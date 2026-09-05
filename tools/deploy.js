#!/usr/bin/env node
/*
 * Put the game where a phone can reach it.
 *
 *   node tools/deploy.js
 *
 * Tilt is the reason this exists. iOS will not let a page ask which way
 * it is being held unless the page came over https, so the dev server -
 * plain http on the local network - can never test it however many
 * phones are pointed at it. It has to be a real deploy, and a real
 * deploy that takes six commands to remember is a deploy that does not
 * get done.
 *
 * What it does not do is as important as what it does. wrangler.toml
 * describes the FULL worker, catalogue and all, and its D1 database does
 * not exist yet - so deploying with it fails on a placeholder id. This
 * writes a second config beside it holding only what is needed to serve
 * the game itself, uses that, and takes it away again. The real config
 * is never touched, so nothing here can quietly become how the
 * catalogue gets shipped later.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TOKEN = path.join(os.homedir(), ".cf-deploy-token");
const TEMP = path.join(ROOT, "wrangler.play.toml");

/* Only the assets and the worker that serves them. No D1, no rate
   limiter: both need real resources, neither is needed to play, and the
   catalogue they belong to is not switched on. */
const CONFIG = [
  "# Written by tools/deploy.js and deleted again. Not the real config.",
  'name = "mutant-fly"',
  'main = "worker/index.js"',
  'compatibility_date = "2026-01-15"',
  "",
  "[assets]",
  'directory = "."',
  'binding = "ASSETS"',
  'not_found_handling = "404-page"',
  'run_worker_first = ["/api/*"]',
  ""
].join("\n");

function die(msg) {
  console.error("\n  " + msg + "\n");
  process.exit(1);
}

if (!fs.existsSync(TOKEN))
  die("No Cloudflare token at " + TOKEN + " - deploying needs one.");

/* The pages are built from src/ before anything goes up, because the
   thing that is easiest to forget is the thing that makes the deploy a
   lie: shipping an index.html whose inlined copy of a src file is a
   version behind. */
console.log("Building the pages from src/ ...");
execFileSync(process.execPath, [path.join(__dirname, "build.js")],
             { cwd: ROOT, stdio: "inherit" });
console.log("Checking them ...");
execFileSync(process.execPath, [path.join(__dirname, "check.js")],
             { cwd: ROOT, stdio: "inherit" });

fs.writeFileSync(TEMP, CONFIG);
try {
  /* wrangler is pinned. The globally installed one on this machine is a
     version whose workerd has no arm64 binary and it dies on startup, so
     npx has to be told exactly which one to fetch rather than being left
     to find the broken one. */
  /* Through a shell, which node warns about because a shell concatenates
     arguments rather than escaping them. Every argument here is a string
     literal from this file, so there is nothing to escape - and without
     the shell, Windows cannot find npx at all: it is npx.cmd, and
     execFile will not go looking. Node prints the warning from this
     process rather than the child, so setting NODE_OPTIONS on the child
     does not silence it - it is left visible and explained here instead
     of being hidden by something that does not work. */
  execFileSync("npx", ["--yes", "wrangler@4.125.0", "deploy", "-c", "wrangler.play.toml"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: Object.assign({}, process.env, {
      CLOUDFLARE_API_TOKEN: fs.readFileSync(TOKEN, "utf8").trim()
    })
  });
} finally {
  fs.unlinkSync(TEMP);
}

console.log("\n  https://mutant-fly.johnhmccauley.workers.dev\n");
console.log("  Tilt needs this address rather than the dev server: iOS will only");
console.log("  ask for the phone's angle on a page that came over https.\n");
