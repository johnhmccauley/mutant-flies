#!/usr/bin/env node
/*
 * Checks the parts of the game that are NOT the 1985 original: the three
 * new monsters, multiple monsters in one cellar, the endless levels, and
 * the saved game. tools/test-rules.js covers everything that must stay
 * faithful to the listing; nothing here is allowed to change that.
 *
 *   node tools/test-monsters.js
 */
global.window = global;
require("../src/rules.js");
const MF = global.MutantFly;

/* Play used to run on live Math.random, so a test could pass on the
   luck of the draw and fail on the next run - which is how the water
   shoving a marble came and went. Pin the stream. TEST_LUCK sweeps it,
   so a test that only works for one run of the dice still gets caught. */
const LUCK = parseInt(process.env.TEST_LUCK, 10) || 20250903;
MF.luck(MF.mulberry32(LUCK));
/* and the cellar itself: an unseeded Game picks its seed off
   Math.random, so half of what looked like flaky play was a different
   room every run */
const SEED = LUCK ^ 0x51ed;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}
const I = (c, r) => r * MF.COLS + c;
const put = (g, c, r) => { g.grid[I(c, r)] = MF.BRICK; g.bricks++; };
const clear = (g, c, r) => { if (g.grid[I(c, r)] === MF.BRICK) g.bricks--; g.grid[I(c, r)] = MF.EMPTY; };
const leash = (g, PA) => { g.PA = PA; g.leash = MF.leashCells(PA); };

function withMonster(kind, level) {
  const g = new MF.Game({ seed: SEED });
  g.F = level || 6; g.sheet();
  g.grid.fill(MF.EMPTY); g.bricks = 0;
  g.height.fill(0);        /* level ground: bricks placed by hand stay put */
  g.manC = 10; g.manR = 10;
  g.monsters = [{ kind: kind, spec: MF.MONSTERS[kind], c: 20, r: 10,
                  tick: 0, trapped: false, ate: false }];
  return g;
}

/* --- the spider: no wandering, but only every second turn ----------- */
{
  const g = withMonster("spider");
  let moves = 0, away = 0;
  for (let i = 0; i < 12; i++) {
    const b = [g.monsters[0].c, g.monsters[0].r];
    const d0 = Math.abs(b[0] - g.manC) + Math.abs(b[1] - g.manR);
    if (d0 === 0) break;
    g.step(null);
    const m = g.monsters[0];
    const d1 = Math.abs(m.c - g.manC) + Math.abs(m.r - g.manR);
    if (m.c !== b[0] || m.r !== b[1]) moves++;
    if (d1 > d0) away++;
  }
  ok("spider: closes on the man and never retreats", away, 0);
  ok("spider: steps on every second turn", moves, 6);
}

/* --- the beetle: eats the bricks you need --------------------------- */
{
  /* Pin it: with brick on all four sides leashStep cannot move it, so the
     only variable left is the fourteen-turn schedule. Calling move()
     directly rather than step() keeps settle() from noticing it is boxed
     and retiring it. Letting it wander instead made this test a lottery -
     it would end a turn on a square with no brick beside it and quietly
     miss a meal. */
  const g = withMonster("beetle");
  const m = g.monsters[0];
  for (let c = 0; c < MF.COLS; c++) for (let r = 0; r < MF.ROWS; r++) put(g, c, r);
  clear(g, m.c, m.r);
  const before = g.bricks;
  let eaten = 0;
  for (let i = 0; i < 28; i++) { m.ate = false; m.spec.move(m, g); if (m.ate) eaten++; }
  ok("beetle: eats twice in twenty-eight turns", eaten, 2);
  ok("beetle: and the bricks really go", g.bricks, before - 2);
  ok("beetle: on a fourteen-turn schedule", [MF.MONSTERS.beetle.eats, m.tick], [14, 28]);
}
{
  /* with nothing beside it there is nothing to eat, and no crash */
  const g = withMonster("beetle");
  let eaten = 0;
  for (let i = 0; i < 30; i++) eaten += g.step(null).eaten;
  ok("beetle: eats nothing when there is nothing next to it", eaten, 0);
}
{
  /* and it does happen in real play, not just when pinned */
  const g = withMonster("beetle");
  for (let c = 0; c < MF.COLS; c++) for (let r = 0; r < MF.ROWS; r++) put(g, c, r);
  for (let c = 18; c <= 22; c++) clear(g, c, 10);
  g.monsters[0].c = 20; g.monsters[0].r = 10;
  clear(g, 2, 2); g.manC = 2; g.manR = 2;
  const before = g.bricks;
  for (let i = 0; i < 60; i++) g.step(null);
  ok("beetle: eats its way through a cellar", g.bricks < before, true);
}

/* --- the wasp: still, then two squares at once ---------------------- */
{
  const g = withMonster("wasp");
  leash(g, 400);
  let still = 0, far = 0;
  for (let i = 0; i < 40; i++) {
    const b = [g.monsters[0].c, g.monsters[0].r];
    g.step(null);
    const d = Math.abs(g.monsters[0].c - b[0]) + Math.abs(g.monsters[0].r - b[1]);
    if (d === 0) still++;
    if (d === 2) far++;
  }
  ok("wasp: half its turns are dead ones", still >= 18, true);
  ok("wasp: and on the others it can cross two squares", far > 0, true);
}

/* --- more than one monster ------------------------------------------ */
{
  const g = new MF.Game({ seed: SEED });
  g.F = 7; g.sheet();
  g.grid.fill(MF.EMPTY); g.bricks = 0;
  g.height.fill(0);        /* level ground: bricks placed by hand stay put */
  g.manC = 2; g.manR = 2;
  g.monsters = [
    { kind: "fly", spec: MF.MONSTERS.fly, c: 15, r: 15, tick: 0, trapped: false },
    { kind: "fly", spec: MF.MONSTERS.fly, c: 25, r: 8, tick: 0, trapped: false }
  ];
  leash(g, 0);
  /* box each one where it actually is - with the leash at nothing they
     close on the man every turn, so their squares move under you */
  /* box every square the thing lies on - the fly is two of them */
  const box = (m) => {
    for (const [c, r] of g.cellsOf(m))
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]])
        if (!g.isPartOf(m, c + dc, r + dr)) put(g, c + dc, r + dr);
  };
  box(g.monsters[0]);
  let ev = g.step(null);
  ok("two monsters: boxing one is not enough", [ev.won, g.monsters[0].trapped], [false, true]);
  box(g.monsters[1]);
  ev = g.step(null);
  ok("two monsters: boxing both clears the cellar", ev.won, true);
}
{
  const g = withMonster("spider");
  g.monsters[0].c = 15; g.monsters[0].r = 15;
  put(g, 16, 15); put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  g.step(null);
  const at = [g.monsters[0].c, g.monsters[0].r];
  for (let i = 0; i < 20; i++) g.step(null);
  ok("a trapped monster stops moving", [g.monsters[0].c, g.monsters[0].r], at);
  g.manC = 15; g.manR = 15;
  ok("and standing on a trapped one is harmless", g.step(null).lost, false);
}
{
  const g = new MF.Game({ seed: SEED });
  g.F = 12; g.sheet();
  let clash = 0;
  for (let i = 0; i < 600; i++) {
    g.step(["left", "right", "up", "down"][i % 4]);
    if (g.over || g.won) { g.reset(12); continue; }
    for (let a = 0; a < g.monsters.length; a++)
      for (let b = a + 1; b < g.monsters.length; b++)
        if (g.monsters[a].c === g.monsters[b].c && g.monsters[a].r === g.monsters[b].r) clash++;
  }
  ok("monsters never stand on one another", clash, 0);
}
{
  /* nothing starts walled in by accident */
  const g = new MF.Game({ seed: SEED });
  let born = 0;
  for (let F = 1; F <= 40; F++) {
    g.F = F; g.sheet();
    for (const m of g.monsters) if (g.isBoxed(m)) born++;
  }
  ok("no monster is ever laid down already trapped", born, 0);
}

/* --- the cellars go on for ever ------------------------------------- */
{
  let worst = 9999, kinds = new Set(), broken = 0;
  for (let F = 1; F <= 300; F++) {
    const l = MF.levelOf(F);
    l.kinds.forEach((k) => kinds.add(k));
    if (!l.PE || !l.kinds.length || l.kinds.some((k) => !MF.MONSTERS[k])) broken++;
    worst = Math.min(worst, l.PE - 4 * l.kinds.length);
  }
  ok("300 levels deep, every cellar is configured", broken, 0);
  ok("and always has bricks to spare over the bare minimum", worst > 20, true);
  ok("all five monsters get used", kinds.size, 5);
  ok("never more than four at once", MF.levelOf(999).kinds.length <= 4, true);
}
{
  /* levels 1 and 2 must still be the original game, undisturbed */
  ok("the first cellars are the 1985 game", [MF.levelOf(1).kinds, MF.levelOf(2).kinds],
     [["fly"], ["fly"]]);
  ok("and level 1 still lays 200 bricks", MF.levelOf(1).PE, 200);
  ok("classic mode never sees a new monster",
     [3, 6, 9, 40].map((F) => MF.levelOf(F, true).kinds.join()), ["fly", "fly", "fly", "fly"]);
}

/* --- running out of bricks ------------------------------------------- */
{
  const g = withMonster("fly");
  leash(g, 400);
  g.bricks = 3;
  ok("too few bricks left to build a trap is flagged", g.step(null).stuck, true);
  g.bricks = 40;
  ok("and not flagged when there are plenty", g.step(null).stuck, false);
}

/* --- saved games ------------------------------------------------------ */
{
  /* there is no localStorage in node: every call must survive that */
  ok("save helpers survive having no storage at all",
     [MF.save.read(), typeof MF.save.keep, typeof MF.save.end],
     [null, "function", "function"]);
  let threw = false;
  try { MF.save.keep(7, 1200, 3400); MF.save.end(3400); } catch (e) { threw = true; }
  ok("and writing without storage does not throw", threw, false);

  /* with a stand-in, a run round-trips */
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  MF.save.keep(7, 1200, 3400);
  const s = MF.save.read();
  ok("a run in progress round-trips", [s.level, s.score, s.best, s.deepest], [7, 1200, 3400, 7]);
  MF.save.keep(4, 200, 100);
  const s2 = MF.save.read();
  ok("the best score and the deepest cellar only ever go up",
     [s2.best, s2.deepest, s2.level], [3400, 7, 4]);
  MF.save.end(5000);
  const s3 = MF.save.read();
  ok("ending a run keeps the record but drops the run",
     [s3.best, s3.deepest, s3.level, s3.score], [5000, 7, undefined, undefined]);
  store["mutantfly.save.v2"] = "{not json";
  ok("a corrupt save reads as nothing rather than exploding", MF.save.read(), null);
  delete global.localStorage;
}

/* --- the title screen is still made of the game ---------------------- */
{
  const cells = MF.titleCells();
  const cs = cells.map((x) => x[0]), rs = cells.map((x) => x[1]);
  ok("the title bricks sit inside the playfield",
     [cells.length > 60, Math.min(...cs) >= 0, Math.max(...cs) < MF.COLS,
      Math.min(...rs) >= 0, Math.max(...rs) < MF.ROWS],
     [true, true, true, true, true]);
}



/* ================= the snake ====================================== */
function snake(g, c, r, len) {
  const m = g.newMonster("snake", c, r);
  m.body = [];
  for (let i = 0; i < len; i++) m.body.push([c + i, r]);
  m.full = len;
  m.growth = 0;
  m.c = c; m.r = r;
  g.monsters.push(m);
  return m;
}
function cellar() {
  const g = new MF.Game({ seed: SEED });
  g.F = 12; g.sheet();
  g.grid.fill(MF.EMPTY);
  /* cellar 12 has tar, water and marbles in it. Clearing only the grid
     leaves a pool with its brickwork gone, which breaches on turn one
     and burns the walls the test just built - which is why this only
     failed on some runs of the dice. */
  g.fluid.fill(MF.DRY); g.fvol.fill(0); g.sealed.fill(0); g.burn.fill(0);
  g.marbles.length = 0; g.sources.length = 0;
  g.item.fill(MF.NOTHING);
  g.height.fill(0);
  g.monsters.length = 0;
  g.bricks = 0;
  g.manC = 2; g.manR = 2;
  g.steps = 0;
  return g;
}
{
  const g = cellar();
  const m = snake(g, 10, 10, 8);
  g.cutSnake(m, 14, 10, { crushed: [] });
  const pieces = g.monsters.filter((x) => !x.gone);
  ok("cutting one in the middle leaves two of half the length",
     [pieces.length, pieces[0].body.length, pieces[1].body.length], [2, 4, 3]);
}
{
  const g = cellar();
  const m = snake(g, 10, 10, 8);
  g.cutSnake(m, 12, 10, { crushed: [] });
  const pieces = g.monsters.filter((x) => !x.gone).map((x) => x.body.length).sort((a, b) => a - b);
  ok("a cut a quarter along leaves a quarter and three quarters", pieces, [2, 5]);
}
{
  const g = cellar();
  const m = snake(g, 10, 10, 8);
  g.cutSnake(m, 11, 10, { crushed: [] });
  const pieces = g.monsters.filter((x) => !x.gone);
  ok("a piece shorter than two squares dies", [pieces.length, pieces[0].body.length], [1, 6]);
}
{
  const g = cellar();
  const m = snake(g, 10, 10, 8);
  const other = g.monsters[0];
  g.cutSnake(m, 14, 10, { crushed: [] });
  const long = g.monsters.filter((x) => !x.gone).sort((a, b) => b.body.length - a.body.length)[0];
  const short = g.monsters.filter((x) => !x.gone).sort((a, b) => a.body.length - b.body.length)[0];
  ok("both pieces are trying to get back to the whole one's length",
     [long.full, short.full], [8, 8]);
}
{
  /* the long piece grows back first, because there is more of it growing */
  const g = cellar();
  g.leash = 0;
  const big = snake(g, 5, 5, 6); big.full = 9;
  const small = snake(g, 5, 20, 2); small.full = 9;
  let bigHit = -1, smallHit = -1;
  /* drive the monsters directly: a whole turn would have them eat the
     man long before either of them finished growing */
  for (let t = 0; t < 400; t++) {
    big.spec.move(big, g);
    small.spec.move(small, g);
    if (bigHit < 0 && big.body.length >= 9) bigHit = t;
    if (smallHit < 0 && small.body.length >= 9) smallHit = t;
  }
  ok("the longer piece comes back to full length first",
     [bigHit >= 0, smallHit < 0 || bigHit < smallHit], [true, true]);
}
{
  /* shoving a brick at the head loses you the brick */
  const g = cellar();
  const m = snake(g, 12, 10, 5);
  g.manC = 10; g.manR = 10;
  g.grid[g.idx(11, 10)] = MF.BRICK; g.bricks = 1;
  g.steps = 3;
  const ev = g.step("right");
  ok("a brick shoved at the head is eaten",
     [ev.crunched, g.bricks, g.monsters.filter((x) => !x.gone).length], [1, 0, 1]);
}
{
  /* but through its back and it cuts */
  const g = cellar();
  const m = snake(g, 10, 10, 6);   /* body runs east from (10,10) */
  g.manC = 13; g.manR = 8;
  g.grid[g.idx(13, 9)] = MF.BRICK; g.bricks = 1;
  g.steps = 3;
  const ev = g.step("up");        /* up is +r down here */
  const alive = g.monsters.filter((x) => !x.gone);
  ok("a brick through its back cuts it in two", [ev.cut, alive.length], [1, 2]);
}
{
  /* and walling one in still works, which is the point */
  const g = cellar();
  g.leash = 0;
  const m = snake(g, 10, 10, 2);
  for (const [c, r] of [[9, 10], [12, 10], [10, 9], [10, 11], [11, 9], [11, 11]])
    g.grid[g.idx(c, r)] = MF.BRICK;
  const ev = g.step(null);
  ok("a snake walled in is finished with", [m.trapped, ev.won], [true, true]);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
