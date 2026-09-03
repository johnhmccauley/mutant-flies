import os
p = os.path.join(os.path.dirname(__file__), "..", "src", "rules.js")
s = open(p, encoding="utf-8").read()
orig = len(s)

def rep(a, b):
    global s
    assert a in s, "MISSING: " + a[:110]
    s = s.replace(a, b, 1)

# ------------------------------------------------------------------
# the tail has to go somewhere it fits
# ------------------------------------------------------------------
rep("""    /* The 1985 fly is one square: VDU 226 and 227 are two characters
       drawn at the SAME graphics position in two colours, not two cells.
       It only lies across two squares in the deep cellars. */
    if (!this.classic && MONSTERS[kind].size === 2) {
      m.tc = Math.max(1, c - 1); m.tr = r;
    }""",
"""    /* The 1985 fly is one square: VDU 226 and 227 are two characters
       drawn at the SAME graphics position in two colours, not two cells.
       It only lies across two squares in the deep cellars.

       The tail needs a square it actually fits on. Dropping it blindly
       behind the head buried it in whatever was already there. */
    if (!this.classic && MONSTERS[kind].size === 2) {
      var D = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var d = 0; d < 4; d++) {
        var tc = c + D[d][0], tr = r + D[d][1];
        if (this.inField(tc, tr) && this.grid[this.idx(tc, tr)] === EMPTY &&
            !this.monsterAt(tc, tr)) { m.tc = tc; m.tr = tr; break; }
      }
      /* nowhere at all to lie: it is one square today */
    }""")

# ------------------------------------------------------------------
# nothing may start walled in, and something must always be loose
# ------------------------------------------------------------------
rep("""    for (var round = 0; round < 6; round++) {
      for (var settleN = 0; settleN < MAX_H * 8; settleN++) if (!this.slideBricks(null)) break;
      var opened = false;
      for (var mi = 0; mi < this.monsters.length; mi++)
        if (this.isBoxed(this.monsters[mi])) opened = this.freeUp(this.cellsOf(this.monsters[mi])) || opened;
      if (this.penned(this.manC, this.manR)) opened = this.freeUp([[this.manC, this.manR]]) || opened;
      if (!opened) break;
    }
  };""",
"""    for (var round = 0; round < 8; round++) {
      for (var settleN = 0; settleN < MAX_H * 8; settleN++) if (!this.slideBricks(null)) break;
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
  };""")

# ------------------------------------------------------------------
# trapped is a state it is in, not a state it is put into
# ------------------------------------------------------------------
rep("""  Game.prototype.settle = function (ev) {
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (!m.trapped && !m.gone && this.isBoxed(m)) { m.trapped = true; ev.trappedNow.push(m); }
    }
  };""",
"""  /* Being walled in is a state it is in, not something done to it once.
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
  };""")

rep("""               blocked: false, chopped_brick: 0, squashed: [], slid: 0,
               treesDown: 0 };""",
"""               blocked: false, chopped_brick: 0, squashed: [], slid: 0,
               treesDown: 0, freed: [] };""")

open(p, "w", encoding="utf-8", newline="").write(s)
print("tail placement, guaranteed way out, reversible trapping: " + str(orig) + " -> " + str(len(s)))
