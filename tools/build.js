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
console.log(total ? "\ninlined " + total + " source file(s)" : "\nnothing to inline");
