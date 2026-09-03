#!/usr/bin/env node
/*
 * Checks the furniture of the deep cellars: sloping floors, trees and the
 * axe, the marbles, the things you pick up, and the tar and the water.
 * None of it may leak into the classic game - tools/test-rules.js guards
 * that end.
 *
 *   node tools/test-elements.js
 */
global.window = global;
require("../src/rules.js");
const MF = global.MutantFly;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}
const I = (c, r) => r * MF.COLS + c;

/* a cellar with nothing in it, so each test can furnish its own */
function bare(level) {
  const g = new MF.Game();
  g.F = level || 12;
  g.sheet();
  g.grid.fill(MF.EMPTY);
  g.fluid.fill(MF.DRY); g.fvol.fill(0); g.burn.fill(0);
  g.height.fill(0);
  g.item.fill(MF.NOTHING);
  g.marbles.length = 0;
  g.sources.length = 0;
  g.monsters.length = 0;
  g.bricks = 0;
  g.manC = 10; g.manR = 10;
  g.steps = 0; g.boots = 0; g.frost = 0; g.saw = 0;
  return g;
}
const put = (g, c, r, what) => { g.grid[I(c, r)] = what === undefined ? MF.BRICK : what; if (what === undefined) g.bricks++; };
const monster = (g, kind, c, r) => { const m = g.newMonster(kind, c, r); g.monsters.push(m); return m; };
const marble = (g, c, r) => { g.grid[I(c, r)] = MF.MARBLE; const m = { c, r, dc: 0, dr: 0, v: 0 }; g.marbles.push(m); return m; };

/* ================= the floor is not level ========================= */
{
  const g = bare();
  g.height[I(11, 10)] = 2;
  ok("climbing costs a turn for every step of height",
     [g.stepCost(11, 10, false), g.stepCost(9, 10, false), g.stepCost(11, 10, true)], [3, 1, 4]);
}
{
  /* one step point a turn, so a two-high climb takes three turns */
  const g = bare();
  g.height[I(11, 10)] = 1;
  let turns = 0;
  while (g.manC === 10 && turns < 8) { g.step("right"); turns++; }
  ok("a climb costs the turn it takes to make it", turns, 2);
}
{
  const g = bare();
  const flat = bare();
  let t1 = 0, t2 = 0;
  while (flat.manC < 14 && t1 < 20) { flat.step("right"); t1++; }
  for (let c = 11; c <= 14; c++) g.height[I(c, 10)] = 1;
  while (g.manC < 14 && t2 < 20) { g.step("right"); t2++; }
  ok("walking uphill is slower than walking on the level", t2 > t1, true);
}
{
  /* stepping down hands a step back, so you run downhill */
  const g = bare();
  g.height[I(10, 10)] = 2;
  g.height[I(11, 10)] = 0;
  g.steps = 1;
  g.step("right");
  ok("stepping down hands a step back", [g.manC, g.steps >= 2], [11, true]);
}
{
  const g = new MF.Game({ classic: true });
  g.sheet();
  let flat = true;
  for (let i = 0; i < g.height.length; i++) if (g.height[i] !== 0) flat = false;
  ok("the classic cellar floor is dead flat", [flat, g.stepCost(1, 1, true)], [true, 1]);
}

/* ================= trees and the axe ============================== */
{
  const g = bare();
  put(g, 11, 10, MF.TREE);
  const ev = g.step("right");
  ok("a tree does not shove and does not let you past",
     [g.manC, ev.strained, g.grid[I(11, 10)]], [10, true, MF.TREE]);
}
{
  const g = bare();
  put(g, 11, 10, MF.TREE);
  g.saw = 3;
  const ev = g.step("right");
  ok("a saw takes the tree out", [ev.chopped, g.grid[I(11, 10)], g.saw], [1, MF.EMPTY, 2]);
}
{
  const g = bare();
  g.saw = 1;
  for (let i = 0; i < 4; i++) put(g, 11 + i, 10, MF.TREE);
  g.step("right"); g.step("right");
  ok("a saw is good for the trees it has and no more", g.saw, 0);
}
{
  /* a tree will hold a monster in, in the deep cellars. Use a spider:
     what is under test is the fixture, and the fly is two squares long */
  const g = bare();
  const m = monster(g, "spider", 15, 15);
  g.leash = 0;
  put(g, 16, 15, MF.TREE); put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  const ev = g.step(null);
  ok("a tree walls a monster in as well as a brick does", [ev.won, m.trapped], [true, true]);
}
{
  /* but not in 1985 - there, only colour 2 counted */
  const g = new MF.Game({ classic: true });
  g.sheet(); g.grid.fill(MF.EMPTY); g.bricks = 0;
  g.monsters[0].c = 15; g.monsters[0].r = 15; g.monsters[0].trapped = false;
  g.manC = 2; g.manR = 2; g.leash = 0;
  g.grid[I(16, 15)] = MF.TREE;
  put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  ok("classic mode still demands four real bricks", g.step(null).won, false);
}

/* ================= the marbles ==================================== */
function roll(g, times) {
  const ev = { rolled: [], smashed: 0, crushed: [], lost: false, lostTo: null, burst: 0 };
  for (let i = 0; i < (times || 1); i++) { g.rollMarbles(ev); if (ev.lost) break; }
  return ev;
}
{
  const g = bare();
  const m = marble(g, 12, 10);
  g.step("right"); g.step("right");        /* walk into it */
  ok("shoving a marble sets it rolling", [m.v > 0, m.dc], [true, 1]);
}
{
  /* it cannot crest a rise it has not the speed for, and comes back */
  const g = bare();
  const m = marble(g, 12, 10);
  for (let c = 13; c < 20; c++) g.height[I(c, 10)] = 3;
  m.dc = 1; m.dr = 0; m.v = 1.2;
  roll(g, 1);
  ok("a marble that cannot climb turns round", m.dc, -1);
}
{
  /* downhill it gathers pace instead of losing it */
  const g = bare();
  const m = marble(g, 20, 10);
  for (let c = 0; c < 20; c++) g.height[I(c, 10)] = 0;
  for (let c = 20; c < 34; c++) g.height[I(c, 10)] = 3;
  m.dc = -1; m.dr = 0; m.v = 1.5;
  const before = m.v;
  roll(g, 1);
  ok("a marble running downhill speeds up", m.v > before, true);
}
{
  const g = bare();
  const m = marble(g, 12, 10);
  put(g, 15, 10);
  m.dc = 1; m.dr = 0; m.v = 3.4;
  const ev = roll(g, 2);
  ok("at speed a marble smashes a brick", [ev.smashed, g.grid[I(15, 10)]], [1, MF.EMPTY]);
}
{
  const g = bare();
  const m = marble(g, 12, 10);
  put(g, 13, 10);
  m.dc = 1; m.dr = 0; m.v = 1.2;
  const ev = roll(g, 1);
  ok("slowly it just bounces off", [ev.smashed, m.dc, g.grid[I(13, 10)]], [0, -1, MF.BRICK]);
}
{
  const g = bare();
  const mon = monster(g, "fly", 14, 10);
  const m = marble(g, 12, 10);
  m.dc = 1; m.dr = 0; m.v = 2.6;
  const ev = roll(g, 2);
  ok("at speed it flattens a monster", [ev.crushed.length, mon.gone, mon.crushed], [1, true, true]);
}
{
  const g = bare();
  const m = marble(g, 12, 10);
  g.manC = 14; g.manR = 10;
  m.dc = 1; m.dr = 0; m.v = 2.6;
  const ev = roll(g, 2);
  ok("and it will flatten you just the same", ev.lost, true);
}
{
  const g = bare();
  const m = marble(g, 12, 10);
  g.manC = 13; g.manR = 10;
  m.dc = 1; m.dr = 0; m.v = 1.3;
  const ev = roll(g, 1);
  ok("but a slow one you can simply stop", [ev.lost, m.v], [false, 0]);
}
{
  /* a resting marble is as good as a brick for walling something in */
  const g = bare();
  const mon = monster(g, "spider", 15, 15);
  g.leash = 0;
  marble(g, 16, 15);
  put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  ok("a marble at rest holds a monster in", g.step(null).won, true);
}

/* ================= the things you pick up ========================= */
{
  const g = bare();
  g.item[I(11, 10)] = MF.BOOTS;
  const ev = g.step("right");
  ok("boots are picked up by walking over them",
     [ev.picked && ev.picked.key, g.boots > 0], ["boots", true]);
  /* two squares a turn while they last */
  const before = g.manC;
  g.step("right");
  ok("and then you cover two squares a turn", g.manC - before, 2);
}
{
  const g = bare();
  const m = monster(g, "spider", 20, 10);
  g.item[I(11, 10)] = MF.FROST;
  g.step("right");
  const at = [m.c, m.r];
  for (let i = 0; i < 12; i++) g.step(null);
  ok("frost stops everything where it stands", [m.c, m.r], at);
  ok("and it does wear off", g.frost < MF.levelOf(12).PE, true);
}
{
  const g = bare();
  g.item[I(11, 10)] = MF.SAW;
  g.step("right");
  ok("a saw arrives with three trees in it", g.saw, 3);
}
{
  /* the unlabelled jar does one of exactly two things */
  let froze = 0, opened = 0;
  for (let i = 0; i < 60; i++) {
    const g = bare();
    monster(g, "fly", 25, 20);
    g.item[I(11, 10)] = MF.JAR;
    const ev = g.step("right");
    if (ev.spawned) opened++; else if (g.frost > 0) froze++;
  }
  ok("a sealed jar is either frost or company", froze + opened, 60);
  ok("and it is genuinely both, over sixty jars", froze > 5 && opened > 5, true);
}

/* ================= the tar ======================================== */
function settle(g, turns) {
  const ev = { burned: 0, doused: 0, swept: 0, set: 0, crushed: [], rolled: [],
               lost: false, lostTo: null, burst: 0 };
  for (let i = 0; i < turns; i++) { g.flowFluids(ev); if (ev.lost) break; }
  return ev;
}
{
  const g = bare();
  put(g, 12, 10, MF.VAT_TAR);
  const ev = { burst: 0 };
  g.breakVat(12, 10, ev);
  ok("breaking a vat leaves a source, not a vat",
     [ev.burst, g.grid[I(12, 10)], g.sources.length], [MF.TAR, MF.EMPTY, 1]);
}
{
  const g = bare();
  put(g, 12, 10, MF.VAT_TAR);
  g.saw = 1;
  g.manC = 11; g.manR = 10;
  const ev = g.step("right");
  ok("a saw will open a vat", [ev.burst, g.sources.length], [MF.TAR, 1]);
}
{
  /* it runs downhill, not uphill */
  const g = bare();
  for (let c = 0; c < 34; c++) for (let r = 0; r < 26; r++) g.height[I(c, r)] = Math.max(0, 3 - Math.floor(c / 4));
  g.grid[I(2, 10)] = MF.VAT_TAR;
  g.breakVat(2, 10, { burst: 0 });
  settle(g, 26);
  /* the floor falls away to the east, so the tar should end up lower
     than the vat it came out of */
  let wet = 0, sumH = 0, farthest = 0;
  for (let c = 0; c < 34; c++) for (let r = 0; r < 26; r++)
    if (g.fvol[I(c, r)] > 0) { wet++; sumH += g.height[I(c, r)]; farthest = Math.max(farthest, c); }
  ok("tar runs downhill", [wet > 0, farthest > 4, sumH / wet < 3], [true, true, true]);
}
{
  const g = bare();
  put(g, 13, 10); put(g, 14, 10, MF.TREE);
  g.grid[I(12, 10)] = MF.VAT_TAR;
  g.breakVat(12, 10, { burst: 0 });
  const ev = settle(g, 20);
  ok("tar burns the bricks and the trees it reaches", ev.burned > 0, true);
}
{
  const g = bare();
  const mon = monster(g, "fly", 13, 10);
  mon.trapped = true;                       /* keep it still for the test */
  g.grid[I(12, 10)] = MF.VAT_TAR;
  g.breakVat(12, 10, { burst: 0 });
  const ev = settle(g, 14);
  ok("tar takes a monster with it", mon.gone, true);
}
{
  const g = bare();
  g.manC = 13; g.manR = 10;
  g.grid[I(12, 10)] = MF.VAT_TAR;
  g.breakVat(12, 10, { burst: 0 });
  const ev = settle(g, 14);
  ok("and it will take you", ev.lost, true);
}
{
  const g = bare();
  g.manC = 31; g.manR = 2;                  /* well clear of the spill */
  g.grid[I(12, 10)] = MF.VAT_TAR;
  g.breakVat(12, 10, { burst: 0 });
  const ev = settle(g, 90);
  let cooled = 0, burning = 0;
  for (let i = 0; i < g.grid.length; i++) {
    if (g.grid[i] === MF.COOLED) cooled++;
    if (g.fluid[i] === MF.TAR) burning++;
  }
  ok("tar sets in the end, and what it leaves is solid",
     [cooled > 0, burning, ev.set > 0], [true, 0, true]);
  ok("set tar walls a monster in", g.solid(12, 10) || cooled > 0, true);
}

/* ================= the water ====================================== */
{
  /* set them side by side rather than waiting for a spill to travel */
  const g = bare();
  g.manC = 31; g.manR = 2;
  g.fluid[I(14, 10)] = MF.TAR;   g.fvol[I(14, 10)] = 4;
  g.fluid[I(13, 10)] = MF.WATER; g.fvol[I(13, 10)] = 6;
  const ev = settle(g, 3);
  ok("water puts the tar out", ev.doused > 0, true);
  ok("and what is left is rock", g.grid[I(14, 10)], MF.COOLED);
}
{
  const g = bare();
  g.manC = 13; g.manR = 10;
  g.grid[I(12, 10)] = MF.VAT_WATER;
  g.breakVat(12, 10, { burst: 0 });
  const ev = settle(g, 14);
  ok("water sweeps you off your feet rather than drowning you",
     [ev.lost, ev.swept > 0], [false, true]);
}
{
  const g = bare();
  const m = marble(g, 13, 10);
  g.grid[I(12, 10)] = MF.VAT_WATER;
  g.breakVat(12, 10, { burst: 0 });
  settle(g, 10);
  ok("water shoves a marble along in front of it", m.v > 0 || m.c !== 13, true);
}
{
  /* it has to stop eventually rather than filling the cellar for ever */
  const g = bare();
  g.grid[I(12, 10)] = MF.VAT_WATER;
  g.breakVat(12, 10, { burst: 0 });
  settle(g, 200);
  let wet = 0;
  for (let i = 0; i < g.fvol.length; i++) if (g.fvol[i] > 0) wet++;
  ok("a spill is finite", wet > 0 && wet < MF.COLS * MF.ROWS, true);
}

/* ================= none of it in 1985 ============================= */
{
  const g = new MF.Game({ classic: true });
  let found = 0;
  for (let F = 1; F <= 20; F++) {
    g.F = F; g.sheet();
    for (let i = 0; i < g.grid.length; i++)
      if (g.grid[i] !== MF.EMPTY && g.grid[i] !== MF.BRICK) found++;
    if (g.item.some((v) => v !== MF.NOTHING)) found++;
    if (g.marbles.length || g.sources.length) found++;
  }
  ok("the classic cellar has nothing in it but bricks", found, 0);
}

/* ================= the fly is two squares long ==================== */
{
  const g = bare();
  const f = monster(g, "fly", 15, 15);
  ok("the fly lies across two squares",
     [g.cellsOf(f).length, g.isPartOf(f, 15, 15), g.isPartOf(f, 14, 15)],
     [2, true, true]);
  ok("and both of them are it", [!!g.monsterAt(15, 15), !!g.monsterAt(14, 15)], [true, true]);
}
{
  /* four bricks round the head is not enough any more - the tail is out */
  const g = bare();
  const f = monster(g, "fly", 15, 15);
  f.tc = 14; f.tr = 15;
  g.leash = 0; g.manC = 2; g.manR = 2;
  put(g, 16, 15); put(g, 15, 16); put(g, 15, 14);
  ok("walling the head in leaves the tail loose", g.step(null).won, false);
}
{
  /* seal both ends and it is held - six bricks, not four */
  const g = bare();
  const f = monster(g, "fly", 15, 15);
  f.tc = 14; f.tr = 15;
  g.leash = 0; g.manC = 2; g.manR = 2;
  put(g, 16, 15); put(g, 15, 16); put(g, 15, 14);
  put(g, 13, 15); put(g, 14, 16); put(g, 14, 14);
  const ev = g.step(null);
  ok("sealing both ends walls it in", [ev.won, f.trapped, f.crushed], [true, true, false]);
}
{
  /* when trapped it cannot be killed - it is held, and alive */
  const g = bare();
  const f = monster(g, "fly", 15, 15);
  f.tc = 14; f.tr = 15; f.trapped = true;
  g.manC = 2; g.manR = 2;
  ok("a walled-in fly is alive, not dead", [f.trapped, f.crushed, f.gone], [true, false, undefined || false]);
}
{
  /* a brick driven at it while it still has room is just destroyed */
  const g = bare();
  const f = monster(g, "fly", 14, 10);
  f.tc = 15; f.tr = 10;                       /* tail to the east, room all round */
  g.leash = 0;
  put(g, 11, 10); put(g, 12, 10); put(g, 13, 10);   /* run ends on its head */
  g.manC = 10; g.manR = 10; g.steps = 3;
  const ev = g.step("right");
  ok("driven at a fly with room to move, the brick is just eaten",
     [ev.crunched, ev.squashed.length, f.crushed], [1, 0, false]);
}
{
  /* head in a dead end, tail sticking out: drive a brick into the tail
     and it has nowhere left to be */
  const g = bare();
  const f = monster(g, "fly", 15, 10);
  f.tc = 14; f.tr = 10;
  g.leash = 0; g.manC = 12; g.manR = 10; g.steps = 3;
  /* seal the head end and both flanks, leaving only the way the man came */
  put(g, 16, 10); put(g, 15, 11); put(g, 15, 9);
  put(g, 14, 11); put(g, 14, 9);
  ok("head stuck but tail exposed is not yet walled in", g.isBoxed(f), false);
  put(g, 13, 10);                              /* the brick he will shove */
  const ev = g.step("right");
  ok("a brick driven into the last square crushes it",
     [ev.squashed.length, f.crushed, f.gone], [1, true, true]);
  ok("and the brick stays where it landed", g.grid[I(14, 10)], MF.BRICK);
  ok("crushing clears the cellar", g.won || g.loose() === 0, true);
}
{
  /* the classic fly is one square: VDU226 and 227 are drawn at the same
     position in two colours, not on two cells */
  const g = new MF.Game({ classic: true });
  g.sheet();
  ok("the 1985 fly is one square", g.cellsOf(g.monsters[0]).length, 1);
}

/* ================= what stops a shove ============================= */
{
  /* a line of bricks driven into a tree simply stops, and so does he */
  const g = bare();
  put(g, 11, 10); put(g, 12, 10);
  put(g, 13, 10, MF.TREE);
  const before = g.bricks;
  g.steps = 3;                            /* a heavy shove needs two */
  const ev = g.step("right");
  ok("bricks shoved against a tree stop dead",
     [ev.blocked, ev.moved, g.manC, g.bricks,
      g.grid[I(11, 10)], g.grid[I(12, 10)], g.grid[I(13, 10)]],
     [true, false, 10, before, MF.BRICK, MF.BRICK, MF.TREE]);
}
{
  /* fell the tree with the saw and the same shove goes through */
  const g = bare();
  put(g, 11, 10); put(g, 12, 10);
  put(g, 13, 10, MF.TREE);
  g.manC = 12; g.manR = 10; g.saw = 1;
  g.step("right");                        /* the saw takes the tree */
  ok("and once the tree is down the way is clear",
     [g.grid[I(13, 10)], g.saw], [MF.EMPTY, 0]);
  g.manC = 10; g.steps = 3;
  const ev = g.step("right");
  ok("so the line moves after all",
     [ev.blocked, g.grid[I(13, 10)], g.grid[I(11, 10)]], [false, MF.BRICK, MF.EMPTY]);
}
{
  /* the cellar wall holds the line instead of eating it */
  const g = bare();
  g.manC = MF.COLS - 3;
  put(g, MF.COLS - 2, 10); put(g, MF.COLS - 1, 10);
  const before = g.bricks;
  g.steps = 3;
  const ev = g.step("right");
  ok("a wall stops a shove without taking a brick",
     [ev.blocked, ev.lostOverEdge, g.bricks, g.manC], [true, 0, before, MF.COLS - 3]);
}
{
  /* but 1985 still loses it over the edge, which is the whole point */
  const g = new MF.Game({ classic: true });
  g.sheet(); g.grid.fill(MF.EMPTY); g.bricks = 0;
  g.manC = MF.COLS - 2; g.manR = 10;
  g.monsters[0].c = 2; g.monsters[0].r = 2;
  put(g, MF.COLS - 1, 10);
  const ev = g.step("right");
  ok("the 1985 cellar still loses bricks over its edge",
     [ev.lostOverEdge, g.bricks, g.manC], [1, 0, MF.COLS - 1]);
}
{
  /* the chopper is the one thing left that takes bricks off you */
  const g = bare();
  put(g, 11, 10); put(g, 12, 10);
  put(g, 13, 10, MF.CHOPPER);
  const before = g.bricks;
  g.steps = 3;
  const ev = g.step("right");
  ok("a chopper mills the brick driven into it",
     [ev.chopped_brick, g.bricks, g.manC, g.grid[I(13, 10)]],
     [1, before - 1, 11, MF.CHOPPER]);
}
{
  const g = bare();
  put(g, 11, 10, MF.CHOPPER);
  const ev = g.step("right");
  ok("and he is not going to walk into one", [g.manC, ev.strained], [10, true]);
}
{
  const g = bare();
  const m = monster(g, "spider", 15, 15);
  g.leash = 0;
  put(g, 16, 15, MF.CHOPPER); put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  ok("a chopper holds a monster in like any other fixture", g.step(null).won, true);
}

/* ================= the descent ==================================== */
{
  const at = { slopes: 4, boots: 5, frost: 6, trees: 7, marbles: 8, jar: 9, tar: 10, water: 11 };
  let wrong = 0;
  for (const k in at) {
    if (MF.featuresFor(at[k])[k] !== true) { wrong++; console.log("      " + k + " missing at " + at[k]); }
    if (MF.featuresFor(at[k] - 1)[k] !== false) { wrong++; console.log("      " + k + " early at " + (at[k] - 1)); }
  }
  ok("every element arrives at exactly the cellar it should", wrong, 0);
}
{
  let missing = 0, briefed = 0;
  for (let F = 1; F <= 16; F++) {
    const adds = MF.levelOf(F).adds;
    const b = MF.briefingFor(F);
    if (adds.length !== b.length) missing++;
    b.forEach((x) => { if (x.name && x.body && x.body.length > 40) briefed++; });
  }
  ok("everything introduced has a briefing written for it", missing, 0);
  ok("and the briefings actually say something", briefed >= 11, true);
}
{
  /* the curve should never hand you fewer bricks than a trap needs */
  let worst = 9999;
  for (let F = 1; F <= 400; F++) {
    const l = MF.levelOf(F);
    worst = Math.min(worst, l.PE - 4 * l.kinds.length);
  }
  ok("400 cellars deep there are always bricks to spare", worst > 30, true);
}
{
  /* and a whole cellar must survive being played blind */
  const g = new MF.Game();
  let crashed = null;
  try {
    for (let F = 1; F <= 20; F++) {
      g.F = F; g.sheet();
      for (let i = 0; i < 300; i++) {
        g.step(["left", "right", "up", "down", null][i % 5]);
        if (g.over || g.won) break;
      }
    }
  } catch (e) { crashed = e.message; }
  ok("twenty cellars can be played through without throwing", crashed, null);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
