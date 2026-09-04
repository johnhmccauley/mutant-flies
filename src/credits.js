/* =====================================================================
   CREDITS

   Clear a cellar and you are paid for it. Clear it quickly and you are
   paid more. What you are paid buys the two things that make a bad
   cellar survivable: another life, and a robot to do half the work.

   THE HOLE THIS IS BUILT AROUND. The moment players can author levels
   AND be paid for completing levels, somebody makes a cellar with one
   monster already three-quarters walled in, finishes it in nine moves,
   and does that four hundred times. Any economy that pays out per
   completion has this hole in it, and it is not a small one - it makes
   the currency worthless, which makes buying it insulting.

   So the rules are:

     the descent pays          every procedural cellar, every time
     your own levels pay nothing, ever
     somebody else's level pays once and once only, the first time you
                               finish it, and only if it is published

   Which leaves nothing to farm. You cannot mint credits from your own
   work, and you cannot mint them twice from anybody else's. The only
   repeatable income is the game itself, which is the thing the credits
   are supposed to be encouraging you to play.

   WHAT IS AND IS NOT WORTH DEFENDING. Credits you EARN are counted on
   your own machine, because the game has to work with no network and no
   login, and a determined person can therefore give themselves a
   thousand. That is a fair trade: this is a single-player game, and
   somebody who cheats it has only cheated themselves out of it. Credits
   you BUY are a different matter entirely - real money changed hands -
   so those are the server's, counted there, and never taken on the
   client's word. The two are kept apart for exactly that reason.
   ===================================================================== */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------
     What a cellar pays.

     Deeper is worth more because it is worth more. The speed tiers are
     the 1985 game's own bonus table - 100 moves, 400, 500, 600, 700 -
     which measure up well against how long a cellar actually takes: a
     bot that clears one uses between 20 and 440 moves, median about 320.
     So the top tier is a genuinely fast clear and the bottom one is the
     player who ground it out, and both are paid.
     ------------------------------------------------------------------ */
  function baseFor(cellar) { return 20 + 5 * Math.max(1, cellar | 0); }

  function speedMultiple(moves) {
    if (moves <= 100) return 2;
    if (moves < 400) return 1.5;
    if (moves < 500) return 1.25;
    if (moves < 600) return 1.1;
    if (moves < 700) return 1;
    return 0.9;
  }

  var MADE_LEVEL_FEE = 15;      /* somebody else's level, the first time */

  /* ------------------------------------------------------------------
     What an author earns from the people playing their work.

     A royalty per counted play, and a bonus for the three most played
     levels each month. Both reopen the farm hole from the other side -
     if plays pay the author, an author can pay themselves - so both are
     defended in the same three ways, and all three are the SERVER's job
     rather than this file's:

       a play by the author on their own level never counts
       a player counts once per level per day, however many times they
         open it, enforced by a UNIQUE index rather than by a check
       playing anybody's level at all requires having paid

     The last one is the real defence. Minting a second identity is free
     and takes a second; minting one that can play a level costs the
     price of the game. An author farming their own work has to buy a
     copy per sock puppet, which is a business model rather than an
     exploit.

     The podium is over the month's counted plays, tie-broken the way
     the board itself is - stars, then newest - so it rewards the thing
     the catalogue is already sorted by.
     ------------------------------------------------------------------ */
  var ROYALTY = 2;              /* credits to the author, per counted play */
  var PODIUM = [
    { place: "gold",   award: 1000 },
    { place: "silver", award: 600 },
    { place: "bronze", award: 300 }
  ];

  /* What this clear is worth, and why - the why is shown to the player,
     because "you earned 96" means nothing and "cellar 12, cleared in 84
     moves, doubled" means something. */
  function earnFor(run) {
    run = run || {};
    var kind = run.kind === "made" ? "made" : "descent";

    if (kind === "made") {
      if (!run.levelId) return { credits: 0, why: "no level" };
      if (run.authorId && run.playerId && run.authorId === run.playerId)
        return { credits: 0, why: "your own level" };
      if (run.alreadyPaid) return { credits: 0, why: "already collected" };
      if (run.state && run.state !== "public" && run.state !== "hidden")
        return { credits: 0, why: "not published" };
      return { credits: MADE_LEVEL_FEE, why: "somebody else's level, first time" };
    }

    var base = baseFor(run.cellar);
    var mult = speedMultiple(run.moves === undefined ? 9999 : run.moves);
    return {
      credits: Math.round(base * mult),
      base: base,
      multiple: mult,
      why: "cellar " + (run.cellar | 0) + ", " + (run.moves | 0) + " moves" +
           (mult > 1 ? ", x" + mult : "")
    };
  }

  /* ------------------------------------------------------------------
     What credits buy. Both of these make a cellar easier to survive;
     neither makes it easier to SOLVE, which is the line worth holding -
     a puzzle you can buy the answer to is not a puzzle.
     ------------------------------------------------------------------ */
  var SHOP = {
    life:        { price: 150, name: "A life",        blurb: "Take the cellar again instead of the run ending." },
    robotSmall:  { price: 60,  name: "A small robot", blurb: "Three rocks' worth of shove, and about forty turns of it." },
    robotMedium: { price: 110, name: "A robot",       blurb: "Four rocks, and it lasts half as long again." },
    robotLarge:  { price: 180, name: "A big robot",   blurb: "Five rocks, seventy turns, and it takes some catching." }
  };

  function priceOf(what) { return SHOP[what] ? SHOP[what].price : null; }

  /* ------------------------------------------------------------------
     The purse.

     Earned and bought are counted separately and spent earned-first, so
     that credits somebody paid real money for are the last to go. If a
     player ever asks for a refund, what they bought is still sitting
     there to be taken back.
     ------------------------------------------------------------------ */
  function Wallet(state) {
    state = state || {};
    this.earned = state.earned || 0;      /* played for, counted here     */
    this.awarded = state.awarded || 0;    /* royalties and podium, server */
    this.bought = state.bought || 0;      /* paid for, server             */
    this.spent = state.spent || 0;
    this.spentBought = state.spentBought || 0;
    this.collected = state.collected || {};    /* level ids already paid out */
    this.ledger = state.ledger || [];
  }

  Wallet.prototype.balance = function () {
    return (this.earned + this.awarded + this.bought) - this.spent;
  };
  /* what is left that was not paid for with money - spent first, so a
     refund always has something to take back */
  Wallet.prototype.freeLeft = function () {
    return (this.earned + this.awarded) - (this.spent - this.spentBought);
  };

  Wallet.prototype.note = function (entry) {
    this.ledger.push(entry);
    if (this.ledger.length > 200) this.ledger.shift();
    return entry;
  };

  Wallet.prototype.earn = function (run, at) {
    var got = earnFor(run);
    if (!got.credits) return this.note({ kind: "nothing", why: got.why, credits: 0, at: at || 0 });
    if (run.kind === "made") this.collected[run.levelId] = 1;
    this.earned += got.credits;
    return this.note({ kind: "earn", credits: got.credits, why: got.why, at: at || 0 });
  };

  /* The server's numbers are TOTALS, never deltas - so a webhook seen
     twice, a retried sync, or a client asking the same question
     repeatedly cannot conjure a second pack or a second royalty out of
     it. This is the whole reason royalties and purchases are counted
     there and only mirrored here. */
  Wallet.prototype.syncServer = function (totals) {
    totals = totals || {};
    var bought = Math.max(0, totals.bought | 0);
    var awarded = Math.max(0, totals.awarded | 0);
    var moved = false;
    if (bought !== this.bought) {
      this.note({ kind: "bought", credits: bought - this.bought, why: "credits bought", at: 0 });
      this.bought = bought; moved = true;
    }
    if (awarded !== this.awarded) {
      this.note({ kind: "awarded", credits: awarded - this.awarded,
                  why: "royalties and podium", at: 0 });
      this.awarded = awarded; moved = true;
    }
    return moved;
  };

  Wallet.prototype.canAfford = function (what) {
    var p = priceOf(what);
    return p !== null && this.balance() >= p;
  };

  Wallet.prototype.spend = function (what, at) {
    var p = priceOf(what);
    if (p === null) return { ok: false, why: "there is no such thing to buy" };
    if (this.balance() < p) return { ok: false, why: "not enough credits", short: p - this.balance() };
    /* earned first, so bought credits are the last to be used up */
    var fromEarned = Math.min(p, Math.max(0, this.freeLeft()));
    this.spent += p;
    this.spentBought += (p - fromEarned);
    this.note({ kind: "spend", credits: -p, why: SHOP[what].name, at: at || 0 });
    return { ok: true, bought: what, paid: p, left: this.balance() };
  };

  Wallet.prototype.toJSON = function () {
    return { earned: this.earned, awarded: this.awarded, bought: this.bought, spent: this.spent,
             spentBought: this.spentBought, collected: this.collected,
             ledger: this.ledger.slice(-40) };
  };

  root.MutantCredits = {
    Wallet: Wallet, earnFor: earnFor, baseFor: baseFor, speedMultiple: speedMultiple,
    SHOP: SHOP, priceOf: priceOf, MADE_LEVEL_FEE: MADE_LEVEL_FEE,
    ROYALTY: ROYALTY, PODIUM: PODIUM
  };
})(typeof window !== "undefined" ? window : globalThis);
