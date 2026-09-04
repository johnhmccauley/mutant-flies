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

/* ------------------------------------------------------------------
   WHEN THE BETA ENDS

   The first of January 2027, midnight Central Time - which is six in
   the morning UTC, because Central is six hours behind in January and
   is not on daylight saving then. Written out as UTC rather than as a
   zone name so it means one instant and not an argument.

   A date rather than a switch, because a switch has to be remembered
   and a date does not, and because a date can be SAID: the game shows
   it, so nobody is charged for something they did not see coming. Set
   BETA_UNTIL to move it without shipping any code.
   ------------------------------------------------------------------ */
const BETA_ENDS = Date.UTC(2027, 0, 1, 6, 0, 0);

function betaEnds(env) {
  if (env && env.BETA_UNTIL) {
    const t = Date.parse(env.BETA_UNTIL);
    if (isFinite(t)) return t;
  }
  return BETA_ENDS;
}
function inBeta(env, now) { return now < betaEnds(env); }

/* ------------------------------------------------------------------
   WHAT YOU ARE GIVEN FOR TURNING UP

   A handful of credits, once, and more of them the earlier you came.
   Somebody who plays it in September is doing something for the game -
   finding what is broken in it, telling somebody about it - that
   somebody arriving the week before it goes paid is not. So the welcome
   starts generous and tapers, day by day, to what a new player gets
   after release.

   Day by day rather than in tiers on purpose. Tiers create a cliff, a
   cliff creates a rush at the edge of it, and somebody always turns up
   an hour late and feels cheated. A straight line has no edge to be on
   the wrong side of.

   It does NOT make the beta an unlimited supply. It is one grant, of
   one size, once - a few lives and a robot at the start, and after that
   credits come the way they always do: by playing, by other people
   playing what you built, or by buying them.
   ------------------------------------------------------------------ */
const WELCOME_EARLY = 1000;      /* the first day of the beta */
const WELCOME_AFTER = 100;       /* the standing grant once it is paid for */
const BETA_STARTS = Date.UTC(2026, 8, 1);        /* 1 September 2026 */

export function welcomeFor(now, env) {
  const ends = betaEnds(env);
  const starts = (env && env.BETA_FROM && isFinite(Date.parse(env.BETA_FROM)))
    ? Date.parse(env.BETA_FROM) : BETA_STARTS;
  if (now >= ends) return WELCOME_AFTER;
  if (now <= starts) return WELCOME_EARLY;
  const through = (now - starts) / (ends - starts);
  return Math.round(WELCOME_EARLY + (WELCOME_AFTER - WELCOME_EARLY) * through);
}

/* Given once. The CASE is what makes it once: a wallet row that already
   exists because somebody was paid a royalty still has welcome at minus
   one, and this fills it in; a row that has already been welcomed is
   left exactly as it is. */
async function welcome(db, playerId, now, env) {
  const amount = welcomeFor(now, env);
  await db.prepare(
    "INSERT INTO wallets (player_id, welcome) VALUES (?, ?)" +
    " ON CONFLICT(player_id) DO UPDATE SET welcome =" +
    " CASE WHEN wallets.welcome < 0 THEN excluded.welcome ELSE wallets.welcome END")
    .bind(playerId, amount).run();
  const row = await db.prepare("SELECT welcome FROM wallets WHERE player_id = ?")
    .bind(playerId).first();
  return (row && row.welcome > 0) ? row.welcome : 0;
}
const ROYALTY = 2;                      /* must match src/credits.js */
const PODIUM = [
  { place: "gold", award: 1000 },
  { place: "silver", award: 600 },
  { place: "bronze", award: 300 }
];

/* ------------------------------------------------------------------
   THE APP KEY

   A second layer, and it is worth being honest about what kind.

   It is NOT identity. Identity is the player's own signing key, made on
   their machine, proved per request, with nothing shared. This is a
   different job: it keeps the API from being a thing anybody can drive
   with curl after reading one URL out of the network tab.

   And it is extractable. It ships inside the page, so anybody who
   really wants it will have it in about a minute. That is fine as long
   as nobody mistakes it for a wall: it stops casual scripting and
   drive-by scraping, it gives the rate limiter something to count
   against, and it does not decide who anybody is or what they own.
   Every rule that matters is still enforced against a signature.

   Several keys are accepted at once so one can be rotated without
   breaking every browser still holding a cached copy of the old page.
   With none configured, everything is allowed - which is what tests and
   a local server want, and is a deliberate choice rather than an
   oversight: a missing secret must not lock the game out of its own
   catalogue.
   ------------------------------------------------------------------ */
function appKeyOk(req, env) {
  const allowed = String(env.APP_KEYS || "").split(",")
    .map((k) => k.trim()).filter(Boolean);
  if (!allowed.length) return true;                  /* not configured */
  const got = req.headers.get("x-mf-app") || "";
  /* constant time, so the answer does not leak the key a byte at a time */
  return allowed.some((k) => {
    if (k.length !== got.length) return false;
    let bad = 0;
    for (let i = 0; i < k.length; i++) bad |= k.charCodeAt(i) ^ got.charCodeAt(i);
    return bad === 0;
  });
}

/* Cloudflare's rate limiter, if one is bound. Counted per player where
   we know who that is and per address where we do not, so one busy
   player cannot use up everybody else's share. */
async function tooFast(env, req, whoId) {
  if (!env.RATE || !env.RATE.limit) return false;
  const key = whoId || req.headers.get("cf-connecting-ip") || "anon";
  try {
    const out = await env.RATE.limit({ key: key });
    return !(out && out.success);
  } catch (e) { return false; }
}

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

/* ------------------------------------------------------------------
   THE STORES

   Money does not arrive the same way twice, and the game does not get
   to choose how. On iOS it is StoreKit and nothing else is permitted;
   on Steam it is the player's wallet; on Android it is Play Billing;
   on the web it is a card processor. So nothing below this line knows
   which one it was - a buyer is a provider and an id that provider
   knows them by, and every store's job is to turn its own kind of
   proof into that pair.

   Each verifier is handed whatever the client presented and answers
   with { who, txn, credits } or throws. Stripe's is written; the others
   are the shape they have to be, and each says plainly that it is not
   wired up yet rather than quietly letting somebody in. That is
   deliberate: a stub that returns "yes" is a free game for anybody who
   reads the source, and the source is right there in the page.
   ------------------------------------------------------------------ */
export const STORES = {
  /* the web. A card through Stripe, arriving as a signed webhook. */
  stripe: {
    async fromWebhook(raw, headers, env, now) {
      const event = await stripeVerify(raw, headers.get("stripe-signature"),
                                       env.STRIPE_WEBHOOK_SECRET, now);
      if (event.type !== "checkout.session.completed") return null;
      const s = event.data.object;
      const email = (s.customer_details && s.customer_details.email) || s.customer_email;
      if (!email) return null;
      return {
        who: "stripe:" + await hashEmail(email, env.EMAIL_SALT || "mutantfly"),
        txn: s.id,
        credits: parseInt((s.metadata && s.metadata.credits) || "0", 10) || 0
      };
    },
    /* somebody who lost the machine they bought on types the address */
    async fromClient(claim, env) {
      if (!claim || !claim.email) throw new Error("which purchase?");
      return { who: "stripe:" + await hashEmail(claim.email, env.EMAIL_SALT || "mutantfly") };
    }
  },

  /* iOS. StoreKit signs a transaction as a JWS; the server checks it
     against Apple's root and reads originalTransactionId out of it.
     Apple does not permit any other way of unlocking anything, so there
     is no web-purchase path to fall back on inside the app. */
  apple: {
    async fromClient(claim, env) {
      if (!env.APPLE_ISSUER_KEY) throw new Error("the App Store is not wired up yet");
      throw new Error("the App Store is not wired up yet");
    }
  },

  /* Steam. The player is already signed in to Steam, so the client
     hands over a ticket and the server asks Steam who it belongs to
     (ISteamUserAuth) and what they own (ISteamMicroTxn). */
  steam: {
    async fromClient(claim, env) {
      if (!env.STEAM_WEB_API_KEY) throw new Error("Steam is not wired up yet");
      throw new Error("Steam is not wired up yet");
    }
  },

  /* Android. A Play Billing purchase token, verified against the Play
     Developer API, keyed on the obfuscated account id. */
  google: {
    async fromClient(claim, env) {
      if (!env.PLAY_SERVICE_ACCOUNT) throw new Error("Play is not wired up yet");
      throw new Error("Play is not wired up yet");
    }
  },

  /* itch.io, which hands the buyer a download key and will confirm one */
  itch: {
    async fromClient(claim, env) {
      if (!env.ITCH_API_KEY) throw new Error("itch.io is not wired up yet");
      throw new Error("itch.io is not wired up yet");
    }
  }
};

/* One way in for every store: record the purchase, and the entitlement
   with it. Safe to run twice for the same transaction, because every
   store will send at least one of them twice. */
export async function grant(db, sale, provider, now) {
  const key = sale.who;
  await db.batch([
    db.prepare("INSERT INTO entitlements (who_key, provider, reference, at)" +
               " VALUES (?,?,?,?) ON CONFLICT(who_key) DO NOTHING")
      .bind(key, provider, sale.txn || null, now),
    db.prepare("INSERT OR IGNORE INTO purchases (provider, txn, who_key, credits, at)" +
               " VALUES (?,?,?,?,?)")
      .bind(provider, sale.txn || ("gift-" + key), key, sale.credits | 0, now)
  ]);
  return { who: key, credits: sale.credits | 0 };
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

/* ------------------------------------------------------------------
   THE BETA

   Until the date above, everything is free - and everybody who turns up
   before it is quietly given a permanent entitlement, keyed on their
   own player id. So on the morning the beta ends, every player who was
   there beforehand keeps everything they had, without being asked for
   anything and without anybody having to remember to do it.

   That is the whole reason it is done this way round rather than as a
   flag that simply opens the gates. A flag opens the gates and then
   shuts them on the people who were already inside. This lets them in
   and gives them a key on the way past.

   Going free to paid is also the only direction that works. Steam
   allows a paid game to be made free and heavily restricts the reverse;
   and people who paid early and then watch it go free feel robbed,
   while people who got in free and then watch it go paid feel lucky.
   Same event, opposite feelings, and the order decides which.
   ------------------------------------------------------------------ */
async function hasPaid(db, playerId, env, now) {
  const row = await db.prepare("SELECT 1 AS ok FROM claims WHERE player_id = ?")
    .bind(playerId).first();
  if (row) return true;
  if (!inBeta(env, now || 0)) return false;

  /* here during the beta: let them in, and give them the key */
  const key = "beta:" + playerId;
  await db.batch([
    db.prepare("INSERT INTO entitlements (who_key, provider, reference, at)" +
               " VALUES (?,'beta','open beta',?) ON CONFLICT(who_key) DO NOTHING")
      .bind(key, now || 0),
    db.prepare("INSERT INTO claims (player_id, who_key, at) VALUES (?,?,?)" +
               " ON CONFLICT(player_id) DO NOTHING")
      .bind(playerId, key, now || 0)
  ]);
  return true;
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
  const w = await db.prepare("SELECT royalties, podium, welcome FROM wallets WHERE player_id = ?")
    .bind(playerId).first();
  const claim = await db.prepare("SELECT who_key FROM claims WHERE player_id = ?")
    .bind(playerId).first();
  let bought = 0;
  if (claim) {
    const b = await db.prepare(
      "SELECT COALESCE(SUM(credits), 0) AS n FROM purchases WHERE who_key = ?")
      .bind(claim.who_key).first();
    bought = (b && b.n) || 0;
  }
  const royalties = (w && w.royalties) || 0;
  const podium = (w && w.podium) || 0;
  const given = (w && w.welcome > 0) ? w.welcome : 0;
  return { awarded: royalties + podium + given,
           royalties, podium, welcome: given, bought, paid: !!claim };
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
  if (!appKeyOk(req, env)) return oops(403, "this is the game's catalogue, not a public API");
  if (await tooFast(env, req, req.headers.get("x-mf-id"))) return oops(429, "slow down");

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
    if (lv.owner === me || await hasPaid(db, me, env, now)) {
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
    const paid = await hasPaid(db, who.id, env, now);
    const given = await welcome(db, who.id, now, env);
    const called = await authorOf(db, who.id);
    const mine = (await db.prepare(
      "SELECT * FROM levels WHERE owner = ? ORDER BY created DESC LIMIT 200")
      .bind(who.id).all()).results || [];
    return json({ id: who.id, paid, name: called ? called.name : null,
                  authorId: called ? called.uuid : null,
                  /* said out loud, so the game can say it too */
                  beta: inBeta(env, now), betaUntil: betaEnds(env),
                  welcome: given, welcomeNow: welcomeFor(now, env),
                  levels: mine.map(publicShape) });
  }

  /* --- put a level up --------------------------------------------- */
  if (path === "/api/levels" && req.method === "POST") {
    if (!await hasPaid(db, who.id, env, now)) return oops(402, "the editor is part of the paid game");
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
      if (lv.owner !== who.id && !await hasPaid(db, who.id, env, now))
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
      if (!await hasPaid(db, who.id, env, now)) return oops(402, "the editor is part of the paid game");
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
    await welcome(db, who.id, now, env);
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
    const provider = String(body.provider || "stripe");
    const store = STORES[provider];
    if (!store || !store.fromClient) return oops(400, "no such shop");
    let sale;
    try {
      sale = await store.fromClient(body, env);
    } catch (e) {
      return oops(400, e.message || "that could not be checked");
    }
    const ent = await db.prepare("SELECT 1 AS ok FROM entitlements WHERE who_key = ?")
      .bind(sale.who).first();
    /* A store that can vouch for the purchase itself - Apple, Steam,
       Play - has just done so, and its answer is the record. Stripe
       cannot: an email address is a claim, not a proof, so there has
       to be a purchase already on file to match it against. */
    if (!ent) {
      if (!sale.txn) return oops(404, "nothing has been bought that way");
      await grant(db, sale, provider, now);
    }
    await db.prepare(
      "INSERT INTO claims (player_id, who_key, at) VALUES (?,?,?)" +
      " ON CONFLICT(player_id) DO UPDATE SET who_key = excluded.who_key")
      .bind(who.id, sale.who, now).run();
    return json({ paid: true, provider: provider });
  }

  return oops(404, "no such thing here");
}

/* ------------------------------------------------------------------
   Checking a webhook really came from Stripe.

   Written out rather than pulled in. The Stripe SDK is a large
   dependency whose signature check reaches for Node's crypto, which
   does not exist in a Worker - the documented fix is to hand it a
   WebCrypto provider, and at that point the only thing being used is
   thirty lines of HMAC. So here are the thirty lines.

   The header is `t=<unix seconds>,v1=<hex hmac>`, and the thing signed
   is the timestamp, a dot, and the raw body - the RAW body, before any
   parsing, because re-serialising JSON changes the bytes and the
   signature is over bytes. The timestamp is checked as well as the
   signature, or a genuine old request could be replayed for ever.
   ------------------------------------------------------------------ */
const STRIPE_TOLERANCE = 5 * 60;        /* seconds either side */

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let bad = 0;
  for (let i = 0; i < a.length; i++) bad |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return bad === 0;
}

export async function stripeVerify(raw, header, secret, now) {
  if (!header || !secret) throw new Error("unsigned");
  const parts = {};
  for (const bit of String(header).split(",")) {
    const eq = bit.indexOf("=");
    if (eq > 0) {
      const k = bit.slice(0, eq).trim();
      /* several v1= signatures can be present while a secret is being
         rotated, and any one of them matching is enough */
      if (k === "v1") (parts.v1 = parts.v1 || []).push(bit.slice(eq + 1).trim());
      else parts[k] = bit.slice(eq + 1).trim();
    }
  }
  if (!parts.t || !parts.v1) throw new Error("no signature");
  const age = Math.abs(Math.floor((now || Date.now()) / 1000) - parseInt(parts.t, 10));
  if (!isFinite(age) || age > STRIPE_TOLERANCE) throw new Error("stale");

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(parts.t + "." + raw));
  let want = "";
  for (const b of new Uint8Array(mac)) want += ("0" + b.toString(16)).slice(-2);
  if (!parts.v1.some((got) => timingSafeEqual(got, want))) throw new Error("bad signature");
  return JSON.parse(raw);
}

/* ------------------------------------------------------------------
   Stripe. Fulfilment happens here and nowhere else: Stripe says plainly
   that a customer is not guaranteed to reach the page they are sent to
   afterwards, so a success page is not where a purchase gets recorded.
   And it has to be safe to run twice, because Stripe will send the same
   event again if it does not hear a clean answer.
   ------------------------------------------------------------------ */
export async function storeHook(req, env, provider) {
  const store = STORES[provider];
  if (!store || !store.fromWebhook) return oops(404, "no such shop");
  const raw = await req.text();
  const now = env.NOW ? env.NOW() : Date.now();
  let sale;
  try {
    sale = await store.fromWebhook(raw, req.headers, env, now);
  } catch (e) {
    return oops(400, "that did not come from " + provider);
  }
  if (!sale) return json({ ignored: true });
  const got = await grant(env.DB, sale, provider, now);
  return json({ ok: true, credits: got.credits });
}

/* kept under its old name because that is what the route is called */
export function stripeHook(req, env) { return storeHook(req, env, "stripe"); }

export const _test = { appKeyOk, betaEnds, inBeta, BETA_ENDS,
                       WELCOME_EARLY, WELCOME_AFTER, BETA_STARTS };
