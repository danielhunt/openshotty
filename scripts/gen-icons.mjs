#!/usr/bin/env node
/**
 * gen-icons.mjs — procedural app-icon generator for the kids' AR monster game.
 *
 * Zero image dependencies: only Node built-ins (node:zlib, node:fs, node:path).
 * The PNG encoder (truecolour RGBA8, filter type 0 per scanline, zlib deflate,
 * hand-rolled CRC32, IHDR/IDAT/IEND, big-endian lengths + CRCs) lives here, and
 * every file written is read back and re-parsed — PNG signature, per-chunk CRC,
 * IHDR width/height/depth/colour-type, scanline filters, inflated IDAT length —
 * before this script is allowed to exit successfully.
 *
 * Artwork is rasterised procedurally from signed-distance functions with
 * analytic coverage, rendered at 4x the target size and box-downscaled
 * (4x4 supersampling) so nothing is jagged at any size.
 *
 * Usage: node scripts/gen-icons.mjs   (idempotent; exits non-zero on failure)
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public');
const SUPER = 4; // supersample factor: render (size*4)^2, box-downscale to size^2

/* ------------------------------------------------------------------ */
/* 1. PNG encoder                                                      */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); // big-endian data length
  out.write(type, 4, 'ascii'); // type bytes are part of the CRC input
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba width*height*4 bytes, straight (non-premultiplied) alpha
 * @returns {Buffer} a complete PNG file
 */
function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`bad dimensions ${width}x${height}`);
  }
  if (!rgba || rgba.length !== width * height * 4) throw new Error('pixel buffer length mismatch');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = truecolour with alpha
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: adaptive (we choose filter type 0 per scanline)
  ihdr[12] = 0; // interlace: none

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    src.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* 2. Signed-distance helpers. Distances are normalised canvas units;  */
/*    callers divide by `dpx` (one icon pixel) to get pixel-space AA.  */
/* ------------------------------------------------------------------ */

const PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const sdCircle = (px, py, r) => Math.hypot(px, py) - r;

/** Axis-aligned ellipse centred on the sample point; inside < 0. */
function sdEllipse(px, py, rx, ry) {
  const e = Math.hypot(px / rx, py / ry);
  const grad = Math.hypot(px / (rx * rx), py / (ry * ry));
  if (grad < 1e-12) return -Math.min(rx, ry);
  return (e - 1) / grad;
}

function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
const smax = (a, b, k) => -smin(-a, -b, k);

/**
 * Convex polygon SDF as a soft-max of edge half-planes, which rounds the
 * corners by about `round`. Orientation-agnostic: the sign of the signed
 * area picks which side of each edge is outside.
 */
function sdRoundPoly(px, py, v, round) {
  let area = 0;
  for (let i = 0; i < v.length; i++) {
    const [ax, ay] = v[i];
    const [bx, by] = v[(i + 1) % v.length];
    area += ax * by - bx * ay;
  }
  const sgn = area >= 0 ? 1 : -1;
  const k = Math.max(round * 2, 1e-6);
  let d = -1e9;
  for (let i = 0; i < v.length; i++) {
    const [ax, ay] = v[i];
    const [bx, by] = v[(i + 1) % v.length];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const nx = (ey / len) * sgn;
    const ny = (-ex / len) * sgn;
    d = smax(d, (px - ax) * nx + (py - ay) * ny, k);
  }
  return d - round;
}

/** Four-point sparkle (astroid: concave sides); scale factor is approximate. */
function sdSparkle(px, py, r) {
  const x = Math.abs(px) / r;
  const y = Math.abs(py) / r;
  return (Math.cbrt(x * x) + Math.cbrt(y * y) - 1) * r * 0.72;
}

/**
 * Rounded arc band ("short thick arc") centred on the sample point:
 * ring radius R, half-angle `half` about `mid`, stroke width w, round caps.
 * Measured in (arc-length, radius) space, which is near-exact for |p| ~= R.
 */
function sdArc(px, py, R, mid, half, w) {
  const r = Math.hypot(px, py);
  let da = Math.atan2(py, px) - mid;
  da = Math.atan2(Math.sin(da), Math.cos(da)); // wrap to [-pi, pi]
  const along = Math.abs(da * R) - half * R; // <0 while inside the arc span
  const radial = r - R; // 0 on the ring
  const rad = w / 2;
  return Math.hypot(Math.max(along, 0), Math.abs(radial)) - rad;
}

/** Analytic coverage of a pixel-space signed distance (1px linear ramp). */
const cover = (d) => (d >= 0.5 ? 0 : d <= -0.5 ? 1 : 0.5 - d);

/* ------------------------------------------------------------------ */
/* 3. Palette + layout (normalised 0..1 canvas, y down, 1 = full width)*/
/* ------------------------------------------------------------------ */

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

const BG_TOP = rgb(0x2de1c2); // gradient top
const BG_BOTTOM = rgb(0x4a2fbd); // gradient bottom
const GLOW = rgb(0xd6fff6); // radial glow tint
const BODY_TOP = rgb(0xa0f8b6);
const BODY_BOT = rgb(0x63e286); // candy green, shaded #7ef29a in the middle
const RIM = rgb(0x2c9c63); // darker rim
const HORN = rgb(0xff6b9d); // warm pink
const HORN_TIP = rgb(0xffa3c1);
const WHITE = rgb(0xffffff);
const DARK = rgb(0x1b1140); // pupils + mouth
const BLUSH = rgb(0xff5f9d); // deeper rose: pink over candy green blends to a soft blush
const SPARK = rgb(0xfff6a8); // sparkle stars

const MON = { cx: 0.5, cy: 0.525 }; // monster centre (headroom for the horns)
const RX = 0.305; // body radii: ~62% of the canvas width, ~53% of its height
const RY = 0.265;
const RIM_W = 0.0165; // rim thickness

const L = {
  glow: { cx: 0.5, cy: 0.44, r: 0.62, amt: 0.17 },
  horns: [
    [
      [0.306, 0.352],
      [0.302, 0.203],
      [0.424, 0.302],
    ],
    [
      [0.694, 0.352],
      [0.698, 0.203],
      [0.576, 0.302],
    ],
  ],
  hornRound: 0.022,
  eyes: [
    { ex: -0.117, ey: -0.055, erx: 0.081, ery: 0.106, px: -0.104, py: -0.033, prx: 0.049, pry: 0.062, hx: -0.129, hy: -0.076, hr: 0.0205 },
    { ex: 0.117, ey: -0.055, erx: 0.081, ery: 0.106, px: 0.104, py: -0.033, prx: 0.049, pry: 0.062, hx: 0.082, hy: -0.076, hr: 0.0205 },
  ],
  blush: [
    { x: -0.205, y: 0.075, rx: 0.062, ry: 0.035 },
    { x: 0.205, y: 0.075, rx: 0.062, ry: 0.035 },
  ],
  mouth: { x: 0.5, y: 0.512, R: 0.105, mid: PI / 2, half: 0.6, w: 0.036 },
  sparkles: [
    { x: 0.125, y: 0.145, r: 0.062 },
    { x: 0.855, y: 0.1, r: 0.046 },
    { x: 0.885, y: 0.775, r: 0.054 },
    { x: 0.115, y: 0.845, r: 0.04 },
    { x: 0.715, y: 0.915, r: 0.03 },
  ],
};

// Sparkle centres re-expressed in "double" units (r is measured there too).
const SPARKS = L.sparkles.map((s) => ({ x: (s.x - 0.5) * 2, y: (s.y - 0.5) * 2, r: s.r }));

/** Body blob: circle squashed vertically, bottom flared a little wider. */
function sdBody(px, py) {
  const dx = px - MON.cx;
  const dy = py - MON.cy;
  const rx = RX * (1 + 0.13 * smoothstep(-0.02, 0.3, dy)) * (1 - 0.05 * smoothstep(0.06, -0.26, dy));
  const ry = RY * (1 - 0.04 * smoothstep(0.02, 0.28, dy));
  return sdEllipse(dx, dy, rx, ry);
}

/* ------------------------------------------------------------------ */
/* 4. One shaded sample: composites the artwork over the full-bleed    */
/*    gradient. Writes r,g,b into `out` (0..255 floats).               */
/* ------------------------------------------------------------------ */

function shade(nx, ny, dpx, scale, out) {
  // Artwork coordinates: `scale` shrinks the artwork about the canvas centre
  // (used by the maskable variant); MON is re-centred on the canvas.
  const ax = (nx - 0.5) / scale + 0.5;
  const ay = (ny - 0.5) / scale + 0.5;

  // full-bleed vertical gradient — no rounded rect, no transparent corners
  let R = lerp(BG_TOP[0], BG_BOTTOM[0], ny);
  let G = lerp(BG_TOP[1], BG_BOTTOM[1], ny);
  let B = lerp(BG_TOP[2], BG_BOTTOM[2], ny);

  // subtle lighter radial glow behind the centre
  const gr = Math.hypot(ax - L.glow.cx, ay - L.glow.cy) / L.glow.r;
  const ga = L.glow.amt * Math.pow(clamp(1 - gr, 0, 1), 1.8);
  if (ga > 0) {
    R += (GLOW[0] - R) * ga;
    G += (GLOW[1] - G) * ga;
    B += (GLOW[2] - B) * ga;
  }

  // tiny four-point sparkle stars scattered in the corners
  for (let i = 0; i < SPARKS.length; i++) {
    const s = SPARKS[i];
    const c = cover(sdSparkle((ax - 0.5) * 2 - s.x, (ay - 0.5) * 2 - s.y, s.r) / (dpx * 0.6));
    if (c <= 0) continue;
    const a = c * 0.92;
    R += (SPARK[0] - R) * a;
    G += (SPARK[1] - G) * a;
    B += (SPARK[2] - B) * a;
  }

  // rounded-triangle horns / ears, drawn behind the head so the bases hide
  for (let i = 0; i < L.horns.length; i++) {
    const c = cover(sdRoundPoly(ax, ay, L.horns[i], L.hornRound) / dpx);
    if (c <= 0) continue;
    const t = 0.4 * smoothstep(0.32, 0.19, ay); // lighter toward the tips
    const a = c * 0.96;
    R += (lerp(HORN[0], HORN_TIP[0], t) - R) * a;
    G += (lerp(HORN[1], HORN_TIP[1], t) - G) * a;
    B += (lerp(HORN[2], HORN_TIP[2], t) - B) * a;
  }

  // darker rim (grown blob), then the candy-green body on top of it
  const bodyD = sdBody(ax, ay);
  const rimC = cover((bodyD - RIM_W) / dpx);
  if (rimC > 0) {
    R += (RIM[0] - R) * rimC;
    G += (RIM[1] - G) * rimC;
    B += (RIM[2] - B) * rimC;
  }
  const bodyC = cover(bodyD / dpx);
  if (bodyC > 0) {
    const t = smoothstep(MON.cy - RY, MON.cy + RY, ay);
    const band = smoothstep(0.0015, -RIM_W * 1.15, bodyD); // keep the rim visible
    const a = bodyC * (0.82 + 0.18 * band);
    R += (lerp(BODY_TOP[0], BODY_BOT[0], t) - R) * a;
    G += (lerp(BODY_TOP[1], BODY_BOT[1], t) - G) * a;
    B += (lerp(BODY_TOP[2], BODY_BOT[2], t) - B) * a;
  }

  // soft pink blush, feathered and clipped to the face
  for (let i = 0; i < L.blush.length; i++) {
    const b = L.blush[i];
    const c =
      cover(sdEllipse(ax - (MON.cx + b.x), ay - (MON.cy + b.y), b.rx, b.ry) / (dpx * 2.2)) * bodyC;
    if (c <= 0) continue;
    const a = c * 0.72;
    R += (BLUSH[0] - R) * a;
    G += (BLUSH[1] - G) * a;
    B += (BLUSH[2] - B) * a;
  }

  // eyes: big white ovals, big dark pupils, one small highlight dot each
  for (let i = 0; i < L.eyes.length; i++) {
    const e = L.eyes[i];
    const w = cover(sdEllipse(ax - (MON.cx + e.ex), ay - (MON.cy + e.ey), e.erx, e.ery) / dpx);
    if (w > 0) {
      R += (WHITE[0] - R) * w;
      G += (WHITE[1] - G) * w;
      B += (WHITE[2] - B) * w;
    }
    const p = cover(sdEllipse(ax - (MON.cx + e.px), ay - (MON.cy + e.py), e.prx, e.pry) / dpx);
    if (p > 0) {
      R += (DARK[0] - R) * p;
      G += (DARK[1] - G) * p;
      B += (DARK[2] - B) * p;
    }
    const hl = cover(sdCircle(ax - (MON.cx + e.hx), ay - (MON.cy + e.hy), e.hr) / (dpx * 0.9));
    if (hl > 0) {
      const a = hl * 0.95;
      R += (255 - R) * a;
      G += (255 - G) * a;
      B += (255 - B) * a;
    }
  }

  // smiling mouth: short thick arc with round ends
  const m = L.mouth;
  const mc = cover(sdArc(ax - m.x, ay - m.y, m.R, m.mid, m.half, m.w) / dpx);
  if (mc > 0) {
    R += (DARK[0] - R) * mc;
    G += (DARK[1] - G) * mc;
    B += (DARK[2] - B) * mc;
  }

  out[0] = clamp(R, 0, 255);
  out[1] = clamp(G, 0, 255);
  out[2] = clamp(B, 0, 255);
}

/* ------------------------------------------------------------------ */
/* 5. Render at 4x, then box-downscale to the target size              */
/* ------------------------------------------------------------------ */

function renderIcon(size, scale = 1) {
  const big = size * SUPER;
  // AA ramp of half a *final* pixel per supersample: after the 4x box filter
  // edges land at ~1.25px — smooth at 32px, crisp at 512px, never jagged.
  const dpx = 1 / (size * 2);
  const acc = new Float64Array(big * big * 4);
  const out = new Uint8Array(size * size * 4);
  const px = new Float64Array(3);
  const inv = 1 / big;

  for (let by = 0; by < big; by++) {
    const ty = (by + 0.5) * inv;
    let o = by * big * 4;
    for (let bx = 0; bx < big; bx++) {
      shade((bx + 0.5) * inv, ty, dpx, scale, px);
      acc[o] = px[0];
      acc[o + 1] = px[1];
      acc[o + 2] = px[2];
      acc[o + 3] = 255; // artwork is fully opaque (full-bleed background)
      o += 4;
    }
  }

  const rowLen = big * 4; // one supersampled row
  const outRow = size * 4;
  const n = SUPER * SUPER;
  for (let y = 0; y < size; y++) {
    const top = y * SUPER * rowLen;
    // sum the SUPER rows of this block into the top row
    for (let s = 1; s < SUPER; s++) {
      const src = top + s * rowLen;
      for (let i = 0; i < rowLen; i++) acc[top + i] += acc[src + i];
    }
    for (let x = 0; x < size; x++) {
      const b = top + x * SUPER * 4;
      const d = y * outRow + x * 4;
      for (let c = 0; c < 4; c++) {
        out[d + c] = Math.round((acc[b + c] + acc[b + 4 + c] + acc[b + 8 + c] + acc[b + 12 + c]) / n);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 6. Verification: re-read the bytes and re-derive every chunk        */
/* ------------------------------------------------------------------ */

function verifyPng(file, expectW, expectH) {
  const b = readFileSync(file);
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8) fail('file shorter than the PNG signature');
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) fail(`bad PNG signature byte ${i} (${b[i]})`);
  if (b.toString('ascii', 12, 16) !== 'IHDR') fail('first chunk is not IHDR');

  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (w !== expectW || h !== expectH) fail(`IHDR says ${w}x${h}, expected ${expectW}x${expectH}`);
  if (b[24] !== 8) fail(`bit depth ${b[24]} != 8`);
  if (b[25] !== 6) fail(`colour type ${b[25]} != 6 (RGBA truecolour)`);
  if (b[26] !== 0 || b[27] !== 0 || b[28] !== 0) fail('unexpected compression/filter/interlace fields');

  let off = 8;
  const idat = [];
  let sawIhdr = false;
  let sawIend = false;
  let idatBefore = false;
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    if (off + 12 + len > b.length) fail(`chunk ${type} overruns the file`);
    const data = b.subarray(off + 8, off + 8 + len);
    const crc = b.readUInt32BE(off + 8 + len);
    if (crc32(b.subarray(off + 4, off + 8 + len)) !== crc) fail(`CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      if (len !== 13 || off !== 8) fail('malformed IHDR');
      sawIhdr = true;
    } else if (type === 'IDAT') {
      if (sawIend) fail('IDAT after IEND');
      idatBefore = true;
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      if (len !== 0) fail('IEND is not empty');
      sawIend = true;
    }
    off += 12 + len;
  }
  if (!sawIhdr || !sawIend || !idatBefore) fail('missing IHDR, IDAT or IEND');
  if (off !== b.length) fail(`trailing bytes after IEND (${off} != ${b.length})`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  if (raw.length !== (stride + 1) * h) {
    fail(`IDAT inflates to ${raw.length} bytes, expected ${(stride + 1) * h}`);
  }
  for (let y = 0; y < h; y++) {
    if (raw[y * (stride + 1)] !== 0) fail(`scanline ${y} uses a non-zero filter type`);
  }
  return { w, h };
}

/* ------------------------------------------------------------------ */
/* 7. Vector twin of the same artwork, for the browser tab icon        */
/* ------------------------------------------------------------------ */

function buildSvg() {
  const S = 512;
  const X = (v) => +(v * S).toFixed(2);
  const horns = L.horns
    .map(
      (t) =>
        `    <path d="${t.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])} ${X(p[1])}`).join(' ')}Z" ` +
        `stroke-width="${(L.hornRound * 2 * S).toFixed(2)}" stroke-linejoin="round"/>`,
    )
    .join('\n');
  const eyes = L.eyes
    .map((e) => {
      const parts = [
        [`ellipse`, { cx: X(MON.cx + e.ex), cy: X(MON.cy + e.ey), rx: X(e.erx), ry: X(e.ery), fill: '#ffffff' }],
        ['ellipse', { cx: X(MON.cx + e.px), cy: X(MON.cy + e.py), rx: X(e.prx), ry: X(e.pry), fill: '#1b1140' }],
        ['circle', { cx: X(MON.cx + e.hx), cy: X(MON.cy + e.hy), r: X(e.hr), fill: '#ffffff', opacity: '0.95' }],
      ];
      return parts
        .map(([tag, at]) => `    <${tag} ${Object.entries(at).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
        .join('\n');
    })
    .join('\n');
  const blush = L.blush
    .map(
      (b) =>
        `    <ellipse cx="${X(MON.cx + b.x)}" cy="${X(MON.cy + b.y)}" rx="${X(b.rx)}" ry="${X(b.ry)}" ` +
        `fill="#ff5f9d" opacity="0.7"/>`,
    )
    .join('\n');
  const sparkles = L.sparkles
    .map((s) => {
      const r = (s.r / 2) * S; // sparkle radius is measured in "double" units
      const k = r * 0.26;
      const cx = X(s.x);
      const cy = X(s.y);
      const f = (v) => v.toFixed(2);
      return (
        `    <path d="M${cx} ${f(cy - r)} Q${f(cx + k)} ${f(cy - k)} ${f(cx + r)} ${cy} ` +
        `Q${f(cx + k)} ${f(cy + k)} ${cx} ${f(cy + r)} ` +
        `Q${f(cx - k)} ${f(cy + k)} ${f(cx - r)} ${cy} ` +
        `Q${f(cx - k)} ${f(cy - k)} ${cx} ${f(cy - r)}Z"/>`
      );
    })
    .join('\n');

  const m = L.mouth;
  const mr = m.R * S;
  const a0 = m.mid - m.half;
  const a1 = m.mid + m.half;
  const p0x = X(m.x + m.R * Math.cos(a0));
  const p0y = X(m.y + m.R * Math.sin(a0));
  const p1x = X(m.x + m.R * Math.cos(a1));
  const p1y = X(m.y + m.R * Math.sin(a1));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Monster icon">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2de1c2"/>
      <stop offset="1" stop-color="#4a2fbd"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.44" r="0.62">
      <stop offset="0" stop-color="#d6fff6" stop-opacity="0.17"/>
      <stop offset="1" stop-color="#d6fff6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a0f8b6"/>
      <stop offset="0.35" stop-color="#7ef29a"/>
      <stop offset="1" stop-color="#63e286"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <rect width="${S}" height="${S}" fill="url(#glow)"/>
  <g fill="#fff6a8" opacity="0.92">
${sparkles}
  </g>
  <g fill="#ff6b9d" stroke="#ff6b9d" stroke-linejoin="round">
${horns}
  </g>
  <ellipse cx="${X(MON.cx)}" cy="${X(MON.cy)}" rx="${X(RX + RIM_W)}" ry="${X(RY + RIM_W)}" fill="#2c9c63"/>
  <ellipse cx="${X(MON.cx)}" cy="${X(MON.cy)}" rx="${X(RX)}" ry="${X(RY)}" fill="url(#body)"/>
  <g>
${blush}
  </g>
${eyes}
  <path d="M${p0x} ${p0y} A${mr.toFixed(2)} ${mr.toFixed(2)} 0 0 1 ${p1x} ${p1y}" fill="none" stroke="#1b1140" stroke-width="${(m.w * S).toFixed(2)}" stroke-linecap="round"/>
</svg>
`;
}

/* ------------------------------------------------------------------ */
/* 8. Main                                                             */
/* ------------------------------------------------------------------ */

const TARGETS = [
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-180.png', size: 180 },
  { file: 'icon-167.png', size: 167 },
  { file: 'icon-152.png', size: 152 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.78 },
  { file: 'favicon-32.png', size: 32 },
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const cache = new Map();
  const written = [];

  for (const t of TARGETS) {
    const scale = t.scale ?? 1;
    const key = `${t.size}@${scale}`;
    let png = cache.get(key);
    if (!png) {
      png = encodePng(t.size, t.size, renderIcon(t.size, scale));
      cache.set(key, png);
    }
    const file = join(OUT_DIR, t.file);
    writeFileSync(file, png);
    const { w, h } = verifyPng(file, t.size, t.size);
    const bytes = statSync(file).size;
    if (bytes !== png.length) throw new Error(`${t.file}: ${bytes} bytes on disk != ${png.length} encoded`);
    written.push({ file: t.file, dim: `${w}x${h}`, bytes });
  }

  const svg = buildSvg();
  const svgFile = join(OUT_DIR, 'favicon.svg');
  writeFileSync(svgFile, svg, 'utf8');
  const back = readFileSync(svgFile, 'utf8');
  if (back !== svg || !back.startsWith('<svg') || !back.trimEnd().endsWith('</svg>')) {
    throw new Error('favicon.svg did not round-trip');
  }
  written.push({ file: 'favicon.svg', dim: 'vector', bytes: statSync(svgFile).size });

  console.log(`wrote ${written.length} files to ${OUT_DIR}`);
  for (const f of written) {
    console.log(`  ${f.file.padEnd(24)} ${f.dim.padEnd(8)} ${String(f.bytes).padStart(8)} bytes`);
  }
}

try {
  main();
} catch (err) {
  console.error(`gen-icons: FAILED — ${err && err.stack ? err.stack : err}`);
  process.exit(1);
}
