/* =====================================================================
   LEVEL IO

   Turning a cellar into a short string and back.

   A cellar is a handful of parallel arrays of small numbers, 884 cells
   apiece, and most of a cellar is the same number over and over - empty
   floor, level ground, dry stone. So the arrays are run-length coded
   first and only then turned into text, which takes a level from about
   twenty thousand characters of JSON down to something you can paste
   into a message.

   The text alphabet is URL-safe base64 with no padding, so a level code
   survives being pasted into a chat window, a query string, or a text
   file somebody has opened in Notepad.
   ===================================================================== */
(function (root) {
  "use strict";

  var A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var BACK = {};
  for (var i = 0; i < A.length; i++) BACK[A.charAt(i)] = i;

  /* ------------------------------------------------------------------
     Run-length coding.

     A run is a value and a count. Counts run to 255 and a longer run is
     simply written as several runs, which costs two bytes per 255 cells
     and saves a great deal of thinking. Values must be bytes, which
     every array in a cellar is - heights, cell kinds, fluids, volumes
     and the rest are all small.
     ------------------------------------------------------------------ */
  function rle(bytes) {
    var out = [], n = bytes.length, i = 0;
    while (i < n) {
      var v = bytes[i], run = 1;
      while (i + run < n && bytes[i + run] === v && run < 255) run++;
      out.push(v & 255, run);
      i += run;
    }
    return out;
  }

  function unrle(pairs, want) {
    var out = new Uint8Array(want), at = 0;
    for (var i = 0; i + 1 < pairs.length; i += 2) {
      var v = pairs[i], run = pairs[i + 1];
      for (var k = 0; k < run && at < want; k++) out[at++] = v;
    }
    return out;
  }

  /* three bytes to four characters, the usual way round */
  function toText(bytes) {
    var s = "", i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var w = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s += A.charAt((w >> 18) & 63) + A.charAt((w >> 12) & 63) +
           A.charAt((w >> 6) & 63) + A.charAt(w & 63);
    }
    var left = bytes.length - i;
    if (left === 1) {
      var w1 = bytes[i] << 16;
      s += A.charAt((w1 >> 18) & 63) + A.charAt((w1 >> 12) & 63);
    } else if (left === 2) {
      var w2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      s += A.charAt((w2 >> 18) & 63) + A.charAt((w2 >> 12) & 63) + A.charAt((w2 >> 6) & 63);
    }
    return s;
  }

  function fromText(s) {
    var out = [], i;
    for (i = 0; i + 3 < s.length; i += 4) {
      var w = (BACK[s.charAt(i)] << 18) | (BACK[s.charAt(i + 1)] << 12) |
              (BACK[s.charAt(i + 2)] << 6) | BACK[s.charAt(i + 3)];
      out.push((w >> 16) & 255, (w >> 8) & 255, w & 255);
    }
    var left = s.length - i;
    if (left === 2) {
      var w1 = (BACK[s.charAt(i)] << 18) | (BACK[s.charAt(i + 1)] << 12);
      out.push((w1 >> 16) & 255);
    } else if (left === 3) {
      var w2 = (BACK[s.charAt(i)] << 18) | (BACK[s.charAt(i + 1)] << 12) |
               (BACK[s.charAt(i + 2)] << 6);
      out.push((w2 >> 16) & 255, (w2 >> 8) & 255);
    }
    return out;
  }

  /* an array of small numbers, as a short string */
  function packArray(arr) { return toText(rle(arr)); }
  function unpackArray(text, want) {
    if (typeof text !== "string" || !text) return new Uint8Array(want);
    for (var i = 0; i < text.length; i++)
      if (BACK[text.charAt(i)] === undefined) return null;   /* not ours */
    return unrle(fromText(text), want);
  }

  /* ------------------------------------------------------------------
     A check digit over the whole record, so a code that got truncated
     in a chat window says so instead of loading as a cellar with one
     wall missing. Not security - there is nothing to secure against
     here - just a way of telling damaged from merely unfamiliar.
     ------------------------------------------------------------------ */
  function sum(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function seal(text) { return text + "." + sum(text).toString(36); }
  function unseal(sealed) {
    if (typeof sealed !== "string") return null;
    var cut = sealed.lastIndexOf(".");
    if (cut < 0) return null;
    var body = sealed.slice(0, cut);
    return sum(body).toString(36) === sealed.slice(cut + 1) ? body : null;
  }

  root.MutantLevelIO = {
    packArray: packArray, unpackArray: unpackArray,
    rle: rle, unrle: unrle, toText: toText, fromText: fromText,
    seal: seal, unseal: unseal, sum: sum
  };
})(typeof window !== "undefined" ? window : globalThis);
