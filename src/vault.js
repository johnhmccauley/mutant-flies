/* =====================================================================
   THE VAULT

   Where a player's things actually live: their progress, the levels they
   have built, the levels they have collected, and anything waiting to be
   sent up when there is a network again.

   This used to be one localStorage key holding one small JSON object,
   which was fine when the only thing worth keeping was a high score. It
   is not fine for levels somebody spent an evening building. localStorage
   is a few megabytes of synchronous strings shared with everything else
   on the origin, and it is the first thing a browser throws away.

   So: IndexedDB, four stores, and three things that matter more than the
   database choice.

   FIRST, ASK TO BE KEPT. navigator.storage.persist() asks the browser not
   to evict this origin under pressure. It is a request and not a promise:
   Chrome grants or silently denies it on engagement heuristics, Firefox
   asks the player, Safari decides for itself. It is asked for on the
   first level SAVE rather than on page load, because every engagement
   heuristic rewards the later moment - a player who has built something
   has demonstrably earned the storage. What it returned is remembered, so
   the game can be honest about it.

   SECOND, SAFARI FORGETS. WebKit deletes ALL script-writable storage for
   an origin - IndexedDB, localStorage, the Cache API and the service
   worker with it - after seven days of browser use without the player
   visiting. It is not an edge case, it is the default for any site opened
   in Safari. A player who goes away for a fortnight comes back to
   nothing. The documented exemption is a web app added to the Home
   Screen, which keeps its own counter. That is why installing matters,
   and why `warnings()` says so out loud rather than hoping.

   THIRD, AND WORSE: on iOS a Home Screen web app gets a SEPARATE storage
   partition from Safari. A player who builds levels in a tab and then
   installs the game to their Home Screen launches into an empty vault.
   So the game must never push the install prompt before the player has a
   way to carry their work across - which is what the level codes and the
   recovery code are for.

   Which is the real conclusion: none of this is a guarantee. The only
   durable backup is the one the player is holding - a level code pasted
   somewhere, a recovery code written down. The vault does its best and
   tells the truth about how good its best is.
   ===================================================================== */
(function (root) {
  "use strict";

  var DB = "mutantfly", DB_VERSION = 1;
  var STORES = ["progress", "levels", "collected", "outbox"];
  var OLD_KEY = "mutantfly.v1";          /* the single localStorage key */

  /* ---- a store that lives only as long as the page ------------------ */
  function memDriver() {
    var data = {};
    STORES.forEach(function (s) { data[s] = {}; });
    return {
      kind: "memory",
      durable: false,
      get: function (store, key) { return Promise.resolve(data[store][key] || null); },
      put: function (store, key, value) { data[store][key] = value; return Promise.resolve(true); },
      del: function (store, key) { delete data[store][key]; return Promise.resolve(true); },
      all: function (store) {
        return Promise.resolve(Object.keys(data[store]).map(function (k) { return data[store][k]; }));
      },
      count: function (store) { return Promise.resolve(Object.keys(data[store]).length); },
      wipe: function (store) { data[store] = {}; return Promise.resolve(true); }
    };
  }

  /* ---- the real one ------------------------------------------------- */
  function idbDriver(idb) {
    var open = null;
    function db() {
      if (open) return open;
      open = new Promise(function (resolve, reject) {
        var req = idb.open(DB, DB_VERSION);
        req.onupgradeneeded = function () {
          var d = req.result;
          STORES.forEach(function (s) {
            if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
          });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("indexeddb refused")); };
        req.onblocked = function () { reject(new Error("indexeddb blocked")); };
      });
      return open;
    }
    function run(store, mode, fn) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var tx = d.transaction(store, mode);
          var req = fn(tx.objectStore(store));
          tx.onabort = tx.onerror = function () { reject(tx.error || new Error("write refused")); };
          if (req) req.onsuccess = function () { resolve(req.result); };
          else tx.oncomplete = function () { resolve(true); };
        });
      });
    }
    return {
      kind: "indexeddb",
      durable: true,
      get: function (s, k) { return run(s, "readonly", function (o) { return o.get(k); })
        .then(function (v) { return v === undefined ? null : v; }); },
      put: function (s, k, v) { return run(s, "readwrite", function (o) { return o.put(v, k); })
        .then(function () { return true; }); },
      del: function (s, k) { return run(s, "readwrite", function (o) { return o.delete(k); })
        .then(function () { return true; }); },
      all: function (s) { return run(s, "readonly", function (o) { return o.getAll(); })
        .then(function (v) { return v || []; }); },
      count: function (s) { return run(s, "readonly", function (o) { return o.count(); }); },
      wipe: function (s) { return run(s, "readwrite", function (o) { return o.clear(); })
        .then(function () { return true; }); }
    };
  }

  function Vault(driver) {
    this.d = driver;
    this.asked = false;
    this.granted = null;
  }

  Vault.prototype.kind = function () { return this.d.kind; };
  Vault.prototype.get = function (s, k) { return this.d.get(s, k); };
  Vault.prototype.del = function (s, k) { return this.d.del(s, k); };
  Vault.prototype.all = function (s) { return this.d.all(s); };
  Vault.prototype.count = function (s) { return this.d.count(s); };
  Vault.prototype.wipe = function (s) { return this.d.wipe(s); };

  /* A write that fails must say so rather than looking like it worked -
     a player whose level quietly did not save has lost an evening and
     does not know it yet. */
  Vault.prototype.put = function (s, k, v) {
    var self = this;
    return this.d.put(s, k, v).then(function () { return { ok: true }; },
      function (err) {
        var full = err && /quota|full|exceeded/i.test(String(err.name || "") + String(err.message || ""));
        return { ok: false, full: !!full, why: String((err && err.message) || err) };
      });
  };

  /* ------------------------------------------------------------------
     Saving a level is the moment to ask to be kept - not page load. The
     player has just made something, which is exactly the engagement
     every browser's heuristic is looking for.
     ------------------------------------------------------------------ */
  Vault.prototype.askToBeKept = function (storage) {
    var self = this;
    storage = storage || (root.navigator && root.navigator.storage);
    if (!storage || !storage.persist) return Promise.resolve(null);
    if (self.asked) return Promise.resolve(self.granted);
    self.asked = true;
    return Promise.resolve()
      .then(function () {
        return storage.persisted ? storage.persisted() : false;
      })
      .then(function (already) { return already ? true : storage.persist(); })
      .then(function (got) { self.granted = !!got; return self.granted; },
            function () { self.granted = false; return false; });
  };

  Vault.prototype.room = function (storage) {
    storage = storage || (root.navigator && root.navigator.storage);
    if (!storage || !storage.estimate) return Promise.resolve(null);
    return storage.estimate().then(function (e) {
      return { used: e.usage || 0, quota: e.quota || 0 };
    }, function () { return null; });
  };

  /* ------------------------------------------------------------------
     What to tell the player, in the player's terms. Every one of these
     is a real way to lose an evening's work, and none of them announces
     itself when it happens.
     ------------------------------------------------------------------ */
  Vault.prototype.warnings = function (env) {
    env = env || {};
    var out = [];
    if (this.d.kind === "memory")
      out.push({ level: "bad", say: "This browser will not keep anything. Levels you build here last until you close the tab - copy the code out if you want to keep one." });
    else if (this.granted === false)
      out.push({ level: "warn", say: "The browser has not promised to keep your levels, and may clear them if it runs short of room. Keep a copy of anything you would miss." });
    if (env.webkit && !env.installed)
      out.push({ level: "warn", say: "On this browser a site left alone for a week has everything cleared - levels, progress, the lot. Adding the game to your Home Screen stops that." });
    if (env.webkit && env.installed === false && env.hasLevels)
      out.push({ level: "warn", say: "Adding to the Home Screen starts a fresh, separate store on this browser, so copy your level codes out FIRST or you will open an empty game." });
    return out;
  };

  /* ---- the old single key, brought across once ---------------------- */
  Vault.prototype.migrate = function (readOld) {
    var self = this;
    return self.get("progress", "run").then(function (already) {
      if (already) return { moved: false, why: "already here" };
      var old = readOld ? readOld() : null;
      if (!old) return { moved: false, why: "nothing to move" };
      return self.put("progress", "run", old).then(function (r) {
        return { moved: !!r.ok, from: "localStorage", carried: old };
      });
    });
  };

  /* Pick the best store available, and never throw: a browser that has
     switched IndexedDB off must still be able to play. */
  function open(env) {
    env = env || {};
    var idb = env.indexedDB || (typeof root !== "undefined" && root.indexedDB);
    if (!idb) return Promise.resolve(new Vault(memDriver()));
    var v = new Vault(idbDriver(idb));
    /* prove it actually works before believing in it - a private window
       can hand you an indexedDB that throws on first use */
    return v.count("progress").then(function () { return v; },
                                    function () { return new Vault(memDriver()); });
  }

  root.MutantVault = {
    open: open, Vault: Vault, memDriver: memDriver, idbDriver: idbDriver,
    STORES: STORES, DB: DB, DB_VERSION: DB_VERSION, OLD_KEY: OLD_KEY
  };
})(typeof window !== "undefined" ? window : globalThis);
