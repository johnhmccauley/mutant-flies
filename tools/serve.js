#!/usr/bin/env node
/*
 * A static server, so the game can be opened the way it is actually
 * served.
 *
 *   node tools/serve.js [port]
 *
 * It stopped being possible to open index.html straight off the disk the
 * moment three.js, the fonts and the service worker moved into vendor/
 * and got referred to by relative path - and a service worker will not
 * register over file:// at all. So: a few dozen lines of http, no
 * dependencies, correct MIME types, and no caching headers at all, which
 * is what you want while you are working on the thing.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = parseInt(process.argv[2], 10) || 8877;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".bas": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary"
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(root, rel);
  /* nothing above the repo, however the path is spelled */
  if (!file.startsWith(root)) { res.writeHead(403).end("no"); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 " + rel);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      /* the worker sits at the root and claims the whole site */
      "Service-Worker-Allowed": "/"
    });
    res.end(buf);
  });
}).listen(port, () => {
  console.log("Mutant Fly on http://localhost:" + port + "/");
  console.log("  the 1985 screen: http://localhost:" + port + "/classic/");
});
