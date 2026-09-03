/* =====================================================================
   WHO YOU ARE, WITHOUT LOGGING IN

   The game must open and play with no account and no network. But a
   level has an author, a rating has somebody who gave it, and a level
   that has gone public must only ever be edited by the person who made
   it. So the game needs to know who you are - it just must not ask.

   So it does not issue you a name. On first run it generates a signing
   key in the browser and never sends the private half anywhere. Your
   identity IS that key: your player id is a thumbprint of its public
   half, and everything you upload is signed with the private half.

   Which means nobody has to be trusted to hand out identities, and
   nobody can claim to be you: a server presented with a level edit
   signed by the key whose thumbprint matches the level's author does
   not need an account system to know it is genuine, and one that is not
   cannot be faked by anybody who has not got your key. It is the same
   trick as an ssh key, minus the part where you have to set it up.

   The costs are real and worth stating plainly:

     - Clear your site data and the key is gone, and with it your levels.
       So there is a recovery code: the key, written out, short enough to
       paste into a note. That is the backup, and it is the ONLY backup.
     - Anyone holding that code is you. It is a password that cannot be
       reset, which is the price of never having to set one.
     - A new device is a new person until you paste the code in.
     - Nothing here proves you are a HUMAN, only that you are the same
       one as last time. Stopping one person from being a thousand people
       is a different problem and needs the server's help.

   Everything above works offline. The key is made on the device, the
   signing happens on the device, and none of it needs a network - the
   network only ever checks the signatures afterwards.
   ===================================================================== */
(function (root) {
  "use strict";

  var KEY = "mutantfly.who.v1";
  var ALGO = { name: "ECDSA", namedCurve: "P-256" };
  var SIGN = { name: "ECDSA", hash: { name: "SHA-256" } };

  function subtle() {
    var c = root.crypto || (typeof crypto !== "undefined" ? crypto : null);
    return c && c.subtle ? c.subtle : null;
  }

  /* localStorage throws outright in some places - a private window, an
     opaque origin, a browser told to block site data - and the game has
     to keep working when it does. So it degrades to memory: you are
     still somebody for this session, you just are not the same somebody
     next time, and the game can say so. */
  function browserStore() {
    var mem = {};
    var real = null;
    try {
      real = root.localStorage;
      real.setItem(KEY + ".probe", "1");
      real.removeItem(KEY + ".probe");
    } catch (e) { real = null; }
    return {
      durable: !!real,
      get: function (k) {
        try { return real ? real.getItem(k) : (mem[k] === undefined ? null : mem[k]); }
        catch (e) { return mem[k] === undefined ? null : mem[k]; }
      },
      set: function (k, v) {
        try { if (real) { real.setItem(k, v); return true; } } catch (e) { /* full, or refused */ }
        mem[k] = v;
        return false;
      },
      clear: function (k) {
        try { if (real) real.removeItem(k); } catch (e) { /* nothing to do */ }
        delete mem[k];
      }
    };
  }

  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return (root.btoa ? root.btoa(s) : Buffer.from(bytes).toString("base64"))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64(text) {
    var s = String(text).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var raw = root.atob ? root.atob(s) : Buffer.from(s, "base64").toString("binary");
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function bytes(text) {
    var out = [], i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charCodeAt(i);
      if (ch < 128) out.push(ch);
      else if (ch < 2048) out.push(192 | (ch >> 6), 128 | (ch & 63));
      else out.push(224 | (ch >> 12), 128 | ((ch >> 6) & 63), 128 | (ch & 63));
    }
    return new Uint8Array(out);
  }

  /* A player id is a thumbprint of the public key, written in groups so
     that a person can read one out or check two are the same at a
     glance. Sixteen bytes of a SHA-256 is far more than enough to make a
     collision something that will not happen. */
  function thumbprint(raw) {
    return subtle().digest("SHA-256", raw).then(function (h) {
      var b = new Uint8Array(h), s = "";
      for (var i = 0; i < 10; i++) s += ("0" + b[i].toString(16)).slice(-2);
      return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12) +
             "-" + s.slice(12, 16) + "-" + s.slice(16, 20);
    });
  }

  function Who(store) {
    this.store = store || browserStore();
    this.id = null;
    this.pub = null;
    this.priv = null;
    this.name = null;
  }

  /* the key, made once and kept - or made now if this is the first time */
  Who.prototype.open = function () {
    var self = this;
    if (!subtle()) return Promise.reject(new Error("no WebCrypto here"));
    var saved = self.store.get(KEY);
    if (saved) {
      var rec;
      try { rec = JSON.parse(saved); } catch (e) { rec = null; }
      if (rec && rec.priv && rec.pub) {
        return self.adopt(rec.priv, rec.pub).then(function () {
          self.name = rec.name || null;
          return self;
        }).catch(function () { return self.mint(); });
      }
    }
    return self.mint();
  };

  Who.prototype.mint = function () {
    var self = this;
    return subtle().generateKey(ALGO, true, ["sign", "verify"]).then(function (pair) {
      return Promise.all([
        subtle().exportKey("jwk", pair.privateKey),
        subtle().exportKey("raw", pair.publicKey)
      ]).then(function (out) {
        self.priv = pair.privateKey;
        self.pubRaw = new Uint8Array(out[1]);
        self.pub = b64(self.pubRaw);
        return thumbprint(self.pubRaw).then(function (id) {
          self.id = id;
          self.privJwk = out[0];
          self.save();
          return self;
        });
      });
    });
  };

  Who.prototype.adopt = function (privJwk, pub) {
    var self = this;
    var raw = unb64(pub);
    return Promise.all([
      subtle().importKey("jwk", privJwk, ALGO, true, ["sign"]),
      thumbprint(raw)
    ]).then(function (out) {
      self.priv = out[0];
      self.privJwk = privJwk;
      self.pub = pub;
      self.pubRaw = raw;
      self.id = out[1];
      return self;
    });
  };

  Who.prototype.save = function () {
    return this.store.set(KEY, JSON.stringify({
      priv: this.privJwk, pub: this.pub, name: this.name
    }));
  };

  Who.prototype.setName = function (name) {
    this.name = String(name || "").slice(0, 24);
    this.save();
    return this.name;
  };

  Who.prototype.sign = function (text) {
    var self = this;
    return subtle().sign(SIGN, self.priv, bytes(text)).then(function (sig) {
      return b64(new Uint8Array(sig));
    });
  };

  /* Anybody can check this, including a server that has never heard of
     the signer: the id is derived from the key, so a signature that
     verifies against a key whose thumbprint is the claimed id is proof,
     with nothing to look up and nobody to ask. */
  function verify(id, pub, text, sig) {
    if (!subtle()) return Promise.resolve(false);
    var raw;
    try { raw = unb64(pub); } catch (e) { return Promise.resolve(false); }
    return thumbprint(raw).then(function (t) {
      if (t !== id) return false;             /* that key is not that person */
      return subtle().importKey("raw", raw, ALGO, true, ["verify"])
        .then(function (key) {
          return subtle().verify(SIGN, key, unb64(sig), bytes(text));
        })
        .catch(function () { return false; });
    }).catch(function () { return false; });
  }

  /* ------------------------------------------------------------------
     The recovery code.

     This is the whole identity written out - so it is worth being blunt
     in the UI: it is the only way back to your levels, and anybody who
     has it is you.
     ------------------------------------------------------------------ */
  Who.prototype.recoveryCode = function () {
    var body = b64(bytes(JSON.stringify({ p: this.privJwk, k: this.pub, n: this.name })));
    return "MF1-" + body.replace(/(.{40})/g, "$1\n");
  };

  Who.prototype.restore = function (code) {
    var self = this;
    var body = String(code || "").replace(/\s+/g, "");
    if (body.indexOf("MF1-") !== 0) return Promise.reject(new Error("not a recovery code"));
    var rec;
    try {
      var text = "";
      var raw = unb64(body.slice(4));
      for (var i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
      rec = JSON.parse(decodeURIComponent(escape(text)));
    } catch (e) { return Promise.reject(new Error("that code is damaged")); }
    if (!rec || !rec.p || !rec.k) return Promise.reject(new Error("that code is damaged"));
    return self.adopt(rec.p, rec.k).then(function () {
      self.name = rec.n || null;
      self.save();
      return self;
    });
  };

  root.MutantWho = {
    Who: Who, verify: verify, browserStore: browserStore,
    b64: b64, unb64: unb64, KEY: KEY
  };
})(typeof window !== "undefined" ? window : globalThis);
