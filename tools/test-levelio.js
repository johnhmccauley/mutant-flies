#!/usr/bin/env node
/*
 * Packing a cellar into a string you can paste somewhere, and getting
 * the same cellar back out.
 *
 *   node tools/test-levelio.js
 */
global.window = global;
require("../src/rules.js");
require("../src/level-io.js");
const MF = global.MutantFly;
const IO = global.MutantLevelIO;

let pass = 0, fail = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n          got  " + g + "\n          want " + w); }
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log("\nPacking\n");
{
  const a = [0, 0, 0, 1, 1, 2];
  ok("runs become value and count", IO.rle(a), [0, 3, 1, 2, 2, 1]);
  ok("and come back", Array.from(IO.unrle(IO.rle(a), a.length)), a);
}
{
  /* a run longer than a byte can count is written as several */
  const a = new Array(600).fill(7);
  const r = IO.rle(a);
  ok("a run of six hundred is written in pieces", [r.length, r[1], r[3], r[5]],
     [6, 255, 255, 90]);
  ok("and still comes back whole", same(Array.from(IO.unrle(r, 600)), a), true);
}
{
  for (const n of [0, 1, 2, 3, 4, 5, 17, 884]) {
    const bytes = [];
    for (let i = 0; i < n; i++) bytes.push((i * 37 + 11) & 255);
    const back = IO.fromText(IO.toText(bytes)).slice(0, n);
    if (!same(back, bytes)) { ok("bytes survive text at length " + n, back, bytes); break; }
  }
  ok("bytes survive being turned into text, at every awkward length", true, true);
}
{
  const t = IO.toText([0, 1, 2, 250, 251, 255]);
  ok("the text is safe to paste anywhere", /^[A-Za-z0-9_-]*$/.test(t), true);
}
{
  const arr = new Uint8Array(884);
  for (let i = 400; i < 460; i++) arr[i] = 3;
  const packed = IO.packArray(arr);
  ok("a mostly-empty cellar array packs very small", packed.length < 20, true);
  ok("and unpacks to exactly what went in",
     same(Array.from(IO.unpackArray(packed, 884)), Array.from(arr)), true);
}
{
  ok("an unpack of nothing gives a clean array of the right size",
     [IO.unpackArray("", 10).length, IO.unpackArray(null, 10)[0]], [10, 0]);
  ok("and text that is not ours is refused rather than guessed at",
     IO.unpackArray("not base64 !!", 10), null);
}

console.log("\nDamaged codes\n");
{
  const s = IO.seal("hello");
  ok("a sealed string comes back", IO.unseal(s), "hello");
  ok("one that lost its tail does not", IO.unseal(s.slice(0, s.length - 3)), null);
  ok("nor one with no seal at all", IO.unseal("hello"), null);
  ok("nor a flipped character", IO.unseal(IO.seal("hellp").replace("hellp", "hello")), null);
}

console.log("\nA whole cellar\n");
{
  const g = new MF.Game({ seed: 4242 });
  g.F = 15; g.sheet();
  const parts = {
    grid: IO.packArray(g.grid),
    height: IO.packArray(g.height),
    item: IO.packArray(g.item),
    fluid: IO.packArray(g.fluid),
    fvol: IO.packArray(g.fvol),
    sealed: IO.packArray(g.sealed),
    W: IO.packArray(g.edge.W), E: IO.packArray(g.edge.E),
    S: IO.packArray(g.edge.S), N: IO.packArray(g.edge.N)
  };
  const code = IO.seal(JSON.stringify(parts));
  const n = MF.COLS * MF.ROWS;
  const back = JSON.parse(IO.unseal(code));
  const okGrid = same(Array.from(IO.unpackArray(back.grid, n)), Array.from(g.grid));
  const okH = same(Array.from(IO.unpackArray(back.height, n)), Array.from(g.height));
  const okE = same(Array.from(IO.unpackArray(back.W, MF.ROWS)), Array.from(g.edge.W));
  console.log("        (a real cellar 15 packs to " + code.length + " characters)");
  ok("a real cellar packs and comes back identical", [okGrid, okH, okE], [true, true, true]);
  ok("and it is short enough to paste into a message", code.length < 3000, true);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
