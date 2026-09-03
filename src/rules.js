/* =====================================================================
   MUTANT FLY - the rules
   Ported from the original BBC BASIC.

   Source: FLY, by John Mc Cauley, (C) The Micro User. 125 lines, 10-1240,
   detokenised from the Database Publications cassette for The Micro User
   volume 3 issue 5 (July 1985) - the tape advertised in that issue as
   "JULY: Fly. Take on mutant flies in this arcade spectacular."

   Everything here follows the listing rather than the magazine article,
   which describes the game loosely and in two places incorrectly. The
   line numbers in the comments are the original's.

   The original ran in MODE 1 and did all its collision detection with
   POINT() against the screen: colour 2 meant "brick". This port keeps a
   grid instead, but every rule below is the rule the BASIC implements.
   ===================================================================== */
(function (root) {
  "use strict";

  /* --- geometry -----------------------------------------------------
     The original worked in BBC graphics units: 32 units to a character
     cell. The man was bounded by X%>96 / X%<1152 (line 230,240) and
     Y%>128 / Y%<928 (250,260), giving a playfield 34 cells across and
     26 down. Bricks were scattered from the PA%() table (line 100),
     which holds 160,192,...1088 - so bricks land in the inner 30x23.  */
  var COLS = 34, ROWS = 26;
  var BRICK_C0 = 2, BRICK_C1 = 31;      /* PA%(1..30) = X 160..1088 */
  var BRICK_R0 = 1, BRICK_R1 = 23;      /* PA%(1..23) = Y 160..864  */

  var EMPTY = 0, BRICK = 1;

  /* The cassette edition has no frame limiter and runs as fast as BASIC
     manages. The disc conversion added one - `210 T%=TIME+5` with
     `380 REPEAT UNTIL TIME>T%`, TIME being centiseconds - which pins the
     main loop at 20 turns a second. That is the rate used here.        */
  var TICK_HZ = 20;

  /* line 130: X%=608 Y%=576, X1%=576 Y1%=512 */
  var MAN_C0 = 16, MAN_R0 = 14, FLY_C0 = 15, FLY_R0 = 12;

  /* --- PROCset_level, lines 890-990 ---------------------------------
     PE% is the number of bricks. PA% is the fly's leash: see step().
     (The listing really does use PA% for both this scalar and the
     brick-position array PA%(); BBC BASIC keeps them apart.)          */
  var LEVELS = [
    /* F%  PE%  PA% */
    [1, 200, 400], [2, 175, 300], [3, 150, 200], [4, 125, 150], [5, 100, 100],
    [6,  75,  75], [7,  50,  50], [8,  40,  40], [9,  30,  30]
  ];
  function levelOf(F) {
    if (F >= 10) return { PE: 20, PA: 0 };          /* line 990 */
    var row = LEVELS[F - 1] || LEVELS[0];
    return { PE: row[1], PA: row[2] };
  }

  /* The leash is in graphics units; 32 of them to a cell. */
  function leashCells(PA) { return PA / 32; }

  /* --- the palette shifts as you descend, lines 1000-1020 -----------
     VDU19 remaps logical 0 (the floor) and, from level 6, logical 1
     (the brick body). Physical colours are the BBC's own numbering.   */
  function palette(F) {
    var floor = 3;                                  /* yellow, line 150 */
    if (F >= 3) floor = 5;                          /* magenta          */
    if (F >= 6) floor = 6;                          /* cyan             */
    if (F >= 8) floor = 5;                          /* magenta again    */
    return {
      floor: floor,
      brick: (F >= 6) ? 4 : 1,                      /* blue from 6, else red */
      mortar: 7,                                    /* white, line 170  */
      figure: 0                                     /* black, line 150  */
    };
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

  function Game() {
    this.HI = 0;
    this.grid = new Uint8Array(COLS * ROWS);
    this.reset(1);
  }

  Game.prototype.idx = function (c, r) { return r * COLS + c; };
  Game.prototype.inField = function (c, r) {
    return c >= 0 && r >= 0 && c < COLS && r < ROWS;
  };
  Game.prototype.brickAt = function (c, r) {
    return this.inField(c, r) && this.grid[this.idx(c, r)] === BRICK;
  };

  /* line 110-140 plus PROCset_level / PROCprint_bricks */
  Game.prototype.reset = function (startLevel) {
    this.F = startLevel || 1;
    this.SC = 0;
    this.CO = 0;
    this.over = false;
    this.won = false;
    this.sheet();
  };

  /* PROCnext_sheet, line 860, and PROCprint_bricks, line 810 */
  Game.prototype.sheet = function () {
    if (this.SC > this.HI) this.HI = this.SC;       /* line 1030 */
    var lv = levelOf(this.F);
    this.PE = lv.PE;
    this.PA = lv.PA;
    this.CO = 0;
    this.grid.fill(EMPTY);

    this.manC = MAN_C0; this.manR = MAN_R0;
    this.flyC = FLY_C0; this.flyR = FLY_R0;

    /* line 820-840: PE% bricks, each dropped on a square that is not
       already a brick. The original does not avoid the man or the fly;
       the fly simply erases whatever it is standing on when it moves.  */
    var placed = 0, guard = 0;
    while (placed < this.PE && guard++ < 200000) {
      var c = BRICK_C0 + ((Math.random() * (BRICK_C1 - BRICK_C0 + 1)) | 0);
      var r = BRICK_R0 + ((Math.random() * (BRICK_R1 - BRICK_R0 + 1)) | 0);
      if (this.grid[this.idx(c, r)] === BRICK) continue;
      if (c === this.flyC && r === this.flyR) continue;
      if (c === this.manC && r === this.manR) continue;
      this.grid[this.idx(c, r)] = BRICK;
      placed++;
    }
    this.bricks = placed;
  };

  /* --- one turn of the main loop, lines 200-390 ---------------------
     dir is "left" | "right" | "up" | "down" | null.
     Order matters and is the original's: the man moves and shoves,
     then the fly moves, then CO% counts up, then the game is tested.  */
  Game.prototype.step = function (dir) {
    var ev = { moved: false, pushed: 0, lostOverEdge: 0, crunched: 0,
               flyMoved: false, won: false, lost: false, bonus: 0 };
    if (this.over || this.won) return ev;

    /* ---- the man, lines 230-260 ---------------------------------- */
    var d = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] }[dir];
    if (d) {
      var nc = this.manC + d[0], nr = this.manR + d[1];
      if (this.inField(nc, nr)) {                   /* the bounds tests */
        this.manC = nc; this.manR = nr;             /* he always moves  */
        ev.moved = true;

        if (this.grid[this.idx(nc, nr)] === BRICK) {
          /* line 230: REPEAT J%=J%+32 UNTIL POINT(...)<>2 - count the
             run of bricks starting under him and find the first square
             that is not a brick.                                       */
          var n = 0, cc = nc, rr = nr;
          while (this.brickAt(cc, rr)) { n++; cc += d[0]; rr += d[1]; }

          /* PROCmove_bricks, line 410: the run shifts one square into
             that first free square. Three things can be standing there. */
          if (!this.inField(cc, rr)) {
            /* off the edge of the cellar. The original drew the brick
               outside the graphics viewport, where it was clipped away
               and never came back.                                     */
            ev.lostOverEdge = 1;
            this.bricks--;
          } else if (cc === this.flyC && rr === this.flyR) {
            /* driven straight at the fly. The brick lands on its square
               and the fly wipes that square the moment it moves, so the
               leading brick - and only the leading brick - is lost.     */
            ev.crunched = 1;
            this.bricks--;
          } else {
            this.grid[this.idx(cc, rr)] = BRICK;
          }
          this.grid[this.idx(nc, nr)] = EMPTY;      /* he stands here now */
          ev.pushed = n;
        }
      }
    }

    /* ---- the fly, lines 300-340 ----------------------------------
       One random direction per turn. It moves only if the square is
       not a brick AND the move keeps it inside a box of half-width
       PA% around the man. That box is the whole of the fly's
       intelligence: at level 1 it is 12 squares and the fly wanders,
       at level 10 it is nothing and the fly can only close on you.   */
    var R = 1 + ((Math.random() * 4) | 0);
    var leash = leashCells(this.PA);
    var fc = this.flyC, fr = this.flyR;
    if (R === 1 && fc > 0 && fc > this.manC - leash && !this.brickAt(fc - 1, fr)) fc--;
    else if (R === 2 && fc < COLS - 1 && fc < this.manC + leash && !this.brickAt(fc + 1, fr)) fc++;
    else if (R === 3 && fr > 0 && fr > this.manR - leash && !this.brickAt(fc, fr - 1)) fr--;
    else if (R === 4 && fr < ROWS - 1 && fr < this.manR + leash && !this.brickAt(fc, fr + 1)) fr++;
    if (fc !== this.flyC || fr !== this.flyR) {
      this.flyC = fc; this.flyR = fr;
      ev.flyMoved = true;
    }

    this.CO++;                                       /* line 370 */

    /* ---- line 380 -------------------------------------------------
       Caught if they share a square. Trapped if all four orthogonal
       neighbours are bricks - the edge of the cellar does NOT count,
       so a corner is no help. Four real bricks or nothing.           */
    if (this.manC === this.flyC && this.manR === this.flyR) {
      ev.lost = true; this.over = true;
      this.SC = 0;                                   /* PROCloss, line 480 */
    } else if (this.brickAt(this.flyC + 1, this.flyR) &&
               this.brickAt(this.flyC - 1, this.flyR) &&
               this.brickAt(this.flyC, this.flyR + 1) &&
               this.brickAt(this.flyC, this.flyR - 1)) {
      ev.won = true; this.won = true;
      /* PROCwin, lines 570-580. The high score is deliberately NOT
         touched here: the original only compares it in PROCset_level
         (line 1030), which runs on the next sheet. Since PROCloss wipes
         SC% to zero first, a run that dies before clearing a sheet
         contributes nothing to HI%. That is the original's behaviour.  */
      if (this.CO < 800) { ev.bonus = bonusFor(this.CO); this.SC += ev.bonus; }
      this.SC += this.F * 50;
    }
    return ev;
  };

  /* called after the win has been shown - line 610 PROCnext_sheet */
  Game.prototype.nextSheet = function () {
    this.F++;
    this.won = false;
    this.sheet();
  };

  /* --- the user-defined characters, lines 80 and 150-160 -------------
     Eight bytes each, exactly as the original VDU23 statements.
     224 is a solid block, used both as the eraser and as the body of a
     brick; 228 is the mortar drawn over it in another colour; 225 is
     the man; 226 and 227 are the fly, overlaid in two colours.        */
  var UDG = {
    block: [255, 255, 255, 255, 255, 255, 255, 255],   /* 224 */
    man:   [28, 28, 8, 127, 8, 20, 34, 65],            /* 225 */
    fly:   [36, 24, 60, 90, 153, 153, 165, 195],       /* 226 */
    flyHi: [0, 0, 0, 36, 102, 102, 66, 0],             /* 227 */
    mortar:[255, 8, 8, 8, 255, 64, 64, 64]             /* 228 */
  };

  /* --- SOUND and ENVELOPE, lines 40-70 -------------------------------
     The four envelopes exactly as the listing declares them.          */
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

  root.MutantFly = {
    Game: Game,
    COLS: COLS, ROWS: ROWS, EMPTY: EMPTY, BRICK: BRICK, TICK_HZ: TICK_HZ,
    levelOf: levelOf, leashCells: leashCells, palette: palette,
    bonusFor: bonusFor,
    UDG: UDG, ENVELOPES: ENVELOPES, INSTRUCTIONS: INSTRUCTIONS,
    /* the BBC's eight physical colours */
    PHYSICAL: ["#000000", "#ff0000", "#00ff00", "#ffff00",
               "#0000ff", "#ff00ff", "#00ffff", "#ffffff"]
  };
})(typeof window !== "undefined" ? window : globalThis);
