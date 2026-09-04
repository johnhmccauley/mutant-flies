/* =====================================================================
   A LEVEL, WRITTEN DOWN

   Capturing a cellar exactly as it stands and putting it back exactly as
   it was - and doing that through a string short enough to paste into a
   message.

   Which is the whole point. A level travels as a code. No server, no
   account, no upload: you make a cellar, you copy it, you send it to
   somebody, they paste it in and play it. That is how levels travelled
   in 1985 - as type-in listings in the back of a magazine - and it means
   the editor, naming, sharing and playing other people's work all
   function before a single line of server code exists.

   The one thing that does NOT go in the code is the seed. The generator
   deliberately splits what it seeds from what it deals fresh: the same
   seed gives the same landscape, trees, water and tar, but different
   bricks, a different starting square and different monsters every time.
   So a seed cannot recreate a cellar. Everything has to be written down.

   What has to be written down, verified against the engine:

     nine per-square arrays   grid height item fluid fvol sealed
                              gnaw burn stress                   884 each
     four edges               W E (26)  S N (34)
     the actors               monsters (with the fly's tail and the
                              snake's whole body), marbles, robots,
                              and any fluid still pouring
     the scalars              which cellar, how many bricks, where the
                              man is, what he is carrying

   And on the way back in, four things have to be redone by hand, because
   loading a level has to bypass the entire generator - makeEdges,
   makeHeights, smooth, makeFurniture, makePools, openSpot, the brick
   scatter, the settling loop, all of it:

     1  the seeded generator, so anything that still draws on it later
        (a snake being cut, a jar being opened) behaves
     2  the level's own numbers - bricks to lay, leash, features, timber
     3  every monster's `spec`, which is a live shared object and cannot
        survive being written to text
     4  settle(), to work out afresh which monsters are walled in
   ===================================================================== */
(function (root) {
  "use strict";
  var MF = root.MutantFly, IO = root.MutantLevelIO;
  var N = MF.COLS * MF.ROWS;

  var PLANES = ["grid", "height", "item", "fluid", "fvol", "sealed", "gnaw", "burn", "stress"];
  var SIDES = [["W", MF.ROWS], ["E", MF.ROWS], ["S", MF.COLS], ["N", MF.COLS]];

  /* ------------------------------------------------------------------
     VERSIONS, AND SURVIVING THEM

     Levels people made are going to outlive several versions of this
     game, and they will be sitting in other people's browsers and
     pasted into other people's messages when the next element gets
     added. A format that refuses anything it does not recognise turns
     every one of those into rubbish the first time the game changes.

     So there are two numbers, not one:

       v          what wrote it
       needs      the oldest reader that can still make sense of it

     A reader will load anything whose `needs` it satisfies, even from a
     version it has never heard of. Adding a new item, a new cell kind
     or a new plane does NOT raise `needs`, because a reader that skips
     what it does not know still gets a playable cellar. `needs` only
     goes up for a change that would make an old reader get the cellar
     WRONG rather than merely incomplete - and then it says so plainly
     instead of loading something subtly broken.

     Three rules keep that promise honest:

       planes are read by NAME, never by position, and a plane that is
         missing reads as zeroes - which is what every one of them means
         when it is absent
       fields nobody recognises are KEPT, not dropped, so a level opened
         in an old game and saved again does not quietly lose whatever
         the new game put in it
       old records are migrated forward on the way in, in one place,
         rather than sprinkling `if (v < 3)` through the reader
     ------------------------------------------------------------------ */
  var VERSION = 3;        /* what this writes */
  var NEEDS = 1;          /* the oldest reader that can read a PLAIN level */

  /* A level that invents its own blocks, or is a shape other than the
     whole room, or leaves things to be dealt out, cannot be read by an
     older game AT ALL - not incompletely, but WRONGLY: it would walk
     through the blocks it does not know, play the full rectangle
     instead of the shape, and find a cellar with a hundred bricks
     missing. So those three raise the bar, and an old game says so
     instead of loading something broken. Adding an item or a monster
     does not, because skipping one of those leaves a cellar that is
     merely poorer rather than wrong. */
  var NEEDS_RICH = 3;

  /* Everything a record carries that is not a plane, an edge, or an
     actor. Anything not in here is somebody else's field and is carried
     through untouched. */
  var KNOWN = ["v", "needs", "F", "cols", "rows", "cells", "edge", "man", "bricks",
               "marbleCount", "carry", "CO", "monsters", "marbles", "robots",
               "sources", "id", "name", "author", "made", "note",
               "blocks", "shape", "bound", "deal"];

  /* One step per version, applied in order. A record from v1 goes
     through migrate[2] and comes out current. */
  var MIGRATE = {
    3: function (rec) {
      /* v2 had no blocks, no shape and no deal - all three absent, all
         three meaning "the ordinary room, drawn as it stands" */
      return rec;
    },
    2: function (rec) {
      /* v1 had no `needs` and no `coins`; both are absent rather than
         wrong, which is exactly the case this whole scheme is for */
      if (rec.needs === undefined) rec.needs = 1;
      return rec;
    }
  };

  /* ---- taking a copy ------------------------------------------------ */
  function capture(g, about) {
    var rec = { v: VERSION, needs: NEEDS, F: g.F, cols: MF.COLS, rows: MF.ROWS,
                cells: {}, edge: {} };
    /* whatever a newer game put in here, put back - the level was only
       passing through */
    if (g._extra) for (var xk in g._extra) if (KNOWN.indexOf(xk) < 0) rec[xk] = g._extra[xk];
    for (var i = 0; i < PLANES.length; i++) rec.cells[PLANES[i]] = IO.packArray(g[PLANES[i]]);
    for (var s = 0; s < SIDES.length; s++) rec.edge[SIDES[s][0]] = IO.packArray(g.edge[SIDES[s][0]]);

    rec.man = [g.manC, g.manR];
    rec.bricks = g.bricks;
    rec.marbleCount = g.marbleCount;
    rec.carry = { steps: g.steps, boots: g.boots, frost: g.frost, saw: g.saw };
    rec.CO = g.CO;

    rec.monsters = g.monsters.map(function (m) {
      var out = { kind: m.kind, c: m.c, r: m.r, tick: m.tick | 0 };
      if (m.tc !== undefined) { out.tc = m.tc; out.tr = m.tr; }
      if (m.body) { out.body = m.body.map(function (b) { return [b[0], b[1]]; });
                    out.full = m.full; out.growth = m.growth | 0; }
      if (m.gone) out.gone = 1;
      if (m.crushed) out.crushed = 1;
      return out;
    });
    rec.marbles = g.marbles.filter(function (m) { return !m.gone; }).map(function (m) {
      return { c: m.c, r: m.r, dc: m.dc, dr: m.dr, v: Math.round(m.v * 100) / 100, size: m.size || 1 };
    });
    rec.robots = g.robots.filter(function (b) { return !b.gone; }).map(function (b) {
      return { c: b.c, r: b.r, size: b.size, running: !!b.running,
               power: b.power, life: b.life, wait: b.wait };
    });
    rec.sources = g.sources.map(function (s2) {
      return { c: s2.c, r: s2.r, kind: s2.kind, left: s2.left };
    });

    /* the blocks this level invented, the shape it is, and anything it
       would rather have dealt out than drawn */
    if (g.blocks && g.blocks.length) rec.blocks = g.blocks.map(cleanBlock);
    if (g.shape) rec.shape = IO.packArray(g.shape);
    if (g.bound) rec.bound = IO.packArray(g.bound);
    if (g.deal && g.deal.length) rec.deal = g.deal.map(function (d) {
      return { what: String(d.what), count: d.count | 0, how: d.how === "fresh" ? "fresh" : "fixed" };
    });
    if (rec.blocks || rec.shape || rec.deal) rec.needs = NEEDS_RICH;

    if (about) {
      /* the level's own id travels inside it, so a cellar pasted into a
         message arrives as the same level it left as */
      if (about.id) rec.id = String(about.id).slice(0, 40);
      if (about.name) rec.name = String(about.name).slice(0, 48);
      if (about.author) rec.author = about.author;
      if (about.made) rec.made = about.made;
      if (about.note) rec.note = String(about.note).slice(0, 200);
    }
    return rec;
  }

  /* A block definition, with every number pulled into a range the game
     can actually run. A weight of nought would be a block with no
     weight at all, which the push loop would count as free and let you
     shove a thousand of. */
  function cleanBlock(b) {
    var name = String((b && b.name) || "Block").slice(0, 20);
    var colour = /^#[0-9a-fA-F]{6}$/.test(b && b.colour) ? b.colour : "#8a7a5e";
    var weight = Number(b && b.weight);
    var friction = Number(b && b.friction);
    return {
      name: name, colour: colour,
      /* a quarter of a stone - a brick - up to two, which is the most a
         man can move at all */
      weight: Math.max(0.25, Math.min(2, isFinite(weight) ? weight : 0.25)),
      /* ice to tar, roughly */
      friction: Math.max(0.02, Math.min(1.2, isFinite(friction) ? friction : 0.16))
    };
  }

  /* ---- putting it back ---------------------------------------------- */
  function apply(g, rec) {
    if (!rec || typeof rec !== "object") throw new Error("that is not a level");
    rec = upgrade(rec);
    if (rec.cols !== MF.COLS || rec.rows !== MF.ROWS)
      throw new Error("that level is a different shape from this cellar");

    /* hold on to anything a newer game wrote that this one has no idea
       about, so saving it again does not throw it away */
    g._extra = {};
    for (var xk in rec) if (KNOWN.indexOf(xk) < 0) g._extra[xk] = rec[xk];

    /* the level's own numbers, without running the generator */
    g.F = rec.F;
    var lv = MF.levelOf(g.F, g.classic);
    g.PE = lv.PE;
    g.PA = lv.PA;
    g.leash = MF.leashCells(lv.PA);
    g.feat = lv.feat;
    g.wood = g.classic || g.F === 1;
    /* anything that still draws on the seeded stream later - a snake
       being cut, a jar being opened - needs one to draw on */
    g.rng = MF.mulberry32(((g.seed | 0) ^ (g.F * 2654435761)) >>> 0);

    for (var i = 0; i < PLANES.length; i++) {
      var packed = rec.cells[PLANES[i]];
      /* a plane this level does not carry is a plane of nothing, which
         is what every one of them means when it is absent - so a level
         written before a plane existed still loads */
      if (packed === undefined || packed === null) { g[PLANES[i]].fill(0); continue; }
      var got = IO.unpackArray(packed, N);
      if (!got) throw new Error("the " + PLANES[i] + " of that level is damaged");
      g[PLANES[i]].set(got);
    }
    for (var s = 0; s < SIDES.length; s++) {
      var side = SIDES[s][0];
      var e = IO.unpackArray(rec.edge[side], SIDES[s][1]);
      if (!e) throw new Error("the edge of that level is damaged");
      g.edge[side].set(e);
    }

    /* what the level brought with it, before anything is placed */
    g.blocks = (rec.blocks || []).slice(0, MF.MAX_MADE - MF.MADE).map(cleanBlock);
    if (!g.blocks.length) g.blocks = null;
    g.shape = rec.shape ? IO.unpackArray(rec.shape, N) : null;
    g.bound = rec.bound ? IO.unpackArray(rec.bound, N) : null;
    g.deal = rec.deal || null;

    g.manC = rec.man[0]; g.manR = rec.man[1];
    g.bricks = rec.bricks | 0;
    g.marbleCount = rec.marbleCount | 0;
    g.CO = rec.CO | 0;
    g.steps = rec.carry.steps | 0;
    g.boots = rec.carry.boots | 0;
    g.frost = rec.carry.frost | 0;
    g.saw = rec.carry.saw | 0;
    g.over = false; g.won = false;

    g.monsters = (rec.monsters || []).map(function (m) {
      var spec = MF.MONSTERS[m.kind];
      /* the one thing that genuinely cannot be skipped: a monster whose
         behaviour this build does not have is not a cellar you can play
         a bit of, it is one you would play WRONG */
      if (!spec) throw new Error("this level has a " + m.kind +
        " in it, which needs a newer version of the game");
      /* `spec` is a live shared object with a move() on it - it cannot
         survive being written to text, so it is re-linked by kind */
      var out = { kind: m.kind, spec: spec, c: m.c, r: m.r, tick: m.tick | 0,
                  trapped: false, crushed: !!m.crushed, gone: !!m.gone, ate: null };
      if (m.tc !== undefined) { out.tc = m.tc; out.tr = m.tr; }
      if (m.body) {
        out.body = m.body.map(function (b) { return [b[0], b[1]]; });
        out.full = m.full;
        out.growth = m.growth | 0;
      }
      return out;
    });
    g.marbles = (rec.marbles || []).map(function (m) {
      return { c: m.c, r: m.r, dc: m.dc, dr: m.dr, v: m.v, size: m.size || 1 };
    });
    g.robots = (rec.robots || []).map(function (b) {
      return { c: b.c, r: b.r, size: b.size, running: !!b.running,
               power: b.power, life: b.life, wait: b.wait, gone: false };
    });
    g.sources = (rec.sources || []).map(function (s2) {
      return { c: s2.c, r: s2.r, kind: s2.kind, left: s2.left };
    });

    /* and now whatever the level asked to have dealt rather than drawn.
       After the actors, so nothing lands on top of them. */
    if (g.deal) {
      g.dealOut(g.deal);
      var laid = 0;
      for (var q = 0; q < N; q++) if (g.grid[q] === MF.BRICK) laid++;
      if (!rec.bricks) g.bricks = laid;
    }

    /* which monsters are walled in is not stored - it is worked out, so
       that a level hand-edited into a winning position cannot claim to
       be one */
    g.settle({ trappedNow: [], freed: [] });
    return g;
  }

  /* ------------------------------------------------------------------
     Bring a record up to date, or say why it cannot be.

     A record from the FUTURE is fine as long as it says an old reader
     can cope - which is the usual case, because most changes add things
     rather than change what the old things mean.
     ------------------------------------------------------------------ */
  function upgrade(rec) {
    var v = rec.v | 0;
    if (v <= 0) throw new Error("that level does not say what wrote it");

    if (v > VERSION) {
      var needs = rec.needs === undefined ? v : (rec.needs | 0);
      if (needs > VERSION)
        throw new Error("this level was made by a newer version of the game, and needs it");
      return rec;                        /* newer, but it says we can cope */
    }

    var out = rec;
    for (var step = v + 1; step <= VERSION; step++)
      if (MIGRATE[step]) out = MIGRATE[step](out) || out;
    out.v = VERSION;
    return out;
  }

  /* ---- the code ------------------------------------------------------
     A code has to survive being pasted into a chat window, which means
     surviving being wrapped across lines - so reading one throws away
     every scrap of whitespace before checking it.

     Which quietly broke every level with a space in its name. The name
     is inside the code, so stripping whitespace stripped the name's
     spaces too, and "The Long Drop" arrived as a checksum failure.

     So the code is written with no literal spaces in it at all: they go
     in as the escape JSON already understands, which JSON.parse turns
     back into spaces on the way in. Six characters per space in a name
     and nothing else changes - and now throwing away whitespace is
     always the right thing to do, because there was never any in it.
     -------------------------------------------------------------------- */
  function toCode(rec) {
    return IO.seal(JSON.stringify(rec).replace(/ /g, "\\u0020"));
  }

  function fromCode(code) {
    var body = IO.unseal(String(code || "").replace(/\s+/g, ""));
    if (body === null) throw new Error("that code is damaged or incomplete");
    var rec;
    try { rec = JSON.parse(body); } catch (e) { throw new Error("that code is not a level"); }
    return rec;
  }

  /* ------------------------------------------------------------------
     Is it playable at all?

     Not "is it good" - that is what the AI bot is for - but the handful
     of things that make a cellar impossible rather than hard, which are
     worth telling an author before anybody else sees it.
     ------------------------------------------------------------------ */
  function faults(rec) {
    var bad = [];
    var g = { grid: IO.unpackArray(rec.cells.grid, N) };
    if (!g.grid) return ["the level is damaged"];

    if (!rec.monsters || !rec.monsters.length) bad.push("there is nothing down here to wall in");
    /* rec.bricks, NOT a count of brick squares. They are not the same
       number: a pool's ring is laid as brick and counted, and then the
       scatter overwrites the total with what it laid - 184 brick squares
       against a count of 136 on a real cellar 20. The count is what
       canStillWin() reads, so it is the one that decides whether a level
       can be finished. */
    var bricks = rec.bricks | 0;
    var loose = (rec.monsters || []).filter(function (m) { return !m.gone; }).length;
    if (loose && bricks < loose * 4)
      bad.push("only " + bricks + " bricks for " + loose +
               (loose === 1 ? " monster - four is the least that will hold one" :
                              " monsters - four apiece is the least that will hold them"));

    var man = rec.man || [];
    if (man[0] === undefined || g.grid[man[1] * MF.COLS + man[0]] !== MF.EMPTY)
      bad.push("the man is standing inside something");
    (rec.monsters || []).forEach(function (m) {
      if (m.c === man[0] && m.r === man[1]) bad.push("a monster is standing on the man");
    });
    return bad;
  }

  root.MutantLevelFormat = {
    VERSION: VERSION, NEEDS: NEEDS, NEEDS_RICH: NEEDS_RICH,
    PLANES: PLANES, KNOWN: KNOWN, upgrade: upgrade, cleanBlock: cleanBlock,
    capture: capture, apply: apply, toCode: toCode, fromCode: fromCode, faults: faults
  };
})(typeof window !== "undefined" ? window : globalThis);
