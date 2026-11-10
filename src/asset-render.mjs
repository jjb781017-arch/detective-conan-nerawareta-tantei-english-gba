import fs from 'fs';
import zlib from 'zlib';

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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
export function encodePNG(width, height, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function encodeRGBA(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// 4bpp tiles -> grayscale, optional 2x upscale, transparent(0)=black
export function renderTiles(data, tilesPerRow = 8, scale = 2, invert = false) {
  const tiles = Math.floor(data.length / 32);
  if (!tiles) return null;
  const rows = Math.ceil(tiles / tilesPerRow);
  const w = tilesPerRow * 8, h = rows * 8;
  const img = Buffer.alloc(w * h, 0);
  for (let t = 0; t < tiles; t++) {
    const tx = (t % tilesPerRow) * 8, ty = Math.floor(t / tilesPerRow) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const b = data[t * 32 + y * 4 + (x >> 1)];
        let c = (x & 1) ? (b >> 4) : (b & 15);
        let v = c * 17;
        if (invert) v = 255 - v;
        img[(ty + y) * w + tx + x] = v;
      }
    }
  }
  const sw = w * scale, sh = h * scale;
  const rgb = Buffer.alloc(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const v = img[Math.floor(y / scale) * w + Math.floor(x / scale)];
      const at = (y * sw + x) * 3;
      rgb[at] = rgb[at + 1] = rgb[at + 2] = v;
    }
  }
  return { png: encodePNG(sw, sh, rgb), width: sw, height: sh, tiles, tilesPerRow, rows };
}

export function decompress(rom, off) {
  if (off < 0 || off + 4 > rom.length || rom[off] !== 0x10) return null;
  const size = rom[off + 1] | (rom[off + 2] << 8) | (rom[off + 3] << 16);
  if (size === 0 || size > 0x100000) return null;
  const out = Buffer.alloc(size);
  let ip = off + 4, op = 0;
  while (op < size) {
    if (ip >= rom.length) return null;
    const flags = rom[ip++];
    for (let bit = 7; bit >= 0 && op < size; bit--) {
      if (!(flags & (1 << bit))) { if (ip >= rom.length) return null; out[op++] = rom[ip++]; }
      else {
        if (ip + 1 >= rom.length) return null;
        const a = rom[ip++], b = rom[ip++];
        const len = (a >> 4) + 3, dist = ((a & 15) << 8 | b) + 1;
        if (dist > op) return null;
        for (let i = 0; i < len && op < size; i++) out[op] = out[op - dist], op++;
      }
    }
  }
  return out;
}

export function textStats(data) {
  const tiles = Math.floor(data.length / 32);
  let ink = 0, total = 0;
  const colors = new Set();
  for (let t = 0; t < tiles; t++) {
    for (let i = 0; i < 32; i++) {
      const b = data[t * 32 + i];
      const lo = b & 15, hi = b >> 4;
      colors.add(lo); colors.add(hi);
      if (lo) ink++;
      if (hi) ink++;
      total += 2;
    }
  }
  return { tiles, uniqueColors: colors.size, inkRatio: total ? ink / total : 0 };
}
