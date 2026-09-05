#!/usr/bin/env node
/*
 * What the first hundred cellars actually are, and how they actually play.
 *
 *   node tools/levels100.js [runs-per-cellar] [turn-limit]
 *
 * Two questions, and they need different tools. What a cellar IS can be
 * read straight off the plan - which monsters, how many bricks, which
 * features are switched on - and that is exact, no sampling needed. How
 * it PLAYS has to be measured, because nobody can read a difficulty
 * curve off a formula: the bot runs each cellar several times from
 * different seeds and we count how often it gets out, how long it takes
 * and what stopped it.
 *
 * Writes a JSON report to tools/levels100.json and prints a summary, so
 * the numbers can be argued about rather than guessed at.
 */
global.window = global;
require("../src/rules.js");
require("../src/bot.js");
const MF = global.MutantFly;
const BOT = global.MutantBot;
const fs = require("fs");
const path = require("path");

const RUNS = parseInt(process.argv[2], 10) || 6;
const LIMIT = parseInt(process.argv[3], 10) || 1200;
const DEEP = 100;

/* ------------------------------------------------------------------
   What the cellar is, before anybody plays it.

   Read from a real sheet rather than from the plan, because the plan
   says what was asked for and the sheet says what arrived - the
   generator refuses things that will not fit, and a feature that never
   makes it onto the floor is not in the cellar however loudly the plan
   asked for it.
   ------------------------------------------------------------------ */
function shapeOf(F, seed) {
  const g = new MF.Game({ seed });
  g.F = F;
  g.sheet();
  const count = {};
  const bump = (k) => { count[k] = (count[k] || 0) + 1; };
  for (let i = 0; i < MF.COLS * MF.ROWS; i++) {
    if (!g.shape || g.shape[i]) {
      const v = g.grid[i];
      if (v === MF.BRICK) bump("brick");
      else if (v === MF.TREE) bump("tree");
      else if (v === MF.ROCK) bump("rock");
      else if (v === MF.VAT_TAR) bump("tarvat");
      else if (v === MF.VAT_WATER) bump("watervat");
      else if (v === MF.CHOPPER) bump("chopper");
      else if (v === MF.MARBLE) bump("marble");
      if (g.item && g.item[i]) bump("item" + g.item[i]);
      if (g.height && g.height[i]) bump("raised");
    }
  }
  const kinds = {};
  (g.monsters || []).forEach((m) => {
    const n = (m.spec && m.spec.name ? m.spec.name : "?").toLowerCase();
    kinds[n] = (kinds[n] || 0) + 1;
  });
  return {
    bricks: g.bricks,
    monsters: g.monsters ? g.monsters.length : 0,
    kinds,
    stuff: count,
    coins: (g.coins || []).length,
    robots: (g.robots || []).length
  };
}

/* The bot dies far more often than it wins - it is a simple thing and
   the cellars are not - so a win rate cannot rank a hundred cellars: it
   is nought nearly everywhere. How long it SURVIVES can, and it is the
   more honest measure anyway. A cellar that kills it in eleven turns is
   harder than one that kills it in two hundred, whether or not either
   was ever going to be cleared. */
function playOne(F, seed) {
  const g = new MF.Game({ seed });
  g.F = F;
  g.sheet();
  const state = {};
  let out = "ran on";
  let turns = 0;
  for (let t = 0; t < LIMIT; t++) {
    turns = t + 1;
    const ev = g.step(BOT.think(g, null, state));
    if (ev.won) { out = "cleared"; break; }
    if (ev.lost) { out = "caught"; break; }
    if (ev.stuck) { out = "stuck"; break; }
  }
  return { out, turns, left: g.bricks, score: g.SC };
}

const rows = [];
for (let F = 1; F <= DEEP; F++) {
  const shape = shapeOf(F, 1000 + F);
  const runs = [];
  for (let r = 0; r < RUNS; r++) runs.push(playOne(F, 1 + r * 977 + F * 13));
  const cleared = runs.filter((x) => x.out === "cleared");
  const turns = cleared.map((x) => x.turns).sort((a, b) => a - b);
  const lived = runs.map((x) => x.turns).sort((a, b) => a - b);
  const why = {};
  runs.forEach((x) => { why[x.out] = (why[x.out] || 0) + 1; });
  rows.push({
    F,
    plan: {
      monsters: shape.monsters,
      kinds: shape.kinds,
      bricks: shape.bricks,
      stuff: shape.stuff,
      coins: shape.coins,
      robots: shape.robots
    },
    play: {
      cleared: cleared.length,
      caught: runs.filter((x) => x.out === "caught").length,
      stuck: runs.filter((x) => x.out === "stuck").length,
      ranOn: runs.filter((x) => x.out === "ran on").length,
      medianTurns: turns.length ? turns[turns.length >> 1] : null,
      medianLived: lived[lived.length >> 1],
      shortest: lived[0],
      longest: lived[lived.length - 1],
      why,
      winRate: +(cleared.length / RUNS).toFixed(2)
    }
  });
  if (F % 10 === 0) process.stderr.write("  ..." + F + "\n");
}

const outPath = path.join(__dirname, "levels100.json");
fs.writeFileSync(outPath, JSON.stringify({ runs: RUNS, limit: LIMIT, rows }, null, 1));

const pad = (v, n) => String(v).padStart(n);
console.log("cellars 1-100, " + RUNS + " bot runs each, turn limit " + LIMIT);
console.log("  #  won/" + RUNS + "  lived  bricks  mon  kinds");
for (const r of rows) {
  console.log(pad(r.F, 3) + pad(r.play.cleared, 6) + pad(r.play.medianLived, 7) +
    pad(r.plan.bricks, 8) + pad(r.plan.monsters, 5) + "  " + Object.keys(r.plan.kinds).join(","));
}
console.log("\nwritten to " + outPath);
