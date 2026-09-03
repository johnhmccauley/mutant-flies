#!/usr/bin/env node
/*
 * Derives the embeddable copy of the game from index.html.
 *
 * index.html is the canonical, standalone file. Some publishing targets wrap
 * the page in their own <!doctype>/<head>/<body> and want only the content,
 * so this strips the document skeleton and writes mutant-flies.html beside it.
 *
 *   node tools/make-artifact.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "index.html"), "utf8");

const head = src.slice(src.indexOf("<title>"), src.indexOf("</head>"));
const bodyOpen = src.indexOf("<main");
const bodyEnd = src.lastIndexOf("</script>") + "</script>".length;
if (bodyOpen < 0 || head.length < 10) {
  console.error("index.html is not in the expected shape");
  process.exit(1);
}

const out = head.trimEnd() + "\n\n" + src.slice(bodyOpen, bodyEnd) + "\n";
fs.writeFileSync(path.join(root, "mutant-flies.html"), out);

// sanity: the skeleton must be gone and the game must still be whole
const bad = [];
for (const tag of ["<!doctype", "<html", "<head", "<body"]) {
  if (out.toLowerCase().includes(tag)) bad.push(tag);
}
for (const marker of ["PROCmove_bricks", "PROCmove_fly", "var FONTSRC", "var UDG", "</script>"]) {
  if (!out.includes(marker)) bad.push("missing " + marker);
}
console.log(bad.length ? "PROBLEMS: " + bad.join(", ")
                       : "mutant-flies.html written, " + out.length + " chars");
