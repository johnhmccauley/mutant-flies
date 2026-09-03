#!/usr/bin/env node
/*
 * Races every strategy over identical cellars and prints the table.
 *
 *   node tools/tournament.js [runs-per-level] [turn-limit] [deepest]
 *
 * Every strategy gets the same seeds, so the comparison is like for like.
 * The number that matters is cleared; walls built is the tie-breaker,
 * because a strategy that gets five of a fly's six walls up is closer to
 * working than one that never starts.
 */
global.window = global;
require("../src/rules.js");
require("../src/bot.js");
require("../src/strategies.js");
const MF = global.MutantFly;
const S = global.MutantStrategies;

const RUNS = parseInt(process.argv[2], 10) || 8;
const LIMIT = parseInt(process.argv[3], 10) || 500;
const DEEPEST = parseInt(process.argv[4], 10) || 9;

function seedsFor() {
  const out = [];
  for (let L = 1; L <= DEEPEST; L++)
    for (let i = 0; i < RUNS; i++) out.push([L, 9000 + i * 31 + L * 17]);
  return out;
}
const SEEDS = seedsFor();

/* the same run of luck for every strategy, so the table compares the
   strategies and not the dice */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(fn, level, seed) {
  MF.luck(mulberry32(seed ^ 0x5bf03635));
  const g = new MF.Game({ seed });
  g.F = level;
  g.sheet();
  let walls = 0, best = 0;
  for (let t = 0; t < LIMIT; t++) {
    let dir = null;
    try { dir = fn(g); } catch (e) { return { r: "threw", walls, best, err: e.message }; }
    const ev = g.step(dir);
    walls += ev.trappedNow.length;
    /* how close it got: the most walls standing round anything at once */
    for (const m of g.monsters) {
      if (m.gone) continue;
      let n = 0;
      for (const [c, r] of g.cellsOf(m))
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (g.isPartOf(m, c + d[0], r + d[1])) continue;
          if (g.solid(c + d[0], r + d[1])) n++;
        }
      best = Math.max(best, n);
    }
    if (ev.won) return { r: "cleared", walls, best, t: g.CO };
    if (ev.lost) return { r: "caught", walls, best, t: g.CO };
    if (ev.stuck) return { r: "stuck", walls, best, t: g.CO };
  }
  return { r: "timeout", walls, best, t: g.CO };
}

const names = Object.keys(S);
const table = [];
for (const name of names) {
  const row = { name, cleared: 0, caught: 0, stuck: 0, timeout: 0, threw: 0, walls: 0, close: 0 };
  const t0 = Date.now();
  for (const [L, seed] of SEEDS) {
    const o = play(S[name], L, seed);
    row[o.r === "threw" ? "threw" : o.r]++;
    row.walls += o.walls;
    row.close += o.best;
    if (o.err && !row.err) row.err = o.err;
  }
  row.secs = ((Date.now() - t0) / 1000).toFixed(1);
  table.push(row);
}

table.sort((a, b) => (b.cleared - a.cleared) || (b.walls - a.walls) || (b.close - a.close));

const pad = (v, n) => String(v).padStart(n);
console.log("Racing " + names.length + " strategies over the same " + SEEDS.length +
            " cellars (levels 1-" + DEEPEST + ", " + LIMIT + " turns each).\n");
console.log("strategy       cleared  caught  stuck  ran on  walls   avg best wall   secs");
for (const r of table) {
  console.log(r.name.padEnd(14) + pad(r.cleared, 8) + pad(r.caught, 8) + pad(r.stuck, 7) +
              pad(r.timeout, 8) + pad(r.walls, 7) + pad((r.close / SEEDS.length).toFixed(2), 16) +
              pad(r.secs, 7) + (r.threw ? "   THREW " + r.threw + ": " + r.err : ""));
}
const win = table[0];
console.log("\nBest on average: " + win.name + " - " + win.cleared + "/" + SEEDS.length +
            " cleared, " + win.walls + " walls built.");
