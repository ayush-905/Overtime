#!/usr/bin/env node
// Draws the desktop app's icons as PNGs in desktop/icons, from the same pixel
// art as the favicon (web/shared/favicon.svg): the app icon, and the menu bar's
// icon in black on clear, which macOS tints to suit the menu bar, plus a
// version with a dot for when an agent needs you. On a Mac it also makes
// icon.icns, the app icon the build uses. Run it again after changing the art:
// npm run app:icons

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'icons');

// ── PNG ──

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA pixels, `size` by `size`, as a PNG file. */
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0;
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ── The art, on a 16 × 16 grid ──

// [x, y, width, height, colour, corner radius], painted in order.
const FIGURE = [
  [5, 2, 6, 2, '#4a2f1d'],
  [4, 3, 8, 2, '#4a2f1d'],
  [4, 5, 8, 4, '#eab98f'],
  [5, 6, 1, 1, '#1d1d24'],
  [10, 6, 1, 1, '#1d1d24'],
  [4, 9, 8, 4, '#d97a2b'],
  [3, 10, 1, 2, '#eab98f'],
  [12, 10, 1, 2, '#eab98f'],
  [11, 1, 4, 3, '#ffcf5c', 1],
];

const inRound = (px, py, x, y, w, h, r = 0) => {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  if (!r) return true;
  const cx = Math.max(x + r, Math.min(x + w - r, px));
  const cy = Math.max(y + r, Math.min(y + h - r, py));
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

/**
 * The app icon: the favicon's figure on a rounded square, laid out on Apple's
 * grid (824 of 1024 wide, with room round it), each cell a square of pixels.
 */
function appIcon(size = 1024) {
  const cell = Math.round((size * 0.8125) / 16);
  const inset = (size - cell * 16) / 2;
  const radius = cell * 16 * 0.2237;
  const top = hex('#3a312b');
  const bottom = hex('#211c19');
  const out = Buffer.alloc(size * size * 4);
  const SUB = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const px = x + (sx + 0.5) / SUB;
          const py = y + (sy + 0.5) / SUB;
          if (!inRound(px, py, inset, inset, cell * 16, cell * 16, radius)) continue;
          const t = (py - inset) / (cell * 16);
          let c = top.map((v, i) => v + (bottom[i] - v) * t);
          const gx = (px - inset) / cell;
          const gy = (py - inset) / cell;
          for (const [rx, ry, rw, rh, colour, rr] of FIGURE) if (inRound(gx, gy, rx, ry, rw, rh, rr)) c = hex(colour);
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (y * size + x) * 4;
      const n = SUB * SUB;
      if (a) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, out);
}

/**
 * The menu bar's icon: the figure's outline in black on clear, with its eyes and
 * the gap under its face cut out. `dot` adds the note in the corner, for when an
 * agent needs you. `scale` 2 is the Retina version.
 */
function trayIcon({ dot = false, scale = 1 } = {}) {
  const on = [
    [5, 2, 6, 1],
    [4, 3, 8, 6], // hair and face, one shape
    [4, 10, 8, 4],
    [3, 11, 1, 2],
    [12, 11, 1, 2], // body and arms, a row lower
  ];
  const off = [
    [5, 6, 1, 1],
    [10, 6, 1, 1],
  ]; // eyes
  if (dot) on.push([13, 0, 3, 3]);
  const size = 16 * scale;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / scale);
      const gy = Math.floor(y / scale);
      const lit =
        on.some(([rx, ry, rw, rh]) => inRound(gx, gy, rx, ry, rw, rh)) &&
        !off.some(([rx, ry, rw, rh]) => inRound(gx, gy, rx, ry, rw, rh));
      out[(y * size + x) * 4 + 3] = lit ? 255 : 0;
    }
  }
  return png(size, out);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'icon.png'), appIcon(1024));
for (const [name, dot] of [
  ['trayTemplate', false],
  ['tray-needsTemplate', true],
]) {
  writeFileSync(path.join(OUT, `${name}.png`), trayIcon({ dot }));
  writeFileSync(path.join(OUT, `${name}@2x.png`), trayIcon({ dot, scale: 2 }));
}
// The .icns: the app icon at every size macOS asks for, with its Retina twins.
if (process.platform === 'darwin') {
  const set = path.join(OUT, 'icon.iconset');
  rmSync(set, { recursive: true, force: true });
  mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [
      [1, ''],
      [2, '@2x'],
    ]) {
      execFileSync(
        'sips',
        [
          '-z',
          String(size * scale),
          String(size * scale),
          path.join(OUT, 'icon.png'),
          '--out',
          path.join(set, `icon_${size}x${size}${suffix}.png`),
        ],
        { stdio: 'ignore' },
      );
    }
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(OUT, 'icon.icns')]);
  rmSync(set, { recursive: true, force: true });
}
console.log(`Icons written to ${path.relative(process.cwd(), OUT) || OUT}`);
