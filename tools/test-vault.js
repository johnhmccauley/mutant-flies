#!/usr/bin/env node
/*
 * Where a player's levels live, and how honestly the game admits when
 * they are not safe.
 *
 *   node tools/test-vault.js
 *
 * The IndexedDB driver itself is exercised in a real browser - node has
 * no IndexedDB. What is tested here is everything around it: the
 * fallback when a browser refuses, a write that fails saying so instead
 * of looking like it worked, the migration off the old single key, and
 * the warnings, which are the part a player actually sees.
 */
global.window = global;
require("../src/vault.js");
const V = global.MutantVault;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}

(async function () {
  console.log("\nKeeping things\n");
  {
    const v = await V.open({ indexedDB: null });
    ok("a browser with no IndexedDB still gets somewhere to put things", v.kind(), "memory");
    const r = await v.put("levels", "a", { name: "Cellar of Doom" });
    ok("and it works", [r.ok, (await v.get("levels", "a")).name], [true, "Cellar of Doom"]);
  }
  {
    const v = await V.open({ indexedDB: null });
    await v.put("levels", "a", { name: "one" });
    await v.put("levels", "b", { name: "two" });
    ok("levels come back as a list", (await v.all("levels")).map((x) => x.name).sort(), ["one", "two"]);
    ok("and can be counted", await v.count("levels"), 2);
    await v.del("levels", "a");
    ok("and deleted", await v.count("levels"), 1);
    await v.wipe("levels");
    ok("and the lot cleared", await v.count("levels"), 0);
  }
  {
    /* a private window can hand you an indexedDB that throws the moment
       you use it - that must degrade, not crash */
    const hostile = { open() { const r = {}; setTimeout(() => r.onerror && r.onerror(), 0); return r; } };
    const v = await V.open({ indexedDB: hostile });
    ok("an IndexedDB that refuses on first use falls back quietly", v.kind(), "memory");
    ok("and the game can still save", (await v.put("progress", "run", { level: 3 })).ok, true);
  }

  console.log("\nWhen a write fails\n");
  {
    const v = new V.Vault({
      kind: "indexeddb", durable: true,
      put: () => Promise.reject(Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" })),
      get: () => Promise.resolve(null), del: () => Promise.resolve(true),
      all: () => Promise.resolve([]), count: () => Promise.resolve(0), wipe: () => Promise.resolve(true)
    });
    const r = await v.put("levels", "big", { huge: true });
    ok("a full disk is reported, not swallowed", [r.ok, r.full], [false, true]);
  }
  {
    const v = new V.Vault({
      kind: "indexeddb", durable: true,
      put: () => Promise.reject(new Error("write refused")),
      get: () => Promise.resolve(null), del: () => Promise.resolve(true),
      all: () => Promise.resolve([]), count: () => Promise.resolve(0), wipe: () => Promise.resolve(true)
    });
    const r = await v.put("levels", "x", {});
    ok("and so is any other refusal", [r.ok, r.full], [false, false]);
  }

  console.log("\nAsking the browser to keep it\n");
  {
    const v = await V.open({ indexedDB: null });
    let asked = 0;
    const storage = { persisted: async () => false, persist: async () => { asked++; return true; } };
    ok("asking is granted", await v.askToBeKept(storage), true);
    await v.askToBeKept(storage);
    ok("and only asked once, however many levels get saved", asked, 1);
  }
  {
    const v = await V.open({ indexedDB: null });
    ok("an already-persistent origin does not ask again",
       await v.askToBeKept({ persisted: async () => true, persist: async () => { throw new Error("should not be called"); } }),
       true);
  }
  {
    const v = await V.open({ indexedDB: null });
    ok("a refusal is a refusal, not a crash",
       await v.askToBeKept({ persisted: async () => false, persist: async () => false }), false);
  }
  {
    const v = await V.open({ indexedDB: null });
    ok("a browser that cannot be asked says nothing rather than lying",
       await v.askToBeKept(null), null);
  }
  {
    const v = await V.open({ indexedDB: null });
    ok("how much room there is, when the browser will say",
       await v.room({ estimate: async () => ({ usage: 1234, quota: 5000000 }) }),
       { used: 1234, quota: 5000000 });
  }

  console.log("\nTelling the player the truth\n");
  {
    const v = await V.open({ indexedDB: null });
    const w = v.warnings({});
    ok("a browser that keeps nothing gets said out loud",
       [w.length, w[0].level, /until you close the tab/.test(w[0].say)], [1, "bad", true]);
  }
  {
    const v = new V.Vault(V.memDriver());
    v.d.kind = "indexeddb";
    v.granted = false;
    ok("so does a browser that would not promise to keep things",
       v.warnings({}).some((x) => /has not promised/.test(x.say)), true);
  }
  {
    const v = new V.Vault(V.memDriver());
    v.d.kind = "indexeddb";
    v.granted = true;
    const w = v.warnings({ webkit: true, installed: false, hasLevels: true });
    ok("Safari's seven days is warned about when the game is not installed",
       w.some((x) => /left alone for a week/.test(x.say)), true);
    ok("and so is the trap where installing starts an empty store",
       w.some((x) => /copy your level codes out FIRST/.test(x.say)), true);
  }
  {
    const v = new V.Vault(V.memDriver());
    v.d.kind = "indexeddb";
    v.granted = true;
    ok("and an installed game on a well-behaved browser is not nagged",
       v.warnings({ webkit: false, installed: true }), []);
  }

  console.log("\nBringing the old save across\n");
  {
    const v = await V.open({ indexedDB: null });
    const old = { level: 7, score: 3100, best: 9000, deepest: 9 };
    const r = await v.migrate(() => old);
    ok("the old single key is moved in", [r.moved, (await v.get("progress", "run")).deepest], [true, 9]);
  }
  {
    const v = await V.open({ indexedDB: null });
    await v.put("progress", "run", { deepest: 12 });
    const r = await v.migrate(() => ({ deepest: 3 }));
    ok("and never moved twice over the top of newer progress",
       [r.moved, (await v.get("progress", "run")).deepest], [false, 12]);
  }
  {
    const v = await V.open({ indexedDB: null });
    ok("a player with nothing to move is not a problem",
       (await v.migrate(() => null)).moved, false);
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
