#!/usr/bin/env node
// Prints the descent, so the curve can be read at a glance.
global.window = global;
require("../src/rules.js");
const M = global.MutantFly;
const pad = (v, n) => String(v).padStart(n);

console.log("  #  monsters                     bricks  leash   new");
for (let F = 1; F <= 24; F++) {
  const l = M.levelOf(F);
  const b = M.briefingFor(F);
  console.log(pad(F, 3) + "  " + l.kinds.join(" + ").padEnd(28) +
              pad(l.PE, 6) + pad(l.PA, 7) + "   " +
              (b.length ? b.map((x) => x.name).join("; ") : ""));
}
const f = M.featuresFor(12);
console.log("\nfeatures at cellar 12: " + Object.keys(f).filter((k) => f[k]).join(", "));
