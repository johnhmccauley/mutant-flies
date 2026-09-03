#!/usr/bin/env node
/*
 * Inlines the shared sources into each page so every shipped HTML file is
 * self-contained: it opens from disk, from a web server, or pasted into a
 * publishing tool, with no relative-path resolution needed.
 *
 *   node tools/build.js
 *
 * The source of truth stays src/*.js. This rewrites the pages in place and
 * is idempotent - run it as often as you like. On the first run a
 *
 *   <script src="../src/rules.js"></script>
 *
 * becomes an <!--inline:../src/rules.js--> ... <!--/inline--> block; on
 * later runs that block is refreshed from src/ again.
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

const PAGES = ["index.html", path.join("classic", "index.html")];

function inlineInto(html, pageDir) {
  let changed = 0;

  // refresh an existing inlined block
  html = html.replace(
    /<!--inline:([^>]+?)-->[\s\S]*?<!--\/inline-->/g,
    (whole, rel) => { changed++; return block(rel, pageDir); }
  );

  // convert a plain external script into one
  html = html.replace(
    /<script src="((?:\.\.\/)?src\/[^"]+)"><\/script>/g,
    (whole, rel) => { changed++; return block(rel, pageDir); }
  );

  return { html, changed };
}

function block(rel, pageDir) {
  const file = path.resolve(pageDir, rel);
  const js = fs.readFileSync(file, "utf8").replace(/<\/script>/gi, "<\\/script>");
  return "<!--inline:" + rel + "-->\n<script>\n" + js.trimEnd() + "\n</script>\n<!--/inline-->";
}

let total = 0;
for (const page of PAGES) {
  const full = path.join(root, page);
  if (!fs.existsSync(full)) { console.log("  skip  " + page + " (not written yet)"); continue; }
  const before = fs.readFileSync(full, "utf8");
  const { html, changed } = inlineInto(before, path.dirname(full));
  if (html !== before) fs.writeFileSync(full, html);
  console.log("  ok    " + page + " - " + changed + " source(s) inlined, " + html.length + " chars");
  total += changed;
}

/* ------------------------------------------------------------------
   Stamp the service worker.

   Its cache is named after this hash, so changing any file the game
   needs offline gives the next visitor a new cache and bins the old
   one. Bumping a version by hand is how people ship a fix nobody can
   see, because every browser is still serving last month's copy.
   ------------------------------------------------------------------ */
const crypto = require("crypto");
const SW = path.join(root, "sw.js");
if (fs.existsSync(SW)) {
  const src = fs.readFileSync(SW, "utf8");
  const listed = [...src.matchAll(/^\s*"([^"]+)",?$/gm)].map((m) => m[1]);
  const h = crypto.createHash("sha256");
  for (const rel of listed.sort()) {
    const f = path.join(root, rel.replace(/\/$/, "/index.html"));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) h.update(fs.readFileSync(f));
  }
  const stamp = h.digest("hex").slice(0, 12);
  const out = src.replace(/const VERSION = "[^"]*";/, 'const VERSION = "' + stamp + '";');
  if (out !== src) fs.writeFileSync(SW, out);
  console.log("  ok    sw.js - offline cache stamped " + stamp);
}

console.log(total ? "\ninlined " + total + " source file(s)" : "\nnothing to inline");
