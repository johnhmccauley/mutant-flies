/* =====================================================================
   STRATEGIES

   Different ideas about how to play, so they can be raced against each
   other over identical cellars rather than argued about.
   tools/tournament.js runs the lot and prints the table.

   The one thing every strategy has to work around is that PA% is a leash
   on the MAN: a monster may only take a step that keeps it inside a box
   PA% wide centred on you. It is not chasing you - it is tethered to you.
   Which means where you stand decides where it can be, and standing still
   in a corner drags it into that corner whether it likes it or not. Some
   of these use that and some do not, which is rather the point.
   ===================================================================== */
(function (root) {
  "use strict";
  var MF = root.MutantFly, B = root.MutantBot;
  var D = B.D, ORDER = B.ORDER;

  function loose(g) {
    var out = [];
    for (var i = 0; i < g.monsters.length; i++) {
      var m = g.monsters[i];
      if (!m.trapped && !m.gone) out.push(m);
    }
    return out;
  }
  function nearest(g, c, r) {
    var all = loose(g), best = null, bd = 1e9;
    for (var i = 0; i < all.length; i++) {
      var cs = g.cellsOf(all[i]);
      for (var k = 0; k < cs.length; k++) {
        var d = Math.abs(cs[k][0] - c) + Math.abs(cs[k][1] - r);
        if (d < bd) { bd = d; best = all[i]; }
      }
    }
    return best ? { m: best, dist: bd } : null;
  }
  /* squares on a ring at `rad` around everything still loose */
  function ring(g, rad) {
    var out = [], seen = {};
    var all = loose(g);
    for (var i = 0; i < all.length; i++) {
      var cs = g.cellsOf(all[i]);
      for (var k = 0; k < cs.length; k++) {
        for (var dc = -rad; dc <= rad; dc++) for (var dr = -rad; dr <= rad; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          var c = cs[k][0] + dc, r = cs[k][1] + dr, key = c + "," + r;
          if (seen[key]) continue;
          if (!g.inField(c, r) || !B.empty(g, c, r) || g.monsterAt(c, r)) continue;
          seen[key] = 1;
          out.push([c, r]);
        }
      }
    }
    return out;
  }
  function step(g, ac, ar, targets) {
    var shoves = B.findShove(g, ac, ar, targets);
    for (var s = 0; s < shoves.length && s < 16; s++) {
      var sh = shoves[s];
      if (sh.standC === ac && sh.standR === ar) return sh.dir;
      var st = B.route(g, ac, ar, sh.standC, sh.standR, false);
      if (st) return st;
    }
    return null;
  }
  function flee(g, ac, ar) {
    var best = null, far = -1;
    for (var i = 0; i < 4; i++) {
      var d = D[ORDER[i]];
      var nc = ac + d[0], nr = ar + d[1];
      if (!B.walkable(g, nc, nr) || B.danger(g, nc, nr)) continue;
      var n = nearest(g, nc, nr);
      var v = n ? n.dist : 99;
      if (v > far) { far = v; best = ORDER[i]; }
    }
    return best;
  }
  function drift(g, ac, ar, tc, tr) {
    var st = B.route(g, ac, ar, tc, tr, false);
    return st || flee(g, ac, ar);
  }

  var S = {};

  /* ---- what the bot did before: fill the squares touching it -------- */
  S.touching = function (g) {
    return B.think(g, null);
  };

  /* ---- your idea: a big box first, then squeeze it in -------------- */
  S.containment = function (g) {
    var ac = g.manC, ar = g.manR;
    if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }
    for (var rad = 3; rad >= 1; rad--) {
      var t = ring(g, rad);
      if (!t.length) continue;
      var mv = step(g, ac, ar, t);
      if (mv) return mv;
    }
    return B.think(g, null);
  };

  /* ---- only build while it is not breathing on you ------------------ */
  S.patient = function (g) {
    var ac = g.manC, ar = g.manR;
    var n = nearest(g, ac, ar);
    if (n && n.dist <= 3) { var f = flee(g, ac, ar); if (f) return f; }
    return B.think(g, null);
  };

  /* ---- go and stand in a corner: the leash drags it in after you ---- */
  S.corner = function (g) {
    var ac = g.manC, ar = g.manR;
    var corners = [[3, 3], [MF.COLS - 4, 3], [3, MF.ROWS - 4], [MF.COLS - 4, MF.ROWS - 4]];
    var best = corners[0], bd = 1e9;
    for (var i = 0; i < corners.length; i++) {
      var d = Math.abs(corners[i][0] - ac) + Math.abs(corners[i][1] - ar);
      if (d < bd) { bd = d; best = corners[i]; }
    }
    if (bd > 2) {
      if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }
      var mv = drift(g, ac, ar, best[0], best[1]);
      if (mv) return mv;
    }
    return S.containment(g);
  };

  /* ---- corner first, then squeeze - the two ideas together ---------- */
  S.corralled = function (g) {
    var ac = g.manC, ar = g.manR;
    var n = nearest(g, ac, ar);
    if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }
    /* while it is far off, close the ring; when it is close, work */
    if (n && n.dist > 6) {
      var far = step(g, ac, ar, ring(g, 3));
      if (far) return far;
    }
    for (var rad = 2; rad >= 1; rad--) {
      var mv = step(g, ac, ar, ring(g, rad));
      if (mv) return mv;
    }
    return B.think(g, null);
  };

  /* ---- fetch a frost jar first, then build in the quiet ------------- */
  S.frostfirst = function (g) {
    var ac = g.manC, ar = g.manR;
    if (g.frost > 0) return S.containment(g);
    var bestC = -1, bestR = -1, bd = 1e9;
    for (var r = 0; r < MF.ROWS; r++) for (var c = 0; c < MF.COLS; c++) {
      var it = g.item[B.idx(c, r)];
      if (it !== MF.FROST && it !== MF.BOOTS) continue;
      var d = Math.abs(c - ac) + Math.abs(r - ar);
      if (d < bd) { bd = d; bestC = c; bestR = r; }
    }
    if (bestC >= 0 && bd < 25) {
      if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }
      var st = B.route(g, ac, ar, bestC, bestR, false);
      if (st) return st;
    }
    return S.containment(g);
  };

  /* ---- never stand next to anything, ever -------------------------- */
  S.timid = function (g) {
    var ac = g.manC, ar = g.manR;
    var n = nearest(g, ac, ar);
    if (n && n.dist <= 5) { var f = flee(g, ac, ar); if (f) return f; }
    return S.containment(g);
  };


  /* ------------------------------------------------------------------
     Pockets.

     Every strategy above gets three of the walls up and then cannot close
     the last one, because the thing simply walks out of the gap while you
     are fetching the brick for it. You cannot wall something that is
     moving. What you can do is find a hole that is already walled on
     three sides - an ordinary cellar has about nineteen of them - get the
     monster into it, and plug the mouth with one shove.

     And the leash is how you get it in there. It is tethered to you, not
     chasing you, so standing on the far side of a pocket pulls it in.
     ------------------------------------------------------------------ */
  function mouthOf(g, cells) {
    var mouth = null, count = 0;
    for (var i = 0; i < cells.length; i++) {
      for (var d = 0; d < 4; d++) {
        var dd = D[ORDER[d]];
        var nc = cells[i][0] + dd[0], nr = cells[i][1] + dd[1];
        var inside = false;
        for (var k = 0; k < cells.length; k++)
          if (cells[k][0] === nc && cells[k][1] === nr) inside = true;
        if (inside) continue;
        /* good stone is a side; a drop is a hole in the room */
        if (!g.inField(nc, nr)) {
          if (g.edgeAt(nc, nr) === MF.WALL) continue;
          return null;
        }
        if (g.solid(nc, nr)) continue;
        count++;
        mouth = [nc, nr];
      }
    }
    return count === 1 ? mouth : null;
  }

  /* holes of exactly the right size with exactly one way in */
  function pockets(g, size) {
    var out = [];
    for (var r = 1; r < MF.ROWS - 1; r++) for (var c = 1; c < MF.COLS - 1; c++) {
      if (!B.empty(g, c, r)) continue;
      if (size === 1) {
        var m1 = mouthOf(g, [[c, r]]);
        if (m1) out.push({ cells: [[c, r]], mouth: m1 });
      } else {
        for (var d = 0; d < 2; d++) {                /* right and up only */
          var dd = D[ORDER[d === 0 ? 1 : 2]];
          var c2 = c + dd[0], r2 = r + dd[1];
          if (!B.empty(g, c2, r2)) continue;
          var m2 = mouthOf(g, [[c, r], [c2, r2]]);
          if (m2) out.push({ cells: [[c, r], [c2, r2]], mouth: m2 });
        }
      }
    }
    return out;
  }

  function sitsIn(g, m, pocket) {
    var cs = g.cellsOf(m);
    for (var i = 0; i < cs.length; i++) {
      var found = false;
      for (var k = 0; k < pocket.cells.length; k++)
        if (pocket.cells[k][0] === cs[i][0] && pocket.cells[k][1] === cs[i][1]) found = true;
      if (!found) return false;
    }
    return true;
  }

  S.pocket = function (g) {
    var ac = g.manC, ar = g.manR;
    var all = loose(g);
    if (!all.length) return null;

    /* anything already in a hole: plug it, now */
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      var ps = pockets(g, g.cellsOf(m).length);
      for (var p = 0; p < ps.length; p++) {
        if (!sitsIn(g, m, ps[p])) continue;
        var mv = step(g, ac, ar, [ps[p].mouth]);
        if (mv) return mv;
      }
    }

    if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }

    /* otherwise herd: stand the far side of the nearest hole to it, so
       its leash has to take it that way */
    var n = nearest(g, ac, ar);
    if (n) {
      var holes = pockets(g, g.cellsOf(n.m).length);
      var best = null, bd = 1e9;
      for (var h = 0; h < holes.length; h++) {
        var cell = holes[h].cells[0];
        var d2 = Math.abs(cell[0] - n.m.c) + Math.abs(cell[1] - n.m.r);
        if (d2 < bd) { bd = d2; best = holes[h]; }
      }
      if (best) {
        /* the spot beyond the hole, on the line from the monster */
        var cell0 = best.cells[0];
        var vx = cell0[0] - n.m.c, vy = cell0[1] - n.m.r;
        var len = Math.max(1, Math.abs(vx) + Math.abs(vy));
        var tx = Math.round(cell0[0] + (vx / len) * 3);
        var ty = Math.round(cell0[1] + (vy / len) * 3);
        tx = Math.max(1, Math.min(MF.COLS - 2, tx));
        ty = Math.max(1, Math.min(MF.ROWS - 2, ty));
        var st = B.route(g, ac, ar, tx, ty, false);
        if (st) return st;
      }
    }
    return S.containment(g);
  };

  /* hold the pocket line but keep tidying up walls while you wait */
  S.pocketwork = function (g) {
    var ac = g.manC, ar = g.manR;
    var all = loose(g);
    if (!all.length) return null;
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      var ps = pockets(g, g.cellsOf(m).length);
      for (var p = 0; p < ps.length; p++) {
        if (!sitsIn(g, m, ps[p])) continue;
        var mv = step(g, ac, ar, [ps[p].mouth]);
        if (mv) return mv;
      }
    }
    if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }
    var n = nearest(g, ac, ar);
    if (n && n.dist <= 4) { var f2 = flee(g, ac, ar); if (f2) return f2; }
    return S.corralled(g);
  };


  /* ------------------------------------------------------------------
     The ambush.

     `pocket` above finds the hole but is still too slow: by the time the
     monster is standing in one, the brick to plug it with is halfway
     across the cellar, and it has wandered out again before the brick
     arrives. So arm the trap first and then wait with a finger on it -
     brick already sitting beside the mouth, man already standing behind
     the brick, one keypress from closing it. The leash does the rest,
     because a monster tethered to a man standing still has nowhere to be
     but nearby, and sooner or later it blunders in.

     Which is, it turns out, how the game was meant to be played.
     ------------------------------------------------------------------ */
  function inPocket(cells, c, r) {
    for (var i = 0; i < cells.length; i++)
      if (cells[i][0] === c && cells[i][1] === r) return true;
    return false;
  }

  /* every way of plugging a hole: which way to push, where the brick has
     to be first, and where the man has to stand to push it */
  function plugs(g, p) {
    var out = [];
    for (var i = 0; i < 4; i++) {
      var d = D[ORDER[i]];
      var bc = p.mouth[0] - d[0], br = p.mouth[1] - d[1];   /* brick waits here */
      var kc = bc - d[0], kr = br - d[1];                   /* man waits here */
      if (!g.inField(bc, br) || !g.inField(kc, kr)) continue;
      if (inPocket(p.cells, bc, br) || inPocket(p.cells, kc, kr)) continue;
      if (!B.empty(g, bc, br) && !B.brick(g, bc, br)) continue;
      if (!B.empty(g, kc, kr)) continue;
      out.push({ dir: ORDER[i], bc: bc, br: br, kc: kc, kr: kr });
    }
    return out;
  }

  function armed(g, pl) { return B.brick(g, pl.bc, pl.br); }

  S.ambush = function (g) {
    var ac = g.manC, ar = g.manR;
    var all = loose(g);
    if (!all.length) return null;
    if (!g._amb) g._amb = { waited: 0, skip: {} };
    var st8 = g._amb;

    var n = nearest(g, ac, ar);
    var m = n.m, size = g.cellsOf(m).length;
    var ps = pockets(g, size);

    /* is anything sitting in a hole we can shut this turn? then shut it */
    for (var i = 0; i < ps.length; i++) {
      if (!sitsIn(g, m, ps[i])) continue;
      var pl = plugs(g, ps[i]);
      for (var k = 0; k < pl.length; k++)
        if (armed(g, pl[k]) && pl[k].kc === ac && pl[k].kr === ar) return pl[k].dir;
    }

    /* otherwise pick the hole to camp on and the way we will shut it */
    var best = null, bs = 1e9;
    for (var i2 = 0; i2 < ps.length; i2++) {
      var p = ps[i2];
      var key = p.cells[0][0] + "," + p.cells[0][1];
      if (st8.skip[key]) continue;
      var dm = Math.abs(p.cells[0][0] - m.c) + Math.abs(p.cells[0][1] - m.r);
      if (dm > 12) continue;
      var pl2 = plugs(g, p);
      for (var k2 = 0; k2 < pl2.length; k2++) {
        var q = pl2[k2];
        var score = dm * 3
                  + (armed(g, q) ? 0 : 9)
                  + Math.abs(q.kc - ac) + Math.abs(q.kr - ar);
        if (score < bs) { bs = score; best = { p: p, q: q, key: key }; }
      }
    }
    if (!best) { st8.skip = {}; return S.pocket(g); }

    /* stop camping on a hole it will plainly never walk into */
    if (st8.key !== best.key) { st8.key = best.key; st8.waited = 0; }

    var q2 = best.q;
    if (!armed(g, q2)) {
      st8.waited = 0;
      var mv = step(g, ac, ar, [[q2.bc, q2.br]]);
      if (mv) return mv;
      st8.skip[best.key] = 1;                 /* cannot arm it - try another */
      return S.pocket(g);
    }
    if (ac !== q2.kc || ar !== q2.kr) {
      var walk = B.route(g, ac, ar, q2.kc, q2.kr, false);
      if (walk) return walk;
      st8.skip[best.key] = 1;
      return S.pocket(g);
    }

    /* armed and in position. Wait - but not for ever, and not while it is
       actually breathing on us */
    st8.waited++;
    if (st8.waited > 45) { st8.skip[best.key] = 1; st8.waited = 0; }
    if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }
    return null;
  };


  /* ------------------------------------------------------------------
     The den.

     The last idea, generalised, and it is the one that finally works.

     Four bricks round a monster is the expensive way to do it, and it
     never comes off because the thing walks out of the side you have not
     built yet. But the cellar is full of squares that already have two
     solid sides. Seal one more and you have a den: a hole it can only be
     in one way out of. Then park a brick beside that mouth, stand behind
     the brick, and wait. Two bricks, not four, and the last one goes in
     while it is standing there rather than while it is on its way past.

     And the tether does the herding for you. Standing still beside the
     den keeps it inside a box centred on you, so it has nowhere to be
     but around the den - and eventually in it.
     ------------------------------------------------------------------ */
  function denAt(g, cells) {
    var free = [], seen = {};
    for (var i = 0; i < cells.length; i++) for (var d = 0; d < 4; d++) {
      var dd = D[ORDER[d]];
      var nc = cells[i][0] + dd[0], nr = cells[i][1] + dd[1];
      if (inPocket(cells, nc, nr)) continue;
      if (!g.inField(nc, nr)) {
        if (g.edgeAt(nc, nr) === MF.WALL) continue;   /* stone counts */
        return null;                                  /* a drop does not */
      }
      if (g.solid(nc, nr)) continue;
      var key = nc + "," + nr;
      if (seen[key]) continue;
      seen[key] = 1;
      free.push([nc, nr]);
    }
    return free.length ? { cells: cells, free: free } : null;
  }

  /* every hole worth three bricks or fewer, nearest the monster first */
  function dens(g, size, mc, mr, budget, radius, hug) {
    var out = [];
    for (var r = 1; r < MF.ROWS - 1; r++) for (var c = 1; c < MF.COLS - 1; c++) {
      if (Math.abs(c - mc) + Math.abs(r - mr) > radius) continue;
      if (!B.empty(g, c, r)) continue;
      var sets = [];
      if (size === 1) sets.push([[c, r]]);
      else {
        for (var e = 0; e < 2; e++) {
          var dd = D[ORDER[e === 0 ? 1 : 2]];
          if (B.empty(g, c + dd[0], r + dd[1]))
            sets.push([[c, r], [c + dd[0], r + dd[1]]]);
        }
      }
      for (var q = 0; q < sets.length; q++) {
        var den = denAt(g, sets[q]);
        if (!den || den.free.length - 1 > budget) continue;
        den.dist = Math.abs(sets[q][0][0] - mc) + Math.abs(sets[q][0][1] - mr);
        out.push(den);
      }
    }
    /* `hug` decides whether a cheap hole across the room beats a dearer
       one right where the thing is standing. Walling it where it stands
       is worth paying for: a fly picks one random direction a turn and
       simply does not move if that way is blocked, so every side you
       build takes another quarter of its speed away. Enclosure feeds
       itself - which is not true of a hole it has to walk to. */
    out.sort(function (a, b) {
      return (a.free.length * 3 + a.dist * hug) - (b.free.length * 3 + b.dist * hug);
    });
    return out;
  }

  /* pick which of the open sides stays open, and how it gets shut */
  function mouthPlan(g, den) {
    for (var i = 0; i < den.free.length; i++) {
      var mouth = den.free[i];
      var pl = plugs(g, { cells: den.cells, mouth: mouth });
      if (!pl.length) continue;
      var seal = [];
      for (var k = 0; k < den.free.length; k++)
        if (k !== i) seal.push(den.free[k]);
      return { mouth: mouth, seal: seal, plug: pl[0], alts: pl };
    }
    return null;
  }

  function denPlay(g, o) {
    var ac = g.manC, ar = g.manR;
    var all = loose(g);
    if (!all.length) return null;
    if (!g._den) g._den = { key: null, waited: 0, skip: {} };
    var st9 = g._den;

    var n = nearest(g, ac, ar), m = n.m, size = g.cellsOf(m).length;
    var cand = dens(g, size, m.c, m.r, o.budget, o.radius, o.hug);

    /* if it is standing in something that only wants its mouth shut, shut it */
    for (var i = 0; i < cand.length && i < 40; i++) {
      var den = cand[i];
      if (!sitsIn(g, m, { cells: den.cells })) continue;
      if (den.free.length !== 1) continue;
      var pl = plugs(g, { cells: den.cells, mouth: den.free[0] });
      for (var k = 0; k < pl.length; k++) {
        if (!armed(g, pl[k])) continue;
        if (pl[k].kc === ac && pl[k].kr === ar) return pl[k].dir;
        var dash = B.route(g, ac, ar, pl[k].kc, pl[k].kr, false);
        if (dash) return dash;
      }
    }

    /* otherwise settle on one and work on it */
    var chosen = null, plan = null;
    for (var i2 = 0; i2 < cand.length && i2 < 60; i2++) {
      var d2 = cand[i2];
      var key = d2.cells[0][0] + "," + d2.cells[0][1] + ":" + d2.cells.length;
      if (st9.skip[key]) continue;
      if (g.monsterAt(d2.cells[0][0], d2.cells[0][1]) && d2.free.length > 1) continue;
      var pn = mouthPlan(g, d2);
      if (!pn) continue;
      chosen = d2; chosen.key = key; plan = pn;
      break;
    }
    if (!chosen) { st9.skip = {}; return S.pocket(g); }
    if (st9.key !== chosen.key) { st9.key = chosen.key; st9.waited = 0; }

    /* 1. wall it in to three sides */
    var need = [];
    for (var s2 = 0; s2 < plan.seal.length; s2++) {
      var t = plan.seal[s2];
      if (g.monsterAt(t[0], t[1])) continue;
      need.push(t);
    }
    if (need.length) {
      st9.waited = 0;
      var mv = step(g, ac, ar, need);
      if (mv) return mv;
      st9.skip[chosen.key] = 1;
      return denPlay(g, o);
    }

    /* 2. park the brick that will shut the mouth */
    var q3 = plan.plug;
    for (var a2 = 0; a2 < plan.alts.length; a2++)
      if (armed(g, plan.alts[a2])) { q3 = plan.alts[a2]; break; }
    if (!armed(g, q3)) {
      st9.waited = 0;
      var mv2 = step(g, ac, ar, [[q3.bc, q3.br]]);
      if (mv2) return mv2;
      st9.skip[chosen.key] = 1;
      return denPlay(g, o);
    }

    /* 3. stand behind it and wait for it to walk in */
    if (ac !== q3.kc || ar !== q3.kr) {
      var walk = B.route(g, ac, ar, q3.kc, q3.kr, false);
      if (walk) return walk;
      st9.skip[chosen.key] = 1;
      return denPlay(g, o);
    }
    st9.waited++;
    if (st9.waited > o.waitCap) { st9.skip[chosen.key] = 1; st9.waited = 0; }
    if (B.danger(g, ac, ar)) { var f = flee(g, ac, ar); if (f) return f; }
    return null;
  }

  /* the knobs, so they can be raced rather than guessed at. `hug` under
     one leaves the cost of a hole dominant and lets distance break ties;
     raising it says a dearer hole where the thing is standing beats a
     cheap one across the room, which sounds right and measures wrong -
     it puts you next to the monster for the whole build. */
  S.den       = function (g) { return denPlay(g, { budget: 3, radius: 11, hug: 0.05, waitCap: 60 }); };
  S.denNear   = function (g) { return denPlay(g, { budget: 3, radius: 5,  hug: 0.05, waitCap: 60 }); };
  S.denWide   = function (g) { return denPlay(g, { budget: 3, radius: 18, hug: 0.05, waitCap: 60 }); };
  S.denPatient= function (g) { return denPlay(g, { budget: 3, radius: 11, hug: 0.05, waitCap: 150 }); };
  S.denCheap  = function (g) { return denPlay(g, { budget: 2, radius: 11, hug: 0.05, waitCap: 60 }); };
  S.denRich   = function (g) { return denPlay(g, { budget: 4, radius: 11, hug: 0.05, waitCap: 60 }); };
  S.denBest   = function (g) { return denPlay(g, { budget: 3, radius: 18, hug: 0.05, waitCap: 150 }); };
  S.denAll    = function (g) { return denPlay(g, { budget: 4, radius: 30, hug: 0.05, waitCap: 250 }); };

  root.MutantStrategies = S;
})(typeof window !== "undefined" ? window : globalThis);
