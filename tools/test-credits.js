#!/usr/bin/env node
/*
 * The credit economy, and the hole it is built around.
 *
 *   node tools/test-credits.js
 *
 * Most of these are the farm: an author paying themselves, a player
 * collecting the same level twice, a sync counted twice. An economy is
 * only as good as what it refuses.
 */
global.window = global;
require("../src/credits.js");
const C = global.MutantCredits;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}

console.log("\nWhat a cellar pays\n");
{
  const slow = C.earnFor({ kind: "descent", cellar: 10, moves: 320 });
  const fast = C.earnFor({ kind: "descent", cellar: 10, moves: 84 });
  ok("clearing it quickly pays more than grinding it out",
     [fast.credits > slow.credits, fast.multiple, slow.multiple], [true, 2, 1.5]);
}
{
  const shallow = C.earnFor({ kind: "descent", cellar: 1, moves: 320 });
  const deep = C.earnFor({ kind: "descent", cellar: 20, moves: 320 });
  ok("and deeper pays more than shallower", deep.credits > shallow.credits, true);
}
{
  ok("a real grind still pays something rather than nothing",
     C.earnFor({ kind: "descent", cellar: 5, moves: 2000 }).credits > 0, true);
}
{
  ok("and the player is told why, not just how much",
     C.earnFor({ kind: "descent", cellar: 12, moves: 84 }).why, "cellar 12, 84 moves, x2");
}

console.log("\nThe farm, and why it does not work\n");
{
  const w = new C.Wallet();
  const own = { kind: "made", levelId: "lv1", authorId: "amy", playerId: "amy", state: "public" };
  w.earn(own); w.earn(own); w.earn(own);
  ok("finishing your own level four hundred times pays nothing at all",
     [w.balance(), w.ledger[0].why], [0, "your own level"]);
}
{
  const w = new C.Wallet();
  const theirs = { kind: "made", levelId: "lv1", authorId: "bob", playerId: "amy", state: "public" };
  w.earn(theirs);
  const first = w.balance();
  w.earn({ ...theirs, alreadyPaid: !!w.collected.lv1 });
  ok("and somebody else's pays once and then never again",
     [first, w.balance()], [C.MADE_LEVEL_FEE, C.MADE_LEVEL_FEE]);
}
{
  const w = new C.Wallet();
  w.earn({ kind: "made", levelId: "lv9", authorId: "bob", playerId: "amy", state: "private" });
  ok("a level nobody has published pays nothing", w.balance(), 0);
}
{
  const w = new C.Wallet();
  for (let i = 0; i < 5; i++)
    w.earn({ kind: "made", levelId: "lv" + i, authorId: "bob", playerId: "amy", state: "public" });
  ok("five different levels pay five times, which is the point",
     w.balance(), C.MADE_LEVEL_FEE * 5);
}
{
  /* the descent is the only repeatable income, and that is deliberate */
  const w = new C.Wallet();
  for (let f = 1; f <= 10; f++) w.earn({ kind: "descent", cellar: f, moves: 320 });
  ok("ten cellars of honest play is worth a few lives",
     [w.balance() > 3 * C.priceOf("life"), w.balance() < 8 * C.priceOf("life")], [true, true]);
}

console.log("\nSpending it\n");
{
  const w = new C.Wallet({ earned: 200 });
  ok("you can buy what you can afford", w.spend("life"),
     { ok: true, bought: "life", paid: 150, left: 50, have: 1 });
  ok("and not what you cannot", w.spend("life"), { ok: false, why: "not enough credits", short: 100 });
}
{
  const w = new C.Wallet({ earned: 500 });
  ok("buying something that does not exist is refused",
     w.spend("aWish").ok, false);
}
{
  /* money last, always: a refund must have something left to take back */
  const w = new C.Wallet({ earned: 100, bought: 500 });
  w.spend("robotSmall");                       /* 60, all from earned */
  ok("earned credits go first", [w.spent, w.spentBought], [60, 0]);
  w.spend("life");                             /* 150: 40 earned, 110 bought */
  ok("and only then the ones somebody paid for", [w.spent, w.spentBought], [210, 110]);
  ok("with the balance still right", w.balance(), 390);
}
{
  const w = new C.Wallet({ earned: 300 });
  ok("what you can afford is answerable without trying to buy it",
     [w.canAfford("robotSmall"), w.canAfford("robotLarge"), w.canAfford("life")],
     [true, true, true]);
}

console.log("\nWhat the server says, said twice\n");
{
  const w = new C.Wallet({ earned: 50 });
  ok("a purchase arrives", [w.syncServer({ bought: 500, awarded: 0 }), w.balance()], [true, 550]);
  ok("and the same answer again changes nothing",
     [w.syncServer({ bought: 500, awarded: 0 }), w.balance()], [false, 550]);
  ok("because the server sends totals, never deltas",
     [w.syncServer({ bought: 500, awarded: 120 }), w.balance()], [true, 670]);
}
{
  const w = new C.Wallet({ earned: 0 });
  w.syncServer({ bought: 500, awarded: 0 });
  w.spend("life");
  w.syncServer({ bought: 500, awarded: 0 });
  ok("and re-syncing after spending does not refill the purse", w.balance(), 350);
}
{
  const w = new C.Wallet();
  w.syncServer({ awarded: 1000 });
  ok("a podium bonus is spendable like anything else",
     [w.balance(), w.spend("life").ok], [1000, true]);
}

console.log("\nWriting it down\n");
{
  const w = new C.Wallet({ earned: 400 });
  w.earn({ kind: "descent", cellar: 3, moves: 90 });
  w.spend("robotSmall");
  const back = new C.Wallet(JSON.parse(JSON.stringify(w.toJSON())));
  ok("a purse survives being saved and loaded", back.balance(), w.balance());
  ok("and remembers which levels it has already been paid for",
     Object.keys(back.collected), Object.keys(w.collected));
}
{
  const w = new C.Wallet();
  for (let i = 0; i < 300; i++) w.earn({ kind: "descent", cellar: 1, moves: 500 });
  ok("the ledger does not grow for ever", w.ledger.length <= 200, true);
}


console.log("\nWhat a purchase actually gives you\n");
{
  const w = new C.Wallet({ earned: 500 });
  const r = w.spend("life");
  ok("buying a life gives you a life, not just a line in a ledger",
     [r.ok, r.have, w.have("life")], [true, 1, 1]);
  w.spend("life");
  ok("and buying two gives you two", w.have("life"), 2);
}
{
  const w = new C.Wallet({ earned: 500 });
  w.spend("life");
  ok("using one takes it out of the cupboard", [w.use("life"), w.have("life")], [true, 0]);
  ok("and using one you have not got is refused rather than going negative",
     [w.use("life"), w.have("life")], [false, 0]);
}
{
  const w = new C.Wallet({ earned: 900 });
  w.spend("robotLarge"); w.spend("life");
  const back = new C.Wallet(JSON.parse(JSON.stringify(w.toJSON())));
  ok("what you bought survives being saved and loaded",
     [back.have("robotLarge"), back.have("life"), back.balance()],
     [1, 1, w.balance()]);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
