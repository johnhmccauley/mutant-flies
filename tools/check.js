#!/usr/bin/env node
/*
 * Sanity checks for index.html. Run by CI before publishing, and useful
 * after any hand-edit:
 *
 *   node tools/check.js
 *
 * Catches the two things that break silently in a file like this: a sprite
 * or font glyph that is the wrong number of pixels, and a syntax error in
 * the game script that only shows up as a blank screen in the browser.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
let bad = 0;
const fail = (m) => { console.error("  FAIL  " + m); bad++; };

// --- 16x16 sprites ----------------------------------------------------
const udg = src.match(/var UDG = \{([\s\S]*?)\n\};/);
if (!udg) fail("UDG block not found");
else {
  let rows = 0;
  for (const line of udg[1].split("\n")) {
    const q = line.match(/"([^"]*)"/);
    if (!q) continue;
    if (q[1].length !== 16) fail("sprite row is " + q[1].length + " px: " + q[1]);
    else rows++;
  }
  if (rows % 16) fail("sprite rows (" + rows + ") is not a whole number of 16x16 sprites");
  console.log("  ok    " + (rows / 16) + " sprites, " + rows + " rows");
}

// --- 8x8 font: 8 rows of 8 joined by 7 commas = 71 characters ---------
const font = src.match(/var FONTSRC = \{([\s\S]*?)\n\};/);
if (!font) fail("FONTSRC block not found");
else {
  const lines = font[1].split("\n").filter((l) => l.trim().length);
  let ok = 0;
  for (const line of lines) {
    const q = line.match(/"([.#,]{71})"/);
    if (!q) { fail("malformed glyph: " + line.slice(0, 24)); continue; }
    const r = q[1].split(",");
    if (r.length !== 8 || r.some((x) => x.length !== 8)) fail("glyph geometry: " + line.slice(0, 12));
    else ok++;
  }
  console.log("  ok    " + ok + "/" + lines.length + " glyphs");
}

// --- the game script must parse ---------------------------------------
const js = src.slice(src.indexOf("<script>") + 8, src.lastIndexOf("</script>"));
try {
  new vm.Script(js);
  console.log("  ok    script parses (" + js.length + " chars)");
} catch (e) {
  fail("syntax error in game script: " + e.message);
}

// --- the procedures named in the magazine must all still be here ------
for (const p of ["PROCinstructions", "PROCtitle_page", "PROCmove_bricks", "PROCmove_fly",
                 "PROCnext_sheet", "PROCbonus", "PROCloss", "PROCset_level"]) {
  if (!js.includes("function " + p)) fail("missing procedure " + p);
}

// --- balanced markup ---------------------------------------------------
for (const t of ["html", "head", "body", "main", "div", "button", "style", "p"]) {
  const o = (src.match(new RegExp("<" + t + "[ >]", "g")) || []).length;
  const c = (src.match(new RegExp("</" + t + ">", "g")) || []).length;
  if (o !== c) fail("<" + t + ">: " + o + " open, " + c + " close");
}

if (bad) { console.error("\n" + bad + " problem(s)"); process.exit(1); }
console.log("\nall checks passed");
