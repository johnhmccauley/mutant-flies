#!/usr/bin/env node
/*
 * Sanity checks for the shipped pages. Run by CI before publishing, and
 * worth running after any hand-edit:
 *
 *   node tools/check.js
 *
 * Catches what breaks silently in files like these: a font glyph or sprite
 * of the wrong size, a syntax error that shows up only as a blank screen,
 * and an inlined copy of src/ that has drifted from the source it came from.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cp = require("child_process");

const root = path.resolve(__dirname, "..");
let bad = 0;
const fail = (m) => { console.error("  FAIL  " + m); bad++; };
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/* --- the 8x8 font: 8 rows of 8, joined by 7 commas = 71 characters --- */
{
  const font = read("src/font.js");
  const blk = font.match(/var FONTSRC = \{([\s\S]*?)\n\s*\};/);
  if (!blk) fail("FONTSRC block not found in src/font.js");
  else {
    const lines = blk[1].split("\n").filter((l) => l.trim().length);
    let ok = 0;
    for (const line of lines) {
      const q = line.match(/"([.#,]{71})"/);
      if (!q) { fail("malformed glyph: " + line.trim().slice(0, 24)); continue; }
      const r = q[1].split(",");
      if (r.length !== 8 || r.some((x) => x.length !== 8)) fail("glyph geometry: " + line.trim().slice(0, 12));
      else ok++;
    }
    console.log("  ok    " + ok + "/" + lines.length + " glyphs");
  }
}

/* --- the author's VDU 23 characters: eight bytes, each a byte -------- */
{
  global.window = global;
  delete require.cache[require.resolve("../src/rules.js")];
  require("../src/rules.js");
  const MF = global.MutantFly;
  let n = 0;
  for (const k of Object.keys(MF.UDG)) {
    const b = MF.UDG[k];
    if (!Array.isArray(b) || b.length !== 8) { fail("UDG " + k + " is not 8 bytes"); continue; }
    if (b.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) { fail("UDG " + k + " has a value outside 0-255"); continue; }
    n++;
  }
  console.log("  ok    " + n + " user-defined characters");

  /* the four ENVELOPEs are 13 values after the number */
  for (const k of Object.keys(MF.ENVELOPES))
    if (MF.ENVELOPES[k].length !== 13) fail("ENVELOPE " + k + " has " + MF.ENVELOPES[k].length + " parameters, expected 13");
  console.log("  ok    4 envelopes");
}

/* --- every page's script must parse --------------------------------- */
for (const page of ["index.html", "classic/index.html"]) {
  const src = read(page);
  let i = 0, blocks = 0, chars = 0;
  while ((i = src.indexOf("<script", i)) !== -1) {
    const open = src.indexOf(">", i);
    const close = src.indexOf("</script>", open);
    if (close === -1) { fail(page + ": unclosed <script>"); break; }
    const tag = src.slice(i, open);
    const body = src.slice(open + 1, close);
    if (!/\ssrc\s*=/.test(tag) && body.trim()) {
      try { new vm.Script(body); blocks++; chars += body.length; }
      catch (e) { fail(page + " script: " + e.message); }
    }
    i = close + 9;
  }
  console.log("  ok    " + page + " - " + blocks + " script block(s), " + chars + " chars, all parse");
}

/* --- the inlined copies must still match src/ ----------------------- */
{
  const before = ["index.html", "classic/index.html"].map(read);
  cp.execFileSync(process.execPath, [path.join(root, "tools", "build.js")], { stdio: "pipe" });
  const after = ["index.html", "classic/index.html"].map(read);
  if (before.join("") !== after.join(""))
    fail("a page's inlined copy of src/ was stale - tools/build.js has now fixed it, commit the result");
  else console.log("  ok    inlined sources match src/");
}

/* --- balanced markup ------------------------------------------------- */
for (const page of ["index.html", "classic/index.html"]) {
  const src = read(page);
  for (const t of ["html", "head", "body", "main", "div", "button", "style", "p", "ul", "li"]) {
    const o = (src.match(new RegExp("<" + t + "[ >]", "g")) || []).length;
    const c = (src.match(new RegExp("</" + t + ">", "g")) || []).length;
    if (o !== c) fail(page + " <" + t + ">: " + o + " open, " + c + " close");
  }
}
console.log("  ok    markup balanced");

/* --- the original must still be here --------------------------------- */
{
  const bas = read("original/FLY.bas");
  if (!/REM FLY BY John Mc Cauley/.test(bas)) fail("original/FLY.bas is not the listing");
  const lines = bas.trim().split("\n").length;
  if (lines !== 125) fail("original/FLY.bas has " + lines + " lines, expected 125");
  else console.log("  ok    original listing present, 125 lines");
}


/* --- two things with the same name ----------------------------------
   index.html is one very long script, and a name declared twice at the
   top level does not complain - the second one silently wins. It has
   cost real time twice now: a `var edMark` holding a piece of scenery
   quietly replaced `function edMark()`, the editor's undo checkpoint,
   so every stamp threw and undo stopped recording; and before that a
   CSS class was reused for two different pictures. Nothing catches it
   at parse time and the symptom always shows up somewhere else, so it
   gets caught here instead.

   Only column-zero declarations count. A `var` inside a function that
   shadows something is ordinary and deliberate. */
{
  const src = read("index.html");
  const where = new Map();
  const clash = [];
  const note = (name, how, line) => {
    const had = where.get(name);
    if (had && had.how !== how)
      clash.push(name + " is a " + had.how + " on line " + had.line +
                 " and a " + how + " on line " + line);
    else if (!had) where.set(name, { how, line });
  };
  src.split("\n").forEach((raw, i) => {
    const f = /^function ([A-Za-z_$][\w$]*)\s*\(/.exec(raw);
    if (f) return note(f[1], "function", i + 1);
    if (!/^var /.test(raw)) return;
    /* the names `var a = 1, b, c = 2;` actually declares */
    const body = raw.slice(4);
    let depth = 0, name = "", want = true;
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if ("([{".indexOf(ch) >= 0) depth++;
      else if (")]}".indexOf(ch) >= 0) depth--;
      if (depth > 0) continue;
      if (want && /[A-Za-z_$]/.test(ch) && !name) { name = ch; continue; }
      if (want && name && /[\w$]/.test(ch)) { name += ch; continue; }
      if (name) { note(name, "variable", i + 1); name = ""; want = false; }
      if (ch === ",") want = true;
      else if (ch === "=" || ch === ";") want = false;
    }
    if (name) note(name, "variable", i + 1);
  });
  if (clash.length) clash.forEach((c) => fail("index.html: " + c));
  else console.log("  ok    no name declared two different ways");
}

if (bad) { console.error("\n" + bad + " problem(s)"); process.exit(1); }
console.log("\nall checks passed");
