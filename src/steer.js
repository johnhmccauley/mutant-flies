/* =====================================================================
   STEERING A PHONE

   Everything hard about tilt is arithmetic, and none of it needs a
   browser: which way is "right" when the phone is held sideways, how
   far you have to lean before it counts, and how to stop a shaking hand
   flickering between two directions. So it lives here with the rest of
   the game's thinking, where node can run it and tools/test-steer.js
   can hold it to account. What is left in the page is listeners and
   permission prompts, which are the parts a test could only pretend to
   check anyway.

   THE ONE FACT THAT MAKES THIS TRACTABLE

   The play camera never rotates. It sits on the +Z side of the man and
   looks along -Z with no yaw (index.html, the play branch of the camera
   block), and grid `up` is dr = +1 which worldOf turns into a SMALLER
   world z. So screen-up is always grid up and screen-right is always
   grid right, in every cellar, for ever. There is no camera angle to
   compensate for - only the phone's own angle.

   HOW A LEAN BECOMES A DIRECTION

   beta and gamma describe which way the screen's normal is leaning: a
   positive beta tips it toward the bottom of the screen, a positive
   gamma toward the right. The side a surface leans toward is its
   downhill side, so the man rolls downhill on the glass the way a
   marble rolls on a tray - which is a metaphor this game already owns,
   because it has marbles and they do exactly that.

   Turning the phone in its own plane rotates the tray without changing
   how it is tilted, so the whole of landscape support is one table of
   sign swaps. It is a table rather than trigonometry because there are
   four cases, they are exact, and a table can be corrected one row at a
   time when a browser turns out to report gamma backwards - which some
   have.

   The angle comes in as an argument rather than being read from
   screen.orientation in here, which is the single decision that lets
   all four orientations be tested in node with no browser at all.
   ===================================================================== */
(function (root) {
  "use strict";

  /* how far you must lean before it counts as a direction at all. Small,
     and it has to be: people hold a phone somewhere between thirty and
     sixty degrees off flat, and a lean of twenty on top of a neutral of
     sixty puts beta at eighty - inside the region where gamma stops
     meaning anything. Twelve keeps the whole working range clear of it. */
  var TILT_ON = 12;

  /* and how far back you must come before it stops. Lower than TILT_ON,
     because letting go is a movement too: returning to level overshoots
     a little, and without the gap that overshoot reads as a lean the
     other way and takes a step you did not ask for. */
  var TILT_OFF = 7;

  /* how much the other axis must beat the current one by before the
     direction changes. Without it, a lean held near the diagonal
     flutters between two directions several times a second, which in a
     game where one square wrong is a wasp is not a small thing. */
  var TILT_BIAS = 5;

  /* past this the phone is nearly upright, gamma is in gimbal lock and
     reports nonsense. Standing still is a legal move here - the world
     still ticks and a step point still banks - so the honest answer to
     a confused sensor is to stand still, which costs a turn rather than
     walking you somewhere you did not choose. */
  var TILT_LOCK = 78;

  /* a swipe, in pixels: about a thumb-width of obvious intent. Below it
     the finger was resting or tapping, not asking for anything. */
  var SWIPE_MIN = 28;

  /* screenRight and screenDown, in terms of beta and gamma, at each of
     the four ways up a phone can be. Signs only - it is a rotation of
     (gamma, beta) by minus the screen angle.

        angle    screen right     screen down
           0       +gamma           +beta
          90       +beta            -gamma
         180       -gamma           -beta
         270       -beta            +gamma

     Treat this as data that may be wrong on somebody's phone rather
     than as a proof. Each row is one sign to flip. */
  var AXES = {
    0:   { rb: 0, rg: 1, db: 1, dg: 0 },
    90:  { rb: 1, rg: 0, db: 0, dg: -1 },
    180: { rb: 0, rg: -1, db: -1, dg: 0 },
    270: { rb: -1, rg: 0, db: 0, dg: 1 }
  };

  /* Which way the phone is leaning, in the screen's own axes.

     Returns lost:true when the reading cannot be trusted, and zeroes
     with it, so a caller that ignores the flag still gets the safe
     answer rather than a wrong one. */
  function toScreen(beta, gamma, angle) {
    var a = AXES[angle] || AXES[0];
    /* A phone with no gyroscope reports null rather than a number, and
       isFinite(null) is TRUE - null becomes nought on the way in - so
       the obvious check waves it straight through as a phone held
       perfectly level. It has to be asked whether it is a number. */
    if (typeof beta !== "number" || typeof gamma !== "number" ||
        !isFinite(beta) || !isFinite(gamma))
      return { right: 0, down: 0, lost: true };
    if (Math.abs(beta) > TILT_LOCK)
      return { right: 0, down: 0, lost: true };
    return {
      right: a.rb * beta + a.rg * gamma,
      down: a.db * beta + a.dg * gamma,
      lost: false
    };
  }

  /* A lean, in screen axes and already measured from wherever the
     player calls level, becomes one of the four directions or nothing.

     `was` is what it said last time, and it is not decoration: both
     hystereses are about it. Coming back toward level has to fall
     further than going out did, and changing axis has to beat the
     current one by a margin - otherwise the answer chatters. */
  function tiltDir(sr, sd, was) {
    var mag = Math.max(Math.abs(sr), Math.abs(sd));
    if (was ? mag < TILT_OFF : mag < TILT_ON) return null;

    var upDown = (was === "up" || was === "down");
    var leftRight = (was === "left" || was === "right");
    var vertical;
    if (upDown) vertical = Math.abs(sd) + TILT_BIAS >= Math.abs(sr);
    else if (leftRight) vertical = Math.abs(sd) > Math.abs(sr) + TILT_BIAS;
    else vertical = Math.abs(sd) > Math.abs(sr);

    if (vertical) return sd > 0 ? "down" : "up";
    return sr > 0 ? "right" : "left";
  }

  /* A finger dragged across the glass, in pixels from where it started
     or from where it last turned a corner. Screen down is grid down:
     you are dragging the man, not the room.

     The same bias as tilt, and for the same reason - a drag reversed
     mid-stroke should not flutter while it crosses the diagonal. */
  function swipeDir(dx, dy, was) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return null;

    var upDown = (was === "up" || was === "down");
    var leftRight = (was === "left" || was === "right");
    var vertical;
    if (upDown) vertical = Math.abs(dy) + TILT_BIAS >= Math.abs(dx);
    else if (leftRight) vertical = Math.abs(dy) > Math.abs(dx) + TILT_BIAS;
    else vertical = Math.abs(dy) > Math.abs(dx);

    if (vertical) return dy > 0 ? "down" : "up";
    return dx > 0 ? "right" : "left";
  }

  root.MutantSteer = {
    toScreen: toScreen, tiltDir: tiltDir, swipeDir: swipeDir,
    AXES: AXES, TILT_ON: TILT_ON, TILT_OFF: TILT_OFF, TILT_BIAS: TILT_BIAS,
    TILT_LOCK: TILT_LOCK, SWIPE_MIN: SWIPE_MIN
  };
})(typeof window !== "undefined" ? window : globalThis);
