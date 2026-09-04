/* =====================================================================
   THE CATALOGUE

   Levels people made themselves: who owns one, whether anybody else can
   see it, what they thought of it, and what order to show them in.

   The ordering is the fiddly part, because the two modes are not the
   same rule with the keys swapped round - they are mirror images of
   each other, and both end on the same third key:

     by stars   stars, then times played, then newest
     by plays   times played, then stars, then newest

   "Stars" is the average of the ratings, and a level nobody has rated
   yet has none rather than nought - so it sorts below a one-star level
   instead of tying with one. Ties on the average are common when a
   level has only been rated once or twice, which is exactly why there
   are two more keys under it.
   ===================================================================== */
(function (root) {
  "use strict";

  /* what a level can be, and the only ways it may move between them */
  var PRIVATE = "private", PUBLIC = "public", HIDDEN = "hidden";

  /* ------------------------------------------------------------------
     What a dollar buys.

     Five cellars are free, and they are the real five - the 1985 game
     and the first of the new ones - not a demo. Cellars one to four say
     nothing about any of this: no editor, no catalogue, nothing but the
     game. Reach the fifth and both appear at once, greyed: the editor
     sits in the menu not working, and everybody else's work is there to
     read - what people have built, what it is called, how it is rated,
     how many have played it. You just cannot open any of it.

     Showing the locked thing rather than hiding it is deliberate. A
     player who cannot see what is behind the paywall has no reason to
     go through it, and a menu that grows a new item the moment you pay
     feels like a different game arriving. This way the shape of the
     whole thing is visible from cellar five, and the pound removes the
     grey rather than adding anything.
     ------------------------------------------------------------------ */
  var FREE_CELLARS = 5, EDITOR_AT = 5;

  function gate(who) {
    var reached = who.reached || 1;
    var paid = !!who.paid;
    return {
      freeCellars: FREE_CELLARS,
      /* the editor is in the menu from here, working or not */
      editorShown: reached >= EDITOR_AT,
      editorEnabled: reached >= EDITOR_AT && paid,
      /* it arrives with the editor and is readable but never playable */
      catalogueShown: reached >= EDITOR_AT,
      cataloguePlayable: paid,
      /* and the descent itself stops at the fifth cellar */
      canDescendTo: paid ? Infinity : FREE_CELLARS,
      paid: paid
    };
  }

  function canDescend(who, cellar) { return cellar <= gate(who).canDescendTo; }

  /* ------------------------------------------------------------------
     Stars, and what to sort on.

     What a level SHOWS is the plain average, because that is what a
     player means by four stars. What it is RANKED on is not, because a
     plain average is trivially gamed: one five from the author's other
     device beats a level with two hundred genuine ratings averaging
     4.8, and the top of the board fills up with levels nobody has
     played. It is the oldest bug in ratings and it is worth not
     shipping.

     So ranking pulls every level towards the middle by a fixed number
     of imaginary average votes - ten of them, at three and a half.
     A single five becomes (10x3.5 + 5) / 11 = 3.64, which is barely
     above an unrated level and nowhere near the top; two hundred real
     ratings at 4.8 come out at 4.74, because by then the ten imaginary
     ones hardly matter. Votes have to be earned before they count for
     much, and there is no threshold to game because the effect fades
     smoothly as real ratings arrive.

     A level nobody has rated scores exactly the prior. That is the
     right answer as well as the convenient one: unrated means unknown,
     not bad, and a new level that sorted below every one-star in the
     catalogue would never be seen long enough to get rated at all.
     ------------------------------------------------------------------ */
  var PRIOR = 3.5, PRIOR_WEIGHT = 10;

  /* what the level shows: the honest average, or nothing at all */
  function stars(rec) {
    if (!rec.ratings || !rec.ratings.count) return null;
    return rec.ratings.total / rec.ratings.count;
  }

  /* what the level is ranked on: the average pulled towards the middle */
  function rank(rec) {
    var count = (rec.ratings && rec.ratings.count) || 0;
    var total = (rec.ratings && rec.ratings.total) || 0;
    return (PRIOR_WEIGHT * PRIOR + total) / (PRIOR_WEIGHT + count);
  }
  function plays(rec) { return rec.plays || 0; }
  function born(rec) { return rec.created || 0; }

  /* Newest first, and if two were made in the same millisecond the id
     breaks it, so the order is total and a list never reshuffles itself
     between one render and the next. The id runs the same way as
     everything else - descending - because the server pages the board
     by comparing whole rows, and a single key running the other way
     makes a page boundary skip whatever tied above it. */
  function newest(a, b) {
    return (born(b) - born(a)) || String(b.id).localeCompare(String(a.id));
  }

  var SORTS = {
    stars: function (a, b) {
      return (rank(b) - rank(a)) || (plays(b) - plays(a)) || newest(a, b);
    },
    plays: function (a, b) {
      return (plays(b) - plays(a)) || (rank(b) - rank(a)) || newest(a, b);
    }
  };

  function sortLevels(list, by) {
    var cmp = SORTS[by] || SORTS.stars;
    return list.slice().sort(cmp);
  }

  /* --------------------------------------------------------------
     What each player is allowed to see.

     A hidden level is not withdrawn from the people already playing
     it - it is only closed to newcomers. Anybody who has played it
     keeps it; anybody who has not never learns it existed. The author
     always sees their own.
     -------------------------------------------------------------- */
  function visibleTo(rec, who) {
    if (rec.owner && rec.owner === who.id) return true;
    if (rec.state === PRIVATE) return false;
    if (rec.state === PUBLIC) return true;
    if (rec.state === HIDDEN) return !!(who.played && who.played[rec.id]);
    return false;
  }

  /* Seeing a level in the list is not the same as being able to open
     it. A free player browses the whole catalogue and plays none of it,
     including - since making one needs the editor - their own. */
  function canPlay(rec, who) {
    if (!visibleTo(rec, who)) return false;
    return !!who.paid;
  }

  /* --------------------------------------------------------------
     What the author is allowed to do.

     Deleting stops the moment a level goes public, and it does not
     start again when it is hidden: other people have played it, and
     some of them still have it. Hiding is the way back, not deleting.
     -------------------------------------------------------------- */
  function canDelete(rec) { return rec.state === PRIVATE && !rec.everPublic; }
  function canEdit(rec, who) {
    if (!rec.owner || rec.owner !== who.id) return false;
    return gate(who).editorEnabled;
  }
  function canCreate(who) { return gate(who).editorEnabled; }

  var MOVES = {};
  MOVES[PRIVATE] = [PUBLIC];
  MOVES[PUBLIC] = [HIDDEN];
  MOVES[HIDDEN] = [PUBLIC];

  function canMove(rec, to) {
    var from = rec.state || PRIVATE;
    return (MOVES[from] || []).indexOf(to) >= 0;
  }

  function move(rec, to) {
    if (!canMove(rec, to)) return false;
    rec.state = to;
    if (to === PUBLIC) rec.everPublic = true;
    return true;
  }

  /* --------------------------------------------------------------
     Ratings. One per player per level, changeable, and not your own
     level - a man marking his own homework is not a rating.
     -------------------------------------------------------------- */
  function canRate(rec, who) {
    if (rec.owner && rec.owner === who.id) return false;
    if (!(who.played && who.played[rec.id])) return false;   /* play it first */
    return rec.state === PUBLIC || rec.state === HIDDEN;
  }

  function rate(rec, who, score) {
    if (!canRate(rec, who)) return false;
    score = Math.max(1, Math.min(5, Math.round(score)));
    if (!rec.ratings) rec.ratings = { total: 0, count: 0, by: {} };
    if (!rec.ratings.by) rec.ratings.by = {};
    var had = rec.ratings.by[who.id];
    if (had) rec.ratings.total -= had;                       /* changing a vote */
    else rec.ratings.count++;
    rec.ratings.by[who.id] = score;
    rec.ratings.total += score;
    return true;
  }

  root.MutantCatalogue = {
    PRIVATE: PRIVATE, PUBLIC: PUBLIC, HIDDEN: HIDDEN,
    FREE_CELLARS: FREE_CELLARS, EDITOR_AT: EDITOR_AT,
    gate: gate, canDescend: canDescend, canCreate: canCreate,
    stars: stars, rank: rank, plays: plays, sortLevels: sortLevels, SORTS: SORTS,
    PRIOR: PRIOR, PRIOR_WEIGHT: PRIOR_WEIGHT,
    visibleTo: visibleTo, canPlay: canPlay, canDelete: canDelete,
    canEdit: canEdit, canMove: canMove, move: move,
    canRate: canRate, rate: rate
  };
})(typeof window !== "undefined" ? window : globalThis);
