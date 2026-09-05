/* =====================================================================
   MUTANT FLY - the rules

   Ported from the original BBC BASIC: FLY, by John Mc Cauley,
   (C) The Micro User. 125 lines, 10-1240, detokenised from the Database
   Publications cassette for The Micro User volume 3 issue 5, July 1985.

   Everything in the classic path follows the listing rather than the
   magazine article, which describes the game loosely and in several
   places incorrectly. Line numbers in the comments are the original's.

   Two modes:

     classic  One fly, the original level table, a flat floor and
              nothing else. This is the 1985 game and tools/test-rules.js
              pins it there. Nothing below may change it.

     deep     The same game, with the cellar getting stranger as you go
              down. Cellars 1 and 2 are the original exactly; after that
              one new thing arrives at a time - a second kind of monster,
              then sloping floors, then tools, then trees, then the
              marbles - so each can be learned on its own. The levels
              do not stop.
   ===================================================================== */
(function (root) {
  "use strict";

  /* --- geometry -----------------------------------------------------
     The original worked in BBC graphics units, 32 to a character cell.
     The man was bounded by X%>96 / X%<1152 (lines 230,240) and
     Y%>128 / Y%<928 (250,260): a playfield 34 cells across and 26 down.
     Bricks came from the PA%() table built at line 100, which holds
     160,192,...1088 - so they land in the inner 30x23.               */
  /* The 1985 playfield, which is still the size of every cellar the
     game generates - the whole of the original game happens in here and
     nothing about how a cellar is dealt has changed. */
  var FIELD_C = 34, FIELD_R = 26;

  /* The canvas a level is allowed to occupy: four times the area, which
     is two of the old playfield each way. Only levels somebody builds
     can use more than the field - a generated cellar is given a shape
     the size of the old one and is dealt inside it exactly as before.
     Everything is indexed against COLS, so this is the only place the
     difference between "the room" and "the paper it is drawn on" is
     decided. */
  var COLS = 68, ROWS = 52;
  var BRICK_C0 = 2, BRICK_C1 = 31;
  var BRICK_R0 = 1, BRICK_R1 = 23;

  /* what can be standing on a square */
  var EMPTY = 0, BRICK = 1, TREE = 2, MARBLE = 3,
      VAT_TAR = 4, VAT_WATER = 5, COOLED = 6, CHOPPER = 7, ROCK = 8;

  /* ------------------------------------------------------------------
     BLOCKS SOMEBODY ELSE INVENTED

     Everything above is a kind this game knows about. From MADE upwards
     the grid holds kinds the LEVEL brought with it: a name, a colour, a
     weight and a friction, defined by whoever built the cellar and
     carried in the level itself.

     Weight is in stones, where one stone is a rock - so a brick is a
     quarter of a stone, and the eight brick-loads in a man's arms are
     two stones however they are made up. Friction is what a marble
     loses crossing a square of it.

     One rule falls out of the weight rather than being a separate
     switch, and it is worth stating: anything a stone or heavier
     behaves like stone. Tar will not burn through it, a beetle cannot
     eat it, a marble comes off it. Lighter than a stone and it is
     brick-like and all three of those can have it. So a builder choosing
     a weight is choosing durability at the same time, which is one
     number to think about instead of four checkboxes.
     ------------------------------------------------------------------ */
  var MADE = 16, MAX_MADE = 48;

  /* ------------------------------------------------------------------
     HOW HARD A THING IS TO SHOVE ALONG

     Weight decides HOW MANY you can move. Friction decides HOW FAST, and
     it is not an average - a line moves at the pace of the worst thing
     in it. One rock at the far end of eight timber blocks and the whole
     line drags like the rock, which is exactly how it feels to push a
     stuck thing: the easy part of the load is not the part you notice.

     Timber slides, brick drags, stone fights you. A level's own blocks
     bring their own number and slot into the same scale.
     ------------------------------------------------------------------ */
  var DRAG = {};
  DRAG[BRICK] = 0.35;          /* the middle of the scale, and the common case  */
  DRAG[ROCK] = 0.75;           /* the worst of it: stone does not want to go    */
  DRAG[COOLED] = 0.55;         /* set tar is rough underneath                   */
  var DRAG_WOOD = 0.18;        /* timber slides, which is the point of timber   */

  /* What it actually costs to shove a line, worked out the way friction
     works: the force resisting you is the coefficient times the weight
     pressing down, summed over everything you are pushing.

         resist = SUM over the line of ( friction of it x weight of it )

     Both of the things you would expect fall straight out of that, and
     neither had to be written as a special case:

       more blocks means more friction, because every one of them adds
         its own term to the sum
       a rough one dominates, because it contributes more per unit of
         weight than everything around it - one rock at the far end of a
         line of timber drags like the rock, which is exactly how it
         feels to push a stuck thing

     Uphill there is a second term, and it is the one that separates a
     heavy load from a light one. Friction is what it takes to keep a
     thing moving along the ground; going up a slope you also have to
     LIFT it, and lifting is mass times gravity times the rise:

         resist = cos(a) x SUM( friction x weight )      the dragging
                + sin(a) x SUM( weight ) x steps risen   the lifting

     One step of floor across one square is about twenty-nine degrees,
     so cos is 0.88 and sin is 0.48. On the flat the second term is
     nought and this is the old sum; on a slope it grows with the whole
     weight of the line, which is why a brick goes up a step easily and
     eight do not.

     Note what does NOT appear: the weight in the FIRST term is there
     because friction is proportional to the normal force, and in the
     second because lifting is work. Neither is the case where mass
     cancels. Whether a block already sitting on a slope stays there IS
     that case, and it is decided without any weight at all, a few
     hundred lines down.

     Every two units of resistance costs a whole extra turn, capped at
     two, because a man only has three turns of effort in him and a
     bottomless cost would just be an unexplained refusal. */
  /* What a unit of resistance is worth in turns. Set so that the whole
     ladder fits in the three step points a man can hold: eight bricks
     or one rock costs him a turn on the flat, two rocks costs two, and
     one rock up a slope costs two - hard, and possible, which it should
     be. Eight bricks up a slope is not. */
  var RESIST_TURN = 2.4, RESIST_CAP = 3;
  var SLOPE_COS = 0.88, SLOPE_SIN = 0.48;

  /* ------------------------------------------------------------------
     HOW MANY, ON A HILL

     There is a fixed amount of push in a man, and on the flat it comes
     to eight bricks - or two rocks, which weigh the same. That is the
     rule, and what follows is only what the same fixed push comes to
     when the ground is not flat.

     What he is working against is the force it takes to move the load:

         flat      friction only        mu x weight x cos
         uphill    and lifting it       mu x weight x cos + weight x sin
         downhill  and gravity helping  mu x weight x cos - weight x sin

     Same push, bigger opposing force, fewer blocks. Same push, gravity
     taking some of it, more blocks. So the count is lower uphill and
     higher downhill, and by how much falls out of the numbers rather
     than being chosen:

         rock, flat        8 units    two rocks
         rock, uphill      4.6        one rock
         rock, downhill   29          seven

     And at the bottom of that table something interesting happens. For
     brick going downhill the opposing force comes out NEGATIVE - the
     slope is steeper than brick's friction can hold - which is another
     way of saying a brick placed there would slide on its own. It is
     the same comparison as the sliding rule, arrived at from the other
     end, and where it is negative there is no limit at all: you are not
     pushing them down, you are letting go of them.
     ------------------------------------------------------------------ */
  Game.prototype.pushLimit = function (mu, rise) {
    var flat = mu * SLOPE_COS;
    var against = flat + SLOPE_SIN * rise;        /* rise is signed */
    if (against <= 0.02) return Infinity;         /* gravity is doing it */
    return PUSH_POWER * flat / against;
  };

  /* ------------------------------------------------------------------
     WHETHER IT STAYS ON THE SLOPE

     A block resting on an incline stays put while friction can hold it,
     and the textbook answer is that it does so exactly when

         tan(angle)  <=  the coefficient of friction

     Which has a consequence worth being straight about: the WEIGHT
     cancels out. Gravity pulls a heavy block down the slope harder, and
     presses it into the slope harder in precisely the same proportion,
     so mass appears on both sides and disappears. A heavy block and a
     light one of the same material slide at the same angle. That is not
     an approximation, it is the whole of it - and it is why a lorry and
     a coin slide off the same tilted plank together.

     What weight does decide is everything AFTER it lets go: how far it
     runs, what it flattens, and how much of your arm it takes to shove
     it back up. Which is where weight already lives in this game.

     The other half is that every slope down here is the same slope. The
     ground rises one step between neighbours and never more, so the
     angle is always 0.55 of a square over one square - about
     twenty-nine degrees - and the question is only ever whether a
     block's friction beats that one number.

         timber  0.18   slides
         brick   0.35   slides
         set tar 0.55   holds, just
         rock    0.75   holds

     So bricks run downhill and rocks sit where you put them, which was
     already true of bricks and is now true for a reason rather than
     because it was written that way.
     ------------------------------------------------------------------ */
  var SLOPE_TAN = 0.55;      /* one step of floor across one square */

  /* and what can be running across it. The cellars are old and things
     have been sealed up down here for a long time. */
  var DRY = 0, WATER = 1, TAR = 2;
  var TAR_COOLS = 26;          /* turns a tar cell burns before it sets */

  /* what can be lying on one */
  var NOTHING = 0, BOOTS = 1, FROST = 2, SAW = 3, JAR = 4;
  var ITEMS = {
    1: { key: "boots", name: "Boots", blurb: "Two squares a turn for a while.", colour: 0xc8a017 },
    2: { key: "frost", name: "Frost jar", blurb: "Everything down here stops moving.", colour: 0x63c8e0 },
    3: { key: "saw",   name: "Saw",   blurb: "Three trees. Nothing else will take one down.", colour: 0xb0b6bd },
    4: { key: "jar",   name: "Sealed jar", blurb: "Nobody labelled it. Could go either way.", colour: 0x9a5bc4 }
  };

  /* The cassette edition has no frame limiter and runs as fast as BASIC
     manages. The disc conversion added one - `210 T%=TIME+5` with
     `380 REPEAT UNTIL TIME>T%` - pinning the loop at 20 turns a second. */
  var TICK_HZ = 20;

  /* line 130: X%=608 Y%=576, X1%=576 Y1%=512 */
  var MAN_C0 = 16, MAN_R0 = 14, MON_C0 = 15, MON_R0 = 12;

  var MAX_H = 3;                      /* how high the GENERATOR builds     */
  var MAX_BUILD_H = 6;                /* how high a person may, by hand    */
  var TREE_STRENGTH = 10;             /* how much leaning a tree will take */

  /* Friction, by what the thing is rolling over. Gravity is the slope;
     this is what decides whether it keeps going. */
  function frictionOn(what, fluid, made) {
    if (fluid === TAR) return 1.10;         /* a square of it and it is done */
    if (fluid === WATER) return 0.42;       /* wading, and it drags          */
    if (made) return made.friction;         /* whatever the level decided    */
    if (what === COOLED) return 0.30;       /* set tar is rough              */
    return 0.16;                            /* bare stone                    */
  }
  /* ------------------------------------------------------------------
     Marbles have mass, and it is the same number as their size.

     Gravity does not care: a heavy marble and a light one gain the same
     speed down the same slope, which is why the height terms below have
     no mass in them at all. Everything else does care.

       starting one   a shove is a fixed push, so a heavy marble leaves
                      slowly - v = push / mass
       keeping going  at the same rate as everything else. Rolling
                      resistance is proportional to weight and so is the
                      inertia resisting the slowdown, so mass cancels and
                      a heavy marble does NOT coast further - the same
                      cancellation that decides whether a block holds on
                      a slope, and it would be odd to believe it there
                      and not here
       hitting things what breaks a brick or a monster is momentum,
                      mass times speed - a big marble at walking pace
                      does what a small one has to sprint to manage
       the lip        a step stops a small wheel and not a large one, so
                      what matters is the lip against the marble's own
                      SIZE. Size and mass happen to be the same number
                      here, but it is the size that is doing the work

     A size-1 marble behaves exactly as marbles did before any of this.
     ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------
     ROCKS

     A brick you can shift with one hand. A rock takes both, and it is
     worth four bricks of effort. There is eight bricks' worth of shove
     in a man, so: eight bricks, or two rocks, or one rock and four
     bricks, and nothing past that. A robot has more in it and manages
     three rocks.

     None of which applies on the first floor down, where the blocks are
     not brick at all but old brown timber. Wood is light: there is no
     limit on how many you can shove at once, which is exactly how the
     1985 game behaved and is now the reason why. It burns, though, and
     tar goes through a stack of it in no time.

     Nothing destroys a rock. A beetle cannot eat one, tar will not burn
     through one, a marble comes off it. Which makes rocks the only
     permanent thing in the cellar: bad news when one is in your way,
     and the best wall you will ever get when it is not. There are never
     many - a tenth of the bricks at the outside.
     ------------------------------------------------------------------ */
  var ROCK_WEIGHT = 4, PUSH_POWER = 8;

  var GRAV = 1.0, LIP = 0.9;
  /* turns a brick stands up to a pool of tar leaning on it */
  var CHAR_THROUGH = 30;
  /* how fast tar works at what is in its way. Flowing tar is hotter than
     a pool that has been sitting sealed up, and timber is timber. */
  var BURN_WOOD = 12, BURN_BRICK = 3;
  function massOf(m) { return m.size || 1; }
  function shoveSpeed(m) { return 1 / (0.6 + 0.4 * massOf(m)); }
  function momentum(m) { return m.v * massOf(m); }
  /* how fast it has to be going to ride over the lip where the floor ends */
  function lipSpeed(m) {
    return Math.sqrt(2 * GRAV * LIP * (2 / (1 + massOf(m))));
  }

  var BOOTS_TURNS = 70, FROST_TURNS = 50, SAW_USES = 3;

  function sign(n) { return n < 0 ? -1 : n > 0 ? 1 : 0; }

  /* Live randomness - what a monster does this turn. Never used to lay a
     cellar out, or the same cellar would come out different every time
     you walked back into it. */
  /* Live chance - deliberately NOT the seeded generator, so the same
     cellar plays differently every time. `luck` swaps in a fixed stream
     for the harness, because ranking strategies against each other on a
     measure that wobbles by four wins between identical runs is not
     ranking anything. Play always uses Math.random. */
  var chance = Math.random;
  function rnd(n) { return (chance() * n) | 0; }
  function luck(fn) { chance = fn || Math.random; }

  /* Laying a cellar out uses this instead: mulberry32, seeded from the
     run and the level, so cellar 7 of a given run is always the same
     cellar. Come back to a saved game and it is where you left it. */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ------------------------------------------------------------------
     Three things a side of a room can be.

     DROP is what the floor has always done here: it ends in a small lip.
     A brick shoved over goes and does not come back, and so do you - but
     a marble rolling at it clouts the lip and comes back slower unless
     it is going fast enough to ride over. That lip has been in the game
     since marbles were, quietly, as part of "drop".

     SHEER is the new one: no lip at all, nothing to catch anything. A
     marble reaches it and is gone whatever speed it was doing.

     WALL is good stone, and it is the only one that holds anything in.
     ------------------------------------------------------------------ */
  var DROP = 0, WALL = 1, SHEER = 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mix(a, b, c) {
    var h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B);
    h = Math.imul(h ^ b, 0xC2B2AE35);
    h = Math.imul(h ^ c, 0x27D4EB2F);
    return (h ^ (h >>> 15)) | 0;
  }

  /* ==================================================================
     THE MONSTERS

     The fly is the original's, exactly. The other three are new, and
     each asks a different question of the same four-sided trap:

       fly      wanders on a leash. The leash is the whole difficulty
                curve - it cannot get further from you than PA%, so as
                PA% shrinks it is dragged onto you.
       spider   no wandering at all. It steps straight at you, but only
                on every second turn. You can outpace it; the cost is
                that it never stops coming.
       beetle   keeps close, and every fourteenth turn eats a brick
                beside it. It destroys the thing you need, so a cellar
                with a beetle in it is a race.
       wasp     stands still for a turn, then crosses two squares at
                once on a loose leash. Safe to approach on its dead
                turn, lethal on its live one.

     A monster stops for good once it is walled in, or crushed.
     ================================================================== */

  /* the original's move, lines 300-340: one random direction a turn,
     taken only if the square is free AND the step keeps the monster
     inside a box `leash` cells wide centred on the man */
  function leashStep(m, g, leash) {
    var R = 1 + rnd(4), c = m.c, r = m.r, p = g.prey(m);
    if (R === 1 && c > 0 && c > p.c - leash && g.free(c - 1, r, m)) c--;
    else if (R === 2 && c < COLS - 1 && c < p.c + leash && g.free(c + 1, r, m)) c++;
    else if (R === 3 && r > 0 && r > p.r - leash && g.free(c, r - 1, m)) r--;
    else if (R === 4 && r < ROWS - 1 && r < p.r + leash && g.free(c, r + 1, m)) r++;
    m.c = c; m.r = r;
  }

  function greedyStep(m, g) {
    var p = g.prey(m);
    var dc = p.c - m.c, dr = p.r - m.r, opts = [];
    if (Math.abs(dc) >= Math.abs(dr)) {
      if (dc) opts.push([sign(dc), 0]);
      if (dr) opts.push([0, sign(dr)]);
    } else {
      if (dr) opts.push([0, sign(dr)]);
      if (dc) opts.push([sign(dc), 0]);
    }
    for (var i = 0; i < opts.length; i++) {
      var nc = m.c + opts[i][0], nr = m.r + opts[i][1];
      if (g.inField(nc, nr) && g.free(nc, nr, m)) { m.c = nc; m.r = nr; return; }
    }
  }

  var MONSTERS = {
    fly: {
      name: "Fly", colour: 0x3d63c4, dark: 0x1e2c5c, eye: 0x8e1208,
      blurb: "The size of a man - it lies across two squares.",
      drone: [0, -10, 23, 1],
      size: 2,
      move: function (m, g) {
        var oc = m.c, or = m.r;
        leashStep(m, g, g.leash);
        if (m.c !== oc || m.r !== or) { m.tc = oc; m.tr = or; }   /* the tail follows */
      }
    },
    spider: {
      name: "Spider", colour: 0x6b4a2a, dark: 0x2e1e10, eye: 0xd8c020,
      blurb: "Comes straight at you, every second turn.",
      drone: [0, -11, 3, 1],
      move: function (m, g) { if (++m.tick % 2 === 0) greedyStep(m, g); }
    },
    beetle: {
      name: "Beetle", colour: 0x2c6a3a, dark: 0x15321c, eye: 0xe06010,
      blurb: "Keeps close, and eats a brick every fourteen turns.",
      drone: [0, -10, 1, 1],
      eats: 14,
      move: function (m, g) {
        leashStep(m, g, g.leash * 0.7);
        if (++m.tick % this.eats === 0) m.ate = g.devour(m);
      }
    },
    wasp: {
      name: "Wasp", colour: 0xc8a017, dark: 0x3a2c06, eye: 0x901010,
      blurb: "Waits a turn, then crosses two squares at once.",
      drone: [0, -9, 5, 1],
      move: function (m, g) {
        if (++m.tick % 2 === 0) return;
        leashStep(m, g, g.leash * 1.6);
        leashStep(m, g, g.leash * 1.6);
      }
    }
  };
  /* ------------------------------------------------------------------
     THE SNAKE

     Everything else down here is one thing in one place. A snake is a
     line of them, and cutting it does not kill it - it makes two.

     Drive a brick through the middle and you get two snakes half the
     length. Cut it a quarter of the way along and you get a quarter and
     three quarters, and both start growing back towards what the whole
     one was. The long piece grows faster, because there is more of it
     doing the growing, so the half you were pleased about is the half
     that comes back first. A piece shorter than two squares has not
     enough of itself left and dies.

     The head is the exception: shove a brick at the head and it takes
     it off you, the way everything else down here does. You have to get
     at its back to cut it, which means getting past it first.

     Which makes it the one monster where the obvious move is the wrong
     one. Walling it in is the only thing that really finishes it, and
     it is long, so that takes a corridor rather than a corner.
     ------------------------------------------------------------------ */
  var GROW_COST = 26;          /* growth points a new square costs */

  function snakeStep(m, g) {
    var p = g.prey(m), opts = [];
    var dc = p.c - m.c, dr = p.r - m.r;
    if (Math.abs(dc) >= Math.abs(dr)) {
      if (dc) opts.push([sign(dc), 0]);
      if (dr) opts.push([0, sign(dr)]);
    } else {
      if (dr) opts.push([0, sign(dr)]);
      if (dc) opts.push([sign(dc), 0]);
    }
    opts.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    for (var i = 0; i < opts.length; i++) {
      var nc = m.c + opts[i][0], nr = m.r + opts[i][1];
      if (!g.inField(nc, nr) || !g.free(nc, nr, m)) continue;
      if (g.isPartOf(m, nc, nr)) continue;         /* it will not eat itself */
      m.body.unshift([nc, nr]);
      m.body.pop();
      m.c = nc; m.r = nr;
      return;
    }
  }

  /* longer means faster: a three-quarter snake is back to full length
     in a third of the time a quarter-length one manages */
  function snakeGrow(m, g) {
    if (m.body.length >= m.full) return;
    m.growth = (m.growth || 0) + m.body.length;
    if (m.growth < GROW_COST) return;
    m.growth -= GROW_COST;
    var tail = m.body[m.body.length - 1];
    var before = m.body[m.body.length - 2] || tail;
    var away = [[tail[0] - before[0], tail[1] - before[1]],
                [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < away.length; i++) {
      if (!away[i][0] && !away[i][1]) continue;
      var nc = tail[0] + away[i][0], nr = tail[1] + away[i][1];
      if (!g.inField(nc, nr) || !g.free(nc, nr, m)) continue;
      if (g.isPartOf(m, nc, nr)) continue;
      m.body.push([nc, nr]);
      return;
    }
  }

  MONSTERS.snake = {
    name: "Snake", colour: 0x4c8a2e, dark: 0x1d3a12, eye: 0xf0d030,
    blurb: "A line of it. Cut it and you have two.",
    drone: [0, -12, 9, 1],
    size: "long",
    move: function (m, g) { snakeStep(m, g); snakeGrow(m, g); }
  };

  var MONSTER_ORDER = ["fly", "spider", "beetle", "wasp", "snake"];

  /* --- PROCset_level, lines 890-990 --------------------------------- */
  var LEVELS = [
    [200, 400], [175, 300], [150, 200], [125, 150], [100, 100],
    [75, 75], [50, 50], [40, 40], [30, 30]
  ];

  /* ==================================================================
     THE DESCENT

     Cellars 1 and 2 are the original, untouched. After that the curve is
     hand-made rather than generated: one new thing at a time, and the
     cellar it arrives in is deliberately gentle - usually a single
     monster and plenty of bricks - so it can be learned before it is
     combined with anything else. The pressure then comes back on.

       3  a second kind of monster        10  the tar
       4  the floor stops being level     11  the water
       5  the beetle, and boots           12+ combinations, tightening
       6  the wasp, and frost
       7  trees, and the axe
       8  marbles
       9  the unlabelled jars
     ================================================================== */
  var FEATURE_AT = { walls: 2, coins: 3, snake: 12, rocks: 15, robots: 16, slopes: 4, boots: 5, frost: 6, trees: 7, saw: 7,
                     marbles: 8, jar: 9, tar: 10, water: 11, choppers: 13 };

  var PLAN = [
    /*  1 */ { kinds: ["fly"], PE: 200, PA: 400, adds: [] },
    /*  2 */ { kinds: ["fly"], PE: 175, PA: 300, adds: ["walls"] },
    /*  3 */ { kinds: ["spider"], PE: 165, PA: 260, adds: ["spider", "coins"] },
    /*  4 */ { kinds: ["fly"], PE: 155, PA: 220, adds: ["slopes"] },
    /*  5 */ { kinds: ["beetle"], PE: 150, PA: 200, adds: ["beetle", "boots"] },
    /*  6 */ { kinds: ["wasp"], PE: 145, PA: 190, adds: ["wasp", "frost"] },
    /*  7 */ { kinds: ["fly"], PE: 145, PA: 175, adds: ["trees"] },
    /*  8 */ { kinds: ["spider"], PE: 140, PA: 165, adds: ["marbles"] },
    /*  9 */ { kinds: ["beetle"], PE: 140, PA: 155, adds: ["jar"] },
    /* 10 */ { kinds: ["fly", "spider"], PE: 170, PA: 150, adds: ["company", "tar"] },
    /* 11 */ { kinds: ["wasp", "beetle"], PE: 165, PA: 145, adds: ["water"] },
    /* 12 */ { kinds: ["snake"], PE: 170, PA: 135, adds: ["snake"] },
    /* 13 */ { kinds: ["spider", "wasp"], PE: 160, PA: 130, adds: ["choppers"] },
    /* 14 */ { kinds: ["snake", "spider"], PE: 180, PA: 125, adds: [] },
    /* 15 */ { kinds: ["wasp", "beetle"], PE: 150, PA: 118, adds: ["rocks"] },
    /* 16 */ { kinds: ["fly", "spider", "wasp", "beetle"], PE: 185, PA: 110, adds: ["robots"] }
  ];

  /* below the plan the cellars keep coming, tightening slowly and never
     quite running out of bricks */
  function deepPlan(F) {
    var n = Math.min(4, 2 + Math.floor((F - 17) / 7));
    var kinds = [];
    for (var i = 0; i < n; i++)
      kinds.push(MONSTER_ORDER[(F + i * 3) % MONSTER_ORDER.length]);
    return {
      kinds: kinds,
      PE: Math.max(56, 120 - (F - 17) * 2) + 22 * (n - 1),
      PA: Math.max(72, 108 - (F - 17)),
      adds: []
    };
  }

  function planFor(F) { return (F <= PLAN.length) ? PLAN[F - 1] : deepPlan(F); }
  function monstersFor(F) { return planFor(F).kinds.slice(); }

  function featuresFor(F) {
    var out = {};
    for (var k in FEATURE_AT) out[k] = F >= FEATURE_AT[k];
    return out;
  }

  /* what turns up at exactly this level, and what to say about it */
  var BRIEFINGS = {
    walls:   { name: "The edge of the cellar", body: "Cellar one had nothing round it - the floor stopped, and a brick shoved over the side was gone. Some of these have proper stone walls instead. A brick driven into good stone stops dead, and stone counts as a side: back something into a stone corner and two bricks will hold it where four would have been needed. Learn to tell them apart before you walk into a gap. Nothing over the side comes back, including you." },
    snake:   { name: "The snake", body: "It comes at you without stopping, and it is not one square but a line of them. Shove a brick at its head and it takes the brick off you. Get at its back and the brick goes through - but that does not kill it, it cuts it, and what you get is two snakes, one either side of the cut. Cut it in the middle and you get two halves. Cut it near the head and you get a short one and a long one, and the long one grows back fastest. A piece shorter than two squares dies. Walling it in is the only thing that actually finishes it - and it is long, so you will want a corridor, not a corner." },
    rocks:   { name: "Rocks", body: "Bricks with ideas. A rock is four bricks' worth of shove, and there is only so much of you: two rocks at once, or one rock and four bricks, and past that you will not move it at all. In exchange nothing down here can destroy one. A beetle cannot eat it, tar will not burn through it, a marble comes straight off it. A rock in the wrong place is there for good - and a rock in the right place is one side of a trap that nothing can take away from you." },
    robots:  { name: "Robots", body: "Somebody was down here before you with machinery, and some of it still works. One turns up on its own, stands about for a while and wanders off if you ignore it. Walk into it and it starts, and then it plays: fetching bricks and building walls the way you would, until its charge runs out. It has more in it than you do - three rocks at once, and the big ones more - and while it is working a monster will go for whichever of you is nearer. That is the real reason to start one. It is also why you get it back in pieces." },
    coins:   { name: "Loose credits", body: "Somebody dropped money down here and it does not stay dropped. A few coins turn up on their own, sit for a short while and go. Reach one first and it is yours. A monster that wanders over it takes it; so does tar, so does water - and so does a brick, if you shove one onto it. That last one is the choice worth noticing: a coin sitting in the line you were about to push is the wall you were building or the money, and not both." },
    spider:  { name: "The spider", body: "It does not wander. It comes straight at you, and takes a step on every second turn. You can out-walk it - but it never stops, and it will be behind you the whole way." },
    beetle:  { name: "The beetle", body: "It keeps closer than the fly, and every fourteen turns it eats a brick beside it. It destroys the one thing you need. Wall it in early, or it will eat the cellar out from under you." },
    wasp:    { name: "The wasp", body: "It stands still for a turn, then crosses two squares at once. Its dead turn is the only safe moment to get near it. Count them." },
    slopes:  { name: "The floor is not level", body: "Climbing costs you. Going up a step takes an extra turn, shoving a line of bricks uphill takes another again, and walking downhill gives you a free step back. Read the ground before you commit to a push." },
    boots:   { name: "Boots", body: "Two squares a turn for the next seventy turns. Nothing else speeds up. It is the only time you are genuinely faster than they are." },
    frost:   { name: "Frost jars", body: "Everything loose in the cellar stops for fifty turns. Time enough to build a wall around something that would never otherwise hold still." },
    trees:   { name: "Trees, and the saw", body: "Trees do not shove, and a line of bricks driven into one stops dead. Nothing moves them but a saw, and a saw is good for three. They hold a monster in as well as a brick does - so a tree in the right place is four bricks you did not have to push." },
    marbles: { name: "Marbles", body: "Heavy, and they keep going. Shove one and it runs until something stops it. Uphill it slows, and if it cannot crest the rise it comes back down at you, gathering speed. Slowly it bounces off things; quickly it smashes bricks; at speed it flattens a monster - or you." },
    jar:     { name: "Sealed jars", body: "Nobody labelled them. Half are frost. The other half have something in them that has been waiting a long time to get out." },
    tar:     { name: "The tar", body: "Sealed in vats, and still hot. Break one - a marble will do it, so will the axe - and it runs downhill burning what it touches: trees, bricks, monsters, you. Eventually it sets, and what it leaves behind is as good as a wall." },
    company: { name: "You are not alone down here", body: "Every cellar so far had one thing in it. From here down there are two, and later more. A wall is only the bricks holding something in, so the first one you shut away stays shut away only as long as you leave its wall alone - go careless taking bricks for the second and the first walks out behind you." },
    choppers:{ name: "The choppers", body: "Somebody left the machinery running. A chopper is fixed where it stands and nothing will shift it, but anything you shove into it comes out as splinters - so it is the one thing down here that will still take a brick off you. It will hold a monster in as well as a wall would." },
    water:   { name: "The cistern", body: "Water runs further and faster than tar and finds every low corner. It puts fires out, shoves marbles along in front of it, and sweeps you and the monsters off your feet. It burns nothing - but where it takes you is not your choice." }
  };
  function briefingFor(F) {
    var adds = planFor(F).adds, out = [];
    for (var i = 0; i < adds.length; i++) if (BRIEFINGS[adds[i]]) out.push(BRIEFINGS[adds[i]]);
    return out;
  }

  function levelOf(F, classic) {
    if (classic) {
      /* line 990 - and the original really does stop developing here */
      if (F >= 10) return { PE: 20, PA: 0, kinds: ["fly"], feat: {}, adds: [] };
      var row = LEVELS[F - 1] || LEVELS[0];
      return { PE: row[0], PA: row[1], kinds: ["fly"], feat: {}, adds: [] };
    }
    var p = planFor(F);
    return { PE: p.PE, PA: p.PA, kinds: p.kinds.slice(),
             feat: featuresFor(F), adds: p.adds.slice() };
  }

  function leashCells(PA) { return PA / 32; }

  /* --- the palette shifts as you descend, lines 1000-1020 ------------ */
  function palette(F) {
    var floor = 3;                                  /* yellow, line 150 */
    if (F >= 3) floor = 5;                          /* magenta          */
    if (F >= 6) floor = 6;                          /* cyan             */
    if (F >= 8) floor = 5;                          /* magenta again    */
    return { floor: floor, brick: (F >= 6) ? 4 : 1, mortar: 7, figure: 0 };
  }

  /* --- PROCbonus, lines 1110-1130 ----------------------------------- */
  function bonusFor(CO) {
    if (CO <= 100) return 300;
    if (CO < 400) return 200;
    if (CO < 500) return 150;
    if (CO < 600) return 100;
    if (CO < 700) return 50;
    return 10;
  }

  /* ==================================================================
     THE GAME
     ================================================================== */
  function Game(opts) {
    this.classic = !!(opts && opts.classic);
    this.edge = { W: new Uint8Array(ROWS), E: new Uint8Array(ROWS),
                  S: new Uint8Array(COLS), N: new Uint8Array(COLS) };
    /* both null unless a level brings them: the blocks it invented, the
       shape it is, and what lies beyond each square that is outside it */
    this.blocks = null;
    this.shape = null;
    this.bound = null;
    /* Which of the level's own floor colours each square is painted, or
       nought for the cellar's own stone. A plane rather than a property
       of anything, because it is a property of the FLOOR - you can paint
       a square and then build on it, or paint it and leave it bare, and
       neither should disturb the other. */
    this.tint = new Uint8Array(COLS * ROWS);
    this.floors = null;
    this.HI = 0;
    this.seed = (opts && opts.seed) || ((Math.random() * 0x7FFFFFFF) | 0);
    this.variant = {};          /* bumped by regenerate(), per level */
    this.grid = new Uint8Array(COLS * ROWS);
    this.height = new Uint8Array(COLS * ROWS);
    this.item = new Uint8Array(COLS * ROWS);
    this.fluid = new Uint8Array(COLS * ROWS);
    this.fvol = new Uint8Array(COLS * ROWS);
    this.sealed = new Uint8Array(COLS * ROWS);
    this.gnaw = new Uint8Array(COLS * ROWS);
    this.burn = new Uint8Array(COLS * ROWS);
    this.stress = new Uint8Array(COLS * ROWS);   /* how hard a tree is leaning */
    this.monsters = [];
    this.robots = [];
    this.coins = [];
    this.marbles = [];
    this.sources = [];
    this.reset(1);
  }

  Game.prototype.idx = function (c, r) { return r * COLS + c; };
  /* What a square is made of, whether this game invented it or the
     level did. Returns null for the built-in kinds. */
  Game.prototype.madeOf = function (v) {
    if (v < MADE || !this.blocks) return null;
    return this.blocks[v - MADE] || null;
  };
  /* in stones: a brick is a quarter, a rock is one */
  Game.prototype.weightOf = function (v) {
    if (v === ROCK) return ROCK_WEIGHT;
    var made = this.madeOf(v);
    if (made) return Math.max(0.25, made.weight * ROCK_WEIGHT);
    return 1;
  };
  /* how many extra turns that much resistance costs */
  Game.prototype.dragCost = function (resist) {
    if (this.classic) return 0;
    return Math.min(RESIST_CAP, Math.floor(resist / RESIST_TURN));
  };
  /* what one square of the line drags like, per unit of weight */
  Game.prototype.dragOf = function (v) {
    var made = this.madeOf(v);
    if (made) return made.friction;
    if (v === BRICK && this.wood) return DRAG_WOOD;
    return DRAG[v] === undefined ? 0.35 : DRAG[v];
  };
  /* will it hold on a one-step slope, or run down it? */
  Game.prototype.holdsOnSlope = function (v) { return this.dragOf(v) >= SLOPE_TAN; };
  Game.prototype.tough = function (v) {
    if (v === ROCK) return true;
    var made = this.madeOf(v);
    return !!made && made.weight >= 1;      /* a stone or heavier is stone */
  };

  /* The floor a level actually has. With no shape it is the whole
     34x26; with one, the level is whatever squares it says - which is
     how a cellar gets to be a different size, or a different shape
     altogether, without a single array changing length. */
  Game.prototype.inField = function (c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    if (this.shape) return this.shape[r * COLS + c] === 1;
    /* No shape means the room the game has always dealt: the 1985
       field, in the corner of the larger sheet a built level may use.
       Saying it this way rather than filling a shape plane into every
       generated cellar keeps those cellars exactly as small on disk and
       in a level code as they have always been. */
    return c < FIELD_C && r < FIELD_R;
  };
  Game.prototype.at = function (c, r) { return this.inField(c, r) ? this.grid[this.idx(c, r)] : -1; };
  Game.prototype.h = function (c, r) { return this.inField(c, r) ? this.height[this.idx(c, r)] : 0; };
  Game.prototype.brickAt = function (c, r) { return this.at(c, r) === BRICK; };

  /* solid enough to hold a monster in. In the original only a brick
     counted, because the win test asked POINT for colour 2 - the edge of
     the cellar read -1 and never qualified. In the deep cellars a tree
     or a resting marble will do as well; the cellar wall still will not. */
  Game.prototype.solid = function (c, r) {
    var v = this.at(c, r);
    if (this.classic) return v === BRICK;
    if (v === ROCK || v >= MADE) return true;
    if (v === BRICK || v === TREE || v === VAT_TAR || v === VAT_WATER ||
        v === COOLED || v === CHOPPER) return true;
    if (v === MARBLE) { var m = this.marbleAt(c, r); return !!m && m.v <= 0; }
    return false;
  };
  /* every square a monster is lying on */
  Game.prototype.cellsOf = function (m) {
    if (m.body) return m.body;
    return (m.spec.size === 2 && m.tc !== undefined)
      ? [[m.c, m.r], [m.tc, m.tr]] : [[m.c, m.r]];
  };
  Game.prototype.isPartOf = function (m, c, r) {
    var cs = this.cellsOf(m);
    for (var i = 0; i < cs.length; i++) if (cs[i][0] === c && cs[i][1] === r) return true;
    return false;
  };
  Game.prototype.monsterAt = function (c, r, except) {
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m !== except && !m.gone && this.isPartOf(m, c, r)) return m;
    }
    return null;
  };
  Game.prototype.marbleAt = function (c, r) {
    for (var i = 0; i < this.marbles.length; i++)
      if (this.marbles[i].c === c && this.marbles[i].r === r) return this.marbles[i];
    return null;
  };
  /* a square a monster may step onto */
  Game.prototype.free = function (c, r, except) {
    return this.at(c, r) === EMPTY && !this.monsterAt(c, r, except);
  };

  /* the same cellar, laid out afresh - the only way a level changes */
  Game.prototype.regenerate = function () {
    this.variant[this.F] = (this.variant[this.F] || 0) + 1;
    this.won = false; this.over = false;
    this.sheet();
  };
  Game.prototype.grnd = function (n) { return (this.rng() * n) | 0; };

  Game.prototype.reset = function (startLevel) {
    this.F = startLevel || 1;
    this.SC = 0;
    this.CO = 0;
    this.over = false;
    this.won = false;
    this.sheet();
  };

  /* --- laying out a cellar: PROCnext_sheet (860) and
         PROCprint_bricks (810), plus everything that came later ------ */
  /* --- what a cellar is, and what it is not ---------------------------
     The place is fixed: the lie of the land, the trees, the vats of tar
     and water, the choppers, what is lying about to pick up, and how
     many marbles there are. Walk out and back in and it is the same
     cellar.

     What is dealt fresh every attempt is the state of play: where the
     bricks have fallen, where you come in, where the monsters are, and
     where the marbles have rolled to. So a cellar is a place you can
     learn, and still a different problem each time you go down.
     -------------------------------------------------------------------- */
  /* ------------------------------------------------------------------
     DEALING THE REST

     A level says what is where, and it can also just say how MANY. The
     1985 game did the second: two hundred bricks, thrown anywhere they
     would fit, different every time you played it. Both are worth
     having, and a level can use either or both - draw the walls that
     matter, and let a hundred loose bricks fall where they will.

       "fixed"   dealt from the level's own seed, so every player who
                 opens it gets the identical cellar - a puzzle
       "fresh"   dealt anew every time it is played, which is what the
                 original did and what makes a cellar replayable

     Anything already drawn stays drawn; the deal only fills empty
     squares, and never the one the man is standing on.
     ------------------------------------------------------------------ */
  var DEALABLE = {
    brick: { cell: BRICK }, rock: { cell: ROCK }, tree: { cell: TREE },
    marble: { marble: true }, chopper: { cell: CHOPPER }, cooled: { cell: COOLED },
    tarvat: { cell: VAT_TAR }, watervat: { cell: VAT_WATER },
    boots: { item: BOOTS }, frost: { item: FROST }, saw: { item: SAW }, jar: { item: JAR },
    fly: { mob: "fly" }, spider: { mob: "spider" }, beetle: { mob: "beetle" },
    wasp: { mob: "wasp" }, snake: { mob: "snake" }
  };

  Game.prototype.dealOut = function (deal) {
    if (!deal || !deal.length) return 0;
    var self = this, laid = 0;
    var fixed = mulberry32(mix(this.seed | 0, this.F, 0x51ed));

    function pick(useFixed) {
      for (var tries = 0; tries < 900; tries++) {
        var c = ((useFixed ? fixed() : Math.random()) * COLS) | 0;
        var r = ((useFixed ? fixed() : Math.random()) * ROWS) | 0;
        if (!self.inField(c, r)) continue;
        if (self.grid[self.idx(c, r)] !== EMPTY) continue;
        if (c === self.manC && r === self.manR) continue;
        if (self.monsterAt(c, r)) continue;
        if (self.coinAt && self.coinAt(c, r)) continue;
        return [c, r];
      }
      return null;
    }

    for (var i = 0; i < deal.length; i++) {
      var entry = deal[i];
      var what = DEALABLE[entry.what];
      if (!what) continue;                       /* a kind we do not know */
      var useFixed = entry.how !== "fresh";
      var want = Math.max(0, Math.min(600, entry.count | 0));
      for (var n = 0; n < want; n++) {
        var at = pick(useFixed);
        if (!at) break;                          /* nowhere left to put one */
        if (what.cell !== undefined) this.grid[this.idx(at[0], at[1])] = what.cell;
        else if (what.item !== undefined) this.item[this.idx(at[0], at[1])] = what.item;
        else if (what.marble) {
          this.grid[this.idx(at[0], at[1])] = MARBLE;
          this.marbles.push({ c: at[0], r: at[1], dc: 0, dr: 0, v: 0, size: 1 + (n % 3) });
        } else if (what.mob) this.monsters.push(this.newMonster(what.mob, at[0], at[1]));
        laid++;
      }
    }
    return laid;
  };

  /* ==================================================================
     LOOSE CREDITS

     Somebody dropped money down here, and it does not stay dropped.

     A few coins turn up on their own, sit for a short while, and go. If
     you reach one first you have it. If a monster wanders over it, it is
     gone. Shove a brick onto it and you have buried it yourself, which
     is the interesting one - a coin sitting in the line you were about
     to push is a choice: the wall you were building, or the money.

     Tar and water take them too. Anything that reaches the square first
     takes it away, which is what makes them worth going for rather than
     waiting for.
     ================================================================== */
  var COIN_EVERY = 40;              /* roughly one turn in this many */
  var COIN_LIVES = 26;              /* and it is there for about this long */

  Game.prototype.coinAt = function (c, r) {
    for (var i = 0; i < this.coins.length; i++)
      if (this.coins[i].c === c && this.coins[i].r === r) return this.coins[i];
    return null;
  };

  Game.prototype.spawnCoin = function (ev) {
    if (this.classic || !this.feat.coins) return;
    if (this.coins.length >= 2) return;
    if (rnd(COIN_EVERY) !== 0) return;
    var spot = this.openSpot([[this.manC, this.manR]], 3);
    if (!spot) return;
    if (this.coinAt(spot[0], spot[1])) return;
    var coin = {
      c: spot[0], r: spot[1],
      value: 5 + rnd(3) * 5,                 /* five, ten or fifteen */
      life: COIN_LIVES + rnd(14)
    };
    this.coins.push(coin);
    ev.coinCame = coin;
  };

  /* Anything on the square takes it. Checked after everything else has
     moved, so a brick that slid onto one, tar that reached one and a
     monster that stepped on one all count - and the man, who gets first
     refusal because he is checked first. */
  Game.prototype.runCoins = function (ev) {
    if (this.classic) return;
    for (var i = this.coins.length - 1; i >= 0; i--) {
      var k = this.coins[i], at = this.idx(k.c, k.r);
      var lost = null;
      if (k.c === this.manC && k.r === this.manR) {
        this.coins.splice(i, 1);
        ev.tookCoin.push(k);
        continue;
      }
      if (this.monsterAt(k.c, k.r)) lost = "a monster got there first";
      else if (this.grid[at] !== EMPTY) lost = "buried";
      else if (this.fluid[at] === TAR) lost = "gone in the tar";
      else if (this.fluid[at] === WATER) lost = "washed away";
      else if (--k.life <= 0) lost = "gone";
      if (lost) {
        this.coins.splice(i, 1);
        ev.lostCoin.push({ coin: k, why: lost });
      }
    }
  };

  /* ==================================================================
     ROBOTS

     Somebody was down here before you with machinery, and some of it
     still works. A robot turns up on its own, stands there for a while,
     and wanders off again if you leave it alone. Walk into one and it
     starts, and from then on it plays: it fetches bricks and builds
     walls exactly the way you would, for as long as its charge lasts.

     It is worth having for two reasons. It has more in it than you do -
     three rocks at once where you manage two, and the big ones more
     than that - and a monster goes for whatever is nearest, so a
     working robot is also something else for it to be interested in.
     That is the trade: it does half your work and takes half the heat,
     right up until the thing catches it, because a monster will take a
     robot apart. Nothing can shove one over the edge, at least - it is
     heavy, and it knows where the floor stops.

     Bigger is better on both counts: it shoves more and it lasts longer.
     ================================================================== */
  var ROBOT_EVERY = 90;        /* roughly one turn in this many, when free */

  Game.prototype.robotAt = function (c, r) {
    for (var i = 0; i < this.robots.length; i++) {
      var b = this.robots[i];
      if (!b.gone && b.c === c && b.r === r) return b;
    }
    return null;
  };

  Game.prototype.spawnRobot = function (ev) {
    if (this.classic || !this.feat.robots) return;
    for (var i = 0; i < this.robots.length; i++) if (!this.robots[i].gone) return;
    if (rnd(ROBOT_EVERY) !== 0) return;
    var spot = this.openSpot([[this.manC, this.manR]], 4);
    if (!spot) return;
    var size = 1 + rnd(3);
    this.robots.push({
      c: spot[0], r: spot[1], size: size,
      running: false,
      power: 8 + size * 4,          /* three rocks at the smallest */
      life: 25 + size * 15,
      wait: 16 + rnd(14),           /* how long it stands about for */
      gone: false
    });
    ev.robotCame = this.robots[this.robots.length - 1];
  };

  /* the robot's own shove. Same arithmetic as a man's, a bigger budget,
     and no interest in picking anything up. */
  Game.prototype.robotMove = function (b, d, ev) {
    var nc = b.c + d[0], nr = b.r + d[1];
    if (!this.inField(nc, nr)) return false;      /* it knows where the floor stops */
    if (this.monsterAt(nc, nr) || this.robotAt(nc, nr)) return false;
    if (nc === this.manC && nr === this.manR) return false;
    var here = this.grid[this.idx(nc, nr)];
    if (this.fluid[this.idx(nc, nr)] === TAR) { b.gone = true; ev.robotDied = b; return false; }
    if (here !== EMPTY && here !== BRICK && here !== ROCK && here < MADE) return false;

    if (here === EMPTY) { b.c = nc; b.r = nr; return true; }

    var line = [], cc = nc, rr = nr, weight = 0, drag = 0;
    for (;;) {
      var pc = this.at(cc, rr);
      if (pc !== BRICK && pc !== ROCK && pc < MADE) break;
      line.push(pc);
      weight += this.weightOf(pc);
      drag += this.dragOf(pc) * this.weightOf(pc);
      cc += d[0]; rr += d[1];
    }
    if (weight > b.power) return false;
    /* a robot feels the same resistance - it just has more to give, and
       pays in charge rather than in turns */
    b.life -= this.dragCost(drag);
    if (!this.inField(cc, rr)) return false;      /* it will not shove one over */
    if (this.at(cc, rr) !== EMPTY) return false;
    if (this.monsterAt(cc, rr) || this.robotAt(cc, rr)) return false;
    if (cc === this.manC && rr === this.manR) return false;
    for (var q = line.length - 1; q >= 0; q--) {
      var fc = nc + d[0] * q, fr = nr + d[1] * q;
      this.grid[this.idx(fc + d[0], fr + d[1])] = line[q];
    }
    this.grid[this.idx(nc, nr)] = EMPTY;
    b.c = nc; b.r = nr;
    ev.pushed = (ev.pushed || 0) + line.length;
    return true;
  };

  Game.prototype.runRobots = function (ev) {
    if (this.classic) return;
    var BOT = root.MutantBot;
    for (var i = 0; i < this.robots.length; i++) {
      var b = this.robots[i];
      if (b.gone) continue;

      /* anything loose standing on it takes it apart */
      var killer = this.monsterAt(b.c, b.r) || null;
      if (!killer) {
        for (var k = 0; k < this.monsters.length; k++) {
          var m = this.monsters[k];
          if (m.gone || m.trapped) continue;
          var cs = this.cellsOf(m);
          for (var q2 = 0; q2 < cs.length; q2++)
            if (Math.abs(cs[q2][0] - b.c) + Math.abs(cs[q2][1] - b.r) === 0) killer = m;
        }
      }
      if (killer) { b.gone = true; ev.robotDied = b; continue; }

      if (!b.running) {
        if (--b.wait <= 0) { b.gone = true; ev.robotLeft = b; }
        continue;
      }
      if (--b.life <= 0) { b.gone = true; ev.robotLeft = b; continue; }
      if (!BOT) continue;
      var dir = BOT.think(this, b);
      if (!dir) continue;
      var d = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] }[dir];
      if (d) this.robotMove(b, d, ev);
    }
  };

  /* --------------------------------------------------------------
     Who a monster is tethered to.

     One on one it is always the man - that is the original rule. But
     the moment a robot is running there are two things down here worth
     chasing, and a monster goes for whichever is nearer. Which is what
     makes a robot worth starting: it is a decoy as much as a spare
     pair of hands, and it buys you the far side of the cellar.
     -------------------------------------------------------------- */
  /* ==================================================================
     THE EDGE OF THE CELLAR

     In 1985 there was only one kind of edge, and it was not really an
     edge at all: the brick was drawn outside the graphics viewport,
     clipped, and gone. Down here that is a DROP - the floor simply
     stops, a brick shoved over it is lost, and it is no help whatever
     for walling something in, because there is nothing there to wall
     against. You can walk off one, too.

     The other kind is a WALL: good stone, a brick driven into it stops
     dead, and it counts as a side. Which is what makes the corners
     worth having - a monster backed into a stone corner needs two
     bricks instead of four.

     Cellar one is all drop, exactly as it was.
     ================================================================== */
  Game.prototype.makeEdges = function () {
    var sides = [["W", ROWS], ["E", ROWS], ["S", COLS], ["N", COLS]];
    for (var s = 0; s < sides.length; s++) {
      var key = sides[s][0], n = sides[s][1];
      var a = this.edge[key];
      if (a.length !== n) a = this.edge[key] = new Uint8Array(n);
      a.fill(DROP);
      if (this.classic || !this.feat.walls) continue;
      /* runs, not a speckle: a stretch of good stone then a stretch of
         nothing, so a wall is long enough to back something into */
      var c = 0;
      var stone = this.grnd(2) === 0;
      while (c < n) {
        var run = 3 + this.grnd(7);
        for (var k = 0; k < run && c < n; k++, c++) if (stone) a[c] = WALL;
        stone = !stone;
      }
    }
  };

  /* what is just outside the field at (c,r) - only ever asked of a
     square one step off the edge, so a corner never comes up */
  Game.prototype.edgeAt = function (c, r) {
    /* ------------------------------------------------------------------
       What lies just beyond a square.

       A level with a `bound` plane has a boundary that is not four
       straight sides - it is whatever outline somebody drew - so the
       answer is kept per square there and that is the whole story.

       A cellar the game DEALT has the four sides it always had. Those
       used to be found by asking whether the square was off the grid,
       which worked while the grid and the room were the same thing. They
       are not any more: the room is 34 by 26 on paper that is 68 by 52,
       so a brick shoved east leaves the room at column 34 and does not
       leave the paper until 68. Every stone wall in the game stopped
       working the moment the paper got bigger, silently, because falling
       off the end of those tests returns DROP. The sides are found
       against the room's own box now.
       ------------------------------------------------------------------ */
    /* Off the sheet altogether there is no square to have recorded
       anything about, so the four sides answer for it even when the
       level has an outline. A room drawn flush against the edge of the
       sheet - which the one you start with is, on two of its sides -
       otherwise had no way to be walled at all: you could choose stone
       for that side and nothing would happen, because the squares
       beyond it are not squares. */
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) {
      if (c < 0) return this.edge.W[clamp(r, 0, ROWS - 1)];
      if (c >= COLS) return this.edge.E[clamp(r, 0, ROWS - 1)];
      if (r < 0) return this.edge.S[clamp(c, 0, COLS - 1)];
      return this.edge.N[clamp(c, 0, COLS - 1)];
    }
    if (this.bound) {
      var b = this.bound[r * COLS + c];
      return (b === WALL || b === SHEER) ? b : DROP;
    }

    var b = this.box || this.reBox();
    if (c < b.c0) return this.edge.W[clamp(r, 0, ROWS - 1)];
    if (c > b.c1) return this.edge.E[clamp(r, 0, ROWS - 1)];
    if (r < b.r0) return this.edge.S[clamp(c, 0, COLS - 1)];
    if (r > b.r1) return this.edge.N[clamp(c, 0, COLS - 1)];
    return DROP;
  };

  /* what an actor can move in one push, in bricks. A rock is four. */
  Game.prototype.pushPower = function (who) {
    if (who && who.power) return who.power;
    return PUSH_POWER;
  };

  Game.prototype.prey = function (m) {
    var bc = this.manC, br = this.manR;
    var bd = Math.abs(bc - m.c) + Math.abs(br - m.r);
    for (var i = 0; i < this.robots.length; i++) {
      var b = this.robots[i];
      if (!b.running || b.gone) continue;
      var d = Math.abs(b.c - m.c) + Math.abs(b.r - m.r);
      if (d < bd) { bd = d; bc = b.c; br = b.r; }
    }
    return { c: bc, r: br };
  };

  Game.prototype.sheet = function () {
    if (this.SC > this.HI) this.HI = this.SC;       /* line 1030 */
    this.rng = mulberry32(mix(this.seed, this.F, this.variant[this.F] || 0));
    var lv = levelOf(this.F, this.classic);
    this.PE = lv.PE;
    this.PA = lv.PA;
    this.leash = leashCells(lv.PA);
    this.feat = lv.feat;
    /* the top cellar is stacked with old timber rather than brick: no
       limit on a shove, and it burns like nothing else down here */
    this.wood = this.classic || this.F === 1;
    this.CO = 0;
    this.grid.fill(EMPTY);
    this.item.fill(NOTHING);
    this.fluid.fill(DRY);
    this.fvol.fill(0);
    this.sealed.fill(0);
    this.gnaw.fill(0);
    this.tint.fill(0);
    this.burn.fill(0);
    this.stress.fill(0);
    this.marbles.length = 0;
    this.sources.length = 0;

    /* ----------------------------------------------------------------
       A generated cellar is the size the game has always been.

       shape and bound were never cleared here, so after playing a level
       somebody had cut a hole in, the next cellar was dealt into that
       hole - bricks and monsters generated outside their own floor,
       standing on paper. Now the cellar states its own shape every
       time: the old 34 by 26 field, and nothing beyond it. Only a level
       somebody builds replaces that with something else.
       ---------------------------------------------------------------- */
    this.shape = null;              /* the field, as always */
    this.bound = null;
    this.blocks = null;
    this.floors = null;
    this.deal = null;
    this.reBox();

    /* the man's state resets with the cellar */
    this.steps = 0;
    this.boots = 0;
    this.frost = 0;
    this.saw = 0;

    this.makeEdges();
    this.makeHeights();
    this.makeFurniture();

    /* now the movable parts, dealt fresh */
    this.monsters = [];
    this.robots = [];
    this.coins = [];
    if (this.classic) {
      this.manC = MAN_C0; this.manR = MAN_R0;       /* line 130 */
      this.monsters.push(this.newMonster(lv.kinds[0], MON_C0, MON_R0));
    } else {
      var start = this.openSpot(null, 0);
      this.manC = start[0]; this.manR = start[1];
      for (var i = 0; i < lv.kinds.length; i++) {
        var at = this.openSpot([[this.manC, this.manR]], 7);
        this.monsters.push(this.newMonster(lv.kinds[i], at[0], at[1]));
      }
      /* and the marbles, however many this cellar has, wherever they
         have ended up this time */
      for (var mb = 0; mb < this.marbleCount; mb++) {
        var ms = this.openSpot([[this.manC, this.manR]], 3);
        this.grid[this.idx(ms[0], ms[1])] = MARBLE;
        /* not all the same size, and size is mass */
        this.marbles.push({ c: ms[0], r: ms[1], dc: 0, dr: 0, v: 0, size: 1 + this.grnd(3) });
      }
    }

    /* line 820-840: PE% bricks dropped on squares that are not already
       bricks. Squares beside a monster are left clear so nothing starts
       walled in by luck. */
    var placed = 0, guard = 0;
    while (placed < this.PE && guard++ < 400000) {
      var c = BRICK_C0 + this.grnd(BRICK_C1 - BRICK_C0 + 1);
      var r = BRICK_R0 + this.grnd(BRICK_R1 - BRICK_R0 + 1);
      if (this.grid[this.idx(c, r)] !== EMPTY) continue;
      if (c === this.manC && r === this.manR) continue;
      if (this.nearMonster(c, r)) continue;
      this.grid[this.idx(c, r)] = BRICK;
      placed++;
    }
    this.bricks = placed;

    /* Let them find their level before anybody looks, or the first turns
       are spent watching the cellar tidy itself up. Settling can also
       pile bricks into the low ground and wall something in before the
       cellar has opened - which hands you the level, or traps you in it -
       so open a way out of whatever got boxed and settle again, because
       freeing a square lets the next brick move. */
    for (var round = 0; round < 8; round++) {
      for (var settleN = 0; settleN < MAX_BUILD_H * 8; settleN++) if (!this.slideBricks(null)) break;
      var opened = false;
      for (var mi = 0; mi < this.monsters.length; mi++)
        if (this.isBoxed(this.monsters[mi])) opened = this.openOut(this.monsters[mi]) || opened;
      if (this.penned(this.manC, this.manR)) opened = this.freeUp([[this.manC, this.manR]]) || opened;
      if (!opened) break;
    }

    /* Belt and braces: a cellar that opens with everything already walled
       in is a cellar you win by standing still, and one that opens with
       the man sealed in is one you cannot play at all. */
    for (var mj = 0; mj < this.monsters.length; mj++) {
      var mm = this.monsters[mj];
      for (var tries = 0; tries < 12 && this.isBoxed(mm); tries++) this.openOut(mm);
      mm.trapped = this.isBoxed(mm);
    }
  };

  /* clear whatever is holding this thing in - a brick for choice, but a
     tree or a marble will do if that is all there is */
  Game.prototype.openOut = function (m) {
    if (this.freeUp(this.cellsOf(m))) return true;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]], cs = this.cellsOf(m), pick = [];
    for (var i = 0; i < cs.length; i++) for (var d = 0; d < 4; d++) {
      var nc = cs[i][0] + D[d][0], nr = cs[i][1] + D[d][1];
      if (!this.inField(nc, nr) || this.isPartOf(m, nc, nr)) continue;
      var v = this.grid[this.idx(nc, nr)];
      if (v === TREE || v === MARBLE || v === COOLED) pick.push([nc, nr, v]);
    }
    if (!pick.length) return false;
    var p = pick[this.grnd(pick.length)];
    if (p[2] === MARBLE) {
      for (var k = 0; k < this.marbles.length; k++)
        if (this.marbles[k].c === p[0] && this.marbles[k].r === p[1]) { this.marbles.splice(k, 1); break; }
    }
    this.grid[this.idx(p[0], p[1])] = EMPTY;
    return true;
  };

  /* somewhere clear to put somebody - level ground for choice, and not
     on top of anything already there */
  /* The smallest box that holds the level - the old field for anything
     generated, whatever somebody drew for anything built. Everything
     that puts something down at random works inside it, so a coin or a
     robot never turns up in the blank paper round a small room. */
  Game.prototype.reBox = function () {
    var c0 = COLS, c1 = -1, r0 = ROWS, r1 = -1;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      if (!this.inField(c, r)) continue;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
    if (c1 < 0) { c0 = 0; c1 = COLS - 1; r0 = 0; r1 = ROWS - 1; }
    this.box = { c0: c0, c1: c1, r0: r0, r1: r1, w: c1 - c0 + 1, h: r1 - r0 + 1 };
    return this.box;
  };

  /* somewhere inside the level, inset from its own edges */
  Game.prototype.someWhere = function (inset, pick) {
    var b = this.box || this.reBox();
    var w = Math.max(1, b.w - inset * 2), h = Math.max(1, b.h - inset * 2);
    return [b.c0 + inset + pick(w), b.r0 + inset + pick(h)];
  };

  Game.prototype.openSpot = function (away, minDist) {
    var best = null, bestScore = -1;
    for (var t = 0; t < 500; t++) {
      var at = this.someWhere(2, rnd), c = at[0], r = at[1];
      /* never on paper the level does not cover, and never in a pool */
      if (!this.inField(c, r)) continue;
      if (this.grid[this.idx(c, r)] !== EMPTY) continue;
      if (this.fluid[this.idx(c, r)] !== DRY) continue;
      if (this.monsterAt(c, r)) continue;
      var ok = true;
      for (var i = 0; away && i < away.length; i++)
        if (Math.abs(away[i][0] - c) + Math.abs(away[i][1] - r) < (minDist || 0)) ok = false;
      if (!ok) continue;
      var score = 10 - this.height[this.idx(c, r)] * 3 + rnd(3);
      if (score > bestScore) { bestScore = score; best = [c, r]; if (score >= 12) break; }
    }
    if (best) return best;
    /* nothing was free: the first empty square in the level, and only
       the man's old corner if the level has none at all */
    for (var fr = 0; fr < ROWS; fr++) for (var fc = 0; fc < COLS; fc++)
      if (this.inField(fc, fr) && this.grid[this.idx(fc, fr)] === EMPTY &&
          this.fluid[this.idx(fc, fr)] === DRY) return [fc, fr];
    return [MAN_C0, MAN_R0];
  };

  Game.prototype.newMonster = function (kind, c, r) {
    var m = { kind: kind, spec: MONSTERS[kind], c: c, r: r,
              tick: 0, trapped: false, crushed: false, gone: false, ate: false };
    /* The 1985 fly is one square: VDU 226 and 227 are two characters
       drawn at the SAME graphics position in two colours, not two cells.
       It only lies across two squares in the deep cellars.

       The tail needs a square it actually fits on. Dropping it blindly
       behind the head buried it in whatever was already there. */
    if (!this.classic && MONSTERS[kind].size === "long") {
      /* lay it out one square at a time, wandering, so it starts curled
         up somewhere rather than as a ruler across the room */
      m.full = 4 + this.grnd(4);
      m.growth = 0;
      m.body = [[c, r]];
      var DD = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      while (m.body.length < m.full) {
        var last = m.body[m.body.length - 1], put = false;
        for (var t = 0; t < 8 && !put; t++) {
          var e = DD[this.grnd(4)];
          var bc = last[0] + e[0], br = last[1] + e[1];
          if (!this.inField(bc, br)) continue;
          if (this.grid[this.idx(bc, br)] !== EMPTY) continue;
          if (this.monsterAt(bc, br) || this.isPartOf(m, bc, br)) continue;
          if (bc === this.manC && br === this.manR) continue;
          m.body.push([bc, br]); put = true;
        }
        if (!put) break;
      }
      m.full = Math.max(2, m.body.length);
      return m;
    }
    if (!this.classic && MONSTERS[kind].size === 2) {
      var D = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var d = 0; d < 4; d++) {
        var tc = c + D[d][0], tr = r + D[d][1];
        if (this.inField(tc, tr) && this.grid[this.idx(tc, tr)] === EMPTY &&
            !this.monsterAt(tc, tr)) { m.tc = tc; m.tr = tr; break; }
      }
      /* nowhere at all to lie: it is one square today */
    }
    return m;
  };

  Game.prototype.nearMonster = function (c, r) {
    for (var i = 0; i < this.monsters.length; i++) {
      var cs = this.cellsOf(this.monsters[i]);
      for (var k = 0; k < cs.length; k++)
        if (Math.abs(cs[k][0] - c) <= 1 && Math.abs(cs[k][1] - r) <= 1) return true;
    }
    return false;
  };

  /* --- the floor -----------------------------------------------------
     A few smooth mounds. The rim stays flat so nothing can be pushed
     uphill into the edge and stick there.                            */
  Game.prototype.makeHeights = function () {
    this.height.fill(0);
    if (this.classic || !this.feat.slopes) return;
    /* Wide and low. A tall narrow mound is all cliff, and smoothing then
       grinds it - and everything round it - back to nothing, which is how
       the whole floor ended up flat. */
    var mounds = 3 + this.grnd(4);
    for (var k = 0; k < mounds; k++) {
      var hp = this.someWhere(4, this.grnd.bind(this));
      var cx = hp[0], cy = hp[1];
      var amp = 1 + this.grnd(MAX_H), rad = 3 + amp * 3 + this.grnd(6);
      for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
        if (!this.inField(c, r)) continue;      /* no hills on blank paper */
        var d = Math.sqrt((c - cx) * (c - cx) + (r - cy) * (r - cy));
        if (d > rad) continue;
        var hgt = Math.round(amp * (1 - d / rad));
        var i = this.idx(c, r);
        if (hgt > this.height[i]) this.height[i] = Math.min(MAX_H, hgt);
      }
    }
    /* Flatten the rim - the ROOM's rim.

       This walked the sheet's edges, which stopped being the room's
       edges when the sheet grew: it was levelling row 51 and column 67,
       out in the blank paper nobody can stand on, and leaving the
       cellar's own far and near rows sloping. A hill running off the
       edge of the room is a hill you meet as a step. */
    var bx = this.box || this.reBox();
    for (var c2 = bx.c0; c2 <= bx.c1; c2++) {
      this.height[this.idx(c2, bx.r0)] = 0;
      this.height[this.idx(c2, bx.r1)] = 0;
    }
    for (var r2 = bx.r0; r2 <= bx.r1; r2++) {
      this.height[this.idx(bx.c0, r2)] = 0;
      this.height[this.idx(bx.c1, r2)] = 0;
    }
    /* Nothing about where people are standing may shape the ground: the
       land is seeded and they are not, so flattening around them made the
       same cellar come out different every time. They are placed on the
       finished terrain instead, and openSpot prefers the level parts. */
    this.smooth();
  };
  /* No cliffs. Stacking mounds leaves squares three steps above their
     neighbours, which reads as a wall you cannot see and makes a shove
     across it unaccountable. Grind every difference down to one step, so
     the floor only ever rises and falls a step at a time and every rise
     is a slope you can read. */
  Game.prototype.smooth = function () {
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var pass = 0; pass < MAX_BUILD_H * 4; pass++) {
      var changed = false;
      for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
        var i = this.idx(c, r), lowest = MAX_BUILD_H;
        for (var d = 0; d < 4; d++) {
          var nc = c + D[d][0], nr = r + D[d][1];
          if (!this.inField(nc, nr)) { lowest = 0; break; }
          lowest = Math.min(lowest, this.height[this.idx(nc, nr)]);
        }
        if (this.height[i] > lowest + 1) { this.height[i] = lowest + 1; changed = true; }
      }
      if (!changed) break;
    }
  };

  /* ------------------------------------------------------------------
     LIFTING THE GROUND

     Raising one square on its own would make a cliff, and a cliff is
     not a thing this floor has. So lifting a square lifts what is
     around it too, and the higher it goes the further out that reaches
     - a cone rather than a pillar, spreading until it runs into the
     edge of the cellar or into ground already high enough.

     HOW STEEP that cone is, is the builder's to choose. `run` is how
     many squares the ground takes to climb one step:

       run 1   step, step, step        0.55 in 1    about 29 degrees
       run 2   step, flat, step, flat  0.55 in 2    about 15
       run 3   ...                     0.55 in 3    about 10

     So a long hill is not a shallower incline - the grid has no such
     thing, heights are whole steps - it is the same one-step edges with
     flat ground between them, and the further apart they are the gentler
     the hill reads and walks. One step per square is the steepest the
     ground goes, and at twenty-nine degrees it is comfortably inside the
     forty-five this floor will not exceed.

     That also means the sliding rule below does not change with the
     length of the hill: a block is either standing on the flat, where
     nothing is pulling it anywhere, or on one of those one-step edges,
     which is always the same edge.

     Lowering does the same in reverse: pull a square down and anything
     left standing too high above it comes down after it. Which means
     the ground is always walkable and always renderable - every change
     of height is a ramp, and there is nothing anywhere that a brick
     could be pushed off but not back onto.
     ------------------------------------------------------------------ */
  Game.prototype.terrace = function (c, r, delta, run) {
    if (!this.inField(c, r)) return 0;
    run = Math.max(1, Math.min(6, run || 1));
    var i = this.idx(c, r);
    var want = Math.max(0, Math.min(MAX_BUILD_H, this.height[i] + delta));
    if (want === this.height[i]) return 0;
    this.height[i] = want;
    return this.relax(delta > 0, run);
  };

  /* Bring the ground within one step per `run` squares - the low ones
     up after a lift, the high ones down after a dig. Runs to a fixed
     point, which cannot take more passes than the room is wide. */
  Game.prototype.relax = function (raising, run) {
    run = Math.max(1, Math.min(6, run || 1));
    var moved = 0;
    for (var pass = 0; pass < COLS + ROWS; pass++) {
      var changed = false;
      for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
        if (!this.inField(c, r)) continue;
        var i = this.idx(c, r), best = raising ? 0 : MAX_BUILD_H;
        /* everything within `run` squares, because that is how far the
           ground is allowed to take to change by one */
        for (var dr = -run; dr <= run; dr++) for (var dc = -run; dc <= run; dc++) {
          if (Math.abs(dc) + Math.abs(dr) > run) continue;
          if (!dc && !dr) continue;
          var nc = c + dc, nr = r + dr;
          if (!this.inField(nc, nr)) continue;    /* the edge is not a height */
          var h = this.height[this.idx(nc, nr)];
          best = raising ? Math.max(best, h) : Math.min(best, h);
        }
        if (raising && this.height[i] < best - 1) { this.height[i] = best - 1; changed = true; moved++; }
        else if (!raising && this.height[i] > best + 1) { this.height[i] = best + 1; changed = true; moved++; }
      }
      if (!changed) break;
    }
    return moved;
  };

  Game.prototype.flatten = function (c, r) {
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++)
      if (this.inField(c + dc, r + dr)) this.height[this.idx(c + dc, r + dr)] = 0;
  };

  /* --- trees, marbles and the things worth picking up ---------------- */
  Game.prototype.makeFurniture = function () {
    if (this.classic) return;
    var f = this.feat, self = this;
    function scatter(n, put) {
      for (var i = 0, guard = 0; i < n && guard < 4000; guard++) {
        var sp = self.someWhere(2, function (n) { return self.grnd(n); });
        var c = sp[0], r = sp[1];
        if (!self.inField(c, r)) continue;
        if (self.grid[self.idx(c, r)] !== EMPTY) continue;
        if (self.item[self.idx(c, r)] !== NOTHING) continue;
        put(c, r); i++;
      }
    }
    if (f.trees) scatter(6 + self.grnd(7), function (c, r) { self.grid[self.idx(c, r)] = TREE; });
    /* how many marbles is part of the cellar; where they have rolled to
       is not */
    this.marbleCount = f.marbles ? (2 + this.grnd(4)) : 0;
    if (f.boots) scatter(2, function (c, r) { self.item[self.idx(c, r)] = BOOTS; });
    if (f.frost) scatter(2, function (c, r) { self.item[self.idx(c, r)] = FROST; });
    if (f.saw) scatter(2 + self.grnd(2), function (c, r) { self.item[self.idx(c, r)] = SAW; });
    if (f.jar) scatter(2 + self.grnd(3), function (c, r) { self.item[self.idx(c, r)] = JAR; });
    if (f.choppers) scatter(2 + self.grnd(3), function (c, r) { self.grid[self.idx(c, r)] = CHOPPER; });
    if (f.tar) scatter(1 + self.grnd(2), function (c, r) { self.grid[self.idx(c, r)] = VAT_TAR; });
    if (f.water) scatter(1 + self.grnd(2), function (c, r) { self.grid[self.idx(c, r)] = VAT_WATER; });
    /* a tenth of the bricks, at the outside */
    if (f.rocks) {
      var want = 3 + this.grnd(Math.max(1, Math.floor(this.PE * 0.1) - 2));
      scatter(want, function (c, r) { self.grid[self.idx(c, r)] = ROCK; });
    }
    if (f.tar) this.makePools(TAR, 1 + this.grnd(2));
    if (f.water) this.makePools(WATER, 1 + this.grnd(2));
  };

  /* ------------------------------------------------------------------
     Pools.

     A vat is a thing somebody built. A pool is what happens when it
     leaks and the last people down here bricked round it to keep it
     where it was. It sits behind a course of brickwork doing nothing at
     all - and it goes on doing nothing until you take a brick out of
     the wall holding it in, at which point it is somebody else's floor.

     Sealed fluid does not flow. Water never will while the ring holds.
     Tar is not so obliging: it works away at the brickwork the whole
     time, and it will burn its own way out - it just takes a while. So
     a pool of tar is a fuse rather than a lock, and the question is
     only whether you open it where you want it or let it choose.
     Open the ring anywhere and the whole pool wakes up at once.
     ------------------------------------------------------------------ */
  Game.prototype.makePools = function (kind, howMany) {
    for (var n = 0; n < howMany; n++) {
      for (var tries = 0; tries < 60; tries++) {
        var pp = this.someWhere(4, this.grnd.bind(this));
        var cx = pp[0], cy = pp[1];
        var rad = 1;
        var clear = true;
        for (var r = cy - rad - 1; r <= cy + rad + 1 && clear; r++)
          for (var c = cx - rad - 1; c <= cx + rad + 1 && clear; c++) {
            if (c < 1 || r < 1 || c >= COLS - 1 || r >= ROWS - 1) clear = false;
            else if (this.grid[this.idx(c, r)] !== EMPTY) clear = false;
          }
        if (!clear) continue;
        for (var r2 = cy - rad - 1; r2 <= cy + rad + 1; r2++)
          for (var c2 = cx - rad - 1; c2 <= cx + rad + 1; c2++) {
            var i = this.idx(c2, r2);
            var inside = Math.abs(c2 - cx) <= rad && Math.abs(r2 - cy) <= rad;
            if (inside) {
              this.fluid[i] = kind;
              this.fvol[i] = (kind === TAR) ? 7 : 9;
              this.sealed[i] = 1;
            } else {
              this.grid[i] = BRICK;
              this.bricks++;
            }
          }
        break;
      }
    }
  };

  /* has anything opened a pool? If so the whole of it goes at once */
  Game.prototype.checkSeals = function (ev) {
    if (this.classic) return;
    var n = COLS * ROWS, i, hit = [];

    /* sealed tar chars the bricks holding it in. Slowly - but it is the
       one thing down here that is working while you are not. */
    for (i = 0; i < n; i++) {
      if (!this.sealed[i] || this.fluid[i] !== TAR) continue;
      var tc = i % COLS, tr = (i / COLS) | 0;
      for (var td = 0; td < 4; td++) {
        var te = [[1, 0], [-1, 0], [0, 1], [0, -1]][td];
        var xc = tc + te[0], xr = tr + te[1];
        if (!this.inField(xc, xr)) continue;
        var xi = this.idx(xc, xr);
        if (this.grid[xi] !== BRICK) continue;
        this.gnaw[xi] = Math.min(255, this.gnaw[xi] + (this.wood ? 4 : 1));   /* sealed: slower */
        if (this.gnaw[xi] >= CHAR_THROUGH) {
          this.grid[xi] = EMPTY; this.bricks--; this.gnaw[xi] = 0;
          ev.burned++;
        }
      }
    }

    for (i = 0; i < n; i++) {
      if (!this.sealed[i]) continue;
      var c = i % COLS, r = (i / COLS) | 0;
      for (var d = 0; d < 4; d++) {
        var dd = [[1, 0], [-1, 0], [0, 1], [0, -1]][d];
        var nc = c + dd[0], nr = r + dd[1];
        if (!this.inField(nc, nr)) { hit.push(i); break; }
        var ni = this.idx(nc, nr);
        if (this.sealed[ni]) continue;
        if (this.grid[ni] === EMPTY) { hit.push(i); break; }
      }
    }
    if (!hit.length) return;
    var q = hit.slice(), head = 0;
    for (var h = 0; h < q.length; h++) this.sealed[q[h]] = 0;
    while (head < q.length) {
      var j = q[head++], jc = j % COLS, jr = (j / COLS) | 0;
      for (var d2 = 0; d2 < 4; d2++) {
        var e = [[1, 0], [-1, 0], [0, 1], [0, -1]][d2];
        var mc = jc + e[0], mr = jr + e[1];
        if (!this.inField(mc, mr)) continue;
        var mi = this.idx(mc, mr);
        if (!this.sealed[mi]) continue;
        this.sealed[mi] = 0;
        q.push(mi);
      }
    }
    ev.spilled = (ev.spilled || 0) + 1;
  };

  /* --- bricks run downhill -------------------------------------------
     A brick shoved uphill is only up there as long as nothing lets it
     back down: the square it came from is under the man the moment he
     pushes it, but step off and it follows you. Shove one downhill and it
     keeps going, which is most of the reason downhill is the easy
     direction. Nothing rolls onto the man, a monster, or another brick.
     -------------------------------------------------------------------- */
  Game.prototype.slideBricks = function (ev) {
    if (this.classic) return 0;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]], moved = 0;
    var press = {};                     /* how many bricks lean on each tree */

    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var i = this.idx(c, r);
      var what = this.grid[i];
      /* anything that can be shoved can also slide - and whether it
         does is friction against the slope, nothing else */
      if (what !== BRICK && what !== ROCK && what < MADE) continue;
      if (this.holdsOnSlope(what)) continue;

      /* tar sets round anything standing in it */
      if (this.fluid[i] === TAR || this.grid[i] === COOLED) continue;

      var here = this.height[i], best = null, bestH = here;
      for (var d = 0; d < 4; d++) {
        var nc = c + D[d][0], nr = r + D[d][1];
        if (!this.inField(nc, nr)) continue;
        var ni = this.idx(nc, nr);
        if (this.height[ni] >= here) continue;      /* only downhill      */
        if (this.grid[ni] === TREE) {               /* leaning on a tree  */
          press[ni] = (press[ni] || 0) + 1;
          continue;
        }
        if (this.height[ni] >= bestH) continue;
        if (this.grid[ni] !== EMPTY) continue;
        if (this.fluid[ni] === TAR) continue;       /* it will not run into tar */
        if (nc === this.manC && nr === this.manR) continue;
        if (this.monsterAt(nc, nr)) continue;
        bestH = this.height[ni]; best = ni;
      }
      /* it arrives as whatever it was: a level's own block does not
         turn into a brick by rolling downhill */
      if (best !== null) { this.grid[i] = EMPTY; this.grid[best] = what; moved++; }
    }

    /* A single brick resting against a tree does nothing for ever. Two
       will have it over eventually, and the more that pile up behind
       them the sooner it goes. When it goes, everything that was held
       up by it carries on down the slope. */
    for (var k = 0; k < this.stress.length; k++) {
      var n = press[k] || 0;
      if (this.grid[k] !== TREE) { this.stress[k] = 0; continue; }
      if (n >= 2) this.stress[k] += (n - 1);
      else if (this.stress[k] > 0) this.stress[k]--;   /* it recovers */
      if (this.stress[k] >= TREE_STRENGTH) {
        this.grid[k] = EMPTY;
        this.stress[k] = 0;
        if (ev) ev.treesDown++;
      }
    }

    if (ev && moved) ev.slid += moved;
    return moved;
  };

  /* take one brick off the squares around something, so it is not sealed
     in before anybody has played a turn */
  Game.prototype.freeUp = function (cells) {
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]], pick = [];
    for (var i = 0; i < cells.length; i++) for (var d = 0; d < 4; d++) {
      var nc = cells[i][0] + D[d][0], nr = cells[i][1] + D[d][1];
      /* a beetle cannot get its jaws round a rock */
      if (this.inField(nc, nr) && this.grid[this.idx(nc, nr)] === BRICK) pick.push([nc, nr]);
    }
    if (!pick.length) return false;
    var p = pick[this.grnd(pick.length)];
    this.grid[this.idx(p[0], p[1])] = EMPTY;
    this.bricks--;
    return true;
  };

  /* the man walled in on every side has no game to play */
  Game.prototype.penned = function (c, r) {
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < 4; d++) {
      var nc = c + D[d][0], nr = r + D[d][1];
      if (this.inField(nc, nr) && this.at(nc, nr) === EMPTY) return false;
    }
    return true;
  };

  /* the beetle's meal: one brick beside it, gone */
  Game.prototype.devour = function (m) {
    var d = [[1, 0], [-1, 0], [0, 1], [0, -1]], pick = [];
    for (var i = 0; i < 4; i++)
      if (this.brickAt(m.c + d[i][0], m.r + d[i][1])) pick.push(d[i]);
    if (!pick.length) return false;
    var p = pick[rnd(pick.length)];
    this.grid[this.idx(m.c + p[0], m.r + p[1])] = EMPTY;
    this.bricks--;
    return true;
  };

  /* Walled in: no square it is lying on has anywhere to go. A two-square
     monster therefore needs a pocket sealed all the way round both ends,
     which takes six bricks rather than four. */
  Game.prototype.isBoxed = function (m) {
    var cs = this.cellsOf(m), D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < cs.length; i++) {
      for (var d = 0; d < 4; d++) {
        var nc = cs[i][0] + D[d][0], nr = cs[i][1] + D[d][1];
        if (this.isPartOf(m, nc, nr)) continue;      /* its own other end */
        /* Outside the playfield POINT read -1, never colour 2, so in
           1985 the cellar edge was no help at all and a cornered
           monster could never be walled in. That stands in the classic
           game and always will. Down here it does not: the cellar has
           four good stone walls and it was always odd that you could
           not back something into one. A corner now costs two bricks
           instead of four, which is what makes the corners worth
           fighting over. */
        if (!this.inField(nc, nr)) {
          if (this.classic) return false;
          if (this.edgeAt(nc, nr) !== WALL) return false;   /* a drop holds nothing in */
          continue;
        }
        if (!this.solid(nc, nr)) return false;
      }
    }
    return true;
  };

  /* ------------------------------------------------------------------
     Cutting one. The square goes to whatever did the cutting; what was
     on either side of it becomes a snake in its own right, and anything
     left shorter than two squares dies. Both survivors go on trying to
     get back to the length the whole one was.
     ------------------------------------------------------------------ */
  Game.prototype.cutSnake = function (m, c, r, ev) {
    var k = -1;
    for (var i = 0; i < m.body.length; i++)
      if (m.body[i][0] === c && m.body[i][1] === r) { k = i; break; }
    if (k < 0) return false;
    var front = m.body.slice(0, k), back = m.body.slice(k + 1);
    var full = m.full;
    ev.cut = (ev.cut || 0) + 1;
    this.SC += 60;

    if (front.length >= 2) {
      m.body = front;
      m.c = front[0][0]; m.r = front[0][1];
      m.growth = 0;
    } else {
      m.gone = true; m.trapped = true;
      ev.crushed.push(m);
    }
    if (back.length >= 2) {
      var other = this.newMonster("snake", back[0][0], back[0][1]);
      other.body = back;
      other.full = full;
      other.growth = 0;
      this.monsters.push(other);
      ev.split = ev.split || [];
      ev.split.push(other);
    }
    return true;
  };

  /* Could it still shift off the square that is about to be filled? If
     not, filling that square leaves it nowhere to be and it is crushed. */
  Game.prototype.canRetreat = function (m, bc, br) {
    var cs = this.cellsOf(m), D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < cs.length; i++) {
      for (var d = 0; d < 4; d++) {
        var nc = cs[i][0] + D[d][0], nr = cs[i][1] + D[d][1];
        if (nc === bc && nr === br) continue;
        if (this.isPartOf(m, nc, nr)) continue;
        if (this.inField(nc, nr) && !this.solid(nc, nr) && !this.monsterAt(nc, nr, m)) return true;
      }
    }
    return false;
  };
  Game.prototype.loose = function () {
    var n = 0;
    for (var i = 0; i < this.monsters.length; i++)
      if (!this.monsters[i].trapped && !this.monsters[i].gone) n++;
    return n;
  };
  Game.prototype.canStillWin = function () {
    if (this.classic) return this.bricks >= 4 * this.loose();
    /* trees and marbles will hold a monster too, so only count bricks
       against what is left loose, generously */
    return this.bricks + this.marbles.length * 2 >= 4 * this.loose();
  };

  /* --- what a step costs --------------------------------------------
     One step point arrives each turn (two in boots). A step on the level
     costs one; every level of climb costs another, and shoving a line or
     a marble costs another again. Stepping down gives a point back, so
     you run downhill. In classic mode everything costs exactly one and
     the whole system is invisible.                                     */
  Game.prototype.stepCost = function (nc, nr, heavy) {
    if (this.classic) return 1;
    var climb = Math.max(0, this.h(nc, nr) - this.h(this.manC, this.manR));
    return 1 + climb + (heavy ? 1 : 0);
  };

  /* ==================================================================
     ONE TURN - lines 200-390, with everything that came later
     ================================================================== */
  Game.prototype.step = function (dir) {
    var ev = { moved: false, pushed: 0, lostOverEdge: 0, overTheEdge: [], fell: false,
               robotCame: null, robotStarted: null, robotLeft: null, robotDied: null,
               coinCame: null, tookCoin: [], lostCoin: [], crunched: 0, crunchedBy: null,
               eaten: 0, chopped: 0, picked: null, strained: false, rolled: [],
               smashed: 0, crushed: [], trappedNow: [], won: false, lost: false,
               lostTo: null, bonus: 0, stuck: false, spawned: null,
               burst: 0, burned: 0, doused: 0, swept: 0, set: 0,
               blocked: false, chopped_brick: 0, squashed: [], slid: 0,
               treesDown: 0, freed: [] };
    if (this.over || this.won) return ev;

    /* --- step points ------------------------------------------------
       One a turn, two in boots, and they bank up to three. Walking on
       the level spends one, so somebody walking steadily never has any
       in hand: the moment the ground rises he loses a turn to it. Stand
       still and you can wind up for a climb or a heavy shove instead. */
    this.steps = Math.min(3, this.steps + (this.boots > 0 ? 2 : 1));

    var d = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] }[dir];
    if (d) {
      /* in boots he gets through two squares in the same turn */
      var passes = this.boots > 0 ? 2 : 1;
      for (var pass = 0; pass < passes; pass++) {
        if (!this.manMove(d, ev)) break;
        if (ev.lost) return ev;
      }
    }

    this.slideBricks(ev);
    this.settle(ev);
    this.rollMarbles(ev);
    if (ev.lost) return ev;
    this.runRobots(ev);
    this.spawnRobot(ev);
    this.runCoins(ev);
    this.spawnCoin(ev);
    this.checkSeals(ev);
    this.flowFluids(ev);
    if (ev.lost) return ev;

    /* ---- the monsters, lines 300-340 ------------------------------ */
    if (this.frost > 0) this.frost--;
    else {
      for (var i = 0; i < this.monsters.length; i++) {
        var m = this.monsters[i];
        if (m.trapped || m.gone) continue;
        m.ate = false;
        m.spec.move(m, this);
        if (m.ate) ev.eaten++;
      }
    }
    if (this.boots > 0) this.boots--;
    this.settle(ev);

    this.CO++;                                      /* line 370 */

    /* ---- line 380 ------------------------------------------------- */
    var caught = this.monsterAt(this.manC, this.manR);
    if (caught && !caught.trapped) return this.die(ev, caught);
    if (this.loose() === 0 && this.monsters.length) {
      ev.won = true; this.won = true;
      /* PROCwin, lines 570-580. The high score is deliberately not
         touched here: the original only compares it in PROCset_level,
         and PROCloss wipes SC% first, so a run that dies before
         clearing a sheet contributes nothing. */
      if (this.CO < 800) { ev.bonus = bonusFor(this.CO); this.SC += ev.bonus; }
      this.SC += this.F * 50;
      this.SC += 100 * (this.monsters.length - 1);
    } else if (!this.canStillWin()) {
      ev.stuck = true;
    }
    return ev;
  };

  /* --- the man's move, lines 230-260. True if he actually did
         something, so a strained turn stops him trying again. -------- */
  Game.prototype.manMove = function (d, ev) {
    {
      var nc = this.manC + d[0], nr = this.manR + d[1];
      if (!this.inField(nc, nr)) {
        /* Stone you simply walk into. A drop you walk off, once. */
        if (this.classic || this.edgeAt(nc, nr) === WALL) return false;
        this.die(ev, { spec: { name: "The drop" } });
        ev.fell = true;
        return false;
      }
      {
        var here = this.grid[this.idx(nc, nr)];

        var bot = this.robotAt(nc, nr);
        if (bot) {
          /* a shove is how you switch one on. It costs the turn, and
             from here it plays by itself until the charge runs out */
          if (!bot.running) { bot.running = true; ev.robotStarted = bot; }
          ev.blocked = true;
          return false;
        }

        if (here === TREE || here === VAT_TAR || here === VAT_WATER) {
          /* none of these shove. The axe is the only argument they take */
          if (this.saw > 0 && this.steps >= 1) {
            this.saw--; this.steps -= 1;
            if (here === TREE) { this.grid[this.idx(nc, nr)] = EMPTY; ev.chopped = 1; }
            else this.breakVat(nc, nr, ev);
          } else ev.strained = true;

        } else if (here === COOLED || here === CHOPPER) {
          ev.strained = true;      /* set tar is rock; the chopper is worse */

        } else if (here === MARBLE) {
          var mar = this.marbleAt(nc, nr);
          var cost = this.stepCost(nc, nr, false);
          if (this.steps < cost) ev.strained = true;
          else {
            this.steps -= cost;
            /* a shove sets it rolling; how well depends on the ground */
            var drop = this.h(nc, nr) - this.h(nc + d[0], nr + d[1]);
            mar.dc = d[0]; mar.dr = d[1];
            mar.v = (2 + Math.max(-1.5, drop * 0.9)) * shoveSpeed(mar) * 1.0;
            if (mar.v <= 0) { mar.v = 0; ev.strained = true; }
            else ev.rolled.push(mar);
          }

        } else {
          if (this.fluid[this.idx(nc, nr)] === TAR) { this.die(ev, { spec: { name: "Tar" } }); return false; }
          /* The line can be bricks, rocks, or both, so it is gathered
             rather than counted - and it has to be shifted a square at a
             time, because the pieces are no longer interchangeable. */
          var line = [], cc = nc, rr = nr, weight = 0, drag = 0;
          for (;;) {
            var pc = this.at(cc, rr);
            if (pc !== BRICK && pc !== ROCK && pc < MADE) break;
            line.push(pc);
            weight += this.weightOf(pc);
            /* friction times the weight pressing down, per block, added
               up - so more of them is harder, and a rough one counts for
               more than a smooth one of the same weight */
            drag += this.dragOf(pc) * this.weightOf(pc);
            cc += d[0]; rr += d[1];
          }
          var run = line.length;
          var wading = this.fluid[this.idx(nc, nr)] === WATER;
          /* Two different costs, and they are both real: stepCost
             charges the man for climbing, which he pays whether he is
             pushing anything or not, and the resist below charges for
             the LOAD - dragging it along, and lifting it if the ground
             rises. Taking the climb out to make a rock go uphill was
             wrong: it made pushing a brick up a step cheaper than
             walking up one empty-handed. */
          var rise = Math.max(0, this.h(cc - d[0], rr - d[1]) - this.h(this.manC, this.manR));
          var resist = drag * SLOPE_COS + (rise ? SLOPE_SIN * weight * rise : 0);
          var cost2 = this.stepCost(nc, nr, wading) + this.dragCost(resist);
          /* how many, given the ground it is going onto */
          var slope = this.h(nc, nr) - this.h(this.manC, this.manR);
          var mu = weight > 0 ? drag / weight : DRAG[BRICK];
          if (!this.wood && weight > this.pushLimit(mu, slope) + 1e-9) {
            /* more than there is in his arms on this ground. He does
               not even move */
            ev.blocked = true;
            ev.tooHeavy = true;
            return false;
          }
          if (this.steps < cost2) ev.strained = true;
          else {
            this.steps -= cost2;
            this.manC = nc; this.manR = nr;         /* he always advances */
            ev.moved = true;
            if (this.h(nc, nr) < this.h(nc - d[0], nr - d[1])) this.steps = Math.min(3, this.steps + 1);

            if (run) {
              var blocker = this.monsterAt(cc, rr);
              var beyond = this.at(cc, rr);
              var lead = line[line.length - 1];      /* what is at the sharp end */
              var leadTough = this.tough(lead);
              if (this.robotAt(cc, rr)) {
                /* it weighs what it weighs and it is not going over any
                   edge on your account */
                ev.blocked = true;
                this.manC -= d[0]; this.manR -= d[1];
                this.steps += cost2;
                ev.moved = false;
                return false;
              }

              if (!this.inField(cc, rr)) {
                if (leadTough) {
                  /* it goes over, and it is not coming back either */
                  ev.lostOverEdge = 1;
                  line.pop();
                } else if (this.classic || this.edgeAt(cc, rr) !== WALL) {
                  /* 1985: the brick was drawn outside the graphics
                     viewport, clipped away, and never came back. Down
                     here the floor just stops, which comes to the same
                     thing - you can hear it land. */
                  ev.lostOverEdge = 1; this.bricks--;
                } else {
                  /* good stone. It stops the line, nothing is lost, and
                     nothing moves - including him. */
                  ev.blocked = true;
                  this.manC -= d[0]; this.manR -= d[1];
                  this.steps += cost2;
                  ev.moved = false;
                  return false;
                }
              } else if (blocker && leadTough) {
                /* nothing eats a rock. Either it has nowhere to go and the
                   rock finishes it, or the rock does not move at all */
                if (!this.canRetreat(blocker, cc, rr)) {
                  this.grid[this.idx(cc, rr)] = lead;
                  blocker.gone = true; blocker.trapped = true;
                  blocker.crushed = true; blocker.crushedAt = [cc, rr];
                  ev.squashed.push(blocker);
                  this.SC += 250;
                  line.pop();
                } else {
                  ev.blocked = true;
                  this.manC -= d[0]; this.manR -= d[1];
                  this.steps += cost2;
                  ev.moved = false;
                  return false;
                }
              } else if (blocker && blocker.body) {
                if (blocker.body[0][0] === cc && blocker.body[0][1] === rr) {
                  /* straight at the head. It takes the brick off you the
                     way anything else down here would */
                  ev.crunched = 1; ev.crunchedBy = blocker; this.bricks--;
                  line.pop();
                } else {
                  /* anywhere behind the head and it is a cut, not a kill */
                  this.cutSnake(blocker, cc, rr, ev);
                }
              } else if (blocker) {
                if (!this.canRetreat(blocker, cc, rr)) {
                  /* it has nowhere left to go. The brick goes in, and what
                     was lying across two squares is now lying across one. */
                  blocker.gone = true; blocker.trapped = true;
                  blocker.crushed = true; blocker.crushedAt = [cc, rr];
                  ev.squashed.push(blocker);
                  this.SC += 250;
                } else {
                  /* driven straight at a monster with room to shrug it off.
                     The brick lands on its square and its redraw wipes it,
                     so the leading brick - and only the leading brick - is
                     destroyed. */
                  ev.crunched = 1; ev.crunchedBy = blocker; this.bricks--;
                  line.pop();
                }
              } else if (beyond === CHOPPER) {
                if (leadTough) {
                  /* the machinery is not that good */
                  ev.blocked = true;
                  this.manC -= d[0]; this.manR -= d[1];
                  this.steps += cost2;
                  ev.moved = false;
                  return false;
                }
                /* the one thing left down here that still takes bricks
                   off you - it comes out the far side as splinters */
                ev.chopped_brick = 1; this.bricks--;
                line.pop();
              } else if (beyond !== EMPTY) {
                /* a tree, a marble, set tar: the line simply stops, and so
                   does he. Cut the tree down first. */
                ev.blocked = true;
                this.manC -= d[0]; this.manR -= d[1];
                this.steps += cost2;
                ev.moved = false;
                return false;
              }
              /* shift what is left of the line one square along, from the
                 far end back, so nothing overwrites its neighbour */
              for (var q = line.length - 1; q >= 0; q--) {
                var fc = nc + d[0] * q, fr = nr + d[1] * q;
                this.grid[this.idx(fc + d[0], fr + d[1])] = line[q];
              }
              this.grid[this.idx(nc, nr)] = EMPTY;
              ev.pushed = run;
            }

            /* anything lying here is picked up */
            var it = this.item[this.idx(nc, nr)];
            if (it !== NOTHING) {
              this.item[this.idx(nc, nr)] = NOTHING;
              ev.picked = this.take(it, ev);
            }
          }
        }
      }
    }

    return ev.moved || ev.chopped > 0 || !!ev.burst;
  };

  Game.prototype.die = function (ev, by) {
    ev.lost = true; ev.lostTo = by || null;
    this.over = true;
    this.SC = 0;                                    /* PROCloss, line 480 */
    return ev;
  };

  Game.prototype.take = function (it, ev) {
    var spec = ITEMS[it];
    if (it === BOOTS) this.boots = BOOTS_TURNS;
    else if (it === FROST) this.frost = FROST_TURNS;
    else if (it === SAW) this.saw += SAW_USES;
    else if (it === JAR) {
      /* nobody labelled it */
      if (rnd(2) === 0) { this.frost = FROST_TURNS + 20; return { key: "jar", name: "Sealed jar", got: "It was frost. Everything has stopped." }; }
      var kind = MONSTER_ORDER[rnd(MONSTER_ORDER.length)];
      var spot = this.farSpot();
      var extra = this.newMonster(kind, spot[0], spot[1]);
      this.monsters.push(extra);
      ev.spawned = extra;
      return { key: "jar", name: "Sealed jar", got: "It was a " + extra.spec.name.toLowerCase() + ". It was not empty." };
    }
    return { key: spec.key, name: spec.name, got: spec.blurb };
  };

  Game.prototype.farSpot = function () {
    var best = [1, 1], far = -1;
    for (var k = 0; k < 60; k++) {
      var sw = this.someWhere(2, rnd), c = sw[0], r = sw[1];
      if (!this.inField(c, r)) continue;
      if (this.grid[this.idx(c, r)] !== EMPTY || this.monsterAt(c, r)) continue;
      var d = Math.abs(c - this.manC) + Math.abs(r - this.manR);
      if (d > far) { far = d; best = [c, r]; }
    }
    return best;
  };

  /* --- the marbles ---------------------------------------------------
     A marble carries speed. It gains speed running downhill and loses it
     climbing, and if it cannot crest a slope it turns round and comes
     back at you, gathering pace. What it hits depends on how fast it is
     going: slowly it bounces off, quickly it breaks bricks, and at speed
     it will flatten a monster - or you.                               */
  Game.prototype.rollMarbles = function (ev) {
    for (var i = 0; i < this.marbles.length; i++) {
      var m = this.marbles[i];
      if (m.v <= 0) { m.v = 0; continue; }
      for (var s = 0; s < 3 && m.v >= 1; s++) {
        var nc = m.c + m.dc, nr = m.r + m.dr;
        var dh = this.h(nc, nr) - this.h(m.c, m.r);

        if (!this.inField(nc, nr)) {
          var side = this.classic ? WALL : this.edgeAt(nc, nr);
          if (side === WALL) { this.bounce(m, 0.45); continue; }
          /* No wall here. A drop still ends in a lip: fast enough and it
             rides over and is gone; short of that it clouts the lip and
             comes back slower, and rougher ground robs it of more on the
             way back. A sheer edge has no lip to clout. */
          if (side === SHEER || m.v >= lipSpeed(m)) {
            this.grid[this.idx(m.c, m.r)] = EMPTY;
            m.gone = true; m.v = 0;
            ev.overTheEdge.push(m);
            break;
          }
          var mu = frictionOn(this.grid[this.idx(m.c, m.r)], this.fluid[this.idx(m.c, m.r)]);
          this.bounce(m, Math.max(0.15, 0.5 - mu));
          continue;
        }
        if (dh > 0 && m.v <= dh) { this.bounce(m, 0.7); continue; }   /* rolls back */

        var what = this.grid[this.idx(nc, nr)];
        if (what === BRICK) {
          if (momentum(m) >= 3) { this.grid[this.idx(nc, nr)] = EMPTY; this.bricks--; ev.smashed++; m.v -= 1.4 / massOf(m); this.place(m, nc, nr); }
          else this.bounce(m, 0.45);
          continue;
        }
        if (what === VAT_TAR || what === VAT_WATER) {
          if (momentum(m) >= 1.5) { this.breakVat(nc, nr, ev); m.v -= 0.6 / massOf(m); }
          else this.bounce(m, 0.4);
          continue;
        }
        if (what === ROCK || (what >= MADE && this.tough(what))) { this.bounce(m, 0.3); continue; }
        if (what >= MADE) {                    /* lighter than stone: breakable */
          if (momentum(m) >= 3 * this.weightOf(what)) {
            this.grid[this.idx(nc, nr)] = EMPTY; ev.smashed++;
            m.v -= 1.4 / massOf(m); this.place(m, nc, nr);
          } else this.bounce(m, 0.45);
          continue;
        }
        if (what === TREE || what === MARBLE || what === COOLED || what === CHOPPER) { this.bounce(m, 0.35); continue; }

        var mon = this.monsterAt(nc, nr);
        if (mon && mon.body && !mon.gone) {
          /* a marble has no respect for which end it hits */
          if (momentum(m) >= 2) {
            this.cutSnake(mon, nc, nr, ev);
            m.v -= 0.8 / massOf(m);
            this.place(m, nc, nr);
          } else this.bounce(m, 0.4);
          continue;
        }
        if (mon && !mon.gone) {
          if (momentum(m) >= 2) {
            mon.gone = true; mon.trapped = true; mon.crushed = true;
            ev.crushed.push(mon);
            this.SC += 150;
            m.v -= 0.8 / massOf(m);
            this.place(m, nc, nr);
          } else this.bounce(m, 0.4);
          continue;
        }
        if (nc === this.manC && nr === this.manR) {
          if (momentum(m) >= 2) { this.die(ev, { spec: { name: "Marble" } }); return; }
          m.v = 0;                                   /* he stops it dead */
          continue;
        }

        /* clear ground. Gravity first - it gains coming down and pays
           going up - then friction for the square it has arrived on. */
        this.place(m, nc, nr);
        m.v += (dh < 0) ? (-dh * 0.55) : (-dh * 0.95);
        /* no mass term: friction slows a heavy marble and a light one
           at the same rate, because what resists the slowing scales
           with the weight as well */
        m.v -= frictionOn(this.grid[this.idx(nc, nr)], this.fluid[this.idx(nc, nr)],
                          this.madeOf(this.grid[this.idx(nc, nr)]));
        if (m.v <= 0.05) { m.v = 0; m.dc = 0; m.dr = 0; }
      }
      if (m.v <= 0.05) { m.v = 0; m.dc = 0; m.dr = 0; }
    }
  };
  Game.prototype.place = function (m, nc, nr) {
    this.grid[this.idx(m.c, m.r)] = EMPTY;
    m.c = nc; m.r = nr;
    this.grid[this.idx(nc, nr)] = MARBLE;
  };
  Game.prototype.bounce = function (m, keep) {
    m.dc = -m.dc; m.dr = -m.dr;
    m.v *= keep;
    if (m.v < 0.3) { m.v = 0; m.dc = 0; m.dr = 0; }
  };

  /* ==================================================================
     TAR AND WATER

     Both are sealed away until something breaks the vat, and then they
     behave the way anything does on a sloping stone floor: they run to
     the lowest ground they can reach and spread out when they can go no
     lower. Volume is carried per square, so a burst vat drains and a
     thin spill peters out.

     Tar burns what it runs into and finally sets solid, which leaves a
     wall you did not have to build. Water goes further, puts the tar
     out, shoves marbles along in front of it, and sweeps whatever is
     standing in its way one square downstream.
     ================================================================== */
  Game.prototype.breakVat = function (c, r, ev) {
    var i = this.idx(c, r);
    var kind = (this.grid[i] === VAT_TAR) ? TAR : WATER;
    this.grid[i] = EMPTY;
    this.sources.push({ c: c, r: r, kind: kind, left: (kind === TAR) ? 9 : 13 });
    ev.burst = kind;
    return kind;
  };

  Game.prototype.blocksFluid = function (c, r, kind) {
    var v = this.at(c, r);
    if (v === -1) return true;
    if (v >= MADE) return true;
    if (v === BRICK || v === ROCK || v === COOLED || v === VAT_TAR || v === VAT_WATER || v === CHOPPER) return true;
    if (v === TREE) return kind !== TAR;        /* tar takes the tree with it */
    return false;                                /* MARBLE is handled by the caller */
  };

  Game.prototype.flowFluids = function (ev) {
    if (this.classic) return;
    var n = COLS * ROWS, i, k;

    /* a burst vat keeps pouring for a while */
    for (var si = 0; si < this.sources.length; si++) {
      var src = this.sources[si];
      if (src.left <= 0) continue;
      i = this.idx(src.c, src.r);
      if (this.fluid[i] === DRY) { this.fluid[i] = src.kind; this.fvol[i] = 0; }
      if (this.fluid[i] === src.kind) { this.fvol[i] = Math.min(9, this.fvol[i] + 3); src.left--; }
    }

    /* highest ground first, so a spill cascades within the turn instead
       of creeping one square a turn */
    var cells = [];
    for (k = 0; k < n; k++) if (this.fvol[k] > 0 && !this.sealed[k]) cells.push(k);
    var self = this;
    cells.sort(function (a, b) {
      return (self.height[b] * 16 + self.fvol[b]) - (self.height[a] * 16 + self.fvol[a]);
    });

    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var ci = 0; ci < cells.length; ci++) {
      i = cells[ci];
      if (this.fvol[i] < 2) continue;      /* a film that thin stays put */
      var c = i % COLS, r = (i / COLS) | 0, kind = this.fluid[i];
      var best = null, bestLvl = this.height[i] * 4 + this.fvol[i];

      var dirs = D.slice();
      for (var t = 3; t > 0; t--) { var j = rnd(t + 1), tmp = dirs[t]; dirs[t] = dirs[j]; dirs[j] = tmp; }

      for (var d = 0; d < 4; d++) {
        var nc = c + dirs[d][0], nr = r + dirs[d][1];
        if (!this.inField(nc, nr)) continue;
        var ni = this.idx(nc, nr);

        /* water shoves a marble along in front of it rather than stopping */
        if (this.grid[ni] === MARBLE) {
          if (kind === WATER && this.fvol[i] >= 3) {
            var mar = this.marbleAt(nc, nr);
            if (mar && mar.v <= 0) { mar.dc = dirs[d][0]; mar.dr = dirs[d][1]; mar.v = 1.6; ev.rolled.push(mar); }
          }
          continue;
        }
        if (kind === TAR && this.tough(this.grid[ni])) continue;   /* it will not burn */
        if (kind === TAR && (this.grid[ni] === BRICK || this.grid[ni] >= MADE)) {
          /* It burns through rather than going round, but not at once.
             Timber goes in a few turns, brick takes long enough that a
             course of it is worth building, and stone never does - so
             what a wall is made of decides whether it is a wall or a
             delay. It spends itself getting through, too, which is why
             two courses hold where one does not. */
          this.gnaw[ni] += this.wood ? BURN_WOOD : BURN_BRICK;
          if (this.gnaw[ni] < CHAR_THROUGH) continue;
          this.gnaw[ni] = 0;
          this.grid[ni] = EMPTY; this.bricks--; ev.burned++;
          this.fvol[i] = Math.max(0, this.fvol[i] - (this.wood ? 1 : 2));
          if (this.fvol[i] <= 0) { this.fluid[i] = DRY; break; }
          continue;
        }
        if (this.blocksFluid(nc, nr, kind)) continue;
        if (this.fluid[ni] !== DRY && this.fluid[ni] !== kind) { this.douse(i, ni, ev); continue; }

        var lvl = this.height[ni] * 4 + this.fvol[ni];
        if (lvl < bestLvl) { bestLvl = lvl; best = [nc, nr, ni, dirs[d]]; }
      }

      if (best) {
        /* hand over half, never the lot: a square that gives away
           everything it has just shunts the same packet along for ever
           instead of the spill levelling out and setting */
        var amt = Math.min((kind === WATER) ? 3 : 2, this.fvol[i] >> 1);
        if (amt < 1) continue;
        this.fvol[i] -= amt;
        if (this.fluid[best[2]] === DRY) this.fluid[best[2]] = kind;
        this.fvol[best[2]] = Math.min(9, this.fvol[best[2]] + amt);
        this.enterFluid(best[0], best[1], kind, best[3], ev);
        if (ev.lost) return;
        if (this.fvol[i] <= 0) this.fluid[i] = DRY;
      }
    }

    /* and the tar sets - unless it is still sealed in, in which case it
       is not exposed to anything and just goes on working at the wall */
    for (k = 0; k < n; k++) {
      if (this.sealed[k]) continue;
      if (this.fluid[k] !== TAR) { if (this.fluid[k] === WATER) this.burn[k] = 0; continue; }
      this.burn[k]++;
      if (this.burn[k] > TAR_COOLS) {
        this.fluid[k] = DRY; this.fvol[k] = 0;
        this.grid[k] = COOLED;
        ev.set++;
      }
    }
  };

  /* what happens on the square the fluid has just reached */
  Game.prototype.enterFluid = function (c, r, kind, dir, ev) {
    var i = this.idx(c, r), d, dd;
    if (kind === TAR) {
      if (this.grid[i] === TREE) { this.grid[i] = EMPTY; ev.burned++; }
      else if (this.grid[i] === BRICK) { this.grid[i] = EMPTY; this.bricks--; ev.burned++; }
      if (this.item[i] !== NOTHING) this.item[i] = NOTHING;

      var mon = this.monsterAt(c, r);
      if (mon && !mon.gone) {
        mon.gone = true; mon.trapped = true; mon.burnt = true;
        ev.crushed.push(mon); this.SC += 120;
      }
      /* and it will take a neighbouring vat with it, which is how a
         cellar goes up all at once */
      for (d = 0; d < 4; d++) {
        dd = [[1, 0], [-1, 0], [0, 1], [0, -1]][d];
        if (this.at(c + dd[0], r + dd[1]) === VAT_TAR) this.breakVat(c + dd[0], r + dd[1], ev);
      }
      if (c === this.manC && r === this.manR) { this.die(ev, { spec: { name: "Tar" } }); return; }

    } else {
      /* water sweeps whatever is standing here one square downstream */
      var nc = c + dir[0], nr = r + dir[1];
      var open = this.inField(nc, nr) && this.at(nc, nr) === EMPTY;
      var m2 = this.monsterAt(c, r);
      if (m2 && !m2.trapped && open && !this.monsterAt(nc, nr)) { m2.c = nc; m2.r = nr; ev.swept++; }
      if (c === this.manC && r === this.manR && open) {
        this.manC = nc; this.manR = nr; ev.swept++;
        var hit = this.monsterAt(nc, nr);
        if (hit && !hit.trapped) { this.die(ev, hit); return; }
      }
    }
  };

  /* water and tar meeting: the fire goes out and leaves rock */
  Game.prototype.douse = function (a, b, ev) {
    var tar = (this.fluid[a] === TAR) ? a : b;
    var wet = (tar === a) ? b : a;
    this.fluid[tar] = DRY; this.fvol[tar] = 0;
    this.grid[tar] = COOLED;
    this.fvol[wet] = Math.max(0, this.fvol[wet] - 2);
    if (this.fvol[wet] <= 0) this.fluid[wet] = DRY;
    ev.doused++;
  };

  /* Being walled in is a state it is in, not something done to it once.
     A wall is only the few bricks that happen to be preventing it
     leaving, and anything that takes one away - a shove, a marble, the
     tar, a beetle's supper, or a brick sliding off downhill - lets it
     straight back out. Which is why you keep the first one walled while
     you go and deal with the second. */
  Game.prototype.settle = function (ev) {
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m.gone) continue;
      var was = m.trapped;
      m.trapped = this.isBoxed(m);
      if (!was && m.trapped) ev.trappedNow.push(m);
      else if (was && !m.trapped) ev.freed.push(m);
    }
  };

  Game.prototype.nextSheet = function () {
    this.F++;
    this.won = false;
    this.sheet();
  };

  /* --- the title screen, line 190 ------------------------------------
     PROCtitle_page reads these records and lays bricks along each run:
     C%=1 a vertical run at x=D% from y=A% to B%, C%=0 a horizontal run
     at y=D% from x=A% to B%. They spell FLY.                          */
  var TITLE_DATA = [
    [1, 192, 480, 896], [1, 224, 480, 896], [0, 896, 224, 684], [0, 768, 224, 320],
    [1, 448, 480, 768], [0, 480, 448, 608],
    [1, 896, 448, 704], [0, 704, 704, 1088], [1, 704, 704, 896], [1, 1088, 704, 896]
  ];
  function titleCells() {
    var out = [];
    for (var i = 0; i < TITLE_DATA.length; i++) {
      var C = TITLE_DATA[i][0], D = TITLE_DATA[i][1], A = TITLE_DATA[i][2], B = TITLE_DATA[i][3];
      for (var G = A; G <= B; G += 32) {
        var X = (C === 1) ? D : G, Y = (C === 1) ? G : D;
        out.push([(X - 96) / 32, (Y - 128) / 32]);
      }
    }
    return out;
  }

  /* --- the user-defined characters, lines 80 and 150-160 ------------- */
  var UDG = {
    block: [255, 255, 255, 255, 255, 255, 255, 255],   /* 224 */
    man:   [28, 28, 8, 127, 8, 20, 34, 65],            /* 225 */
    fly:   [36, 24, 60, 90, 153, 153, 165, 195],       /* 226 */
    flyHi: [0, 0, 0, 36, 102, 102, 66, 0],             /* 227 */
    mortar:[255, 8, 8, 8, 255, 64, 64, 64]             /* 228 */
  };

  /* --- SOUND and ENVELOPE, lines 40-70 ------------------------------- */
  var ENVELOPES = {
    1: [1, -10, 20, -10, 33, 33, 33, 25, -1, -1, -2, 100, 80],
    2: [1, 4, -3, 5, 40, 20, 30, 127, -1, 0, 0, 126, 0],
    3: [6, -8, -18, 7, 2, 14, 0, 0, 0, 0, 0, 0, 0],
    4: [0, 0, 0, 0, 0, 0, 67, -3, 0, -4, 126, 126, 0]
  };

  /* the instruction screen, lines 1170-1220, verbatim including the
     author's "to close to the edge" */
  var INSTRUCTIONS = [
    "You must trap the fly",
    "by surrounding it with bricks",
    "using the Z, X, : and / keys.",
    "The fly can only destroy the bricks",
    "when you drive them straight at him.",
    "Do not move the bricks to close to the",
    "edge, and don't get caught or else!!"
  ];

  /* --- saved games ---------------------------------------------------
     This browser only. Every read and write is guarded: storage can be
     absent, full, or refused outright.                                */
  var KEY = "mutantfly.save.v2";
  var save = {
    read: function () {
      try {
        var s = JSON.parse(localStorage.getItem(KEY));
        return (s && typeof s === "object") ? s : null;
      } catch (e) { return null; }
    },
    write: function (o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} },
    keep: function (level, score, best) {
      var s = this.read() || {};
      s.level = level; s.score = score;
      s.best = Math.max(best || 0, s.best || 0);
      s.deepest = Math.max(level, s.deepest || 0);
      /* when this was last written, which is how the game can tell a
         run made during the beta from one made after it */
      s.at = Date.now();
      this.write(s);
    },
    end: function (best) {
      var s = this.read() || {};
      s.best = Math.max(best || 0, s.best || 0);
      delete s.level; delete s.score;
      this.write(s);
    }
  };

  root.MutantFly = {
    Game: Game,
    COLS: COLS, ROWS: ROWS, FIELD_C: FIELD_C, FIELD_R: FIELD_R, SHEER: SHEER,
    TICK_HZ: TICK_HZ, MAX_H: MAX_H, MAX_BUILD_H: MAX_BUILD_H,
    EMPTY: EMPTY, BRICK: BRICK, TREE: TREE, MARBLE: MARBLE,
    VAT_TAR: VAT_TAR, VAT_WATER: VAT_WATER, COOLED: COOLED, CHOPPER: CHOPPER,
    ROCK: ROCK, ROCK_WEIGHT: ROCK_WEIGHT, PUSH_POWER: PUSH_POWER,
    MADE: MADE, MAX_MADE: MAX_MADE, DEALABLE: DEALABLE,
    DRAG: DRAG, DRAG_WOOD: DRAG_WOOD, RESIST_TURN: RESIST_TURN, SLOPE_TAN: SLOPE_TAN,
    DRY: DRY, WATER: WATER, TAR: TAR,
    NOTHING: NOTHING, BOOTS: BOOTS, FROST: FROST, SAW: SAW, JAR: JAR, ITEMS: ITEMS,
    levelOf: levelOf, monstersFor: monstersFor, featuresFor: featuresFor,
    DROP: DROP, WALL: WALL, luck: luck, briefingFor: briefingFor, BRIEFINGS: BRIEFINGS, leashCells: leashCells, palette: palette, bonusFor: bonusFor,
    MONSTERS: MONSTERS, MONSTER_ORDER: MONSTER_ORDER,
    titleCells: titleCells, TITLE_DATA: TITLE_DATA,
    UDG: UDG, ENVELOPES: ENVELOPES, INSTRUCTIONS: INSTRUCTIONS,
    save: save, mulberry32: mulberry32, TREE_STRENGTH: TREE_STRENGTH,
    frictionOn: frictionOn,
    PHYSICAL: ["#000000", "#ff0000", "#00ff00", "#ffff00",
               "#0000ff", "#ff00ff", "#00ffff", "#ffffff"]
  };
})(typeof window !== "undefined" ? window : globalThis);
