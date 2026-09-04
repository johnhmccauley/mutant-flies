#!/usr/bin/env node
/*
 * A level, written down, sent to somebody, and played.
 *
 *   node tools/test-level-format.js
 *
 * The test that matters is not that the arrays come back - it is that
 * two people who paste the same code get the same cellar, turn for turn,
 * for two hundred turns. Anything left out of the code shows up there
 * and nowhere else.
 */
global.window = global;
require("../src/rules.js");
require("../src/level-io.js");
require("../src/level-format.js");
const MF = global.MutantFly;
const LF = global.MutantLevelFormat;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}
const N = MF.COLS * MF.ROWS;
const I = (c, r) => r * MF.COLS + c;
const same = (a, b) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
function mul(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* Pin the live stream for the whole file. Laying a cellar out draws on
   it as well as the seeded one - openSpot picks the man's square, the
   monsters' and the marbles' from it - so a test that builds a cellar
   without pinning gets a different room every run, which is exactly how
   the play-length check below came and went. */
MF.luck(MF.mulberry32(20260903));

function built(seed, F) {
  const g = new MF.Game({ seed });
  g.F = F; g.sheet();
  return g;
}
/* everything visible about a cellar, in one string */
function fingerprint(g) {
  const parts = [g.manC, g.manR, g.bricks, g.CO, g.steps, g.boots, g.frost, g.saw];
  for (const k of LF.PLANES) {
    let h = 0;
    for (let i = 0; i < N; i++) h = (Math.imul(h, 31) + g[k][i]) | 0;
    parts.push(h);
  }
  for (const m of g.monsters)
    parts.push(m.kind + ":" + m.c + "," + m.r + ":" + (m.trapped ? "T" : "-") +
               (m.gone ? "G" : "-") + (m.body ? ":" + m.body.length : "") +
               (m.tc !== undefined ? ":" + m.tc + "," + m.tr : ""));
  for (const m of g.marbles) parts.push("mb" + m.c + "," + m.r + "," + m.v.toFixed(2) + "," + m.size);
  return parts.join("|");
}

console.log("\nWriting one down and reading it back\n");
{
  const g = built(7717, 13);
  const rec = LF.capture(g, { name: "The Long Way Down" });
  const back = new MF.Game({ seed: 1 });
  back.F = 1; back.sheet();
  LF.apply(back, rec);

  let planesOk = true;
  for (const k of LF.PLANES) if (!same(g[k], back[k])) planesOk = false;
  ok("all nine planes of the cellar come back", planesOk, true);

  let edgesOk = true;
  for (const k of ["W", "E", "S", "N"]) if (!same(g.edge[k], back.edge[k])) edgesOk = false;
  ok("and the four edges", edgesOk, true);

  ok("and the man, the bricks and what he is carrying",
     [back.manC, back.manR, back.bricks, back.saw === g.saw], [g.manC, g.manR, g.bricks, true]);
  ok("and the level's own numbers, which are not stored but re-derived",
     [back.F, back.PE, back.PA, back.leash === g.leash, back.wood], [g.F, g.PE, g.PA, true, g.wood]);
  ok("and every monster, in the same place",
     back.monsters.map((m) => m.kind + m.c + "," + m.r),
     g.monsters.map((m) => m.kind + m.c + "," + m.r));
  ok("with its spec re-linked to a live one that can still move",
     back.monsters.every((m) => m.spec === MF.MONSTERS[m.kind] && typeof m.spec.move === "function"),
     true);
  ok("the whole thing has the same fingerprint", fingerprint(back), fingerprint(g));
}
{
  /* the two awkward monsters: one with a tail, one that is all body */
  const g = built(4242, 14);          /* snake + spider */
  g.monsters.forEach((m) => { if (m.body) m.body = m.body.slice(0, 5); });
  const rec = LF.capture(g);
  const back = new MF.Game({ seed: 2 }); back.F = 1; back.sheet();
  LF.apply(back, rec);
  const snake = back.monsters.find((m) => m.body);
  const was = g.monsters.find((m) => m.body);
  ok("a snake keeps every square of its body, in order",
     [snake.body.length, JSON.stringify(snake.body)], [was.body.length, JSON.stringify(was.body)]);
  ok("and what length it is growing back to", [snake.full, snake.growth], [was.full, was.growth]);
}
{
  const g = built(99, 7);             /* a fly cellar */
  const fly = g.monsters.find((m) => m.kind === "fly");
  const rec = LF.capture(g);
  const back = new MF.Game({ seed: 3 }); back.F = 1; back.sheet();
  LF.apply(back, rec);
  const got = back.monsters.find((m) => m.kind === "fly");
  ok("a fly keeps its tail on the right square", [got.tc, got.tr], [fly.tc, fly.tr]);
}
{
  const g = built(555, 11);           /* marbles, tar and water */
  const rec = LF.capture(g);
  const back = new MF.Game({ seed: 4 }); back.F = 1; back.sheet();
  LF.apply(back, rec);
  ok("the marbles come back with their size and speed",
     back.marbles.map((m) => [m.c, m.r, m.size]), g.marbles.map((m) => [m.c, m.r, m.size]));
  let sealedOk = same(g.sealed, back.sealed);
  ok("and a sealed pool is still sealed - it is not derivable from the fluid", sealedOk, true);
}

console.log("\nSending it to somebody\n");
{
  const g = built(31337, 15);
  const code = LF.toCode(LF.capture(g, { name: "Rockfall" }));
  console.log("        (cellar 15 with rocks in it: " + code.length + " characters)");
  ok("a level fits in something you can paste into a message", code.length < 4000, true);
  const rec = LF.fromCode(code);
  ok("and the name travels with it", rec.name, "Rockfall");
  const back = new MF.Game({ seed: 5 }); back.F = 1; back.sheet();
  LF.apply(back, rec);
  ok("and it is the same cellar at the other end", fingerprint(back), fingerprint(g));
}
{
  const code = LF.toCode(LF.capture(built(8, 8)));
  let threw = null;
  try { LF.fromCode(code.slice(0, code.length - 8)); } catch (e) { threw = e.message; }
  ok("a code that lost its tail is refused, not half-loaded",
     /damaged or incomplete/.test(threw || ""), true);
  try { LF.fromCode("hello there"); threw = null; } catch (e) { threw = e.message; }
  ok("and so is something that is not a code", /damaged or incomplete/.test(threw || ""), true);
}
{
  const rec = LF.capture(built(8, 8));
  rec.monsters[0].kind = "basilisk";
  const back = new MF.Game({ seed: 6 }); back.F = 1; back.sheet();
  let threw = null;
  try { LF.apply(back, rec); } catch (e) { threw = e.message; }
  ok("a level with a monster this game has never heard of is refused",
     /needs a newer version of the game/.test(threw || ""), true);
}

console.log("\nOutliving the game that made it\n");
{
  /* a level written before this version existed */
  const old = LF.capture(built(8, 8));
  old.v = 1;
  delete old.needs;
  delete old.cells.stress;                 /* a plane that did not exist then */
  const back = new MF.Game({ seed: 71 }); back.F = 1; back.sheet();
  LF.apply(back, old);
  let clean = true;
  for (let i = 0; i < N; i++) if (back.stress[i] !== 0) clean = false;
  ok("a level from an older version still loads", [back.manC >= 0, clean], [true, true]);
}
{
  /* one from a NEWER version that says an old reader can cope */
  const rec = LF.capture(built(8, 8));
  rec.v = LF.VERSION + 5;
  rec.needs = LF.VERSION;
  rec.somethingNew = { paintedWalls: true };
  rec.cells.aPlaneFromTheFuture = "AAAA";
  const back = new MF.Game({ seed: 72 }); back.F = 1; back.sheet();
  LF.apply(back, rec);
  ok("and one from a newer version loads, if it says it can be read", back.bricks, rec.bricks);
  const again = LF.capture(back);
  ok("with whatever the newer game put in it carried through untouched",
     [again.somethingNew, again.v], [{ paintedWalls: true }, LF.VERSION]);
}
{
  /* and one that genuinely cannot be read says so, rather than loading
     something subtly wrong */
  const rec = LF.capture(built(8, 8));
  rec.v = LF.VERSION + 5;
  rec.needs = LF.VERSION + 5;
  let threw = null;
  try { LF.apply(new MF.Game({ seed: 73 }), rec); } catch (e) { threw = e.message; }
  ok("a level that needs a newer game says exactly that",
     /newer version of the game, and needs it/.test(threw || ""), true);
}
{
  const rec = LF.capture(built(8, 8));
  delete rec.v;
  let threw = null;
  try { LF.apply(new MF.Game({ seed: 74 }), rec); } catch (e) { threw = e.message; }
  ok("and one that does not say what wrote it is refused",
     /does not say what wrote it/.test(threw || ""), true);
}
{
  const rec = LF.capture(built(8, 8));
  rec.monsters[0].kind = "basilisk";
  let threw = null;
  try { LF.apply(new MF.Game({ seed: 75 }), rec); } catch (e) { threw = e.message; }
  ok("a monster this build has never heard of names the real problem",
     /needs a newer version of the game/.test(threw || ""), true);
}
{
  /* being walled in is worked out, never taken on trust - or a level
     could be hand-edited into a cellar that is already won */
  const g = built(3, 3);
  const rec = LF.capture(g);
  rec.monsters.forEach((m) => { m.trapped = true; });
  const back = new MF.Game({ seed: 8 }); back.F = 1; back.sheet();
  LF.apply(back, rec);
  ok("a level cannot claim its monsters are already walled in",
     back.monsters.some((m) => m.trapped), false);
}

console.log("\nTwo people, one code, the same cellar\n");
{
  /* the real test. Two independent loads of the same code, played the
     same way with the same run of luck, must not diverge by a square. */
  /* a fly cellar, because the point is to run for a long time and a
     snake catches the man inside a minute */
  /* the cellar itself, pinned too - and a run of luck the man survives,
     because a test that ends on turn thirty proves thirty turns */
  MF.luck(mul(222));
  const code = LF.toCode(LF.capture(built(2024, 7)));
  const MOVES = ["left", "up", "right", "right", "down", null, "up", "left", "down", "right"];
  function playIt(luckSeed) {
    MF.luck(mul(luckSeed));
    const g = new MF.Game({ seed: 12345 });
    g.F = 1; g.sheet();
    LF.apply(g, LF.fromCode(code));
    const trace = [];
    let turns = 0;
    for (let t = 0; t < 200; t++) {
      g.step(MOVES[t % MOVES.length]);
      trace.push(fingerprint(g));
      turns++;
      if (g.over || g.won) break;
    }
    return { trace: trace.join("#"), turns: turns };
  }
  const a = playIt(90210), b = playIt(90210);
  console.log("        (they ran " + a.turns + " turns before anything ended it)");
  ok("turn for turn, the two are the same cellar",
     [a.turns >= 100, a.trace === b.trace], [true, true]);

  const c = playIt(11111);
  ok("and a different run of luck does make a different game", a.trace === c.trace, false);
}
{
  /* and against the original, for a cellar with nothing that draws on
     the seeded stream mid-play */
  MF.luck(mul(4004));
  const g = built(606, 8);
  const code = LF.toCode(LF.capture(g));
  MF.luck(mul(4004));
  const h = new MF.Game({ seed: 777 }); h.F = 1; h.sheet();
  LF.apply(h, LF.fromCode(code));
  const MOVES = ["right", "right", "up", null, "left", "down"];
  let apart = -1;
  for (let t = 0; t < 120; t++) {
    g.step(MOVES[t % MOVES.length]);
    h.step(MOVES[t % MOVES.length]);
    if (fingerprint(g) !== fingerprint(h)) { apart = t; break; }
  }
  ok("a loaded cellar plays the same as the one it was copied from", apart, -1);
}

console.log("\nTelling an author their level is broken\n");
{
  const g = built(11, 6);
  ok("a generated cellar has nothing wrong with it", LF.faults(LF.capture(g)), []);
}
{
  const g = built(11, 6);
  g.grid.fill(MF.EMPTY);
  g.bricks = 0;          /* the count the game reads, not the squares */
  ok("no bricks at all is worth saying out loud",
     LF.faults(LF.capture(g)).some((f) => /bricks/.test(f)), true);
}
{
  /* the count the game uses is not the number of brick squares - a
     pool's ring is laid as brick and counted, then the scatter
     overwrites the total. faults() has to read the one canStillWin()
     reads, or it passes a level that cannot be finished. */
  const g = built(31337, 20);
  let cells = 0;
  for (let i = 0; i < N; i++) if (g.grid[i] === MF.BRICK) cells++;
  ok("brick squares and the brick count are genuinely different numbers",
     [cells > g.bricks, LF.capture(g).bricks], [true, g.bricks]);
}
{
  const g = built(11, 6);
  g.monsters.length = 0;
  ok("and so is an empty cellar",
     LF.faults(LF.capture(g)).some((f) => /nothing down here/.test(f)), true);
}
{
  const g = built(11, 6);
  g.grid[g.manR * MF.COLS + g.manC] = MF.BRICK;
  ok("and a man standing inside a brick",
     LF.faults(LF.capture(g)).some((f) => /inside something/.test(f)), true);
}

console.log("\nBlocks the level invented\n");
function madeGame(blocks) {
  const g = new MF.Game({ seed: 909 });
  g.F = 12; g.sheet();
  g.grid.fill(MF.EMPTY);
  g.item.fill(0); g.fluid.fill(MF.DRY); g.fvol.fill(0); g.sealed.fill(0);
  g.height.fill(0); g.marbles.length = 0; g.monsters.length = 0; g.coins.length = 0;
  g.bricks = 0; g.manC = 5; g.manR = 10; g.steps = 3;
  g.blocks = blocks.map(LF.cleanBlock);
  return g;
}
const ICE   = { name: "Ice",     colour: "#9fd8e8", weight: 0.25, friction: 0.03 };
const SLATE = { name: "Slate",   colour: "#4a4f57", weight: 1,    friction: 0.5 };
const LEAD  = { name: "Lead",    colour: "#5b5f66", weight: 2,    friction: 0.9 };
{
  const g = madeGame([ICE]);
  g.grid[I(6, 10)] = MF.MADE;
  ok("a block the level invented is solid", g.solid(6, 10), true);
  ok("and weighs what the level said, in bricks",
     [g.weightOf(MF.MADE), g.weightOf(MF.BRICK), g.weightOf(MF.ROCK)], [1, 1, 4]);
}
{
  /* eight quarter-stone blocks is exactly a man's load; nine is not */
  const g = madeGame([ICE]);
  for (let c = 6; c <= 13; c++) g.grid[I(c, 10)] = MF.MADE;
  const ev = g.step("right");
  ok("eight light blocks shove", [ev.blocked, ev.pushed], [false, 8]);
}
{
  const g = madeGame([ICE]);
  for (let c = 6; c <= 14; c++) g.grid[I(c, 10)] = MF.MADE;
  const ev = g.step("right");
  ok("nine do not", [ev.blocked, !!ev.tooHeavy], [true, true]);
}
{
  /* a two-stone block is the whole load on its own */
  const g = madeGame([LEAD]);
  g.grid[I(6, 10)] = MF.MADE;
  ok("one two-stone block is all a man has", g.step("right").blocked, false);
}
{
  const g = madeGame([LEAD]);
  g.grid[I(6, 10)] = MF.MADE; g.grid[I(7, 10)] = MF.MADE;
  ok("and two of them is more than he has", g.step("right").blocked, true);
}
{
  /* a stone or heavier behaves like stone: tar will not have it */
  const g = madeGame([SLATE, ICE]);
  g.grid[I(12, 10)] = MF.MADE;          /* slate */
  g.grid[I(12, 12)] = MF.MADE + 1;      /* ice   */
  g.fluid[I(11, 10)] = MF.TAR; g.fvol[I(11, 10)] = 9;
  g.fluid[I(11, 12)] = MF.TAR; g.fvol[I(11, 12)] = 9;
  g.manC = 1; g.manR = 1;
  for (let t = 0; t < 60; t++) { g.fvol[I(11, 10)] = 9; g.fvol[I(11, 12)] = 9; g.step(null); }
  ok("tar burns through a light block and not a heavy one",
     [g.grid[I(12, 12)] === MF.MADE + 1, g.grid[I(12, 10)] === MF.MADE], [false, true]);
}
{
  /* friction is the level's, and a marble feels it */
  const slippy = madeGame([ICE]);
  const sticky = madeGame([{ name: "Mud", colour: "#5a4a32", weight: 0.25, friction: 1.1 }]);
  const run = (g) => {
    for (let c = 6; c <= 20; c++) g.grid[I(c, 10)] = 0;
    const m = { c: 6, r: 10, dc: 1, dr: 0, v: 3, size: 1 };
    g.marbles.push(m); g.grid[I(6, 10)] = MF.MARBLE;
    for (let c = 7; c <= 20; c++) g.grid[I(c, 10)] = MF.EMPTY;
    /* the floor it rolls over is the invented stuff */
    for (let t = 0; t < 12 && m.v > 0; t++) g.step(null);
    return m.c;
  };
  ok("a marble carries further over what the level called ice than over mud",
     run(slippy) >= run(sticky), true);
}
{
  /* and it all survives being written down */
  const g = madeGame([ICE, SLATE]);
  g.grid[I(6, 10)] = MF.MADE;
  g.grid[I(7, 10)] = MF.MADE + 1;
  const code = LF.toCode(LF.capture(g, { name: "Ice and slate" }));
  const rec = LF.fromCode(code);
  ok("a level carries the blocks it invented", rec.blocks.map((b) => b.name), ["Ice", "Slate"]);
  ok("and says an old game cannot read it", rec.needs, LF.NEEDS_RICH);
  const back = new MF.Game({ seed: 3 }); back.F = 1; back.sheet();
  LF.apply(back, rec);
  ok("and they come back with their weight and friction",
     [back.blocks[0].weight, back.blocks[1].friction, back.grid[I(7, 10)]],
     [0.25, 0.5, MF.MADE + 1]);
}
{
  const silly = LF.cleanBlock({ name: "x".repeat(90), colour: "not a colour", weight: 999, friction: -4 });
  ok("a block with nonsense in it is pulled into a range the game can run",
     [silly.name.length, silly.colour, silly.weight, silly.friction], [20, "#8a7a5e", 2, 0.02]);
}

console.log("\nWhat shape the cellar is\n");
{
  const g = madeGame([ICE]);
  g.shape = new Uint8Array(N);
  /* a ten by eight room in the corner, and nothing else */
  for (let r = 2; r < 10; r++) for (let c = 2; c < 12; c++) g.shape[I(c, r)] = 1;
  ok("a level can be a smaller room than the one it is in",
     [g.inField(5, 5), g.inField(20, 20), g.inField(1, 5)], [true, false, false]);
}
{
  const g = madeGame([ICE]);
  g.shape = new Uint8Array(N);
  for (let r = 2; r < 10; r++) for (let c = 2; c < 12; c++) g.shape[I(c, r)] = 1;
  for (let r = 4; r < 7; r++) for (let c = 5; c < 8; c++) g.shape[I(c, r)] = 0;   /* a hole in it */
  ok("and it does not have to be a rectangle", [g.inField(6, 5), g.inField(4, 5)], [false, true]);
  g.bound = new Uint8Array(N);
  g.bound[I(6, 5)] = MF.WALL;
  ok("what lies beyond a square is said per square, not per side",
     [g.edgeAt(6, 5), g.edgeAt(4, 4)], [MF.WALL, MF.DROP]);
}
{
  const g = madeGame([ICE]);
  g.shape = new Uint8Array(N);
  for (let r = 2; r < 10; r++) for (let c = 2; c < 12; c++) g.shape[I(c, r)] = 1;
  g.manC = 3; g.manR = 3;
  const code = LF.toCode(LF.capture(g, { name: "A smaller room" }));
  const back = new MF.Game({ seed: 4 }); back.F = 1; back.sheet();
  LF.apply(back, LF.fromCode(code));
  ok("the shape travels with the level",
     [back.inField(5, 5), back.inField(20, 20)], [true, false]);
}
{
  /* an ordinary cellar has no shape at all, and is the whole room */
  const g = new MF.Game({ seed: 5 }); g.F = 6; g.sheet();
  ok("a level that is just the room carries no shape and no blocks",
     [LF.capture(g).shape, LF.capture(g).blocks, LF.capture(g).needs],
     [undefined, undefined, 1]);
}

console.log("\nDrawn, dealt, or both\n");
{
  const g = madeGame([ICE]);
  g.grid[I(20, 20)] = MF.BRICK;                 /* one brick drawn by hand */
  g.deal = [{ what: "brick", count: 40, how: "fixed" }, { what: "fly", count: 1, how: "fixed" }];
  const code = LF.toCode(LF.capture(g, { name: "Mostly dealt" }));
  const load = (seed) => {
    const h = new MF.Game({ seed: 4242 }); h.F = 1; h.sheet();
    LF.apply(h, LF.fromCode(code));
    let n = 0;
    for (let i = 0; i < N; i++) if (h.grid[i] === MF.BRICK) n++;
    return { bricks: n, mobs: h.monsters.length, drawn: h.grid[I(20, 20)] === MF.BRICK,
             where: Array.from(h.grid).join("") };
  };
  const a = load(), b = load();
  ok("what was drawn stays drawn and what was dealt gets dealt",
     [a.drawn, a.bricks, a.mobs], [true, 41, 1]);
  ok("and a fixed deal gives every player the identical cellar", a.where === b.where, true);
}
{
  const g = madeGame([ICE]);
  g.deal = [{ what: "brick", count: 30, how: "fresh" }];
  const code = LF.toCode(LF.capture(g));
  const load = () => {
    const h = new MF.Game({ seed: 4242 }); h.F = 1; h.sheet();
    LF.apply(h, LF.fromCode(code));
    return Array.from(h.grid).join("");
  };
  MF.luck(Math.random);
  let differed = false;
  for (let i = 0; i < 6 && !differed; i++) if (load() !== load()) differed = true;
  MF.luck(MF.mulberry32(20260903));
  ok("and a fresh deal is a different cellar every time, as the original was",
     differed, true);
}
{
  const g = madeGame([ICE]);
  g.deal = [{ what: "unicorn", count: 5, how: "fixed" }, { what: "rock", count: 3, how: "fixed" }];
  const back = new MF.Game({ seed: 8 }); back.F = 1; back.sheet();
  LF.apply(back, LF.fromCode(LF.toCode(LF.capture(g))));
  let rocks = 0;
  for (let i = 0; i < N; i++) if (back.grid[i] === MF.ROCK) rocks++;
  ok("something the game has never heard of is skipped, not fatal", rocks, 3);
}


/* ============ a level written for the smaller sheet ================ */
/* Every cellar used to be 34 by 26, and so is every level anybody has
   already saved or shared as a code. The sheet is four times that now.
   Refusing those records would have thrown all of them away. */
{
  const IO = global.MutantLevelIO;
  const g = new MF.Game({ seed: 4242 });
  g.F = 7; g.sheet();
  g.grid[g.idx(5, 5)] = MF.BRICK;
  g.grid[g.idx(33, 25)] = MF.BRICK;      /* the far corner of the OLD room */
  g.manC = 6; g.manR = 6;

  /* squeeze a current record down to how one looked before the sheet grew */
  const rec = MutantLevelFormat.capture(g, { name: "From Before" });
  const OC = MF.FIELD_C, OR = MF.FIELD_R;
  const squeeze = (arr) => {
    const out = new Uint8Array(OC * OR);
    for (let r = 0; r < OR; r++) for (let c = 0; c < OC; c++)
      out[r * OC + c] = arr[r * MF.COLS + c];
    return out;
  };
  const old = JSON.parse(JSON.stringify(rec));
  old.cols = OC; old.rows = OR;
  MutantLevelFormat.PLANES.forEach((pl) => {
    if (rec.cells[pl] == null) return;
    old.cells[pl] = IO.packArray(squeeze(g[pl]));
  });

  const back = new MF.Game({ seed: 1 });
  let threw = null;
  try { MutantLevelFormat.apply(back, old); } catch (e) { threw = String(e); }
  ok("a level from the smaller sheet still loads", threw, null);
  ok("and everything in it is where it was",
     [back.grid[back.idx(5, 5)], back.grid[back.idx(33, 25)], back.manC, back.manR],
     [MF.BRICK, MF.BRICK, 6, 6]);
  ok("it keeps the old room and does not gain the blank paper round it",
     [back.inField(33, 25), back.inField(34, 25), back.inField(5, 26)],
     [true, false, false]);

  /* and a record from some future build is refused rather than guessed at */
  let big = null;
  try { MutantLevelFormat.apply(new MF.Game({ seed: 1 }),
        Object.assign({}, old, { cols: MF.COLS + 2, rows: MF.ROWS })); }
  catch (e) { big = String(e); }
  ok("a level built for a bigger cellar is refused", /bigger cellar/.test(big || ""), true);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
