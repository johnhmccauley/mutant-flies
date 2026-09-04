/* =====================================================================
   THE CATALOGUE SERVER

   Every rule about who may do what already exists in src/catalogue.js,
   because the game needs to know them to draw the right buttons. None of
   that is worth anything here. A browser is not a place you can enforce
   a rule - it is a place you can be polite about one - so every single
   predicate is checked again on this side, against the database, before
   anything is written.

   Identity is the interesting part, because there are no accounts. A
   player is a public key: their id is a thumbprint of it, generated on
   their own machine and never registered anywhere. So a request that
   changes something carries the key, and a signature over a nonce this
   server issued a moment ago, and the server checks three things:

     the key really does thumbprint to the id being claimed
     the signature really was made by that key
     the nonce was one of ours, has not been used, and has not expired

   Which is enough. Nobody had to be trusted to hand out identities, and
   a captured request cannot be replayed, because its nonce is spent.

   The one thing this cannot do is tell a person from a program. Somebody
   determined can mint ten thousand keys. That is what the paywall does
   double duty for: the entitlement is the write credential, so a forged
   army of players is an army somebody paid for.
   ===================================================================== */

const PRIOR = 3.5, PRIOR_WEIGHT = 10;   /* must match src/catalogue.js */
const NONCE_TTL = 120 * 1000;           /* two minutes to sign and send */
const MAX_BODY = 8000;                  /* a level packs to ~1.9k; this is slack */
const MAX_NAME = 48;
const MAX_THUMB = 60000;                /* a 384x240 jpeg of a dark room, with room to spare */
const PAGE = 50;
const ROYALTY = 2;                      /* must match src/credits.js */
const PODIUM = [
  { place: "gold", award: 1000 },
  { place: "silver", award: 600 },
  { place: "bronze", award: 300 }
];

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      /* the _headers file does not touch responses a Worker makes, so
         this has to be said here or the catalogue inherits caching and
         a player sees yesterday's board */
      "Cache-Control": "no-store",
      ...extra
    }
  });
const oops = (status, say) => json({ error: say }, status);

/* ---- the same maths the client sorts by --------------------------- */
export function rankScore(sum, count) {
  return (PRIOR_WEIGHT * PRIOR + sum) / (PRIOR_WEIGHT + count);
}

/* ---- identity ------------------------------------------------------ */
const b64 = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (text) => {
  let s = String(text).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
const bytes = (text) => new TextEncoder().encode(text);

export async function thumbprint(rawKey) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", rawKey));
  let s = "";
  for (let i = 0; i < 10; i++) s += ("0" + h[i].toString(16)).slice(-2);
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12) +
         "-" + s.slice(12, 16) + "-" + s.slice(16, 20);
}

export async function hashEmail(email, salt) {
  const h = await crypto.subtle.digest("SHA-256", bytes(salt + "|" + String(email).trim().toLowerCase()));
  return b64(new Uint8Array(h));
}

/* what a signature is actually over: the request, not just the nonce,
   so a signature lifted off one call cannot authorise a different one */
export function claimText(method, path, nonce, body) {
  return method.toUpperCase() + "\n" + path + "\n" + nonce + "\n" + (body || "");
}

async function verifySig(rawKey, text, sig) {
  try {
    const key = await crypto.subtle.importKey("raw", rawKey,
      { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: { name: "SHA-256" } },
      key, unb64(sig), bytes(text));
  } catch (e) { return false; }
}

/* Who is calling, proved. Returns null - never a guess - if anything
   about the proof does not hold. */
export async function whoIsThis(db, req, path, rawBody, now) {
  const id = req.headers.get("x-mf-id");
  const pub = req.headers.get("x-mf-key");
  const nonce = req.headers.get("x-mf-nonce");
  const sig = req.headers.get("x-mf-sig");
  if (!id || !pub || !nonce || !sig) return null;

  let raw;
  try { raw = unb64(pub); } catch (e) { return null; }
  if (await thumbprint(raw) !== id) return null;          /* not that person's key */

  /* spend the nonce first, and only once: a DELETE that changes nothing
     means somebody else got there first, which is a replay */
  const spent = await db.prepare(
    "DELETE FROM nonces WHERE nonce = ? AND expires > ?").bind(nonce, now).run();
  if (!spent.meta || spent.meta.changes !== 1) return null;

  if (!await verifySig(raw, claimText(req.method, path, nonce, rawBody), sig)) return null;
  return { id, pub };
}

async function hasPaid(db, playerId) {
  const row = await db.prepare("SELECT 1 AS ok FROM claims WHERE player_id = ?")
    .bind(playerId).first();
  return !!row;
}

/* ---- the rules, enforced rather than trusted ---------------------- */
function canDelete(lv) { return lv.state === "private" && !lv.ever_public; }
const MOVES = { private: ["public"], public: ["hidden"], hidden: ["public"] };
function canMove(from, to) { return (MOVES[from] || []).includes(to); }

/* Visible to this player: their own always; public to everybody; hidden
   only to somebody who already played it - closed to newcomers, not
   taken away from the people on it. */
async function visible(db, lv, playerId) {
  if (!lv) return false;
  if (lv.owner === playerId) return true;
  if (lv.state === "public") return true;
  if (lv.state === "hidden") {
    const row = await db.prepare(
      "SELECT 1 AS ok FROM plays WHERE level_id = ? AND player_id = ? LIMIT 1")
      .bind(lv.id, playerId).first();
    return !!row;
  }
  return false;
}

const publicShape = (lv) => ({
  id: lv.id, name: lv.name, author: lv.author_name || null,
  authorId: lv.author_uuid || null,
  thumb: lv.thumb || null,
  cellar: lv.cellar, state: lv.state, created: lv.created, edited: lv.edited,
  plays: lv.plays,
  stars: lv.rating_count ? lv.rating_sum / lv.rating_count : null,
  ratings: lv.rating_count
});

const today = (now) => new Date(now).toISOString().slice(0, 10);

/* What uniqueness is judged on. Case and runs of space are not what
   anybody means by a different name, and letting them count would make
   "The Long Drop" and "the  long  drop" two levels - which fools
   nobody and helps nobody. */
function nameKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
const OK_NAME = /^[\w .,'!?()&:-]{2,48}$/;

async function authorOf(db, playerId) {
  return db.prepare("SELECT name, uuid FROM authors WHERE player_id = ?")
    .bind(playerId).first();
}
const thisMonth = (now) => new Date(now).toISOString().slice(0, 7);
function lastMonth(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

/* What the server is holding for somebody. Royalties and podium money
   it counted itself; bought credits it works out from the purchases on
   the address they claimed, rather than storing a per-player number -
   so following a purchase to a second machine counts it again rather
   than granting it again, and there is nothing to grant twice. */
async function walletOf(db, playerId) {
  const w = await db.prepare("SELECT royalties, podium FROM wallets WHERE player_id = ?")
    .bind(playerId).first();
  const claim = await db.prepare("SELECT email_hash FROM claims WHERE player_id = ?")
    .bind(playerId).first();
  let bought = 0;
  if (claim) {
    const b = await db.prepare(
      "SELECT COALESCE(SUM(credits), 0) AS n FROM purchases WHERE email_hash = ?")
      .bind(claim.email_hash).first();
    bought = (b && b.n) || 0;
  }
  const royalties = (w && w.royalties) || 0;
  const podium = (w && w.podium) || 0;
  return { awarded: royalties + podium, royalties, podium, bought, paid: !!claim };
}

/* ------------------------------------------------------------------
   The month's three most played levels, and the bonus for them.

   Ordered the way the board itself is - plays, then the shrunk star
   rank, then newest - so the podium rewards what the catalogue is
   already sorted by. Only plays by somebody OTHER than the author count
   towards it, for the obvious reason.

   Safe to run any number of times: the awards table has one row per
   place per month and the wallet is only credited for a row that was
   actually new. Whoever opens the game first on the first of the month
   closes the last one, and everybody after them changes nothing.
   ------------------------------------------------------------------ */
async function settlePodium(db, period, now) {
  const top = (await db.prepare(
    "SELECT l.id AS level_id, l.owner AS player_id, l.name AS name," +
    " COUNT(*) AS n, l.rank_score AS rank_score, l.created AS created" +
    " FROM plays p JOIN levels l ON l.id = p.level_id" +
    " WHERE p.day LIKE ? AND p.player_id <> l.owner" +
    " GROUP BY l.id" +
    " ORDER BY n DESC, l.rank_score DESC, l.created DESC, l.id DESC" +
    " LIMIT 3").bind(period + "%").all()).results || [];

  const out = [];
  for (let i = 0; i < top.length; i++) {
    const row = top[i], place = PODIUM[i];
    const put = await db.prepare(
      "INSERT OR IGNORE INTO podium_awards" +
      " (period, place, level_id, player_id, plays, amount, at) VALUES (?,?,?,?,?,?,?)")
      .bind(period, place.place, row.level_id, row.player_id, row.n, place.award, now).run();
    const fresh = put.meta && put.meta.changes === 1;
    if (fresh) {
      await db.prepare(
        "INSERT INTO wallets (player_id, podium) VALUES (?, ?)" +
        " ON CONFLICT(player_id) DO UPDATE SET podium = podium + ?")
        .bind(row.player_id, place.award, place.award).run();
    }
    out.push({ place: place.place, levelId: row.level_id, name: row.name,
               author: row.player_id, plays: row.n, award: place.award, paidNow: !!fresh });
  }
  return out;
}

/* ==================================================================== */
export async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;
  const db = env.DB;
  const now = env.NOW ? env.NOW() : Date.now();

  if (!path.startsWith("/api/")) return null;      /* not ours; let the assets have it */
  if (req.method === "OPTIONS") return json({}, 204);

  const rawBody = (req.method === "POST" || req.method === "DELETE")
    ? await req.text() : "";
  let body = {};
  if (rawBody) {
    try { body = JSON.parse(rawBody); }
    catch (e) { return oops(400, "that request was not readable"); }
  }

  /* --- a nonce to sign ------------------------------------------- */
  if (path === "/api/nonce" && req.method === "GET") {
    const nonce = b64(crypto.getRandomValues(new Uint8Array(18)));
    await db.prepare("INSERT INTO nonces (nonce, expires) VALUES (?, ?)")
      .bind(nonce, now + NONCE_TTL).run();
    /* tidy up after ourselves rather than growing a table of dead ones */
    if (ctx && ctx.waitUntil)
      ctx.waitUntil(db.prepare("DELETE FROM nonces WHERE expires < ?").bind(now).run());
    return json({ nonce, expires: now + NONCE_TTL });
  }

  /* --- the board -------------------------------------------------- */
  if (path === "/api/levels" && req.method === "GET") {
    const sort = url.searchParams.get("sort") === "plays" ? "plays" : "stars";
    const limit = Math.min(PAGE, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || PAGE));
    const me = url.searchParams.get("me") || "";
    const cursor = url.searchParams.get("cursor");

    /* Public levels, plus this player's own, plus any hidden one they
       have already played. Hidden levels never reach anybody else. */
    /* Every key descends, including the id. That is not a style
       choice: the keyset below compares whole rows with `<`, and a row
       comparison treats every column as ascending. One column ordered
       the other way and the page boundary silently skips whatever tied
       on the three keys above it - which is exactly the bug that lost
       three levels out of twelve. The id is only there to make the
       order total, so which way it runs does not matter; that it agrees
       with the comparison does. src/catalogue.js sorts the same way. */
    const order = sort === "plays"
      ? "plays DESC, rank_score DESC, created DESC, id DESC"
      : "rank_score DESC, plays DESC, created DESC, id DESC";

    let where = "(state = 'public' OR owner = ?1 OR (state = 'hidden' AND EXISTS " +
                "(SELECT 1 FROM plays p WHERE p.level_id = levels.id AND p.player_id = ?1)))";
    const binds = [me];
    if (cursor) {
      let c;
      try { c = JSON.parse(atob(cursor)); } catch (e) { return oops(400, "that page marker is damaged"); }
      /* keyset, so page fifty costs the same as page one */
      const key = sort === "plays"
        ? "(plays, rank_score, created, id)" : "(rank_score, plays, created, id)";
      const val = sort === "plays"
        ? "(?2, ?3, ?4, ?5)" : "(?2, ?3, ?4, ?5)";
      where += " AND " + key + " < " + val;
      binds.push(sort === "plays" ? c.p : c.r, sort === "plays" ? c.r : c.p, c.c, c.i);
    }

    const rows = (await db.prepare(
      "SELECT * FROM levels WHERE " + where + " ORDER BY " + order + " LIMIT " + (limit + 1)
    ).bind(...binds).all()).results || [];

    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    let next = null;
    if (more && page.length) {
      const last = page[page.length - 1];
      next = btoa(JSON.stringify({ r: last.rank_score, p: last.plays, c: last.created, i: last.id }));
    }
    return json({ sort, levels: page.map(publicShape), cursor: next });
  }

  /* --- one level -------------------------------------------------- */
  const one = path.match(/^\/api\/levels\/([A-Za-z0-9_-]{1,64})$/);
  if (one && req.method === "GET") {
    const lv = await db.prepare("SELECT * FROM levels WHERE id = ?").bind(one[1]).first();
    const me = url.searchParams.get("me") || "";
    if (!lv || !(await visible(db, lv, me))) return oops(404, "no such level");
    const out = publicShape(lv);
    /* the metadata is free to read - that is what a locked catalogue
       shows a player who has not paid. The cellar itself is not. */
    if (lv.owner === me || await hasPaid(db, me)) {
      const b = await db.prepare("SELECT body FROM level_bodies WHERE level_id = ?")
        .bind(lv.id).first();
      out.code = b ? b.body : null;
    } else {
      out.locked = true;
    }
    return json(out);
  }

  /* everything past here changes something, so it has to be proved */
  const who = await whoIsThis(db, req, path, rawBody, now);
  if (!who) return oops(401, "that request was not signed by anybody I can check");

  /* --- who am I, and what have I got ------------------------------ */
  if (path === "/api/me" && req.method === "POST") {
    const paid = await hasPaid(db, who.id);
    const called = await authorOf(db, who.id);
    const mine = (await db.prepare(
      "SELECT * FROM levels WHERE owner = ? ORDER BY created DESC LIMIT 200")
      .bind(who.id).all()).results || [];
    return json({ id: who.id, paid, name: called ? called.name : null,
                  authorId: called ? called.uuid : null,
                  levels: mine.map(publicShape) });
  }

  /* --- put a level up --------------------------------------------- */
  if (path === "/api/levels" && req.method === "POST") {
    if (!await hasPaid(db, who.id)) return oops(402, "the editor is part of the paid game");
    const name = String(body.name || "").trim().slice(0, MAX_NAME);
    const code = String(body.code || "");
    if (!OK_NAME.test(name)) return oops(400, "a level needs a name, of two to forty-eight ordinary characters");
    if (!code || code.length > MAX_BODY) return oops(400, "that level is not a size a level comes in");
    const thumb = String(body.thumb || "").slice(0, MAX_THUMB) || null;
    if (body.thumb && thumb.indexOf("data:image/") !== 0)
      return oops(400, "that picture is not a picture");
    /* the level's own uuid, made where the level was made, so it is the
       same level here as it is in the vault and in a pasted code */
    const id = String(body.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
      return oops(400, "a level needs an id");
    const already = await db.prepare("SELECT owner FROM levels WHERE id = ?").bind(id).first();
    if (already) return oops(409, "there is already a level with that id");
    const me = await authorOf(db, who.id);

    await db.batch([
      db.prepare("INSERT INTO levels (id, owner, owner_key, name, name_key, author_name," +
                 " author_uuid, thumb, cellar, state, ever_public, created, edited, rank_score)" +
                 " VALUES (?,?,?,?,?,?,?,?,?,'private',0,?,?,?)")
        .bind(id, who.id, who.pub, name, nameKey(name), me ? me.name : null,
              me ? me.uuid : null, thumb, parseInt(body.cellar, 10) || 1,
              now, now, rankScore(0, 0)),
      db.prepare("INSERT INTO level_bodies (level_id, body) VALUES (?,?)").bind(id, code)
    ]);
    return json({ id, state: "private" }, 201);
  }

  const mine = path.match(/^\/api\/levels\/([A-Za-z0-9_-]{1,64})(\/[a-z]+)?$/);
  if (mine) {
    const lv = await db.prepare("SELECT * FROM levels WHERE id = ?").bind(mine[1]).first();
    if (!lv) return oops(404, "no such level");
    const sub = mine[2] || "";

    /* --- record a play ------------------------------------------- */
    if (sub === "/play" && req.method === "POST") {
      if (!await visible(db, lv, who.id)) return oops(404, "no such level");
      if (lv.owner !== who.id && !await hasPaid(db, who.id))
        return oops(402, "other people's levels are part of the paid game");
      const op = String(body.op || "").slice(0, 64);
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(op)) return oops(400, "that play has no op id");
      /* Two guards doing different jobs: op_id makes a retry harmless,
         and the day index makes a loop pointless. Both are the database
         refusing, not this code checking - so a race cannot slip past. */
      const put = await db.prepare(
        "INSERT OR IGNORE INTO plays (op_id, level_id, player_id, day, at) VALUES (?,?,?,?,?)")
        .bind(op, lv.id, who.id, today(now), now).run();
      const counted = put.meta && put.meta.changes === 1;
      if (counted) {
        await db.prepare("UPDATE levels SET plays = plays + 1 WHERE id = ?").bind(lv.id).run();
        /* the author is paid for somebody else playing their work - and
           only for somebody else, which with the one-a-day index above
           and the paywall below is what keeps this from being a way of
           printing credits */
        if (lv.owner !== who.id) {
          await db.prepare(
            "INSERT INTO wallets (player_id, royalties) VALUES (?, ?)" +
            " ON CONFLICT(player_id) DO UPDATE SET royalties = royalties + ?")
            .bind(lv.owner, ROYALTY, ROYALTY).run();
        }
      }
      return json({ counted: !!counted, plays: lv.plays + (counted ? 1 : 0) });
    }

    /* --- give it stars ------------------------------------------- */
    if (sub === "/rate" && req.method === "POST") {
      if (!await visible(db, lv, who.id)) return oops(404, "no such level");
      if (lv.owner === who.id) return oops(403, "you cannot rate your own level");
      const played = await db.prepare(
        "SELECT 1 AS ok FROM plays WHERE level_id = ? AND player_id = ? LIMIT 1")
        .bind(lv.id, who.id).first();
      if (!played) return oops(403, "play it first");
      const score = Math.round(Number(body.score));
      if (!(score >= 1 && score <= 5)) return oops(400, "a rating is one to five");

      const had = await db.prepare(
        "SELECT score FROM ratings WHERE level_id = ? AND player_id = ?")
        .bind(lv.id, who.id).first();
      await db.prepare(
        "INSERT INTO ratings (level_id, player_id, score, at) VALUES (?,?,?,?)" +
        " ON CONFLICT(level_id, player_id) DO UPDATE SET score = excluded.score, at = excluded.at")
        .bind(lv.id, who.id, score, now).run();

      /* changing a vote replaces it; it does not add one */
      const sum = lv.rating_sum - (had ? had.score : 0) + score;
      const count = lv.rating_count + (had ? 0 : 1);
      await db.prepare(
        "UPDATE levels SET rating_sum = ?, rating_count = ?, rank_score = ? WHERE id = ?")
        .bind(sum, count, rankScore(sum, count), lv.id).run();
      return json({ stars: sum / count, ratings: count, yours: score });
    }

    /* Everything below is the author's own business. Refusing a private
       level with "that is not yours" would confirm it exists, which is
       exactly what private means it should not do - so anything the
       caller cannot see is a plain not-found, and only a level they can
       see is honestly refused. */
    if (lv.owner !== who.id) {
      return (await visible(db, lv, who.id))
        ? oops(403, "that is not your level")
        : oops(404, "no such level");
    }

    /* --- edit it -------------------------------------------------- */
    if (!sub && req.method === "POST") {
      if (!await hasPaid(db, who.id)) return oops(402, "the editor is part of the paid game");
      const name = body.name === undefined ? lv.name : String(body.name).trim().slice(0, MAX_NAME);
      if (!OK_NAME.test(name)) return oops(400, "a level needs a name, of two to forty-eight ordinary characters");
      if (lv.ever_public && nameKey(name) !== lv.name_key)
        return oops(409, "a level that has been public keeps the name people know it by");
      const thumb2 = body.thumb === undefined ? lv.thumb : String(body.thumb).slice(0, MAX_THUMB);
      const work = [db.prepare("UPDATE levels SET name = ?, name_key = ?, thumb = ?, edited = ? WHERE id = ?")
        .bind(name, nameKey(name), thumb2, now, lv.id)];
      if (body.code !== undefined) {
        const code = String(body.code);
        if (!code || code.length > MAX_BODY) return oops(400, "that level is not a size a level comes in");
        work.push(db.prepare("UPDATE level_bodies SET body = ? WHERE level_id = ?").bind(code, lv.id));
      }
      await db.batch(work);
      return json({ id: lv.id, name, edited: now });
    }

    /* --- publish it, or take it out of the window ------------------ */
    if (sub === "/state" && req.method === "POST") {
      const to = String(body.state || "");
      if (!canMove(lv.state, to))
        return oops(409, "a level cannot go from " + lv.state + " to " + to);
      if (to === "public" && !lv.ever_public) {
        /* going out in public for the first time: it needs a name
           nobody else is using, and so do you */
        const mine = await authorOf(db, who.id);
        if (!mine) return oops(428, "choose a name for yourself before you publish anything");
        const clash = await db.prepare(
          "SELECT id FROM levels WHERE name_key = ? AND ever_public = 1 AND id <> ?")
          .bind(lv.name_key, lv.id).first();
        if (clash) return oops(409, "somebody has already published a level called that");
        await db.prepare("UPDATE levels SET author_name = ?, author_uuid = ? WHERE id = ?")
          .bind(mine.name, mine.uuid, lv.id).run();
      }
      await db.prepare(
        "UPDATE levels SET state = ?, ever_public = ?, edited = ? WHERE id = ?")
        .bind(to, to === "public" ? 1 : lv.ever_public, now, lv.id).run();
      return json({ id: lv.id, state: to, everPublic: to === "public" ? 1 : lv.ever_public });
    }

    /* --- throw it away, if it never went out ---------------------- */
    if (!sub && req.method === "DELETE") {
      if (!canDelete(lv))
        return oops(409, "this level has been public - other people have played it, so it can be hidden but not deleted");
      await db.batch([
        db.prepare("DELETE FROM level_bodies WHERE level_id = ?").bind(lv.id),
        db.prepare("DELETE FROM ratings WHERE level_id = ?").bind(lv.id),
        db.prepare("DELETE FROM plays WHERE level_id = ?").bind(lv.id),
        db.prepare("DELETE FROM levels WHERE id = ?").bind(lv.id)
      ]);
      return json({ deleted: lv.id });
    }
  }

  /* --- what the server says you are owed -------------------------- */
  if (path === "/api/wallet" && req.method === "POST") {
    return json(await walletOf(db, who.id));
  }

  /* --- close a month and pay the podium --------------------------- */
  if (path === "/api/podium" && req.method === "POST") {
    const period = /^\d{4}-\d{2}$/.test(String(body.period || ""))
      ? body.period : lastMonth(now);
    if (period >= thisMonth(now))
      return oops(409, "that month is not over yet");
    const standings = await settlePodium(db, period, now);
    return json({ period, standings });
  }

  /* --- what people call themselves -------------------------------- */
  if (path === "/api/name" && req.method === "POST") {
    const want = String(body.name || "").trim().slice(0, 24);
    if (!OK_NAME.test(want) || want.length < 2)
      return oops(400, "a name of two to twenty-four ordinary characters");
    const key = nameKey(want);
    const taken = await db.prepare("SELECT player_id FROM authors WHERE name_key = ?")
      .bind(key).first();
    if (taken && taken.player_id !== who.id) return oops(409, "somebody is already called that");
    /* One name each, changeable. The old row goes FIRST: there is one
       row per player as well as one per name, so inserting the new name
       before removing the old one is refused by the index - which is
       what happened, and is the index doing its job.

       The uuid is made once and kept for ever after. It is what the
       catalogue points at, so it has to survive the person changing
       what they are called. */
    const had = await db.prepare("SELECT uuid FROM authors WHERE player_id = ?")
      .bind(who.id).first();
    const uuid = had ? had.uuid : crypto.randomUUID();
    await db.prepare("DELETE FROM authors WHERE player_id = ?").bind(who.id).run();
    await db.prepare(
      "INSERT INTO authors (name_key, name, player_id, uuid, at) VALUES (?,?,?,?,?)" +
      " ON CONFLICT(name_key) DO UPDATE SET name = excluded.name," +
      " player_id = excluded.player_id, uuid = excluded.uuid, at = excluded.at")
      .bind(key, want, who.id, uuid, now).run();
    /* the levels already out in public follow the new name, because
       they are still theirs */
    await db.prepare("UPDATE levels SET author_name = ?, author_uuid = ? WHERE owner = ?")
      .bind(want, uuid, who.id).run();
    return json({ name: want, authorId: uuid });
  }

  if (path === "/api/name/free" && req.method === "POST") {
    const key = nameKey(body.name);
    if (!key) return json({ free: false, why: "a name of two characters or more" });
    const taken = await db.prepare("SELECT player_id FROM authors WHERE name_key = ?")
      .bind(key).first();
    return json({ free: !taken || taken.player_id === who.id });
  }

  /* --- claim a purchase onto this machine ------------------------- */
  if (path === "/api/claim" && req.method === "POST") {
    const email = String(body.email || "");
    if (!email) return oops(400, "which purchase?");
    const hash = await hashEmail(email, env.EMAIL_SALT || "mutantfly");
    const ent = await db.prepare("SELECT 1 AS ok FROM entitlements WHERE email_hash = ?")
      .bind(hash).first();
    if (!ent) return oops(404, "nothing has been bought with that address");
    await db.prepare(
      "INSERT INTO claims (player_id, email_hash, at) VALUES (?,?,?)" +
      " ON CONFLICT(player_id) DO UPDATE SET email_hash = excluded.email_hash")
      .bind(who.id, hash, now).run();
    return json({ paid: true });
  }

  return oops(404, "no such thing here");
}

/* ------------------------------------------------------------------
   Stripe. Fulfilment happens here and nowhere else: Stripe says plainly
   that a customer is not guaranteed to reach the page they are sent to
   afterwards, so a success page is not where a purchase gets recorded.
   And it has to be safe to run twice, because Stripe will send the same
   event again if it does not hear a clean answer.
   ------------------------------------------------------------------ */
export async function stripeHook(req, env, verify) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  let event;
  try {
    event = await verify(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return oops(400, "that did not come from Stripe");
  }
  if (event.type !== "checkout.session.completed") return json({ ignored: event.type });

  const session = event.data.object;
  const email = (session.customer_details && session.customer_details.email) ||
                session.customer_email;
  if (!email) return json({ ignored: "no email on the session" });

  const now = env.NOW ? env.NOW() : Date.now();
  const hash = await hashEmail(email, env.EMAIL_SALT || "mutantfly");

  /* A session buying credits carries how many in its metadata; one
     buying the game carries none. Both are keyed on the Stripe session
     id, so the same event arriving twice - which Stripe says plainly it
     may - writes nothing the second time. */
  const credits = parseInt((session.metadata && session.metadata.credits) || "0", 10) || 0;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO entitlements (email_hash, source, reference, at) VALUES (?,'stripe',?,?)" +
      " ON CONFLICT(email_hash) DO NOTHING").bind(hash, session.id, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO purchases (session_id, email_hash, credits, at) VALUES (?,?,?,?)")
      .bind(session.id, hash, credits, now)
  ]);
  return json({ ok: true, credits });
}
