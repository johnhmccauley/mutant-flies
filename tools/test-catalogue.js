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
  /* An unrated level is not a nought-star level, and it is not a
     one-star level either. Unrated means unknown, so it sits exactly at
     the middle - above the level somebody has actually disliked, below
     anything that has earned a good word. A new level that sorted under
     every one-star in the catalogue would never be seen long enough to
     get rated at all. */
  const a = lvl("a", { avg: 1, plays: 0, created: 5 });
  const b = lvl("b", { plays: 0, created: 9 });          /* nobody has rated it */
  ok("a level nobody has rated outranks one that has been disliked",
     order([a, b], "stars"), ["b", "a"]);
  ok("but it shows no stars at all rather than pretending to some",
     [C.stars(b), C.stars(a)], [null, 1]);
}
{
  /* the reason for all of this: one forged five must not beat a level
     with two hundred real ratings */
  const forged = lvl("forged", { avg: 5, votes: 1, created: 9 });
  const earned = lvl("earned", { avg: 4.8, votes: 200, created: 1 });
  ok("one forged five-star does not top a level with two hundred real ones",
     order([forged, earned], "stars"), ["earned", "forged"]);
  ok("and the level still SHOWS the honest average it was given",
     [C.stars(forged), C.stars(earned)], [5, 4.8]);
}
{
  /* and it fades: once the votes are real, the correction stops mattering */
  const few = lvl("few", { avg: 5, votes: 3 });
  const many = lvl("many", { avg: 5, votes: 300 });
  ok("three fives rank below three hundred fives", order([few, many], "stars"), ["many", "few"]);
  ok("and by three hundred the shrinking is all but gone",
     C.rank(many) > 4.9, true);
}
{
  /* a single grumpy vote should not bury a level for ever either */
  const grumpy = lvl("grumpy", { avg: 1, votes: 1 });
  const bad = lvl("bad", { avg: 1, votes: 60 });
  ok("one bad review hurts far less than sixty", C.rank(grumpy) > C.rank(bad), true);
}
{
  /* and the order is total: two levels born in the same millisecond do
     not swap places between one render and the next */
  const a = lvl("a", { avg: 4, plays: 2, created: 500 });
  const b = lvl("b", { avg: 4, plays: 2, created: 500 });
  ok("levels made in the same instant still have a fixed order",
     [order([a, b], "stars"), order([b, a], "stars")], [["b", "a"], ["b", "a"]]);
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
const amy = { id: "amy", reached: 9, paid: true, played: {} };
const bob = { id: "bob", reached: 9, paid: true, played: {} };
const cid = { id: "cid", reached: 9, paid: false, played: {} };
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
  /* and so are your own. The dollar is what buys the editor, so an
     author who has not paid is one who has lost their key and started
     again on a new machine - and they are back to the five free cellars
     like anybody else until they paste their recovery code in. */
  ok("including the author's own, if the money is not there",
     C.canPlay(r, { id: "amy", reached: 9, paid: false, played: {} }), false);
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


console.log("\nWhat a dollar buys\n");
{
  const early = C.gate({ id: "a", reached: 4, paid: false });
  ok("cellars one to four say nothing about any of it",
     [early.editorShown, early.catalogueShown], [false, false]);
}
{
  const early = C.gate({ id: "a", reached: 4, paid: true });
  ok("and not even if you have paid - it is the fifth that opens it",
     [early.editorShown, early.catalogueShown], [false, false]);
}
{
  const free = C.gate({ id: "a", reached: 5, paid: false });
  ok("at the fifth both appear, and neither works",
     [free.editorShown, free.editorEnabled, free.catalogueShown, free.cataloguePlayable],
     [true, false, true, false]);
  ok("and the descent stops there", [C.canDescend({ paid: false }, 5), C.canDescend({ paid: false }, 6)],
     [true, false]);
}
{
  const paid = C.gate({ id: "a", reached: 5, paid: true });
  ok("a dollar turns all four on",
     [paid.editorShown, paid.editorEnabled, paid.catalogueShown, paid.cataloguePlayable],
     [true, true, true, true]);
  ok("and lets the descent carry on", C.canDescend({ paid: true }, 400), true);
}
{
  /* a free player browses the whole catalogue and opens none of it -
     including, since making one needs the editor, their own */
  const r = lvl("r", { state: C.PUBLIC, owner: "amy" });
  const looker = { id: "zoe", reached: 9, paid: false, played: {} };
  ok("a free player can see a level but not play it",
     [C.visibleTo(r, looker), C.canPlay(r, looker)], [true, false]);
  const owner = { id: "amy", reached: 9, paid: false, played: {} };
  ok("and cannot play their own either once the money has lapsed",
     C.canPlay(r, owner), false);
  ok("nor edit it", C.canEdit(r, owner), false);
  ok("nor make a new one", C.canCreate(owner), false);
}
{
  const owner = { id: "amy", reached: 9, paid: true, played: {} };
  const r = lvl("r", { state: C.PRIVATE, owner: "amy", everPublic: false });
  ok("a paid author may make and edit", [C.canCreate(owner), C.canEdit(r, owner)], [true, true]);
  const tooEarly = { id: "amy", reached: 3, paid: true, played: {} };
  ok("but not before the fifth cellar", C.canCreate(tooEarly), false);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
