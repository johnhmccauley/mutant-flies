/* =====================================================================
   TALKING TO THE CATALOGUE

   The half of the catalogue that lives in the game. Every request that
   changes anything is signed with the player's own key - there is no
   login, no shared secret shipped inside the game for somebody to pull
   out, and nothing to steal that would let one player act as another.

   The order is always: ask for a nonce, sign the method, the path, that
   nonce and the exact body, send all four along with the public key.
   The server checks the key thumbprints to the id being claimed, that
   the signature is real, and that the nonce was one of its own and has
   not been spent. Which is a lot of words for "prove it", and it costs
   one extra round trip on a write and nothing at all on a read.

   Everything here assumes the network may simply not be there, because
   most of the time it will not be: the game is played offline and the
   catalogue is the one part that is not. So every call resolves rather
   than throwing, and says what happened in words a player can read.
   ===================================================================== */
(function (root) {
  "use strict";

  var W = root.MutantWho;

  function Cat(opts) {
    opts = opts || {};
    this.base = opts.base || "";        /* same origin, which is the point */
    this.who = opts.who || null;        /* a MutantWho.Who, already opened */
    this.timeout = opts.timeout || 12000;
  }

  /* Never throws. A catalogue that blows up in a game that was playing
     perfectly well without it is worse than no catalogue. */
  Cat.prototype.raw = function (method, path, body, headers) {
    var self = this;
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, self.timeout) : null;
    var init = { method: method, headers: headers || {} };
    if (body !== undefined && body !== null) {
      init.body = body;
      init.headers["Content-Type"] = "application/json";
    }
    if (ctrl) init.signal = ctrl.signal;

    return fetch(self.base + path, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        if (res.ok) return { ok: true, status: res.status, data: data };
        return { ok: false, status: res.status,
                 why: (data && data.error) || ("the catalogue said " + res.status),
                 data: data };
      });
    }, function () {
      if (timer) clearTimeout(timer);
      return { ok: false, status: 0, offline: true,
               why: "no answer from the catalogue - your work is saved here" };
    });
  };

  Cat.prototype.get = function (path) { return this.raw("GET", path); };

  /* A signed call: nonce, then sign, then send. */
  Cat.prototype.send = function (method, path, payload) {
    var self = this;
    if (!self.who) return Promise.resolve({ ok: false, why: "no player key yet" });
    var body = payload === undefined ? "" : JSON.stringify(payload);
    return self.get("/api/nonce").then(function (n) {
      if (!n.ok) return n;
      var nonce = n.data && n.data.nonce;
      if (!nonce) return { ok: false, why: "the catalogue would not issue a nonce" };
      var text = method.toUpperCase() + "\n" + path + "\n" + nonce + "\n" + body;
      return self.who.sign(text).then(function (sig) {
        return self.raw(method, path, body === "" ? null : body, {
          "x-mf-id": self.who.id,
          "x-mf-key": self.who.pub,
          "x-mf-nonce": nonce,
          "x-mf-sig": sig
        });
      });
    });
  };

  /* ---- reading, which needs no proof ------------------------------ */
  Cat.prototype.board = function (sort, cursor) {
    var q = "/api/levels?sort=" + (sort === "plays" ? "plays" : "stars") +
            "&me=" + encodeURIComponent(this.who ? this.who.id : "");
    if (cursor) q += "&cursor=" + encodeURIComponent(cursor);
    return this.get(q);
  };
  Cat.prototype.level = function (id) {
    return this.get("/api/levels/" + encodeURIComponent(id) +
                    "?me=" + encodeURIComponent(this.who ? this.who.id : ""));
  };

  /* ---- who you are ------------------------------------------------ */
  Cat.prototype.me = function () { return this.send("POST", "/api/me"); };
  Cat.prototype.wallet = function () { return this.send("POST", "/api/wallet"); };
  Cat.prototype.nameFree = function (name) {
    return this.send("POST", "/api/name/free", { name: name });
  };
  Cat.prototype.claimName = function (name) {
    return this.send("POST", "/api/name", { name: name });
  };
  Cat.prototype.claimPurchase = function (email) {
    return this.send("POST", "/api/claim", { email: email });
  };

  /* ---- your levels ------------------------------------------------ */
  Cat.prototype.upload = function (level) {
    return this.send("POST", "/api/levels", {
      id: level.id, name: level.name, code: level.body,
      cellar: level.cellar, thumb: level.thumb
    });
  };
  Cat.prototype.update = function (level) {
    return this.send("POST", "/api/levels/" + encodeURIComponent(level.id), {
      name: level.name, code: level.body, thumb: level.thumb
    });
  };
  Cat.prototype.setState = function (id, state) {
    return this.send("POST", "/api/levels/" + encodeURIComponent(id) + "/state", { state: state });
  };
  Cat.prototype.remove = function (id) {
    return this.send("DELETE", "/api/levels/" + encodeURIComponent(id), {});
  };

  /* ---- playing somebody else's ------------------------------------ */
  Cat.prototype.played = function (id, opId) {
    return this.send("POST", "/api/levels/" + encodeURIComponent(id) + "/play", { op: opId });
  };
  Cat.prototype.rate = function (id, score) {
    return this.send("POST", "/api/levels/" + encodeURIComponent(id) + "/rate", { score: score });
  };
  Cat.prototype.podium = function (period) {
    return this.send("POST", "/api/podium", period ? { period: period } : {});
  };

  /* ------------------------------------------------------------------
     Putting a level up.

     Upload if it has never been up, update if it has, then publish. The
     three steps are separate on the server because they are separate
     things - a level can sit privately on the catalogue for as long as
     its author likes - but from the editor it is one button, so it is
     one call here.
     ------------------------------------------------------------------ */
  Cat.prototype.publish = function (level) {
    var self = this;
    var put = level.everUploaded ? self.update(level) : self.upload(level);
    return put.then(function (r) {
      /* a level already up under this id is not an error - it is the
         same level, and the second press of a button */
      if (!r.ok && r.status !== 409) return r;
      return self.setState(level.id, "public").then(function (s) {
        if (s.ok) return { ok: true, state: "public" };
        return s;
      });
    });
  };

  /* ------------------------------------------------------------------
     The outbox.

     A play or a rating made with no connection is not lost, it waits.
     Each carries an id made here, so the same one arriving twice counts
     once however many times it is retried - which is what makes it safe
     to drain the queue at every opportunity and never think about it
     again.
     ------------------------------------------------------------------ */
  function opId() {
    var b = crypto.getRandomValues(new Uint8Array(12));
    var s = "";
    for (var i = 0; i < b.length; i++) s += ("0" + b[i].toString(16)).slice(-2);
    return s;
  }

  Cat.prototype.drain = function (vault) {
    var self = this;
    if (!vault) return Promise.resolve({ sent: 0 });
    return vault.all("outbox").then(function (rows) {
      if (!rows.length) return { sent: 0 };
      var sent = 0, stuck = 0;
      return rows.reduce(function (chain, row) {
        return chain.then(function () {
          var go = row.kind === "rate"
            ? self.rate(row.levelId, row.score)
            : self.played(row.levelId, row.op);
          return go.then(function (r) {
            /* Sent, or refused for a reason that will not change - a
               level that has gone, a rating that is not allowed. Either
               way it comes out of the queue; only a network failure
               leaves it in, or the queue never empties. */
            if (r.ok || (r.status >= 400 && r.status < 500)) {
              sent += r.ok ? 1 : 0;
              return vault.del("outbox", row.id);
            }
            stuck++;
          });
        });
      }, Promise.resolve()).then(function () { return { sent: sent, stuck: stuck }; });
    });
  };

  Cat.prototype.queue = function (vault, entry) {
    if (!vault) return Promise.resolve(false);
    var id = opId();
    var row = { id: id, op: id, at: 0, kind: entry.kind,
                levelId: entry.levelId, score: entry.score };
    return vault.put("outbox", id, row).then(function (r) { return !!(r && r.ok); });
  };

  root.MutantCat = { Cat: Cat, opId: opId };
})(typeof window !== "undefined" ? window : globalThis);
