#!/usr/bin/env node
/**
 * Generates the PWA PNG icons for packages/client without any dependency:
 * a tiny PNG encoder (zlib deflate from node:zlib + CRC32) rasterising a tank glyph on a neon gradient.
 * Output: packages/client/public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'packages', 'client', 'public', 'icons');

// ---------- PNG encoder ----------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- rasteriser ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  bgA: hex('#101a3f'),
  bgB: hex('#07090f'),
  cyan: hex('#5ee1ff'),
  hullA: hex('#ffe08a'),
  hullB: hex('#f4a261'),
  barrel: hex('#ffd166'),
  magenta: hex('#ff5ec4'),
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}
const coverage = (d, aa) => clamp01(0.5 - d / aa);

/**
 * Renders a size x size icon. `maskable` fills the full square (safe zone in the centre 80%),
 * otherwise the background is a rounded square with transparent corners.
 */
function renderIcon(size, maskable) {
  const ss = 2; // supersampling
  const W = size * ss;
  const out = Buffer.alloc(size * size * 4);
  const acc = new Float32Array(size * size * 4);
  const u = W / 512; // unit: design space is 512
  const glyphScale = maskable ? 0.78 : 1;
  const gx = (x) => 256 * u + (x - 256) * u * glyphScale;
  const gs = (v) => v * u * glyphScale;
  const aa = 1.2 * ss;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // background
      const t = clamp01((px + py) / (2 * W));
      let col = mix(C.bgA, C.bgB, t);
      let alpha = 1;
      if (!maskable) {
        const d = sdRoundRect(px, py, W / 2, W / 2, W / 2, W / 2, W * 0.22);
        alpha = coverage(d, aa);
      }
      // cyan glow
      const dx = px - 256 * u;
      const dy = py - 268 * u;
      const rr = Math.sqrt(dx * dx + dy * dy) / (210 * u * glyphScale);
      const glow = clamp01(1 - rr) * 0.5;
      col = mix(col, C.cyan, glow * glow);
      // tracks
      const trackL = coverage(sdRoundRect(px, py, gx(160), gx(292), gs(32), gs(116), gs(22)), aa);
      const trackR = coverage(sdRoundRect(px, py, gx(352), gx(292), gs(32), gs(116), gs(22)), aa);
      const track = Math.max(trackL, trackR);
      col = mix(col, C.cyan, track);
      // hull with vertical gradient
      const hull = coverage(sdRoundRect(px, py, gx(256), gx(296), gs(80), gs(88), gs(28)), aa);
      const hullCol = mix(C.hullA, C.hullB, clamp01((py - gx(208)) / gs(176)));
      col = mix(col, hullCol, hull);
      // barrel
      const barrel = coverage(sdRoundRect(px, py, gx(256), gx(172), gs(16), gs(100), gs(14)), aa);
      col = mix(col, C.barrel, barrel);
      // hatch
      const hatchD = Math.sqrt((px - gx(256)) ** 2 + (py - gx(296)) ** 2) - gs(26);
      const hatch = coverage(hatchD, aa);
      col = mix(col, C.magenta, hatch);

      const ix = Math.floor(x / ss);
      const iy = Math.floor(y / ss);
      const o = (iy * size + ix) * 4;
      acc[o] += col[0] * alpha;
      acc[o + 1] += col[1] * alpha;
      acc[o + 2] += col[2] * alpha;
      acc[o + 3] += alpha * 255;
    }
  }
  const n = ss * ss;
  for (let i = 0; i < size * size; i++) {
    const a = acc[i * 4 + 3] / n;
    const k = a > 0 ? 255 / a : 0; // un-premultiply
    out[i * 4] = Math.round(clamp01((acc[i * 4] / n) * k / 255) * 255);
    out[i * 4 + 1] = Math.round(clamp01((acc[i * 4 + 1] / n) * k / 255) * 255);
    out[i * 4 + 2] = Math.round(clamp01((acc[i * 4 + 2] / n) * k / 255) * 255);
    out[i * 4 + 3] = Math.round(a);
  }
  return encodePng(size, size, out);
}

mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, maskable] of targets) {
  writeFileSync(join(outDir, name), renderIcon(size, maskable));
}
console.log(`[gen-icons] wrote ${targets.length} icons to ${outDir}`);
