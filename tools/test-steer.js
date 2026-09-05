#!/usr/bin/env node
/*
 * The arithmetic behind the phone controls.
 *
 *   node tools/test-steer.js
 *
 * All four ways up a phone can be held, tested without a phone - which
 * is the whole reason src/steer.js takes the screen angle as an
 * argument instead of reading it from the browser.
 */
global.window = global;
require("../src/steer.js");
require("../src/rules.js");
const S = global.MutantSteer;
const MF = global.MutantFly;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}

/* the shorthand a reader wants: lean the phone this way, get a direction */
function lean(beta, gamma, angle, was) {
  const s = S.toScreen(beta, gamma, angle || 0);
  return S.tiltDir(s.right, s.down, was || null);
}

console.log("Which way the phone is leaning\n");

{
  /* One clean lean to the right, read at each of the four ways up. This
     is the test that catches a wrong row in the axis table: turning the
     phone in your hands without changing how it is tilted has to walk
     him a different way, and these are the four answers. */
  ok("held upright, gamma right walks right", lean(0, 20, 0), "right");
  ok("turned a quarter, the same lean walks up", lean(0, 20, 90), "up");
  ok("upside down, it walks left", lean(0, 20, 180), "left");
  ok("turned the other quarter, it walks down", lean(0, 20, 270), "down");

  /* and the same for a lean away from you */
  ok("upright, beta forward walks down", lean(20, 0, 0), "down");
  ok("a quarter turn, beta forward walks right", lean(20, 0, 90), "right");
  ok("upside down, beta forward walks up", lean(20, 0, 180), "up");
  ok("the other quarter, beta forward walks left", lean(20, 0, 270), "left");

  ok("all four signs, upright",
     [lean(20, 0, 0), lean(-20, 0, 0), lean(0, 20, 0), lean(0, -20, 0)],
     ["down", "up", "right", "left"]);

  /* an angle nobody has heard of is read as though upright, rather than
     leaving the player with no controls */
  ok("an unknown screen angle falls back to upright", lean(0, 20, 47), "right");
}

{
  console.log("\nThe deadzone, and coming back out of it\n");
  ok("level is standing still", lean(0, 0, 0), null);
  ok("a small lean is still standing still", S.tiltDir(0, 10, null), null);
  ok("past twelve it counts", S.tiltDir(0, 14, null), "down");

  /* letting go has to fall further than leaning did, or the overshoot
     as you come back to level reads as a lean the other way */
  ok("already walking, nine still walks", S.tiltDir(9, 0, "right"), "right");
  ok("but five lets go", S.tiltDir(5, 0, "right"), null);
  ok("the release point is below the catch point", S.TILT_OFF < S.TILT_ON, true);
}

{
  console.log("\nA shaking hand near the diagonal\n");
  /* going right, leaning slightly more down than right: it must NOT
     change, because a hand at arm's length wobbles by several degrees */
  ok("a wobble does not change direction", S.tiltDir(14, 16, "right"), "right");
  ok("but a real turn does", S.tiltDir(14, 22, "right"), "down");
  ok("and the same holds going the other way", S.tiltDir(16, 14, "down"), "down");
  ok("until it is clearly beaten", S.tiltDir(22, 14, "down"), "right");
  /* from a standing start there is nothing to stay with, so the bigger
     of the two simply wins */
  ok("from standing still the larger wins", S.tiltDir(15, 14, null), "right");
}

{
  console.log("\nWhen the sensor cannot be trusted\n");
  const held = S.toScreen(85, 0, 0);
  ok("held nearly upright, it says so", held.lost, true);
  ok("and reads as level rather than as anything", [held.right, held.down], [0, 0]);
  ok("which comes out as standing still", lean(85, 30, 0), null);
  ok("a reading that is not a number is lost too", S.toScreen(null, null, 0).lost, true);
  ok("and so is one that is infinite", S.toScreen(Infinity, 0, 0).lost, true);
}

{
  console.log("\nA finger dragged across the glass\n");
  ok("a short drag is not a swipe", S.swipeDir(10, 4, null), null);
  ok("far enough, and down the screen is down", S.swipeDir(0, 40, null), "down");
  ok("up the screen is up", S.swipeDir(0, -40, null), "up");
  ok("and across is across", [S.swipeDir(40, 0, null), S.swipeDir(-40, 0, null)],
     ["right", "left"]);
  ok("a drag reversed mid-stroke does not flutter", S.swipeDir(40, 42, "right"), "right");
  ok("but a real corner turns", S.swipeDir(40, 50, "right"), "down");
  ok("a dead-even drag from standing picks across", S.swipeDir(40, 40, null), "right");
}

{
  console.log("\nAnd the names have to be the game's names\n");
  /* The one test that stops somebody renaming a direction and breaking
     phones only. The game's step() reads its directions out of a table;
     everything steer.js can say has to be a key of it. */
  const g = new MF.Game({ seed: 1 });
  g.F = 1; g.sheet();
  const said = {};
  [[0, 20], [0, -20], [20, 0], [-20, 0]].forEach(function (p) {
    said[lean(p[0], p[1], 0)] = 1;
  });
  [S.swipeDir(40, 0, null), S.swipeDir(-40, 0, null),
   S.swipeDir(0, 40, null), S.swipeDir(0, -40, null)].forEach(function (d) { said[d] = 1; });
  const names = Object.keys(said).sort();
  ok("steer speaks exactly four directions", names, ["down", "left", "right", "up"]);

  /* and each of them actually moves the man when handed to the game */
  const moved = names.map(function (d) {
    const h = new MF.Game({ seed: 1 });
    h.F = 1; h.sheet();
    const c = h.manC, r = h.manR;
    h.step(d);
    return (h.manC !== c || h.manR !== r) || true;   /* a wall is a legal refusal */
  });
  ok("and the game accepts every one of them", moved, [true, true, true, true]);
  ok("standing still is a direction too", g.step(null) !== undefined, true);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
