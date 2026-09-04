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
const same = (a, b) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
function mul(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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
     /never heard of/.test(threw || ""), true);
}
{
  const rec = LF.capture(built(8, 8));
  rec.v = 99;
  let threw = null;
  try { LF.apply(new MF.Game({ seed: 7 }), rec); } catch (e) { threw = e.message; }
  ok("and one from a different version says so", /different version/.test(threw || ""), true);
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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
