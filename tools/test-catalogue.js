#!/usr/bin/env node
/*
 * The catalogue: ownership, publishing, ratings, and the sort order.
 *
 *   node tools/test-catalogue.js
 *
 * The sort is the part worth pinning down. The two modes are mirror
 * images - by stars breaks ties on plays, by plays breaks ties on stars
 * - and both end on newest-created. It is exactly the sort of rule that
 * reads fine and is implemented backwards, so every clause gets a test
 * that fails if the keys are swapped.
 */
global.window = global;
require("../src/catalogue.js");
const C = global.MutantCatalogue;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}

/* a level record, with only the fields the catalogue looks at */
function lvl(id, opts) {
  opts = opts || {};
  const r = {
    id: id, name: id, owner: opts.owner || "amy",
    state: opts.state || C.PUBLIC,
    everPublic: opts.everPublic !== undefined ? opts.everPublic : (opts.state || C.PUBLIC) !== C.PRIVATE,
    plays: opts.plays || 0,
    created: opts.created || 0,
    ratings: null
  };
  /* n ratings averaging `avg` */
  if (opts.avg !== undefined) {
    const n = opts.votes || 1;
    r.ratings = { total: opts.avg * n, count: n, by: {} };
  }
  return r;
}
const order = (list, by) => C.sortLevels(list, by).map((r) => r.id);

console.log("\nThe order things come in\n");
{
  const a = lvl("a", { avg: 5 }), b = lvl("b", { avg: 3 }), c = lvl("c", { avg: 4 });
  ok("by stars, most stars first", order([b, c, a], "stars"), ["a", "c", "b"]);
}
{
  const a = lvl("a", { plays: 3 }), b = lvl("b", { plays: 90 }), c = lvl("c", { plays: 40 });
  ok("by plays, most played first", order([a, b, c], "plays"), ["b", "c", "a"]);
}
{
  /* same stars: the busier one wins */
  const a = lvl("a", { avg: 4, plays: 10 });
  const b = lvl("b", { avg: 4, plays: 900 });
  ok("stars tied, so times played breaks it", order([a, b], "stars"), ["b", "a"]);
}
{
  /* same plays: the better-liked one wins - the mirror of the above */
  const a = lvl("a", { avg: 2, plays: 50 });
  const b = lvl("b", { avg: 5, plays: 50 });
  ok("plays tied, so stars breaks it", order([a, b], "plays"), ["b", "a"]);
}
{
  /* the two modes are genuinely different rules, not one rule reversed:
     the same three levels come out in a different order under each */
  const a = lvl("a", { avg: 5, plays: 10, created: 1 });
  const b = lvl("b", { avg: 3, plays: 99, created: 2 });
  ok("the two modes disagree, which is the whole point",
     [order([a, b], "stars"), order([a, b], "plays")], [["a", "b"], ["b", "a"]]);
}
{
  /* third key, both ways round */
  const a = lvl("a", { avg: 4, plays: 7, created: 100 });
  const b = lvl("b", { avg: 4, plays: 7, created: 900 });
  ok("everything tied, so the newest goes first - sorting by stars",
     order([a, b], "stars"), ["b", "a"]);
  ok("and the same when sorting by plays", order([a, b], "plays"), ["b", "a"]);
}
{
  /* an unrated level is not a nought-star level */
  const a = lvl("a", { avg: 1, plays: 0, created: 5 });
  const b = lvl("b", { plays: 0, created: 9 });          /* nobody has rated it */
  ok("a level nobody has rated sorts below a one-star one",
     order([b, a], "stars"), ["a", "b"]);
}
{
  /* and the order is total: two levels born in the same millisecond do
     not swap places between one render and the next */
  const a = lvl("a", { avg: 4, plays: 2, created: 500 });
  const b = lvl("b", { avg: 4, plays: 2, created: 500 });
  ok("levels made in the same instant still have a fixed order",
     [order([a, b], "stars"), order([b, a], "stars")], [["a", "b"], ["a", "b"]]);
}
{
  const many = [];
  for (let i = 0; i < 40; i++) many.push(lvl("n" + i, { avg: i % 5 + 1, plays: i % 7, created: i }));
  const s = C.sortLevels(many, "stars");
  let sane = true;
  for (let i = 1; i < s.length; i++) {
    const p = C.stars(s[i - 1]), q = C.stars(s[i]);
    if (p < q) sane = false;
    if (p === q && (s[i - 1].plays < s[i].plays)) sane = false;
  }
  ok("forty levels come out in a consistent order", sane, true);
}
{
  ok("sorting does not disturb the list it was given", (function () {
    const l = [lvl("a", { avg: 1 }), lvl("b", { avg: 5 })];
    C.sortLevels(l, "stars");
    return l.map((r) => r.id);
  })(), ["a", "b"]);
}

console.log("\nWho may do what\n");
const amy = { id: "amy", paid: true, played: {} };
const bob = { id: "bob", paid: true, played: {} };
const cid = { id: "cid", paid: false, played: {} };
{
  const r = lvl("r", { state: C.PRIVATE, everPublic: false });
  ok("a private level is the author's alone",
     [C.visibleTo(r, amy), C.visibleTo(r, bob)], [true, false]);
  ok("and can be deleted while it is", C.canDelete(r), true);
}
{
  const r = lvl("r", { state: C.PRIVATE, everPublic: false });
  ok("private goes public", [C.move(r, C.PUBLIC), r.state, r.everPublic],
     [true, C.PUBLIC, true]);
  ok("and once public it cannot be deleted", C.canDelete(r), false);
  ok("public goes hidden", [C.move(r, C.HIDDEN), r.state], [true, C.HIDDEN]);
  ok("but hiding it does not make it deletable again", C.canDelete(r), false);
  ok("and it cannot be put back to private", C.canMove(r, C.PRIVATE), false);
  ok("hidden goes public again", [C.move(r, C.PUBLIC), r.state], [true, C.PUBLIC]);
}
{
  /* hidden: closed to newcomers, not withdrawn from the people on it */
  const r = lvl("r", { state: C.HIDDEN });
  const old = { id: "old", paid: true, played: { r: true } };
  ok("a hidden level stays with whoever already played it",
     [C.visibleTo(r, old), C.visibleTo(r, bob), C.visibleTo(r, amy)],
     [true, false, true]);
}
{
  const r = lvl("r", { state: C.PUBLIC, owner: "amy" });
  ok("other people's levels are for paying players",
     [C.canPlay(r, bob), C.canPlay(r, cid)], [true, false]);
  ok("but the author never has to pay for their own",
     C.canPlay(r, { id: "amy", paid: false, played: {} }), true);
}
{
  const r = lvl("r", { state: C.PUBLIC, owner: "amy" });
  ok("only the author may edit", [C.canEdit(r, amy), C.canEdit(r, bob)], [true, false]);
}

console.log("\nStars\n");
{
  const r = lvl("r", { state: C.PUBLIC, owner: "amy" });
  ok("you cannot rate a level you have not played", C.canRate(r, bob), false);
  bob.played.r = true;
  ok("and can once you have", C.canRate(r, bob), true);
  ok("the author cannot rate their own", C.canRate(r, { id: "amy", played: { r: true } }), false);
}
{
  const r = lvl("r", { state: C.PUBLIC, owner: "amy" });
  const b = { id: "bob", played: { r: true } }, c = { id: "cid", played: { r: true } };
  C.rate(r, b, 5); C.rate(r, c, 3);
  ok("two ratings average", [r.ratings.count, C.stars(r)], [2, 4]);
  C.rate(r, b, 1);
  ok("changing your mind replaces your vote rather than adding one",
     [r.ratings.count, C.stars(r)], [2, 2]);
  C.rate(r, b, 9);
  ok("a rating outside one to five is pulled back into range", r.ratings.by.bob, 5);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
