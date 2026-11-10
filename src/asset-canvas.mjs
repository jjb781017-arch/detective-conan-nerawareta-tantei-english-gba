import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Shared loader: turn any focus asset into a palette-index canvas.
//
// Everything downstream (style study, English rendering, contact sheets) works on
// `idx`, a Uint8Array of 4bpp palette indices, because that is what can be written
// back into the ROM tile data losslessly. `c * 17` is only applied at PNG time.
import fs from 'fs';
import { decompress } from './asset-render.mjs';

export const ROM_PATH = process.env.CONAN_CLEAN_ROM || path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba');
export const TABLE = 0xa7108;

let rom = null;
export function getRom() {
  if (!rom) rom = fs.readFileSync(ROM_PATH);
  return rom;
}

export function ent(id) {
  const r = getRom();
  const e = TABLE + id * 8;
  return { size: r.readUInt32LE(e), ptr: r.readUInt32LE(e + 4) & 0x1ffffff };
}

export function lzAt(off) {
  const r = getRom();
  if (r[off] !== 0x10) return null;
  return decompress(r, off);
}

export function graphic(id) { return lzAt(ent(id).ptr); }

export function parseDesc(id) {
  const r = getRom();
  const e = ent(id + 1);
  if (e.size < 28 || e.size > 4096) return null;
  if ((e.size - 12) % 16 !== 0) return null;
  const n = (e.size - 12) / 16;
  if (r.readUInt16LE(e.ptr + 2) !== n) return null;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const o = e.ptr + 8 + i * 16;
    parts.push({
      w: r.readUInt16LE(o + 4),
      h: r.readUInt16LE(o + 6),
      tiles: r.readUInt16LE(o + 8),
      x: r.readUInt16LE(o + 12),
      y: r.readUInt16LE(o + 14),
    });
  }
  return parts;
}

export function descMatches(parts, g) {
  if (!parts || !parts.length) return false;
  let sum = 0;
  for (const p of parts) {
    if (!p.w || !p.h || p.w > 256 || p.h > 256) return false;
    if (p.tiles !== (p.w / 8) * (p.h / 8)) return false;
    sum += p.tiles;
  }
  return sum * 32 === g.length;
}

function tilePixel(g, tile, x, y) {
  const b = g[tile * 32 + y * 4 + (x >> 1)];
  return (x & 1) ? (b >> 4) : (b & 15);
}

export function assembleFromParts(g, parts) {
  const items = parts.map((p, i) => ({ ...p, i }));
  let px = items[0].x;
  for (const p of items) {
    let x = p.x;
    while (x + 256 < px) x += 512;
    while (x - 256 > px) x -= 512;
    p.X = x;
    px = x;
    p.Y = p.y;
  }
  const ys = items.map((p) => p.Y);
  if (Math.max(...ys) - Math.min(...ys) > 128) {
    for (const p of items) if (p.Y < 128) p.Y += 256;
  }
  const minX = Math.min(...items.map((p) => p.X));
  const minY = Math.min(...items.map((p) => p.Y));
  for (const p of items) { p.X -= minX; p.Y -= minY; }
  const W = Math.max(...items.map((p) => p.X + p.w));
  const H = Math.max(...items.map((p) => p.Y + p.h));
  const idx = new Uint8Array(W * H);
  let cursor = 0;
  for (const p of items) {
    const cols = p.w / 8;
    for (let t = 0; t < p.tiles; t++) {
      const tx = (t % cols) * 8, ty = Math.floor(t / cols) * 8;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const px2 = p.X + tx + x, py2 = p.Y + ty + y;
        if (px2 < 0 || py2 < 0 || px2 >= W || py2 >= H) continue;
        idx[py2 * W + px2] = tilePixel(g, cursor + t, x, y);
      }
    }
    p.tileStart = cursor;
    cursor += p.tiles;
  }
  return { idx, W, H, mode: 'parts', parts: items };
}

export function compositeScreen(tiles, map, W = 240, H = 160) {
  const MW = 32, MH = 32;
  const full = new Uint8Array(MW * 8 * MH * 8);
  for (let my = 0; my < MH; my++) for (let mx = 0; mx < MW; mx++) {
    const e = map.readUInt16LE((my * MW + mx) * 2);
    const ti = e & 0x3ff, hf = (e >> 10) & 1, vf = (e >> 11) & 1;
    if (ti * 32 + 32 > tiles.length) continue;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sx = hf ? 7 - x : x, sy = vf ? 7 - y : y;
      full[(my * 8 + y) * (MW * 8) + mx * 8 + x] = tilePixel(tiles, ti, sx, sy);
    }
  }
  const idx = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) idx[y * W + x] = full[y * (MW * 8) + x];
  return { idx, W, H, mode: 'tilemap', map };
}

export function rawTiles(g, perRow = 8) {
  const n = g.length / 32, rows = Math.ceil(n / perRow);
  const W = perRow * 8, H = rows * 8;
  const idx = new Uint8Array(W * H);
  for (let t = 0; t < n; t++) {
    const tx = (t % perRow) * 8, ty = Math.floor(t / perRow) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      idx[(ty + y) * W + tx + x] = tilePixel(g, t, x, y);
    }
  }
  return { idx, W, H, mode: 'raw8' };
}

export function loadAsset(id) {
  const g = graphic(id);
  if (!g) return null;
  const nextLz = lzAt(ent(id + 1).ptr);
  const parts = parseDesc(id);
  if (nextLz && nextLz.length === 2048 && !descMatches(parts, g)) {
    const res = compositeScreen(g, nextLz);
    res.tiles = g;
    return res;
  }
  if (descMatches(parts, g)) {
    const res = assembleFromParts(g, parts);
    res.tiles = g;
    return res;
  }
  const res = rawTiles(g, 8);
  res.tiles = g;
  return res;
}

// ------------------------------------------------------------ write back ---
// Re-pack a canvas back into the original 4bpp tile buffer, so an English
// recreation can be patched into the ROM without touching anything else.
// Returns { tiles, conflicts } where `conflicts` counts canvas pixels that map
// onto the same tile pixel with different values (should always be 0).
export function writeBackParts(asset, grid) {
  const out = Buffer.from(asset.tiles);
  let conflicts = 0;
  const seen = new Map();
  for (const p of asset.parts) {
    const cols = p.w / 8;
    for (let t = 0; t < p.tiles; t++) {
      const tx = (t % cols) * 8, ty = Math.floor(t / cols) * 8;
      const ti = p.tileStart + t;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const px = p.X + tx + x, py = p.Y + ty + y;
        if (px < 0 || py < 0 || px >= asset.W || py >= asset.H) continue;
        const v = grid[py * asset.W + px] & 15;
        const at = ti * 32 + y * 4 + (x >> 1);
        const shift = (x & 1) ? 4 : 0;
        const old = (out[at] >> shift) & 15;
        const k = at + ':' + shift;
        if (seen.has(k) && seen.get(k) !== v) conflicts++;
        seen.set(k, v);
        out[at] = shift ? ((out[at] & 0x0f) | (v << 4)) : ((out[at] & 0xf0) | v);
      }
    }
  }
  return { tiles: out, conflicts };
}

export function writeBackTilemap(asset, grid) {
  // Screen tiles are shared: the same blank card tile is reused everywhere, so
  // writing new lettering straight into one of them would corrupt every other
  // copy. Any screen tile whose pixels changed is therefore cloned into a fresh
  // tile and only that map entry is repointed. The tileset grows, which is fine
  // for the review PNGs (ROM insertion already needs relocation).
  const map = Buffer.from(asset.map);
  const blocks = [];
  for (let i = 0; i + 32 <= asset.tiles.length; i += 32) {
    blocks.push(Buffer.from(asset.tiles.subarray(i, i + 32)));
  }
  const readPx = (b, sx, sy) => (b[sy * 4 + (sx >> 1)] >> ((sx & 1) ? 4 : 0)) & 15;
  const writePx = (b, sx, sy, v) => {
    const at = sy * 4 + (sx >> 1);
    b[at] = (sx & 1) ? ((b[at] & 0x0f) | (v << 4)) : ((b[at] & 0xf0) | v);
  };
  let conflicts = 0, cloned = 0;
  for (let my = 0; my < 32; my++) for (let mx = 0; mx < 32; mx++) {
    const off = (my * 32 + mx) * 2;
    const e = map.readUInt16LE(off);
    const ti = e & 0x3ff, hf = (e >> 10) & 1, vf = (e >> 11) & 1;
    if (ti >= blocks.length) continue;
    const src = blocks[ti];
    let changed = false;
    for (let sy = 0; sy < 8 && !changed; sy++) for (let sx = 0; sx < 8; sx++) {
      const cx = mx * 8 + (hf ? 7 - sx : sx);
      const cy = my * 8 + (vf ? 7 - sy : sy);
      if (cx >= asset.W || cy >= asset.H) continue;
      if (readPx(src, sx, sy) !== (grid[cy * asset.W + cx] & 15)) { changed = true; break; }
    }
    if (!changed) continue;
    if (blocks.length >= 1024) { conflicts++; continue; }
    const clone = Buffer.from(src);
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
      const cx = mx * 8 + (hf ? 7 - sx : sx);
      const cy = my * 8 + (vf ? 7 - sy : sy);
      if (cx >= asset.W || cy >= asset.H) continue;
      writePx(clone, sx, sy, grid[cy * asset.W + cx] & 15);
    }
    blocks.push(clone);
    cloned++;
    map.writeUInt16LE((e & 0xfc00) | (blocks.length - 1), off);
  }
  return { tiles: Buffer.concat(blocks), map, conflicts, cloned };
}

// Palette-index canvas -> RGB buffer.
//
// The review images are deliberately rendered as a clean greyscale ramp
// (index * 17). The index canvas is the ROM's actual 4bpp tile data, so this is
// an exact, lossless view of what gets written back. Mapping the indices through
// guessed per-asset palettes produced garish, sometimes invisible previews
// (e.g. the Ghost Doctor title card), so previews stay neutral.
export function toRGB(idx, W, H, scale = 1) {
  const sw = W * scale, sh = H * scale;
  const rgb = Buffer.alloc(sw * sh * 3);

  for (let y = 0; y < sh; y++) {
    const srcY = Math.floor(y / scale);
    for (let x = 0; x < sw; x++) {
      const srcX = Math.floor(x / scale);
      const c = idx[srcY * W + srcX] & 15;
      const v = c * 17;
      const at = (y * sw + x) * 3;
      rgb[at] = v;
      rgb[at + 1] = v;
      rgb[at + 2] = v;
    }
  }
  return { rgb, sw, sh };
}

