#!/usr/bin/env node
/*
 * The catalogue server.
 *
 *   node tools/test-worker.js
 *
 * D1 is SQLite and node has a real SQLite, so the actual schema and the
 * actual queries run here - not a mock of them. Signatures are real too:
 * the requests are signed by src/identity.js, the same code the game
 * ships, and verified by the Worker's own WebCrypto.
 *
 * Which means most of this file is written as an attacker rather than a
 * user. The rules exist in src/catalogue.js as well, but a browser is
 * not a place a rule can be enforced, so what matters is whether the
 * server refuses when the client is lying.
 */
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

global.window = global;
require("../src/identity.js");
const W = global.MutantWho;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}

/* ---- D1, as far as the Worker is concerned ------------------------ */
function d1(sqlite) {
  const wrap = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    first() {
      const r = sqlite.prepare(sql).get(...this._args);
      return Promise.resolve(r === undefined ? null : r);
    },
    all() { return Promise.resolve({ results: sqlite.prepare(sql).all(...this._args) }); },
    run() {
      const r = sqlite.prepare(sql).run(...this._args);
      return Promise.resolve({ meta: { changes: Number(r.changes) } });
    }
  });
  return {
    prepare: wrap,
    batch(list) { return Promise.all(list.map((s) => s.run())); }
  };
}

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(fs.readFileSync(path.join(__dirname, "..", "worker", "schema.sql"), "utf8"));
  return { sqlite, DB: d1(sqlite) };
}

(async function () {
  const api = await import("../worker/api.js");
  const ORIGIN = "https://mutantfly.test";

  /* a player, with a real key, that can sign a real request */
  async function player() {
    const mem = {};
    const store = { durable: true, get: (k) => mem[k] || null, set: (k, v) => { mem[k] = v; return true; }, clear: (k) => { delete mem[k]; } };
    const who = await new W.Who(store).open();
    return who;
  }

  function makeEnv(db, now) {
    return { DB: db.DB, NOW: () => now, EMAIL_SALT: "pepper" };
  }

  async function call(db, who, method, p, body, opts = {}) {
    const now = opts.now || 1_700_000_000_000;
    const env = makeEnv(db, now);
    let headers = {};
    if (who) {
      const n = await api.handle(new Request(ORIGIN + "/api/nonce"), env, null);
      const { nonce } = await n.json();
      const raw = body === undefined ? "" : JSON.stringify(body);
      const text = api.claimText(method, opts.signPath || p, opts.badNonce || nonce, raw);
      const sig = await (opts.signAs || who).sign(text);
      headers = {
        "x-mf-id": opts.claimId || who.id,
        "x-mf-key": opts.claimKey || (opts.signAs || who).pub,
        "x-mf-nonce": opts.badNonce || nonce,
        "x-mf-sig": opts.badSig || sig
      };
    }
    const req = new Request(ORIGIN + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const res = await api.handle(req, env, null);
    return { status: res.status, body: await res.json() };
  }

  /* a player who has paid */
  async function paidUp(db, who, email) {
    db.sqlite.prepare("INSERT INTO entitlements (email_hash, source, reference, at) VALUES (?,'stripe','sess',1)")
      .run(await api.hashEmail(email, "pepper"));
    return call(db, who, "POST", "/api/claim", { email });
  }

  console.log("\nProving who you are, with no account anywhere\n");
  {
    const db = freshDb();
    const amy = await player();
    const r = await call(db, amy, "POST", "/api/me");
    ok("a properly signed request is believed", [r.status, r.body.id], [200, amy.id]);
  }
  {
    const db = freshDb();
    ok("an unsigned request is not", (await call(db, null, "POST", "/api/me")).status, 401);
  }
  {
    const db = freshDb();
    const amy = await player(), bob = await player();
    ok("nor one signed with somebody else's key while claiming your id",
       (await call(db, amy, "POST", "/api/me", undefined, { signAs: bob, claimKey: bob.pub })).status, 401);
  }
  {
    const db = freshDb();
    const amy = await player(), bob = await player();
    ok("nor one that hands over your key but bob's signature",
       (await call(db, amy, "POST", "/api/me", undefined, { signAs: bob })).status, 401);
  }
  {
    const db = freshDb();
    const amy = await player();
    ok("nor one with a nonce this server never issued",
       (await call(db, amy, "POST", "/api/me", undefined, { badNonce: "made-it-up" })).status, 401);
  }
  {
    /* the replay: capture a good request and send it twice */
    const db = freshDb();
    const amy = await player();
    const now = 1_700_000_000_000;
    const env = makeEnv(db, now);
    const n = await api.handle(new Request(ORIGIN + "/api/nonce"), env, null);
    const { nonce } = await n.json();
    const sig = await amy.sign(api.claimText("POST", "/api/me", nonce, ""));
    const h = { "x-mf-id": amy.id, "x-mf-key": amy.pub, "x-mf-nonce": nonce, "x-mf-sig": sig };
    const one = await api.handle(new Request(ORIGIN + "/api/me", { method: "POST", headers: h }), env, null);
    const two = await api.handle(new Request(ORIGIN + "/api/me", { method: "POST", headers: h }), env, null);
    ok("the very same request sent twice works once and then never again",
       [one.status, two.status], [200, 401]);
  }
  {
    const db = freshDb();
    const amy = await player();
    ok("a signature made for one path will not open another",
       (await call(db, amy, "POST", "/api/me", undefined, { signPath: "/api/levels" })).status, 401);
  }
  {
    const db = freshDb();
    const amy = await player();
    const now = 1_700_000_000_000;
    const env = makeEnv(db, now);
    const n = await api.handle(new Request(ORIGIN + "/api/nonce"), env, null);
    const { nonce } = await n.json();
    const sig = await amy.sign(api.claimText("POST", "/api/levels", nonce, JSON.stringify({ name: "a", code: "x" })));
    const res = await api.handle(new Request(ORIGIN + "/api/levels", {
      method: "POST",
      headers: { "x-mf-id": amy.id, "x-mf-key": amy.pub, "x-mf-nonce": nonce, "x-mf-sig": sig },
      body: JSON.stringify({ name: "SOMETHING ELSE", code: "x" })
    }), env, null);
    ok("nor a signature made for one body authorise a different one", res.status, 401);
  }

  console.log("\nThe money\n");
  {
    const db = freshDb();
    const amy = await player();
    const r = await call(db, amy, "POST", "/api/levels", { name: "Mine", code: "MFL1", cellar: 6 });
    ok("you cannot put a level up without having paid", r.status, 402);
  }
  {
    const db = freshDb();
    const amy = await player();
    ok("claiming a purchase nobody made is refused",
       (await call(db, amy, "POST", "/api/claim", { email: "nope@example.com" })).status, 404);
  }
  {
    const db = freshDb();
    const amy = await player();
    await paidUp(db, amy, "amy@example.com");
    ok("and once the purchase is claimed the editor opens",
       (await call(db, amy, "POST", "/api/me")).body.paid, true);
  }
  {
    /* one purchase, two machines - that is how somebody moves laptops */
    const db = freshDb();
    const laptop = await player(), phone = await player();
    await paidUp(db, laptop, "amy@example.com");
    await call(db, phone, "POST", "/api/claim", { email: "amy@example.com" });
    ok("the same purchase works on a second machine",
       (await call(db, phone, "POST", "/api/me")).body.paid, true);
  }

  console.log("\nA level's life\n");
  const db = freshDb();
  const amy = await player(), bob = await player(), zoe = await player();
  await paidUp(db, amy, "amy@example.com");
  await paidUp(db, bob, "bob@example.com");
  let LV = null;
  {
    const r = await call(db, amy, "POST", "/api/levels",
      { name: "The Long Drop", code: "MFL1~body~seal", cellar: 12, author: "Amy" });
    LV = r.body.id;
    ok("a new level starts private", [r.status, r.body.state], [201, "private"]);
  }
  {
    const seen = await call(db, null, "GET", "/api/levels?me=" + bob.id);
    ok("and nobody else can see it", seen.body.levels.length, 0);
    ok("nor fetch it directly",
       (await call(db, null, "GET", "/api/levels/" + LV + "?me=" + bob.id)).status, 404);
  }
  {
    ok("the author can see their own", (await call(db, amy, "POST", "/api/me")).body.levels.length, 1);
  }
  {
    const r = await call(db, bob, "POST", "/api/levels/" + LV, { name: "Bob Woz Ere" });
    ok("while it is private, a stranger is not even told it exists", r.status, 404);
  }
  {
    await call(db, amy, "POST", "/api/levels/" + LV + "/state", { state: "public" });
    const seen = await call(db, null, "GET", "/api/levels?me=" + bob.id);
    ok("published, and now everybody can see it", seen.body.levels.map((l) => l.name), ["The Long Drop"]);
  }
  {
    const r = await call(db, null, "GET", "/api/levels/" + LV + "?me=" + zoe.id);
    ok("a player who has not paid sees the level but not the cellar",
       [r.status, r.body.name, r.body.code, r.body.locked],
       [200, "The Long Drop", undefined, true]);
    const p = await call(db, null, "GET", "/api/levels/" + LV + "?me=" + bob.id);
    ok("and a player who has paid gets the cellar itself", p.body.code, "MFL1~body~seal");
  }
  {
    const r = await call(db, bob, "POST", "/api/levels/" + LV, { name: "Bob Woz Ere" });
    ok("but once it is public the refusal is honest rather than coy",
       [r.status, r.body.error], [403, "that is not your level"]);
  }
  {
    const r = await call(db, amy, "DELETE", "/api/levels/" + LV, {});
    ok("it cannot be deleted now that it has been public",
       [r.status, /other people have played it/.test(r.body.error)], [409, true]);
  }
  {
    const r = await call(db, amy, "POST", "/api/levels/" + LV + "/state", { state: "private" });
    ok("nor put back to private", r.status, 409);
  }

  console.log("\nCounting plays\n");
  {
    const a = await call(db, bob, "POST", "/api/levels/" + LV + "/play", { op: "op-aaaaaaaa" });
    const b = await call(db, bob, "POST", "/api/levels/" + LV + "/play", { op: "op-aaaaaaaa" });
    ok("the same play sent twice counts once", [a.body.counted, b.body.counted], [true, false]);
  }
  {
    const c = await call(db, bob, "POST", "/api/levels/" + LV + "/play", { op: "op-bbbbbbbb" });
    ok("and a second play the same day does not count either", c.body.counted, false);
  }
  {
    const c = await call(db, bob, "POST", "/api/levels/" + LV + "/play",
      { op: "op-cccccccc" }, { now: 1_700_000_000_000 + 86400000 * 2 });
    ok("but the next day it does", c.body.counted, true);
  }
  {
    const r = await call(db, zoe, "POST", "/api/levels/" + LV + "/play", { op: "op-dddddddd" });
    ok("somebody who has not paid cannot play it at all", r.status, 402);
  }

  console.log("\nStars\n");
  {
    const r = await call(db, amy, "POST", "/api/levels/" + LV + "/rate", { score: 5 });
    ok("the author cannot rate their own level", r.status, 403);
  }
  {
    const zoePaid = await player();
    const r = await call(db, zoePaid, "POST", "/api/levels/" + LV + "/rate", { score: 5 });
    ok("nor can somebody who has never played it", r.status, 403);
  }
  {
    const r = await call(db, bob, "POST", "/api/levels/" + LV + "/rate", { score: 4 });
    ok("somebody who has played it can", [r.status, r.body.stars, r.body.ratings], [200, 4, 1]);
  }
  {
    const r = await call(db, bob, "POST", "/api/levels/" + LV + "/rate", { score: 2 });
    ok("changing your mind replaces your vote rather than adding one",
       [r.body.stars, r.body.ratings], [2, 1]);
  }
  {
    const r = await call(db, bob, "POST", "/api/levels/" + LV + "/rate", { score: 9 });
    ok("a rating outside one to five is refused outright", r.status, 400);
  }
  {
    const row = db.sqlite.prepare("SELECT rank_score, rating_sum, rating_count FROM levels WHERE id=?").get(LV);
    ok("and the rank the board sorts on is kept in step",
       Math.abs(row.rank_score - api.rankScore(2, 1)) < 1e-9, true);
  }

  console.log("\nHidden means closed to newcomers, not taken away\n");
  {
    await call(db, amy, "POST", "/api/levels/" + LV + "/state", { state: "hidden" });
    const newcomer = await player();
    await paidUp(db, newcomer, "new@example.com");
    ok("a newcomer cannot see it", (await call(db, null, "GET", "/api/levels?me=" + newcomer.id)).body.levels.length, 0);
    ok("nor fetch it", (await call(db, null, "GET", "/api/levels/" + LV + "?me=" + newcomer.id)).status, 404);
    const had = await call(db, null, "GET", "/api/levels?me=" + bob.id);
    ok("but somebody who already played it keeps it", had.body.levels.length, 1);
    ok("and the author still sees it", (await call(db, amy, "POST", "/api/me")).body.levels.length, 1);
  }
  {
    const r = await call(db, amy, "DELETE", "/api/levels/" + LV, {});
    ok("hiding it does not make it deletable again", r.status, 409);
  }

  console.log("\nThe order of the board, on the server this time\n");
  {
    const d = freshDb();
    const dev = await player();
    await paidUp(d, dev, "dev@example.com");
    const made = {};
    for (const [name, sum, count, plays] of [
      ["forged", 5, 1, 2], ["earned", 960, 200, 40], ["busy", 30, 10, 900], ["fresh", 0, 0, 0]
    ]) {
      const r = await call(d, dev, "POST", "/api/levels", { name, code: "x", cellar: 5 });
      made[name] = r.body.id;
      await call(d, dev, "POST", "/api/levels/" + r.body.id + "/state", { state: "public" });
      d.sqlite.prepare("UPDATE levels SET rating_sum=?, rating_count=?, plays=?, rank_score=? WHERE id=?")
        .run(sum, count, plays, api.rankScore(sum, count), made[name]);
    }
    const byStars = await call(d, null, "GET", "/api/levels?sort=stars&me=x");
    const byPlays = await call(d, null, "GET", "/api/levels?sort=plays&me=x");
    /* the forged five sits above an unrated level and above a mediocre
       one - which is right, a single five is weak evidence of good and
       none at all of bad - but nowhere near two hundred real ratings */
    ok("by stars, a forged five does not beat two hundred real ones",
       byStars.body.levels.map((l) => l.name), ["earned", "forged", "fresh", "busy"]);
    ok("by plays, the busy one leads and the rest fall in behind on stars",
       byPlays.body.levels.map((l) => l.name), ["busy", "earned", "forged", "fresh"]);
    ok("and the two orders really are different rules",
       byStars.body.levels[0].name !== byPlays.body.levels[0].name, true);
  }
  {
    /* paging must not skip or repeat a level */
    const d = freshDb();
    const dev = await player();
    await paidUp(d, dev, "dev@example.com");
    for (let i = 0; i < 12; i++) {
      const r = await call(d, dev, "POST", "/api/levels", { name: "L" + i, code: "x", cellar: 1 });
      await call(d, dev, "POST", "/api/levels/" + r.body.id + "/state", { state: "public" });
      d.sqlite.prepare("UPDATE levels SET plays=?, rank_score=? WHERE id=?").run(i % 3, 3.5, r.body.id);
    }
    const seen = [];
    let cursor = null, pages = 0;
    do {
      const q = "/api/levels?sort=stars&limit=5&me=x" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const r = await call(d, null, "GET", q);
      r.body.levels.forEach((l) => seen.push(l.id));
      cursor = r.body.cursor;
      pages++;
    } while (cursor && pages < 10);
    ok("paging through the board sees every level exactly once",
       [seen.length, new Set(seen).size, pages], [12, 12, 3]);
  }

  console.log("\nRubbish sent on purpose\n");
  {
    const d = freshDb();
    const dev = await player();
    await paidUp(d, dev, "dev@example.com");
    ok("a level with no name is refused",
       (await call(d, dev, "POST", "/api/levels", { name: "  ", code: "x" })).status, 400);
    ok("and one far too big to be a level",
       (await call(d, dev, "POST", "/api/levels", { name: "big", code: "x".repeat(9000) })).status, 400);
    ok("a play with no op id is refused",
       (await call(d, dev, "POST", "/api/levels/nope/play", { op: "!" })).status, 404);
    ok("and a level that does not exist is a plain not-found",
       (await call(d, null, "GET", "/api/levels/madeup?me=x")).status, 404);
  }
  {
    const d = freshDb();
    const dev = await player();
    ok("a damaged page marker says so rather than breaking",
       (await call(d, null, "GET", "/api/levels?cursor=%%%&me=x")).status, 400);
  }

  console.log("\nPaying an author for other people's plays\n");
  {
    const d = freshDb();
    const amy = await player(), bob = await player(), cid = await player();
    for (const [w, e] of [[amy, "amy@x"], [bob, "bob@x"], [cid, "cid@x"]]) await paidUp(d, w, e);
    const r = await call(d, amy, "POST", "/api/levels", { name: "Amy's", code: "x", cellar: 5 });
    const LV = r.body.id;
    await call(d, amy, "POST", "/api/levels/" + LV + "/state", { state: "public" });

    ok("an author starts owed nothing", (await call(d, amy, "POST", "/api/wallet")).body.awarded, 0);

    await call(d, bob, "POST", "/api/levels/" + LV + "/play", { op: "op-11111111" });
    ok("somebody else playing it pays the author",
       (await call(d, amy, "POST", "/api/wallet")).body.royalties, 2);

    await call(d, bob, "POST", "/api/levels/" + LV + "/play", { op: "op-22222222" });
    ok("and the same person again the same day pays nothing more",
       (await call(d, amy, "POST", "/api/wallet")).body.royalties, 2);

    await call(d, cid, "POST", "/api/levels/" + LV + "/play", { op: "op-33333333" });
    ok("a different player does pay again",
       (await call(d, amy, "POST", "/api/wallet")).body.royalties, 4);

    await call(d, amy, "POST", "/api/levels/" + LV + "/play", { op: "op-44444444" });
    ok("but the author playing their own work pays them nothing",
       (await call(d, amy, "POST", "/api/wallet")).body.royalties, 4);

    ok("and a player who has earned nothing is owed nothing",
       (await call(d, bob, "POST", "/api/wallet")).body.awarded, 0);
  }

  console.log("\nGold, silver and bronze\n");
  {
    const d = freshDb();
    const authors = [], LVs = [];
    for (let i = 0; i < 4; i++) {
      const a = await player();
      await paidUp(d, a, "a" + i + "@x");
      authors.push(a);
      const r = await call(d, a, "POST", "/api/levels", { name: "Level " + i, code: "x", cellar: 5 });
      LVs.push(r.body.id);
      await call(d, a, "POST", "/api/levels/" + r.body.id + "/state", { state: "public" });
    }
    /* fourteen, nine, four and one plays last month, by other people */
    const counts = [14, 9, 4, 1];
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < counts[i]; k++) {
        d.sqlite.prepare("INSERT INTO plays (op_id, level_id, player_id, day, at) VALUES (?,?,?,?,1)")
          .run("o" + i + "-" + k, LVs[i], "someone-" + k, "2026-07-1" + (k % 10));
      }
    }
    const NOW = Date.UTC(2026, 7, 3);          /* the third of August */
    const first = await call(d, authors[0], "POST", "/api/podium", { period: "2026-07" }, { now: NOW });
    ok("the three most played get the three places",
       first.body.standings.map((s) => [s.place, s.name, s.plays]),
       [["gold", "Level 0", 14], ["silver", "Level 1", 9], ["bronze", "Level 2", 4]]);
    ok("and the fourth gets nothing", first.body.standings.length, 3);

    const paid = [];
    for (let i = 0; i < 3; i++)
      paid.push((await call(d, authors[i], "POST", "/api/wallet", undefined, { now: NOW })).body.podium);
    ok("gold gets most, bronze least", paid, [1000, 600, 300]);
    ok("and the fourth author gets nothing at all",
       (await call(d, authors[3], "POST", "/api/wallet", undefined, { now: NOW })).body.podium, 0);

    /* whoever opens the game next also closes the month; it must not pay twice */
    const again = await call(d, authors[1], "POST", "/api/podium", { period: "2026-07" }, { now: NOW });
    ok("closing the month a second time pays nobody again",
       [again.body.standings.every((s) => s.paidNow === false),
        (await call(d, authors[0], "POST", "/api/wallet", undefined, { now: NOW })).body.podium],
       [true, 1000]);
    ok("and the standings still read the same",
       again.body.standings.map((s) => s.place), ["gold", "silver", "bronze"]);
  }
  {
    const d = freshDb();
    const amy = await player();
    await paidUp(d, amy, "amy@x");
    const NOW = Date.UTC(2026, 7, 15);
    const r = await call(d, amy, "POST", "/api/podium", { period: "2026-08" }, { now: NOW });
    ok("a month still running cannot be closed", [r.status, r.body.error], [409, "that month is not over yet"]);
  }
  {
    /* the author's own plays must not lift their own level onto the podium */
    const d = freshDb();
    const amy = await player(), bob = await player();
    await paidUp(d, amy, "amy@x"); await paidUp(d, bob, "bob@x");
    const mine = (await call(d, amy, "POST", "/api/levels", { name: "Mine", code: "x", cellar: 5 })).body.id;
    const theirs = (await call(d, bob, "POST", "/api/levels", { name: "Theirs", code: "x", cellar: 5 })).body.id;
    for (const id of [mine, theirs]) {
      const owner = id === mine ? amy : bob;
      await call(d, owner, "POST", "/api/levels/" + id + "/state", { state: "public" });
    }
    /* nine days running, which is all the index will let one player do -
       and still nine times what the honest level got */
    for (let k = 1; k <= 9; k++)
      d.sqlite.prepare("INSERT INTO plays (op_id, level_id, player_id, day, at) VALUES (?,?,?,?,1)")
        .run("self-" + k, mine, amy.id, "2026-07-0" + k);
    d.sqlite.prepare("INSERT INTO plays (op_id, level_id, player_id, day, at) VALUES (?,?,?,?,1)")
      .run("real-1", theirs, "a-stranger", "2026-07-05");
    const NOW = Date.UTC(2026, 7, 3);
    const st = await call(d, amy, "POST", "/api/podium", { period: "2026-07" }, { now: NOW });
    ok("playing your own level every day does not win you gold",
       st.body.standings.map((s) => s.name), ["Theirs"]);
  }

  console.log("\nBuying credits\n");
  {
    const d = freshDb();
    const amy = await player();
    const hash = await api.hashEmail("amy@x", "pepper");
    d.sqlite.prepare("INSERT INTO entitlements (email_hash, source, reference, at) VALUES (?,'stripe','s1',1)").run(hash);
    d.sqlite.prepare("INSERT INTO purchases (session_id, email_hash, credits, at) VALUES ('s1',?,0,1)").run(hash);
    await call(d, amy, "POST", "/api/claim", { email: "amy@x" });
    ok("buying the game buys no credits", (await call(d, amy, "POST", "/api/wallet")).body.bought, 0);

    d.sqlite.prepare("INSERT INTO purchases (session_id, email_hash, credits, at) VALUES ('s2',?,1500,2)").run(hash);
    ok("buying a pack does", (await call(d, amy, "POST", "/api/wallet")).body.bought, 1500);

    /* the same webhook arriving twice, which Stripe says it may */
    const twice = d.sqlite.prepare("INSERT OR IGNORE INTO purchases (session_id, email_hash, credits, at) VALUES ('s2',?,1500,2)").run(hash);
    ok("and the same purchase arriving twice does not buy it twice",
       [Number(twice.changes), (await call(d, amy, "POST", "/api/wallet")).body.bought], [0, 1500]);

    /* the same purchase followed to a second machine */
    const phone = await player();
    await call(d, phone, "POST", "/api/claim", { email: "amy@x" });
    ok("a purchase followed to a second machine is counted, not granted again",
       (await call(d, phone, "POST", "/api/wallet")).body.bought, 1500);
  }
  {
    const d = freshDb();
    const amy = await player();
    ok("somebody who has bought nothing is holding nothing",
       (await call(d, amy, "POST", "/api/wallet")).body, { awarded: 0, royalties: 0, podium: 0, bought: 0, paid: false });
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
