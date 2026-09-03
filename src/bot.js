/* =====================================================================
   THE BOT

   It drives the man when AI play is switched on, it drives the robots,
   and it is how the game gets playtested - tools/playtest.js runs it over
   a few hundred cellars and reports which of the things in them actually
   come up in play.

   The first version could only shove a brick that already happened to be
   sitting one square behind where it wanted one. That is a rare accident,
   so it built almost nothing: with the monsters frozen solid and harmless
   it still walled in nothing at all, which is how the problem got found.
   Shoving a brick across a room is the whole game, so that is what this
   does now.

   The search runs backwards. From a square that needs a brick, work out
   every square a brick could be pushed FROM to arrive there - one push
   back, two pushes back, and so on - stopping each branch when it reaches
   a square that has a brick on it now. One sweep gives the nearest usable
   brick, and the first shove to make, for every needed square at once.
   Whether the man can actually get to the pushing spot is checked only
   for the shove it settles on, which keeps the whole thing to one grid
   sweep and one route per turn.
   ===================================================================== */
(function (root) {
  "use strict";
  var MF = root.MutantFly;
  var D = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };
  var ORDER = ["left", "right", "up", "down"];

  function idx(c, r) { return r * MF.COLS + c; }
  function empty(g, c, r) { return g.inField(c, r) && g.grid[idx(c, r)] === MF.EMPTY; }
  function brick(g, c, r) { return g.inField(c, r) && g.grid[idx(c, r)] === MF.BRICK; }

  /* anywhere something loose could be standing next turn. Nothing can
     while the frost holds, which is the point of a frost jar - without
     this it spends the whole fifty turns running away from things that
     cannot move. */
  function danger(g, c, r) {
    if (g.frost > 0) return false;
    for (var i = 0; i < g.monsters.length; i++) {
      var m = g.monsters[i];
      if (m.trapped || m.gone) continue;
      var cs = g.cellsOf(m);
      for (var k = 0; k < cs.length; k++)
        if (Math.abs(cs[k][0] - c) + Math.abs(cs[k][1] - r) <= 1) return true;
    }
    return false;
  }

  /* Walkable. Danger is about being NEXT to something; this is about
     being ON it, which is fatal whatever else is true - including under
     the frost, where nothing is dangerous but everything is still solid
     enough to walk into and die on. */
  function walkable(g, c, r) {
    return empty(g, c, r) && !g.monsterAt(c, r);
  }

  /* the first step of the way there on foot, round bricks not through */
  function route(g, sc, sr, tc, tr, allowDanger) {
    if (sc === tc && sr === tr) return null;
    var seen = {}, q = [[sc, sr, null]], head = 0;
    seen[sc + "," + sr] = 1;
    while (head < q.length) {
      var cur = q[head++];
      for (var i = 0; i < 4; i++) {
        var d = D[ORDER[i]];
        var nc = cur[0] + d[0], nr = cur[1] + d[1], key = nc + "," + nr;
        if (seen[key]) continue;
        if (!walkable(g, nc, nr)) continue;
        if (!allowDanger && danger(g, nc, nr) && !(nc === tc && nr === tr)) continue;
        var first = cur[2] === null ? ORDER[i] : cur[2];
        if (nc === tc && nr === tr) return first;
        seen[key] = 1;
        q.push([nc, nr, first]);
      }
    }
    return null;
  }

  /* squares that still need a brick on them for something to be walled */
  function wanted(g) {
    var out = [];
    for (var i = 0; i < g.monsters.length; i++) {
      var m = g.monsters[i];
      if (m.trapped || m.gone) continue;
      var cs = g.cellsOf(m);
      for (var k = 0; k < cs.length; k++) for (var d = 0; d < 4; d++) {
        var dd = D[ORDER[d]];
        var tc = cs[k][0] + dd[0], tr = cs[k][1] + dd[1];
        if (!g.inField(tc, tr)) continue;        /* the cellar edge is no help */
        if (g.isPartOf(m, tc, tr) || g.solid(tc, tr) || g.monsterAt(tc, tr)) continue;
        out.push([tc, tr]);
      }
    }
    return out;
  }

  /* Backwards from every wanted square at once. Returns the cheapest
     shove that starts a brick on its way there, or null. */
  function findShove(g, ac, ar, targets) {
    targets = targets || wanted(g);
    if (!targets.length) return [];

    var dist = new Int16Array(MF.COLS * MF.ROWS);
    dist.fill(-1);
    var q = [], head = 0, t;
    for (t = 0; t < targets.length; t++) {
      var ti = idx(targets[t][0], targets[t][1]);
      if (dist[ti] !== -1) continue;
      dist[ti] = 0;
      q.push(targets[t]);
    }

    var best = [];
    while (head < q.length) {
      var cell = q[head++];
      var xc = cell[0], xr = cell[1], k = dist[idx(xc, xr)];
      if (k > 20) break;                        /* further is not worth it */
      for (var i = 0; i < 4; i++) {
        var d = D[ORDER[i]];
        /* to arrive at (xc,xr) going in direction d, the brick was one
           square back and the man one square back of that */
        var pc = xc - d[0], pr = xr - d[1];
        var sc = pc - d[0], sr = pr - d[1];
        if (!g.inField(pc, pr) || !g.inField(sc, sr)) continue;
        if (!empty(g, sc, sr) && !(sc === ac && sr === ar)) continue;
        /* the monsters are not in the grid, so an empty-looking square
           can still have one standing on it - and it stalled for eighty
           turns trying to walk to a square the fly was lying on */
        if (g.monsterAt(sc, sr)) continue;

        if (brick(g, pc, pr)) {
          var cost = (k + 1) * 3 + Math.abs(sc - ac) + Math.abs(sr - ar)
                   + (danger(g, sc, sr) ? 30 : 0);
          best.push({ standC: sc, standR: sr, dir: ORDER[i], cost: cost, pushes: k + 1 });
          continue;
        }
        if (!empty(g, pc, pr)) continue;
        /* A brick cannot be pushed THROUGH a monster - the monster eats
           it. The monsters are not in the grid, so without this the
           search routed bricks straight through them and the bot spent
           the cellar feeding them one brick at a time. */
        if (g.monsterAt(pc, pr)) continue;
        var pi = idx(pc, pr);
        if (dist[pi] !== -1) continue;
        dist[pi] = k + 1;
        q.push([pc, pr]);
      }
    }
    best.sort(function (a, b) { return a.cost - b.cost; });
    return best;
  }

  /* One move, worked out fresh every turn. Planning a whole route and
     then walking it blind came apart the moment anything refused a step -
     straining uphill, a shove that would not go, a brick sliding out from
     under the plan - and it would carry on walking the rest of the route
     from the wrong square and shove into thin air. */
  function think(g, actor) {
    var ac = actor ? actor.c : g.manC, ar = actor ? actor.r : g.manR;

    if (danger(g, ac, ar)) {
      var flee = null, far = -1;
      for (var i = 0; i < 4; i++) {
        var d = D[ORDER[i]];
        var nc = ac + d[0], nr = ar + d[1];
        if (!walkable(g, nc, nr) || danger(g, nc, nr)) continue;
        var near = 99;
        for (var j = 0; j < g.monsters.length; j++) {
          var m = g.monsters[j];
          if (m.trapped || m.gone) continue;
          near = Math.min(near, Math.abs(m.c - nc) + Math.abs(m.r - nr));
        }
        if (near > far) { far = near; flee = ORDER[i]; }
      }
      if (flee) return flee;
    }

    /* Try them in order and take the first the man can actually get to.
       Keeping only the single cheapest meant one unreachable spot froze
       it on the spot for the rest of the cellar. */
    var shoves = findShove(g, ac, ar, null);
    for (var s = 0; s < shoves.length && s < 16; s++) {
      var sh = shoves[s];
      if (sh.standC === ac && sh.standR === ar) return sh.dir;
      var step = route(g, ac, ar, sh.standC, sh.standR, false);
      if (step) return step;
    }
    for (var s2 = 0; s2 < shoves.length && s2 < 8; s2++) {
      var sh2 = shoves[s2];
      var step2 = route(g, ac, ar, sh2.standC, sh2.standR, true);
      if (step2) return step2;
    }

    /* nothing to shove that helps - keep out of the way */
    var away = null, awayD = -1;
    for (var k2 = 0; k2 < 4; k2++) {
      var dd = D[ORDER[k2]];
      var wc = ac + dd[0], wr = ar + dd[1];
      if (!walkable(g, wc, wr) || danger(g, wc, wr)) continue;
      var sum = 0;
      for (var q2 = 0; q2 < g.monsters.length; q2++) {
        var mm = g.monsters[q2];
        if (mm.trapped || mm.gone) continue;
        sum += Math.abs(mm.c - wc) + Math.abs(mm.r - wr);
      }
      if (sum > awayD) { awayD = sum; away = ORDER[k2]; }
    }
    return away;
  }

  root.MutantBot = { think: think, findShove: findShove, wanted: wanted,
                     route: route, danger: danger, walkable: walkable,
                     empty: empty, brick: brick, D: D, ORDER: ORDER, idx: idx };
})(typeof window !== "undefined" ? window : globalThis);
