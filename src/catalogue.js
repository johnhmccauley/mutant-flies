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

  function stars(rec) {
    if (!rec.ratings || !rec.ratings.count) return -1;   /* unrated sorts last */
    return rec.ratings.total / rec.ratings.count;
  }
  function plays(rec) { return rec.plays || 0; }
  function born(rec) { return rec.created || 0; }

  /* newest first, and if two were made in the same millisecond the id
     breaks it, so the order is total and a list never reshuffles itself
     between one render and the next */
  function newest(a, b) {
    return (born(b) - born(a)) || String(a.id).localeCompare(String(b.id));
  }

  var SORTS = {
    stars: function (a, b) {
      return (stars(b) - stars(a)) || (plays(b) - plays(a)) || newest(a, b);
    },
    plays: function (a, b) {
      return (plays(b) - plays(a)) || (stars(b) - stars(a)) || newest(a, b);
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

  function canPlay(rec, who) {
    if (!visibleTo(rec, who)) return false;
    if (rec.owner && rec.owner === who.id) return true;
    return !!who.paid;                      /* other people's levels are paid for */
  }

  /* --------------------------------------------------------------
     What the author is allowed to do.

     Deleting stops the moment a level goes public, and it does not
     start again when it is hidden: other people have played it, and
     some of them still have it. Hiding is the way back, not deleting.
     -------------------------------------------------------------- */
  function canDelete(rec) { return rec.state === PRIVATE && !rec.everPublic; }
  function canEdit(rec, who) { return !!rec.owner && rec.owner === who.id; }

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
    stars: stars, plays: plays, sortLevels: sortLevels, SORTS: SORTS,
    visibleTo: visibleTo, canPlay: canPlay, canDelete: canDelete,
    canEdit: canEdit, canMove: canMove, move: move,
    canRate: canRate, rate: rate
  };
})(typeof window !== "undefined" ? window : globalThis);
