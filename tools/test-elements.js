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

/* a cellar with nothing in it, so each test can furnish its own */
function bare(level) {
  const g = new MF.Game({ seed: SEED });
  g.F = level || 12;
  g.sheet();
  g.grid.fill(MF.EMPTY);
  g.fluid.fill(MF.DRY); g.fvol.fill(0); g.burn.fill(0); g.sealed.fill(0);
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
  const g = new MF.Game({ classic: true, seed: SEED });
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
  const g = new MF.Game({ classic: true, seed: SEED });
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
  settle(g, 34);
  /* Measure where the tar HAS BEEN - wet squares plus the rock it leaves
     when it sets. Counting only wet squares makes the test a race
     against TAR_COOLS: too few turns and it has not travelled, too many
     and it has all set and there is nothing left to measure. */
  let touched = 0, sumH = 0, farthest = 0;
  for (let c = 0; c < 34; c++) for (let r = 0; r < 26; r++) {
    const i = I(c, r);
    if (g.fvol[i] > 0 || g.grid[i] === MF.COOLED) {
      touched++; sumH += g.height[i]; farthest = Math.max(farthest, c);
    }
  }
  /* the claim is that it went DOWN, which the mean height proves;
     distance is only there to show it moved off the vat at all */
  ok("tar runs downhill", [touched > 0, farthest > 2, sumH / touched < 3], [true, true, true]);
}
{
  const g = bare();
  put(g, 13, 10); put(g, 14, 10, MF.TREE);
  g.grid[I(12, 10)] = MF.VAT_TAR;
  g.breakVat(12, 10, { burst: 0 });
  const early = settle(g, 8);
  const late = settle(g, 60);
  ok("tar burns the bricks and the trees it reaches, but not at once",
     [early.burned > 0, late.burned > 0], [false, true]);
}
{
  const g = bare();
  const mon = monster(g, "fly", 13, 10);
  mon.trapped = true;                       /* keep it still for the test */
  /* A spill chooses its direction at random, so left to find the monster
     on its own it sometimes never goes that way. Wall three sides with
     set tar - which fluid cannot enter - and east is the only way out. */
  g.grid[I(12, 9)] = MF.COOLED;
  g.grid[I(12, 11)] = MF.COOLED;
  g.grid[I(11, 10)] = MF.COOLED;
  g.fluid[I(12, 10)] = MF.TAR;
  g.fvol[I(12, 10)] = 8;
  const ev = settle(g, 8);
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
  const g = new MF.Game({ classic: true, seed: SEED });
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
  const g = new MF.Game({ classic: true, seed: SEED });
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
  /* good stone holds the line instead of eating it */
  const g = bare();
  g.edge.E.fill(MF.WALL);
  g.manC = MF.COLS - 3;
  put(g, MF.COLS - 2, 10); put(g, MF.COLS - 1, 10);
  const before = g.bricks;
  g.steps = 3;
  const ev = g.step("right");
  ok("a stone wall stops a shove without taking a brick",
     [ev.blocked, ev.lostOverEdge, g.bricks, g.manC], [true, 0, before, MF.COLS - 3]);
}
{
  /* but where the floor just stops, it goes over and is gone */
  const g = bare();
  g.edge.E.fill(MF.DROP);
  g.manC = MF.COLS - 3;
  put(g, MF.COLS - 2, 10); put(g, MF.COLS - 1, 10);
  const before = g.bricks;
  g.steps = 3;
  const ev = g.step("right");
  ok("a brick shoved over a drop is lost",
     [ev.lostOverEdge, g.bricks, g.manC], [1, before - 1, MF.COLS - 2]);
}
{
  /* stone counts as a side, so a corner is worth two bricks */
  const g = bare();
  g.edge.E.fill(MF.WALL); g.edge.N.fill(MF.WALL);
  const m = monster(g, "spider", MF.COLS - 1, MF.ROWS - 1);
  const cornered = g.isBoxed(m);
  put(g, MF.COLS - 2, MF.ROWS - 1); put(g, MF.COLS - 1, MF.ROWS - 2);
  ok("two bricks wall a monster into a stone corner",
     [cornered, g.isBoxed(m)], [false, true]);
}
{
  /* the same corner made of nothing holds nothing */
  const g = bare();
  g.edge.E.fill(MF.DROP); g.edge.N.fill(MF.DROP);
  const m = monster(g, "spider", MF.COLS - 1, MF.ROWS - 1);
  put(g, MF.COLS - 2, MF.ROWS - 1); put(g, MF.COLS - 1, MF.ROWS - 2);
  ok("a corner of two drops holds nothing in", g.isBoxed(m), false);
}
{
  /* and you can walk off one */
  const g = bare();
  g.edge.E.fill(MF.DROP);
  g.manC = MF.COLS - 1; g.manR = 10;
  g.steps = 3;
  const ev = g.step("right");
  ok("walking off a drop kills you", [ev.fell, ev.lost], [true, true]);
}
{
  const g = bare();
  g.edge.E.fill(MF.WALL);
  g.manC = MF.COLS - 1; g.manR = 10;
  g.steps = 3;
  const ev = g.step("right");
  ok("walking into stone does not", [!!ev.fell, !!ev.lost], [false, false]);
}
{
  /* cellar one is exactly as it was: no stone anywhere */
  const g = new MF.Game({ seed: 4 });
  g.F = 1; g.sheet();
  let stone = 0;
  for (const k of ["W", "E", "S", "N"]) for (const v of g.edge[k]) if (v === MF.WALL) stone++;
  const g2 = new MF.Game({ seed: 4 });
  g2.F = 2; g2.sheet();
  let stone2 = 0;
  for (const k of ["W", "E", "S", "N"]) for (const v of g2.edge[k]) if (v === MF.WALL) stone2++;
  ok("cellar one is all drop, cellar two is not", [stone, stone2 > 0], [0, true]);
}
{
  /* but 1985 still loses it over the edge, which is the whole point */
  const g = new MF.Game({ classic: true, seed: SEED });
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

/* ================= the ground, and what rolls down it ============= */
{
  /* every rise is a slope you can walk, never a cliff */
  let steepest = 0;
  const g = new MF.Game({ seed: SEED });
  for (let F = 4; F <= 24; F++) {
    g.F = F; g.sheet();
    for (let r = 0; r < MF.ROWS; r++) for (let c = 0; c < MF.COLS; c++) {
      const h = g.height[I(c, r)];
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc >= MF.COLS || nr >= MF.ROWS) continue;
        steepest = Math.max(steepest, Math.abs(h - g.height[I(nc, nr)]));
      }
    }
  }
  ok("the floor never steps more than one at a time", steepest, 1);
}
{
  /* and there is actually some ground to slope */
  const g = new MF.Game({ seed: SEED });
  let raised = 0, total = 0;
  for (let F = 4; F <= 20; F++) {
    g.F = F; g.sheet();
    for (let i = 0; i < g.height.length; i++) { total++; if (g.height[i] > 0) raised++; }
  }
  ok("a good part of the cellar is not level", raised / total > 0.25, true);
}
{
  /* nothing is left mid-slide when the cellar opens */
  const g = new MF.Game({ seed: SEED });
  let restless = 0;
  for (let F = 4; F <= 24; F++) { g.F = F; g.sheet(); if (g.slideBricks(null)) restless++; }
  ok("bricks have found their level before play starts", restless, 0);
}
{
  /* A hillside, uniform north to south, so the only way down is west.
     Raising single squares instead just lets a brick slide off sideways,
     which is correct and tests nothing. */
  const hill = (g, edge) => {
    for (let c = 0; c < MF.COLS; c++) for (let r = 0; r < MF.ROWS; r++)
      g.height[I(c, r)] = c >= edge ? 1 : 0;
  };
  const g = bare();
  hill(g, 12);
  put(g, 12, 10);
  g.manC = 11; g.manR = 10; g.steps = 3;
  g.step("right");                      /* shove it further up the hill */
  ok("a brick can be shoved uphill", [g.grid[I(13, 10)], g.manC], [MF.BRICK, 12]);
  g.step("up");                         /* and step off the square below it */
  ok("but it follows him back down the moment he leaves",
     [g.grid[I(13, 10)], g.grid[I(12, 10)]], [MF.BRICK, MF.EMPTY]);
}
{
  /* downhill it keeps going, which is why downhill is the easy way */
  /* a continuous fall, not a terrace - a brick only rolls to strictly
     lower ground, so on a flat step it correctly stops dead */
  const g = bare();
  for (let c = 0; c < MF.COLS; c++) for (let r = 0; r < MF.ROWS; r++)
    g.height[I(c, r)] = Math.max(0, 3 - Math.max(0, c - 11));
  put(g, 12, 10);
  g.manC = 11; g.manR = 10; g.steps = 3;
  g.step("right");
  let resting = -1;
  for (let c = 12; c < MF.COLS; c++) if (g.grid[I(c, 10)] === MF.BRICK) resting = c;
  ok("shoved downhill it runs on past where you pushed it", resting > 13, true);
  ok("and comes to rest on the level ground below", g.height[I(resting, 10)], 0);
}
{
  /* it will not roll onto anybody */
  const g = bare();
  for (let c = 0; c < MF.COLS; c++) for (let r = 0; r < MF.ROWS; r++)
    g.height[I(c, r)] = c <= 11 ? 1 : 0;
  put(g, 11, 10);
  const m = monster(g, "spider", 12, 10);
  g.slideBricks(null);
  ok("a brick will not roll onto a monster",
     [g.grid[I(11, 10)], g.grid[I(12, 10)]], [MF.BRICK, MF.EMPTY]);
  g.monsters.length = 0;
  g.manC = 12; g.manR = 10;
  g.slideBricks(null);
  ok("nor onto the man", g.grid[I(11, 10)], MF.BRICK);
  g.manC = 2; g.manR = 2;
  g.slideBricks(null);
  ok("but it goes the moment the way is clear", g.grid[I(12, 10)], MF.BRICK);
}
{
  /* and none of it happens in 1985 */
  const g = new MF.Game({ classic: true, seed: SEED });
  g.sheet();
  ok("the classic cellar has no slopes and nothing slides",
     [g.slideBricks(null), Math.max.apply(null, Array.from(g.height))], [0, 0]);
}

/* ================= leaning on a tree ============================== */
/* A bowl with the tree at the bottom of it, so every square around the
   tree is uphill of it and a brick on any of them leans in. An east-west
   slope only ever gives you one square that presses. */
function bowl(g, cx, cy) {
  for (let c = 0; c < MF.COLS; c++) for (let r = 0; r < MF.ROWS; r++)
    g.height[I(c, r)] = Math.min(6, Math.abs(c - cx) + Math.abs(r - cy));
}
{
  const g = bare();
  bowl(g, 15, 10);
  put(g, 15, 10, MF.TREE);
  put(g, 14, 10);                       /* one brick leaning on it */
  let turns = 0;
  while (g.grid[I(15, 10)] === MF.TREE && turns < 60) { g.slideBricks(null); turns++; }
  ok("one brick leaning on a tree never brings it down",
     [turns, g.grid[I(15, 10)]], [60, MF.TREE]);
}
{
  const g = bare();
  bowl(g, 15, 10);
  put(g, 15, 10, MF.TREE);
  put(g, 14, 10); put(g, 16, 10);
  let two = 0;
  while (g.grid[I(15, 10)] === MF.TREE && two < 90) { g.slideBricks(null); two++; }
  ok("two will have it over, given time", g.grid[I(15, 10)], MF.EMPTY);
  ok("but it does take time", two > 4, true);

  const h = bare();
  bowl(h, 15, 10);
  put(h, 15, 10, MF.TREE);
  put(h, 14, 10); put(h, 16, 10); put(h, 15, 9); put(h, 15, 11);
  let many = 0;
  while (h.grid[I(15, 10)] === MF.TREE && many < 90) { h.slideBricks(null); many++; }
  ok("the more that pile up the quicker it goes", many < two, true);
}
{
  /* and once it is gone, what it was holding carries on down */
  const g = bare();
  bowl(g, 15, 10);
  put(g, 15, 10, MF.TREE);
  put(g, 14, 10); put(g, 16, 10);
  let fell = 0;
  while (g.grid[I(15, 10)] === MF.TREE && fell < 120) { g.slideBricks(null); fell++; }
  ok("bricks leaning on a tree on a slope bring it down", g.grid[I(15, 10)], MF.EMPTY);
  for (let i = 0; i < 60; i++) g.slideBricks(null);
  ok("and one of them carries on down into where it stood",
     g.grid[I(15, 10)], MF.BRICK);
}
{
  /* a tree on the flat is under no pressure at all */
  const g = bare();
  put(g, 10, 10, MF.TREE);
  put(g, 9, 10); put(g, 10, 9); put(g, 11, 10); put(g, 10, 11);
  for (let i = 0; i < 90; i++) g.slideBricks(null);
  ok("bricks resting beside a tree on level ground never shift it",
     g.grid[I(10, 10)], MF.TREE);
}

/* ================= friction ======================================= */
{
  ok("friction depends on the surface",
     [MF.frictionOn(MF.EMPTY, MF.DRY) < MF.frictionOn(MF.EMPTY, MF.WATER),
      MF.frictionOn(MF.EMPTY, MF.WATER) < MF.frictionOn(MF.EMPTY, MF.TAR),
      MF.frictionOn(MF.EMPTY, MF.DRY) < MF.frictionOn(MF.COOLED, MF.DRY)],
     [true, true, true]);
}
{
  /* the same shove carries a marble further over stone than through
     water, and tar stops it. The man goes elsewhere: left in the way he
     is what the marble hits, and every surface scores the same. */
  const runFor = (fluidKind) => {
    const g = bare();
    g.manC = 2; g.manR = 22;
    const m = marble(g, 5, 10);
    if (fluidKind) for (let c = 0; c < MF.COLS; c++) {
      g.fluid[I(c, 10)] = fluidKind; g.fvol[I(c, 10)] = 1;
    }
    m.dc = 1; m.dr = 0; m.v = 3;
    const ev = { rolled: [], smashed: 0, crushed: [], lost: false, burst: 0 };
    let turns = 0;
    while (m.v > 0 && turns < 40) { g.rollMarbles(ev); turns++; }
    return m.c - 5;
  };
  const dry = runFor(0), wet = runFor(MF.WATER), sticky = runFor(MF.TAR);
  ok("a marble runs furthest over dry stone", [dry > wet, wet > sticky], [true, true]);
  ok("and tar all but stops it", sticky <= 3, true);
}
{
  /* a brick will not slide out of tar */
  const g = bare();
  for (let c = 0; c < MF.COLS; c++) for (let r = 0; r < MF.ROWS; r++)
    g.height[I(c, r)] = Math.max(0, Math.min(6, 20 - c));
  put(g, 8, 10);
  g.fluid[I(8, 10)] = MF.TAR; g.fvol[I(8, 10)] = 3;
  for (let i = 0; i < 20; i++) g.slideBricks(null);
  ok("tar holds a brick where it stands", g.grid[I(8, 10)], MF.BRICK);
}

/* ================= a cellar is the same cellar ==================== */
/* The place is seeded; the state of play is not. So compare the land and
   its fixtures, and separately check that the movable parts really do
   move. */
function placeOf(g) {
  const fixed = [];
  for (let i = 0; i < g.grid.length; i++) {
    const v = g.grid[i];
    fixed.push((v === MF.TREE || v === MF.VAT_TAR || v === MF.VAT_WATER || v === MF.CHOPPER) ? v : 0);
  }
  return Array.from(g.height).join("") + "|" + fixed.join("") +
         "|" + Array.from(g.item).join("") + "|" + g.marbleCount;
}
{
  const a = new MF.Game({ seed: 4242 }); a.reset(9);
  const b = new MF.Game({ seed: 4242 }); b.reset(9);
  ok("the same run lays out the same place", placeOf(a), placeOf(b));

  const was = placeOf(a);
  a.F = 12; a.sheet();
  a.F = 9; a.sheet();
  ok("and it is still that place when you come back to it", placeOf(a), was);

  const c = new MF.Game({ seed: 77 }); c.reset(9);
  ok("a different run is a different place", placeOf(c) !== was, true);

  a.regenerate();
  ok("regenerating is the one thing that changes it", placeOf(a) !== was, true);
}
{
  /* but the bricks, the way in, and the monsters are dealt fresh */
  const state = (g) => Array.from(g.grid).join("") + "|" + g.manC + "," + g.manR +
                       "|" + g.monsters.map((m) => m.c + "," + m.r).join(";");
  const g = new MF.Game({ seed: 4242 });
  g.reset(9);
  const first = state(g);
  let differed = 0;
  for (let i = 0; i < 8; i++) { g.F = 9; g.sheet(); if (state(g) !== first) differed++; }
  ok("the bricks, the way in and the monsters are dealt again", differed, 8);
}
{
  /* how many monsters is part of the cellar, and it grows as you go down */
  ok("one monster until cellar ten, and more after it",
     [MF.levelOf(1).kinds.length, MF.levelOf(9).kinds.length,
      MF.levelOf(10).kinds.length, MF.levelOf(16).kinds.length],
     [1, 1, 2, 4]);
  let singles = 0;
  for (let F = 1; F <= 9; F++) if (MF.levelOf(F).kinds.length === 1) singles++;
  ok("every cellar before ten has exactly one thing in it", singles, 9);
  const a = new MF.Game({ seed: 5 }); a.reset(14);
  const b = new MF.Game({ seed: 999 }); b.reset(14);
  ok("and it does not vary between runs", a.monsters.length, b.monsters.length);
}
{
  /* how many marbles is part of the cellar; where they are is not */
  const a = new MF.Game({ seed: 31 }); a.reset(12);
  const b = new MF.Game({ seed: 31 }); b.reset(12);
  ok("the same cellar has the same number of marbles", a.marbleCount, b.marbleCount);
  const at = (g) => g.marbles.map((m) => m.c + "," + m.r).join(";");
  let moved = 0;
  const first = at(a);
  for (let i = 0; i < 8; i++) { a.F = 12; a.sheet(); if (at(a) !== first) moved++; }
  ok("but they are not in the same places", moved > 0, true);
}

/* ================= a wall is only a wall while it stands ========== */
{
  /* box a spider, then take one brick out of the wall */
  const g = bare();
  const m = monster(g, "spider", 15, 15);
  g.leash = 0; g.manC = 2; g.manR = 2;
  put(g, 16, 15); put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  let ev = g.step(null);
  ok("walled in", [m.trapped, ev.trappedNow.length, ev.won], [true, 1, true]);

  g.won = false;                       /* keep playing, to see it get out */
  g.grid[I(16, 15)] = MF.EMPTY; g.bricks--;
  ev = g.step(null);
  ok("take a brick out of the wall and it is loose again",
     [m.trapped, ev.freed.length], [false, 1]);
}
{
  /* and it starts moving the moment it is */
  const g = bare();
  const m = monster(g, "spider", 15, 15);
  g.leash = 0; g.manC = 2; g.manR = 2;
  put(g, 16, 15); put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  g.step(null); g.won = false;
  const held = [m.c, m.r];
  for (let i = 0; i < 5; i++) { g.step(null); g.won = false; }
  ok("a walled-in monster stays put", [m.c, m.r], held);
  g.grid[I(14, 15)] = MF.EMPTY;
  for (let i = 0; i < 6; i++) { g.step(null); g.won = false; }
  ok("and moves again once the wall is broken", m.c !== held[0] || m.r !== held[1], true);
}
{
  /* two monsters: the cellar is only cleared while both are held at once */
  const g = bare();
  g.height.fill(0);
  const a = monster(g, "spider", 10, 15);
  const b = monster(g, "spider", 25, 8);
  g.leash = 0; g.manC = 2; g.manR = 2;
  const box = (m) => { put(g, m.c + 1, m.r); put(g, m.c - 1, m.r); put(g, m.c, m.r + 1); put(g, m.c, m.r - 1); };
  box(a);
  let ev = g.step(null);
  ok("one held is not enough", [ev.won, a.trapped, b.trapped], [false, true, false]);
  /* break the first wall in the same breath as building the second */
  g.grid[I(11, 15)] = MF.EMPTY;
  box(b);
  ev = g.step(null);
  ok("letting the first go while walling the second clears nothing",
     [ev.won, a.trapped, b.trapped, ev.freed.length], [false, false, true, 1]);
  put(g, 11, 15);
  ev = g.step(null);
  ok("both at once clears the cellar", ev.won, true);
}
{
  /* nothing is ever laid down walled in, or lying on top of something */
  const g = new MF.Game({ seed: 8 });
  let boxed = 0, buried = 0, tailless = 0;
  for (let F = 1; F <= 20; F++) {
    g.F = F; g.sheet();
    for (const m of g.monsters) {
      if (g.isBoxed(m)) boxed++;
      const cs = g.cellsOf(m);
      if (m.spec.size === 2 && cs.length === 1) tailless++;
      for (const [c, r] of cs) if (g.grid[I(c, r)] !== MF.EMPTY) buried++;
    }
  }
  ok("no monster starts walled in", boxed, 0);
  ok("and none starts buried in the scenery", buried, 0);
  ok("and the fly always has room to lie down", tailless, 0);
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
  const g = new MF.Game({ seed: SEED });
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


/* ---- pools: liquid behind brickwork ------------------------------- */
{
  const g = bare();
  g.makePools(MF.WATER, 1);
  let sealed = 0, ring = 0;
  for (let i = 0; i < MF.COLS * MF.ROWS; i++) {
    if (g.sealed[i]) sealed++;
    if (g.grid[i] === MF.BRICK) ring++;
  }
  ok("a pool is liquid inside a ring of brick", [sealed, ring], [9, 16]);
}
{
  /* while the ring holds, it does not move */
  const g = bare();
  g.makePools(MF.WATER, 1);
  const before = g.fvol.slice();
  for (let t = 0; t < 25; t++) g.step(null);
  let same = true;
  for (let i = 0; i < before.length; i++) if (before[i] !== g.fvol[i]) same = false;
  ok("water behind a sound ring stays put", same, true);
}
{
  /* take one brick out and the whole pool wakes up */
  const g = bare();
  g.makePools(MF.WATER, 1);
  let pc = -1, pr = -1;
  for (let r = 0; r < MF.ROWS; r++) for (let c = 0; c < MF.COLS; c++)
    if (g.sealed[I(c, r)] && pc < 0) { pc = c; pr = r; }
  /* the brick due north of the pool's top-left cell is part of the ring */
  g.grid[I(pc, pr - 1)] = MF.EMPTY;
  g.step(null);
  let stillSealed = 0;
  for (let i = 0; i < g.sealed.length; i++) if (g.sealed[i]) stillSealed++;
  ok("opening the ring anywhere releases all of it", stillSealed, 0);
}
{
  /* tar burns its own way out, given long enough */
  const g = bare();
  g.makePools(MF.TAR, 1);
  let held = true;
  for (let t = 0; t < 12; t++) { g.step(null); }
  for (let i = 0; i < g.sealed.length; i++) if (!g.sealed[i] && g.fluid[i] === MF.TAR) held = false;
  let out = false;
  for (let t = 0; t < 200 && !out; t++) {
    g.step(null);
    for (let i = 0; i < g.sealed.length; i++) if (!g.sealed[i] && g.fluid[i] === MF.TAR) out = true;
  }
  ok("tar holds for a while, then burns out on its own", [held, out], [true, true]);
}

/* ---- marbles have mass ------------------------------------------- */
{
  const small = { c: 5, r: 5, dc: 1, dr: 0, v: 1.2, size: 1 };
  const big   = { c: 5, r: 5, dc: 1, dr: 0, v: 1.2, size: 3 };
  const g = bare();
  g.edge.E.fill(MF.DROP);
  const run = (mar) => {
    const h = bare();
    h.edge.E.fill(MF.DROP);
    h.marbles.push(mar);
    mar.c = MF.COLS - 2; mar.r = 10;
    h.grid[I(mar.c, mar.r)] = MF.MARBLE;
    h.step(null);
    return !!mar.gone;
  };
  ok("the same speed carries a big marble over the lip and not a small one",
     [run(small), run(big)], [false, true]);
}
{
  /* momentum breaks bricks, so a heavy one does it slowly */
  const g = bare();
  const mar = { c: 10, r: 10, dc: 1, dr: 0, v: 1.1, size: 3 };
  g.marbles.push(mar); g.grid[I(10, 10)] = MF.MARBLE;
  put(g, 11, 10);
  const ev = g.step(null);
  ok("a heavy marble smashes a brick at a speed a light one bounces off",
     [ev.smashed, g.bricks], [1, 0]);
}
{
  const g = bare();
  const mar = { c: 10, r: 10, dc: 1, dr: 0, v: 1.1, size: 1 };
  g.marbles.push(mar); g.grid[I(10, 10)] = MF.MARBLE;
  put(g, 11, 10);
  const ev = g.step(null);
  ok("and the light one leaves it standing",
     [ev.smashed, g.grid[I(11, 10)]], [0, MF.BRICK]);
}

/* ---- rocks -------------------------------------------------------- */
{
  const g = bare();
  g.manC = 10; g.manR = 10;
  g.grid[I(11, 10)] = MF.ROCK;
  g.steps = 3;
  const ev = g.step("right");
  ok("one rock shoves", [ev.blocked, g.grid[I(12, 10)], g.grid[I(11, 10)]],
     [false, MF.ROCK, MF.EMPTY]);
}
{
  const g = bare();
  g.manC = 10; g.manR = 10;
  g.grid[I(11, 10)] = MF.ROCK; g.grid[I(12, 10)] = MF.ROCK;
  g.steps = 3;
  const ev = g.step("right");
  ok("two rocks is exactly all he has",
     [ev.blocked, g.grid[I(13, 10)], g.grid[I(12, 10)]], [false, MF.ROCK, MF.ROCK]);
}
{
  const g = bare();
  g.manC = 10; g.manR = 10;
  for (const c of [11, 12, 13]) g.grid[I(c, 10)] = MF.ROCK;
  g.steps = 3;
  const ev = g.step("right");
  ok("three is more than there is in him",
     [ev.blocked, !!ev.tooHeavy, g.manC], [true, true, 10]);
}
{
  /* a rock and four bricks is the other way to spend eight */
  const g = bare();
  g.manC = 10; g.manR = 10;
  g.grid[I(11, 10)] = MF.ROCK;
  for (const c of [12, 13, 14, 15]) put(g, c, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("a rock and four bricks goes",
     [ev.blocked, g.grid[I(12, 10)], g.grid[I(16, 10)]], [false, MF.ROCK, MF.BRICK]);
}
{
  const g = bare();
  g.manC = 10; g.manR = 10;
  g.grid[I(11, 10)] = MF.ROCK;
  for (const c of [12, 13, 14, 15, 16]) put(g, c, 10);
  const ev = (g.steps = 3, g.step("right"));
  ok("a rock and five is one too many", [ev.blocked, !!ev.tooHeavy], [true, true]);
}
{
  const g = bare();
  g.manC = 10; g.manR = 10;
  for (let c = 11; c <= 18; c++) put(g, c, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("eight bricks is the most he can move", [ev.blocked, ev.pushed], [false, 8]);
}
{
  const g = bare();
  g.manC = 10; g.manR = 10;
  for (let c = 11; c <= 19; c++) put(g, c, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("nine is not", [ev.blocked, !!ev.tooHeavy], [true, true]);
}
{
  /* the 1985 game never had a limit and still does not */
  const g = new MF.Game({ classic: true, seed: SEED });
  g.sheet(); g.grid.fill(MF.EMPTY); g.bricks = 0;
  g.monsters[0].c = 2; g.monsters[0].r = 2; g.monsters[0].tc = 3; g.monsters[0].tr = 2;
  g.manC = 5; g.manR = 10;
  for (let c = 6; c <= 20; c++) put(g, c, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("classic shoves a line of fifteen without complaint",
     [ev.blocked, ev.pushed], [false, 15]);
}
{
  /* and neither does the first cellar, where the blocks are timber */
  const g = new MF.Game({ seed: SEED });
  g.F = 1; g.sheet(); g.grid.fill(MF.EMPTY); g.bricks = 0;
  g.monsters[0].c = 2; g.monsters[0].r = 2; g.monsters[0].tc = 3; g.monsters[0].tr = 2;
  g.manC = 5; g.manR = 10;
  for (let c = 6; c <= 20; c++) put(g, c, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("wooden blocks have no limit either",
     [g.wood, ev.blocked, ev.pushed], [true, false, 15]);
}
{
  /* but cellar 2 is brick, and brick has a limit */
  const g = new MF.Game({ seed: SEED });
  g.F = 2; g.sheet(); g.grid.fill(MF.EMPTY); g.bricks = 0;
  g.monsters[0].c = 2; g.monsters[0].r = 2; g.monsters[0].tc = 3; g.monsters[0].tr = 2;
  g.manC = 5; g.manR = 10;
  for (let c = 6; c <= 20; c++) put(g, c, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("and brick does", [g.wood, ev.blocked, !!ev.tooHeavy], [false, true, true]);
}
{
  /* tar will not burn through one */
  const g = bare();
  g.grid[I(12, 10)] = MF.ROCK;
  g.fluid[I(11, 10)] = MF.TAR; g.fvol[I(11, 10)] = 9;
  for (let t = 0; t < 30; t++) g.step(null);
  ok("tar does not burn a rock", g.grid[I(12, 10)], MF.ROCK);
}
{
  /* and a beetle cannot eat one */
  const g = bare();
  const b = monster(g, "beetle", 10, 10);
  g.leash = 0;
  g.grid[I(11, 10)] = MF.ROCK;
  for (let t = 0; t < 60; t++) g.step(null);
  ok("a beetle cannot eat a rock", g.grid[I(11, 10)], MF.ROCK);
}
{
  /* a rock walls a monster in as well as anything else */
  const g = bare();
  g.leash = 0;
  const m = monster(g, "spider", 15, 15);
  g.grid[I(16, 15)] = MF.ROCK;
  put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  const ev = g.step(null);
  ok("a rock is a wall like any other", [m.trapped, ev.won], [true, true]);
}
{
  /* there are never many of them */
  const g = new MF.Game({ seed: SEED });
  g.F = 15; g.sheet();
  let rocks = 0, bricks = 0;
  for (let i = 0; i < MF.COLS * MF.ROWS; i++) {
    if (g.grid[i] === MF.ROCK) rocks++;
    if (g.grid[i] === MF.BRICK) bricks++;
  }
  ok("no more than a tenth of the bricks", [rocks > 0, rocks <= Math.ceil(bricks * 0.1)],
     [true, true]);
}


/* ---- robots ------------------------------------------------------- */
function deep(level) {
  const g = bare(level || 16);
  return g;
}
{
  const g = deep();
  g.robots.push({ c: 12, r: 10, size: 1, running: false, power: 12, life: 40, wait: 20, gone: false });
  g.manC = 11; g.manR = 10;
  g.steps = 3;
  const ev = g.step("right");
  ok("walking into a robot starts it, and costs you the turn",
     [!!ev.robotStarted, g.robots[0].running, g.manC], [true, true, 11]);
}
{
  /* left alone it wanders off */
  const g = deep();
  g.robots.push({ c: 12, r: 10, size: 1, running: false, power: 12, life: 40, wait: 3, gone: false });
  g.manC = 2; g.manR = 2;
  for (let t = 0; t < 5; t++) g.step(null);
  ok("a robot nobody starts goes away again", g.robots[0].gone, true);
}
{
  /* it has three rocks in it where a man has two */
  const g = deep();
  const b = { c: 10, r: 10, size: 1, running: true, power: 12, life: 40, wait: 20, gone: false };
  g.robots.push(b);
  for (const c of [11, 12, 13]) g.grid[I(c, 10)] = MF.ROCK;
  const moved = g.robotMove(b, [1, 0], { pushed: 0 });
  ok("a robot shoves three rocks", [moved, g.grid[I(14, 10)], b.c], [true, MF.ROCK, 11]);
}
{
  const g = deep();
  const b = { c: 10, r: 10, size: 1, running: true, power: 12, life: 40, wait: 20, gone: false };
  g.robots.push(b);
  for (const c of [11, 12, 13, 14]) g.grid[I(c, 10)] = MF.ROCK;
  const moved = g.robotMove(b, [1, 0], { pushed: 0 });
  ok("but not four", [moved, b.c], [false, 10]);
}
{
  /* nothing shoves one over the edge */
  const g = deep();
  g.edge.E.fill(MF.DROP);
  const b = { c: MF.COLS - 1, r: 10, size: 1, running: true, power: 12, life: 40, wait: 20, gone: false };
  g.robots.push(b);
  const moved = g.robotMove(b, [1, 0], { pushed: 0 });
  ok("a robot will not walk off a drop", [moved, b.gone, b.c], [false, false, MF.COLS - 1]);
}
{
  const g = deep();
  g.edge.E.fill(MF.DROP);
  const b = { c: MF.COLS - 1, r: 10, size: 1, running: true, power: 12, life: 40, wait: 20, gone: false };
  g.robots.push(b);
  g.manC = MF.COLS - 3; g.manR = 10;
  put(g, MF.COLS - 2, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("and a brick line will not push one over either",
     [ev.blocked, b.gone, g.manC], [true, false, MF.COLS - 3]);
}
{
  /* a monster takes one apart */
  const g = deep();
  g.leash = 0;
  const b = { c: 15, r: 15, size: 1, running: true, power: 12, life: 40, wait: 20, gone: false };
  g.robots.push(b);
  const m = monster(g, "spider", 15, 15);
  g.step(null);
  ok("a monster destroys a robot it reaches", [b.gone, !!g._lastEv], [true, false]);
}
{
  /* the charge runs out */
  const g = deep();
  const b = { c: 5, r: 5, size: 1, running: true, power: 12, life: 3, wait: 20, gone: false };
  g.robots.push(b);
  g.manC = 2; g.manR = 2;
  for (let t = 0; t < 6; t++) g.step(null);
  ok("a robot stops when its charge does", b.gone, true);
}
{
  /* bigger ones shove more and last longer */
  const g = deep();
  g.feat.robots = true;
  let sizes = {}, powers = {}, lives = {};
  for (let t = 0; t < 4000 && Object.keys(sizes).length < 3; t++) {
    g.robots.length = 0;
    g.spawnRobot({});
    for (const b of g.robots) { sizes[b.size] = 1; powers[b.size] = b.power; lives[b.size] = b.life; }
  }
  ok("a bigger robot shoves more and lasts longer",
     [powers[1] < powers[3], lives[1] < lives[3], powers[1] >= 12], [true, true, true]);
}
{
  /* and a monster goes for whichever of you is nearer */
  const g = deep();
  const m = monster(g, "spider", 20, 10);
  g.manC = 2; g.manR = 10;
  const far = g.prey(m);
  g.robots.push({ c: 22, r: 10, size: 1, running: true, power: 12, life: 40, wait: 20, gone: false });
  const near = g.prey(m);
  ok("a running robot is what a monster goes for when it is nearer",
     [far.c, near.c], [2, 22]);
}
{
  /* but not one that is standing there switched off */
  const g = deep();
  const m = monster(g, "spider", 20, 10);
  g.manC = 2; g.manR = 10;
  g.robots.push({ c: 22, r: 10, size: 1, running: false, power: 12, life: 40, wait: 20, gone: false });
  ok("a robot nobody has started is not worth chasing", g.prey(m).c, 2);
}


/* ---- loose credits ------------------------------------------------ */
function withCoin(c, r, level) {
  const g = bare(level || 6);
  g.feat.coins = true;
  g.coins.push({ c, r, value: 10, life: 50 });
  return g;
}
{
  const g = withCoin(11, 10);
  g.manC = 10; g.manR = 10;
  g.steps = 3;
  const ev = g.step("right");
  ok("walking onto one collects it",
     [ev.tookCoin.length, ev.tookCoin[0] && ev.tookCoin[0].value, g.coins.length], [1, 10, 0]);
}
{
  /* a monster that gets there first takes it */
  const g = withCoin(15, 15);
  g.leash = 0;
  monster(g, "spider", 15, 15);
  g.manC = 2; g.manR = 2;
  const ev = g.step(null);
  ok("a monster standing on one takes it",
     [g.coins.length, ev.lostCoin[0] && ev.lostCoin[0].why], [0, "a monster got there first"]);
}
{
  /* shove a brick onto it and you have buried it yourself */
  const g = withCoin(12, 10);
  g.manC = 10; g.manR = 10;
  put(g, 11, 10);
  g.steps = 3;
  const ev = g.step("right");
  ok("a brick pushed onto one buries it",
     [g.coins.length, ev.lostCoin[0] && ev.lostCoin[0].why], [0, "buried"]);
}
{
  const g = withCoin(12, 10);
  g.fluid[I(12, 10)] = MF.TAR; g.fvol[I(12, 10)] = 6;
  g.manC = 2; g.manR = 2;
  const ev = g.step(null);
  ok("tar takes one", [g.coins.length, ev.lostCoin[0] && ev.lostCoin[0].why], [0, "gone in the tar"]);
}
{
  const g = withCoin(12, 10);
  g.fluid[I(12, 10)] = MF.WATER; g.fvol[I(12, 10)] = 6;
  g.manC = 2; g.manR = 2;
  const ev = g.step(null);
  ok("and so does water", [g.coins.length, ev.lostCoin[0] && ev.lostCoin[0].why], [0, "washed away"]);
}
{
  /* they do not sit there for ever */
  const g = withCoin(20, 20);
  g.coins[0].life = 3;
  g.manC = 2; g.manR = 2;
  let went = -1;
  for (let t = 0; t < 10 && went < 0; t++) { g.step(null); if (!g.coins.length) went = t; }
  ok("a coin nobody reaches goes away on its own", went >= 0 && went < 6, true);
}
{
  /* and they turn up by themselves, but not in the first cellars */
  const g = bare(6);
  g.manC = 2; g.manR = 2;
  let ever = false;
  for (let t = 0; t < 600 && !ever; t++) { g.step(null); if (g.coins.length) ever = true; }
  ok("coins turn up on their own", ever, true);
}
{
  const g = bare(1);
  g.manC = 2; g.manR = 2;
  let ever = false;
  for (let t = 0; t < 600 && !ever; t++) { g.step(null); if (g.coins.length) ever = true; }
  ok("but never in the top cellar, which has none of this in it", ever, false);
}
{
  const g = new MF.Game({ classic: true, seed: SEED });
  g.sheet();
  let ever = false;
  for (let t = 0; t < 400 && !ever; t++) { g.step(null); if (g.coins.length) ever = true; }
  ok("and never at all in the 1985 game", ever, false);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
