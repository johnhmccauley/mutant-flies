#!/usr/bin/env node
/*
 * The app icon, drawn from the game's own sprite.
 *
 *   node tools/make-icons.js
 *
 * MODE 1 had five user-defined characters in it and one of them was the
 * fly - eight bytes, eight rows of eight bits, defined on line 20 of the
 * 1985 listing. That is the icon: the same eight bytes, blown up, so the
 * thing on the home screen is the thing off the tape rather than a new
 * drawing of it.
 *
 * The PNG is written by hand - a signature, three chunks and a CRC - so
 * that building the icons needs nothing installed.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

global.window = global;
require("../src/rules.js");
const FLY = global.MutantFly.UDG.fly;

/* ---- the smallest PNG writer that is still a real PNG -------------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      /* bits per channel */
  ihdr[9] = 2;      /* truecolour       */
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;   /* no filter */
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      raw[row + 1 + x * 3] = rgb[p];
      raw[row + 2 + x * 3] = rgb[p + 1];
      raw[row + 3 + x * 3] = rgb[p + 2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- the picture --------------------------------------------------- */
const GROUND = [0x14, 0x11, 0x0c];      /* cellar dark  */
const FIG = [0xe0, 0x4a, 0x30];         /* the red the title is set in */
const GLOW = [0x2a, 0x20, 0x16];        /* a little torchlight behind it */

function draw(size, fill) {
  const rgb = Buffer.alloc(size * size * 3);
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const far = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    /* a soft pool of light in the middle, the way the man's lantern
       lights the floor around him */
    const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / far;
    const lit = Math.max(0, 1 - d * 1.25);
    const p = (y * size + x) * 3;
    for (let k = 0; k < 3; k++) rgb[p + k] = Math.round(GROUND[k] + (GLOW[k] - GROUND[k]) * lit);
  }
  /* the sprite, blown up, centred, filling `fill` of the icon */
  const cell = Math.floor((size * fill) / 8);
  const x0 = Math.round((size - cell * 8) / 2), y0 = Math.round((size - cell * 8) / 2);
  for (let r = 0; r < 8; r++) for (let b = 0; b < 8; b++) {
    if (!(FLY[r] & (128 >> b))) continue;
    for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) {
      const x = x0 + b * cell + dx, y = y0 + r * cell + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const p = (y * size + x) * 3;
      rgb[p] = FIG[0]; rgb[p + 1] = FIG[1]; rgb[p + 2] = FIG[2];
    }
  }
  return png(size, size, rgb);
}

const out = path.resolve(__dirname, "..", "icons");
fs.mkdirSync(out, { recursive: true });

/* a plain icon, and a maskable one drawn smaller so that a launcher can
   crop it to a circle without taking the fly's wings off */
const JOBS = [
  ["icon-192.png", 192, 0.72],
  ["icon-512.png", 512, 0.72],
  ["icon-maskable-512.png", 512, 0.52],
  ["apple-touch-icon.png", 180, 0.68]
];
for (const [name, size, fill] of JOBS) {
  const buf = draw(size, fill);
  fs.writeFileSync(path.join(out, name), buf);
  console.log("  ok    icons/" + name + " - " + size + "x" + size + ", " + buf.length + " bytes");
}
console.log("\ndrawn from the 1985 sprite: [" + FLY.join(", ") + "]");
