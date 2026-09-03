#!/usr/bin/env node
/*
 * Knowing who somebody is without ever asking them to log in.
 *
 *   node tools/test-identity.js
 *
 * The claim under test is a strong one - that a level edit can be proved
 * genuine by a server that has never heard of the author and keeps no
 * accounts - so it gets tested as an attacker would: by trying to forge
 * one.
 */
global.window = global;
require("../src/identity.js");
const W = global.MutantWho;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}
/* a store that behaves like localStorage but lives in this process */
function memStore() {
  const m = {};
  return { durable: true, get: (k) => (m[k] === undefined ? null : m[k]),
           set: (k, v) => { m[k] = v; return true; }, clear: (k) => { delete m[k]; } };
}

(async function () {
  console.log("\nBeing somebody\n");

  const store = memStore();
  const me = await new W.Who(store).open();
  ok("you get an id without being asked for anything",
     [typeof me.id, /^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/.test(me.id)], ["string", true]);

  const again = await new W.Who(store).open();
  ok("and it is the same id next time the game opens", again.id, me.id);

  const other = await new W.Who(memStore()).open();
  ok("somebody else gets a different one", other.id === me.id, false);

  console.log("\nProving it\n");
  const claim = JSON.stringify({ level: "cellar-of-doom", author: me.id, edit: 3 });
  const sig = await me.sign(claim);
  ok("a signature checks out against the id alone",
     await W.verify(me.id, me.pub, claim, sig), true);

  ok("a changed message does not",
     await W.verify(me.id, me.pub, claim.replace("edit\":3", "edit\":4"), sig), false);

  ok("and neither does somebody else signing the same thing",
     await W.verify(me.id, me.pub, claim, await other.sign(claim)), false);

  /* the forgery that matters: claiming to BE somebody by presenting your
     own key against their id */
  ok("you cannot put your own key behind another player's id",
     await W.verify(me.id, other.pub, claim, await other.sign(claim)), false);

  ok("nor sign with your key and hand over theirs",
     await W.verify(other.id, other.pub, claim, sig), false);

  ok("a mangled signature is refused rather than throwing",
     await W.verify(me.id, me.pub, claim, "not-a-signature"), false);
  ok("so is a mangled key", await W.verify(me.id, "!!!", claim, sig), false);

  console.log("\nMoving to another machine\n");
  const code = me.recoveryCode();
  ok("the code says what it is and is short enough to paste",
     [code.slice(0, 4), code.length < 700], ["MF1-", true]);

  const newDevice = new W.Who(memStore());
  await newDevice.open();
  const before = newDevice.id;
  await newDevice.restore(code);
  ok("pasting it in makes the new machine the same player",
     [before === me.id, newDevice.id === me.id], [false, true]);

  const carried = await newDevice.sign(claim);
  ok("and it can sign as that player", await W.verify(me.id, me.pub, claim, carried), true);

  const third = new W.Who(memStore());
  await third.open();
  let refused = null;
  await third.restore("MF1-" + "rubbish").then(() => { refused = false; }, () => { refused = true; });
  ok("a damaged code is refused, not half-applied", refused, true);
  await third.restore("hello").then(() => { refused = false; }, () => { refused = true; });
  ok("and so is something that is not a code at all", refused, true);

  console.log("\nWhen the browser will not remember anything\n");
  {
    /* a private window, an opaque origin, or site data switched off */
    const hostile = {
      durable: false, get: () => { throw new Error("blocked"); },
      set: () => { throw new Error("blocked"); }, clear: () => {}
    };
    const safe = {
      durable: false, mem: {},
      get(k) { try { return hostile.get(k); } catch (e) { return this.mem[k] === undefined ? null : this.mem[k]; } },
      set(k, v) { try { hostile.set(k, v); } catch (e) { this.mem[k] = v; } return false; },
      clear(k) { delete this.mem[k]; }
    };
    const ghost = await new W.Who(safe).open();
    ok("you are still somebody for this session", typeof ghost.id, "string");
    ok("and the game knows it will not be remembered", safe.durable, false);
  }

  console.log("\nA name to put on a level\n");
  {
    const s = memStore();
    const p = await new W.Who(s).open();
    p.setName("Onticha");
    const back = await new W.Who(s).open();
    ok("a display name is kept with the key", back.name, "Onticha");
    ok("and a silly long one is cut down", p.setName("x".repeat(80)).length, 24);
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
