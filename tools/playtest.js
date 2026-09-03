#!/usr/bin/env node
/*
 * Plays the game, a lot, and reports what actually happens in it.
 *
 *   node tools/playtest.js [cellars-per-level] [turn-limit]
 *
 * The point is not the bot's score. It is to find out which of the things
 * in a cellar ever come up in play, which cellars cannot be finished, and
 * where a run tends to end - the questions you cannot answer by reading
 * the code, and would take hours to answer by hand.
 */
global.window = global;
require("../src/rules.js");
require("../src/bot.js");
const MF = global.MutantFly;
const BOT = global.MutantBot;

const RUNS = parseInt(process.argv[2], 10) || 12;
const LIMIT = parseInt(process.argv[3], 10) || 900;
const DEEPEST = 16;

const EVENTS = ["pushed", "blocked", "lostOverEdge", "crunched", "chopped_brick",
                "chopped", "eaten", "smashed", "slid", "treesDown", "burst",
                "burned", "doused", "swept", "picked", "squashed", "crushed",
                "trappedNow", "freed"];

function playOne(seed, level) {
  const g = new MF.Game({ seed });
  g.F = level;
  g.sheet();
  const state = {};
  const tally = {};
  let outcome = "ran out of turns";
  for (let turn = 0; turn < LIMIT; turn++) {
    const dir = BOT.think(g, null, state);
    const ev = g.step(dir);
    for (const k of EVENTS) {
      const v = ev[k];
      const n = Array.isArray(v) ? v.length : (v === true ? 1 : (v | 0));
      if (n) tally[k] = (tally[k] || 0) + n;
    }
    if (ev.lost) { outcome = "caught"; break; }
    if (ev.won) { outcome = "cleared"; break; }
    if (ev.stuck) { outcome = "out of bricks"; break; }
  }
  return { outcome, turns: g.CO, tally, bricks: g.bricks };
}

const perLevel = [];
const totals = {};
const outcomes = {};

for (let F = 1; F <= DEEPEST; F++) {
  const row = { F, cleared: 0, caught: 0, stuck: 0, ranOut: 0, turns: [] };
  for (let i = 0; i < RUNS; i++) {
    const r = playOne(1000 + i * 7 + F * 101, F);
    if (r.outcome === "cleared") row.cleared++;
    else if (r.outcome === "caught") row.caught++;
    else if (r.outcome === "out of bricks") row.stuck++;
    else row.ranOut++;
    row.turns.push(r.turns);
    outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
    for (const k in r.tally) totals[k] = (totals[k] || 0) + r.tally[k];
  }
  row.median = row.turns.sort((a, b) => a - b)[Math.floor(row.turns.length / 2)];
  perLevel.push(row);
}

const pad = (v, n) => String(v).padStart(n);
console.log("Playing " + RUNS + " runs of each of cellars 1-" + DEEPEST +
            ", " + LIMIT + " turns apiece.\n");
console.log("  #   cleared  caught  stuck  ran on   median turns   what is down there");
for (const r of perLevel) {
  const kinds = MF.levelOf(r.F).kinds.join("+");
  console.log(pad(r.F, 3) + pad(r.cleared, 9) + pad(r.caught, 8) + pad(r.stuck, 7) +
              pad(r.ranOut, 8) + pad(r.median, 15) + "   " + kinds);
}

console.log("\nOutcomes over " + (RUNS * DEEPEST) + " runs:");
for (const k of Object.keys(outcomes).sort((a, b) => outcomes[b] - outcomes[a]))
  console.log("  " + String(outcomes[k]).padStart(5) + "  " + k);

console.log("\nHow often each thing actually happened:");
const seen = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
for (const k of seen) console.log("  " + String(totals[k]).padStart(7) + "  " + k);
const never = EVENTS.filter((k) => !totals[k]);
if (never.length) console.log("\n  NEVER HAPPENED AT ALL:  " + never.join(", "));
