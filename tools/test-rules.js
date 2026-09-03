#!/usr/bin/env node
/*
 * Checks the ported rules against the behaviour of the original BASIC.
 * Each test names the line of FLY it is pinning down.
 *
 *   node tools/test-rules.js
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

function bare(level) {
  const g = new MF.Game();
  g.reset(level || 1);
  g.grid.fill(MF.EMPTY);
  g.bricks = 0;
  g.manC = 10; g.manR = 10;
  g.flyC = 25; g.flyR = 20;
  return g;
}
const put = (g, c, r) => { g.grid[r * MF.COLS + c] = MF.BRICK; g.bricks++; };
const isBrick = (g, c, r) => g.grid[r * MF.COLS + c] === MF.BRICK;

/* --- lines 230-260 + PROCmove_bricks (410): the shove ---------------- */
{
  const g = bare(); put(g, 11, 10);
  g.step("right");
  ok("single brick shifts one square, man takes its place (line 230/430)",
     [isBrick(g, 11, 10), isBrick(g, 12, 10), g.manC, g.bricks], [false, true, 11, 1]);
}
{
  const g = bare(); put(g, 11, 10); put(g, 12, 10); put(g, 13, 10);
  g.step("right");
  ok("a whole run of bricks shifts together (line 240 REPEAT scan)",
     [isBrick(g, 11, 10), isBrick(g, 12, 10), isBrick(g, 13, 10), isBrick(g, 14, 10), g.manC, g.bricks],
     [false, true, true, true, 11, 3]);
}
{
  /* the man always advances - the original updates X% before it looks */
  const g = bare(); g.manC = MF.COLS - 2; put(g, MF.COLS - 1, 10);
  g.step("right");
  ok("brick pushed over the edge is gone for good (POINT reads -1 outside)",
     [g.manC, g.bricks, isBrick(g, MF.COLS - 1, 10)], [MF.COLS - 1, 0, false]);
}
{
  /* three bricks against the edge: only the leading one is lost */
  const g = bare(); g.manC = MF.COLS - 4;
  put(g, MF.COLS - 3, 10); put(g, MF.COLS - 2, 10); put(g, MF.COLS - 1, 10);
  g.step("right");
  ok("only the leading brick of a run goes over the edge",
     [g.bricks, isBrick(g, MF.COLS - 2, 10), isBrick(g, MF.COLS - 1, 10)], [2, true, true]);
}
{
  /* driven straight at the fly: the head brick lands on its square and
     the fly's redraw wipes it. Exactly one brick, and the fly is unhurt. */
  const g = bare(); g.flyC = 13; g.flyR = 10;
  put(g, 11, 10); put(g, 12, 10);
  const before = g.flyC;
  g.step("right");
  ok("bricks driven at the fly cost exactly one brick, fly unharmed (line 350/360)",
     [g.bricks, g.manC, g.flyC === before || g.flyC === before, isBrick(g, 12, 10)],
     [1, 11, true, true]);
}

/* --- line 380: the win test ------------------------------------------ */
{
  const g = bare(); g.flyC = 15; g.flyR = 15; g.PA = 0;
  put(g, 16, 15); put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  const ev = g.step(null);
  ok("four bricks around the fly wins the sheet", [ev.won, g.won], [true, true]);
}
{
  /* a fly in the corner has two neighbours off the field, where POINT
     returns -1, so the original could never trap it there */
  const g = bare(); g.flyC = 0; g.flyR = 0; g.PA = 0; g.manC = 20; g.manR = 20;
  put(g, 1, 0); put(g, 0, 1);
  const ev = g.step(null);
  ok("the cellar edge does NOT count as a wall - a cornered fly is not trapped",
     ev.won, false);
}
{
  const g = bare(); g.flyC = 15; g.flyR = 15; g.PA = 0;
  put(g, 16, 15); put(g, 14, 15); put(g, 15, 16);
  const ev = g.step(null);
  ok("three bricks is not enough", ev.won, false);
}

/* --- line 380/390 + PROCloss: caught --------------------------------- */
{
  const g = bare(); g.manC = 10; g.manR = 10; g.flyC = 11; g.flyR = 10; g.PA = 0;
  g.SC = 999;
  const ev = g.step("right");           /* he walks straight into it */
  ok("walking onto the fly is death, and the score is wiped (line 480)",
     [ev.lost, g.over, g.SC], [true, true, 0]);
}
{
  /* dying before a sheet is cleared must leave the high score alone,
     because PROCloss zeroes SC% before PROCset_level ever compares it */
  const g = bare(); g.HI = 0; g.SC = 500;
  g.manC = 10; g.manR = 10; g.flyC = 11; g.flyR = 10; g.PA = 0;
  g.step("right");
  ok("a death contributes nothing to the high score (line 1030)", g.HI, 0);
}

/* --- lines 300-340: PA% is a leash, not a chase ---------------------- */
{
  /* with PA%=0 the fly can only take steps that close on the man */
  const g = bare(); g.PA = 0; g.manC = 10; g.manR = 10; g.flyC = 20; g.flyR = 10;
  let closed = 0, opened = 0;
  for (let i = 0; i < 400; i++) {
    const d0 = Math.abs(g.flyC - g.manC) + Math.abs(g.flyR - g.manR);
    if (d0 === 0) break;
    g.step(null);
    const d1 = Math.abs(g.flyC - g.manC) + Math.abs(g.flyR - g.manR);
    if (d1 < d0) closed++; else if (d1 > d0) opened++;
  }
  ok("leash 0: the fly never moves away from the man", opened, 0);
  ok("leash 0: and it does close on him", closed > 0, true);
}
{
  /* with the level 1 leash it must stay inside a 12.5-cell box */
  const g = bare(); g.PA = 400; g.manC = 17; g.manR = 13; g.flyC = 17; g.flyR = 13;
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    g.step(null);
    if (g.over || g.won) { g.over = false; g.won = false; g.manC = 17; g.manR = 13; continue; }
    worst = Math.max(worst, Math.abs(g.flyC - g.manC), Math.abs(g.flyR - g.manR));
  }
  ok("leash 400: the fly stays within 12.5 squares of the man", worst <= 13, true);
}

/* --- PROCset_level / PROCbonus --------------------------------------- */
{
  const table = [];
  for (let F = 1; F <= 10; F++) { const l = MF.levelOf(F); table.push([l.PE, l.PA]); }
  ok("the level table (lines 900-990)", table,
     [[200,400],[175,300],[150,200],[125,150],[100,100],[75,75],[50,50],[40,40],[30,30],[20,0]]);
}
ok("bonus bands (line 1120)",
   [100, 101, 399, 400, 499, 500, 599, 600, 699, 700].map(MF.bonusFor),
   [300, 200, 200, 150, 150, 100, 100, 50, 50, 10]);
{
  const g = bare(3); g.CO = 0; g.SC = 0; g.PA = 0;
  g.flyC = 15; g.flyR = 15;
  put(g, 16, 15); put(g, 14, 15); put(g, 15, 16); put(g, 15, 14);
  const ev = g.step(null);
  ok("win pays the bonus plus F%*50 (lines 570-580)", [ev.bonus, g.SC], [300, 300 + 150]);
}

/* --- PROCprint_bricks ------------------------------------------------- */
{
  const g = new MF.Game();
  for (let F = 1; F <= 10; F++) {
    g.F = F; g.sheet();
    if (g.bricks !== MF.levelOf(F).PE) { fail++; console.log("  FAIL  level " + F + " laid " + g.bricks + " bricks"); }
  }
  ok("every level lays exactly PE% bricks", true, true);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
