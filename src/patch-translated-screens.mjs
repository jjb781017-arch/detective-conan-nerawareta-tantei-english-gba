import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// work/patch-translated-screens.mjs
//
// Encodes the 23 full-screen translated assets made by Community
// ("translated_screens/*.png") into the GBA ROM:
//
//   * 3  cutscene / newspaper screens
//   * 5  case intro title screens
//   * 8  minigame tutorial screens
//   * 7  gadget instruction cards
//
// Each source image is a 240x160 design exported at 2528x1686. It is reduced to
// 240x160, then every 8x8 cell is quantised against the real in-game palette
// bank and emitted as a unique tile + a 32x32 tilemap entry (with the chosen
// palette in the top nibble). Tiles and map are LZ77-compressed into reserved
// scratch space at 0x00E10000 and the asset table entries are re-pointed.
//
// IMPORTANT: this patcher runs LAST in build-dual-char-game.mjs, so it wins over
// the older BMP/pixel-bin versions of the same screens.
import fs from 'fs';
import zlib from 'zlib';
import { encodePNG } from './asset-render.mjs';
import { decompressLZ77 } from './patch-all-confirmed-ui.mjs';

export const TRANSLATED_SRC_DIRS = [
  path.resolve(__dirname, '../assets/screens'),
  path.resolve(__dirname, '../assets/titles'),
  path.resolve(__dirname, '../assets/gadgets'),
  path.resolve(__dirname, '../assets/tutorials'),
];
export const TRANSLATED_SRC_DIR = TRANSLATED_SRC_DIRS[0];
export const TRANSLATED_SCRATCH_BASE = 0x00e10000;
export const TRANSLATED_SCRATCH_STRIDE = 0x00005000; // 16 KiB tiles + 4 KiB map
export const ASSET_TABLE = 0xa7108;

let cleanRomCache = null;
function getCleanRom() {
  if (!cleanRomCache) {
    const p = process.env.CONAN_CLEAN_ROM || 
      (fs.existsSync(path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba'))
        ? path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba')
        : path.resolve(__dirname, '../../Meitantei Conan - Nerawareta Tantei.gba'));
    cleanRomCache = fs.readFileSync(p);
  }
  return cleanRomCache;
}

export function getCleanTransparentMask(cleanRom, mapId, tilesId) {
  const pMap = ASSET_TABLE + mapId * 8;
  const mapOffset = cleanRom.readUInt32LE(pMap + 4) & 0x01FFFFFF;
  const map = decompressLZ77(cleanRom, mapOffset);
  if (!map) return null;

  const pTiles = ASSET_TABLE + tilesId * 8;
  const tilesOffset = cleanRom.readUInt32LE(pTiles + 4) & 0x01FFFFFF;
  const tiles = decompressLZ77(cleanRom, tilesOffset);
  if (!tiles) return null;

  const mask = new Uint8Array(32 * 32);
  let hasZeros = false;
  for (let ty = 0; ty < 20; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      const entry = map.readUInt16LE((ty * 32 + tx) * 2);
      const tileIdx = entry & 0x3ff;
      const tileBytes = tiles.subarray(tileIdx * 32, (tileIdx + 1) * 32);
      if (tileBytes.every(b => b === 0)) {
        mask[ty * 32 + tx] = 1;
        hasZeros = true;
      }
    }
  }
  return hasZeros ? mask : null;
}

// The list order defines the scratch slot, so do not reorder it: the pointers
// already baked into the ROM assume this exact order.
//
// PALETTE RULE (established 2026-10-28 by measuring an in-game screenshot of
// the Japanese 4x4 tutorial):
//
//   The palette the game actually has in VRAM for a full-screen asset is the
//   512-byte bank stored IMMEDIATELY BEFORE the tiles: tilesPtr - 0x200.
//
// It is NOT the separate 512-byte palette asset that sits at the end of the
// asset bundle (0x3114/0x31a2/... pointers). Those are variants used by other
// sub-modes. Encoding against them produced the green/brown/magenta corruption
// reported in-game, because at runtime those slots hold different colours.
//
// The gadget cards are the exception: they share one bank (0x3ed608) and use
// sub-palette 13, so they carry an explicit `sharedPal`.
//
// allowedPals is the set of sub-palettes the ORIGINAL Japanese screen uses in
// its own tilemap. Only those slots are guaranteed to be populated at runtime;
// the remaining slots of these banks are often all-zero (black) or get
// overwritten by the shared UI palette.
export const TRANSLATED_SCREENS = [
  // --- cutscenes -------------------------------------------------------
  { hex: '0x2409', title: 'Newspaper Cutscene', tilesId: 0x2409, mapId: 0x240a, palOffset: 0x61a5b0, allowedPals: [0] },
  { hex: '0x2431', title: 'Cutscene Background', tilesId: 0x2431, mapId: 0x2432, palOffset: 0x61fd90, allowedPals: [0, 1, 2, 3, 4, 5] },
  { hex: '0x2b2d', title: 'Event Cutscene', tilesId: 0x2b2d, mapId: 0x2b2e, palOffset: 0x72809c, allowedPals: [0] },

  // --- case intro titles ----------------------------------------------
  { hex: '0x2dc5', title: 'Case 4 (Security System)', tilesId: 0x2dc5, mapId: 0x2dc6, palOffset: 0x76f268, allowedPals: [0] },
  { hex: '0x2dd9', title: 'Case 1 (Theme Park)', tilesId: 0x2dd9, mapId: 0x2dda, palOffset: 0x7703a8, allowedPals: [0] },
  { hex: '0x2ded', title: 'Case 2 (Chinatown)', tilesId: 0x2ded, mapId: 0x2dee, palOffset: 0x770e38, allowedPals: [0] },
  { hex: '0x2e01', title: 'Case 5 (Haunted Hospital)', tilesId: 0x2e01, mapId: 0x2e02, palOffset: 0x771b64, allowedPals: [0] },
  { hex: '0x2e15', title: 'Case 6 (Pet Robot)', tilesId: 0x2e15, mapId: 0x2e16, palOffset: 0x772a90, allowedPals: [0] },
  { hex: '0x2e29', title: 'Game Subtitle (Targeted Detective)', tilesId: 0x2e29, mapId: 0x2e2a, palOffset: 0x7737dc, allowedPals: [0] },

  // --- minigame / system tutorials ------------------------------------
  // NOTE: Minigame tutorial screens (0x3111, 0x319f, 0x31c7, 0x31f1, 0x3230,
  // 0x325a, 0x3296) and minigame puzzle layers (0x3219) are handled by their
  // respective minigame engines. Do NOT duplicate or overwrite them here.

  // --- gadget instruction cards ---------------------------------------
  { hex: '0xc58', title: 'Power Kick Shoes', tilesId: 0xc58, mapId: 0xc59, palOffset: 0x3ed608, allowedPals: [13] },
  { hex: '0xc5e', title: 'Voice-Changing Bow Tie', tilesId: 0xc5e, mapId: 0xc5f, palOffset: 0x3ed608, allowedPals: [13] },
  { hex: '0xc61', title: 'Turbo Skateboard', tilesId: 0xc61, mapId: 0xc62, palOffset: 0x3ed608, allowedPals: [13] },
  { hex: '0xc64', title: 'Tracking Glasses', tilesId: 0xc64, mapId: 0xc65, palOffset: 0x3ed608, allowedPals: [13] },
  { hex: '0xc67', title: 'Detective Boys Badge', tilesId: 0xc67, mapId: 0xc68, palOffset: 0x3ed608, allowedPals: [13] },
  { hex: '0xc6a', title: 'Earring Phone', tilesId: 0xc6a, mapId: 0xc6b, palOffset: 0x3ed608, allowedPals: [13] },
  { hex: '0xc6d', title: 'Wristwatch Tranquilizer', tilesId: 0xc6d, mapId: 0xc6e, palOffset: 0x3ed608, allowedPals: [13] },
  { hex: '0xc5b', title: 'Wristwatch Flashlight', tilesId: 0xc5b, mapId: 0xc5c, palOffset: 0x3ed608, allowedPals: [13] },
];

// The palette bank the game really has loaded for this screen. These values are
// verified against the clean Japanese ROM by work/verify-translated-screens.mjs:
// for every non-gadget screen `palOffset === tilesPtr - 0x200`.
export function resolvePalOffset(rom, scr) {
  return scr.palOffset;
}

// Guard used by the verifier: recompute the rule from the clean ROM.
export function expectedPalOffset(cleanRom, scr) {
  if (scr.sharedPal != null) return scr.sharedPal;
  if (scr.palOffset === 0x3ed608) return 0x3ed608; // shared gadget bank
  const ptr = cleanRom.readUInt32LE(ASSET_TABLE + scr.tilesId * 8 + 4) & 0x1ffffff;
  return ptr - 0x200;
}

// ---------------------------------------------------------------------------
// PNG -> 240x160 RGB
// ---------------------------------------------------------------------------
export function decodePNGtoRGB(buf) {
  let pos = 8;
  const idatChunks = [];
  let ihdr = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') ihdr = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IDAT') idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * bpp;
  const rgb = Buffer.alloc(w * h * 3);

  let srcPos = 0;
  const rowBuf = Buffer.alloc(stride);
  const prevRow = Buffer.alloc(stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[srcPos++];
    for (let x = 0; x < stride; x++) {
      let b = raw[srcPos++];
      const left = x >= bpp ? rowBuf[x - bpp] : 0;
      const up = y > 0 ? prevRow[x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? prevRow[x - bpp] : 0;
      if (filter === 1) b = (b + left) & 0xff;
      else if (filter === 2) b = (b + up) & 0xff;
      else if (filter === 3) b = (b + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        const pr = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
        b = (b + pr) & 0xff;
      }
      rowBuf[x] = b;
    }
    rowBuf.copy(prevRow);
    for (let x = 0; x < w; x++) {
      const atDst = (y * w + x) * 3;
      const atSrc = x * bpp;
      rgb[atDst] = rowBuf[atSrc];
      rgb[atDst + 1] = rowBuf[atSrc + 1];
      rgb[atDst + 2] = rowBuf[atSrc + 2];
    }
  }
  return { w, h, rgb };
}

export function downsampleTo240x160(w, h, rgb) {
  const out = Buffer.alloc(240 * 160 * 3);
  for (let y = 0; y < 160; y++) {
    const sy = Math.min(h - 1, Math.round(y * (h - 1) / 159));
    for (let x = 0; x < 240; x++) {
      const sx = Math.min(w - 1, Math.round(x * (w - 1) / 239));
      const srcAt = (sy * w + sx) * 3;
      const dstAt = (y * 240 + x) * 3;
      out[dstAt] = rgb[srcAt];
      out[dstAt + 1] = rgb[srcAt + 1];
      out[dstAt + 2] = rgb[srcAt + 2];
    }
  }
  return out;
}

export function findTranslatedFile(hex) {
  for (const dir of TRANSLATED_SRC_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const exact = path.join(dir, `${hex}.png`);
    if (fs.existsSync(exact)) return exact;

    const list = fs.readdirSync(dir);
    const match = list.find(f => f.toLowerCase().includes(hex.toLowerCase()) && f.endsWith('.png'));
    if (match) return path.join(dir, match);
  }
  return null;
}

export function loadSourceRGB(hex) {
  const file = findTranslatedFile(hex);
  if (!file) return null;
  const { w, h, rgb } = decodePNGtoRGB(fs.readFileSync(file));
  return (w === 240 && h === 160) ? rgb : downsampleTo240x160(w, h, rgb);
}

export function assertNoDistance1(stream, label = '') {
  const outLen = stream[1] | (stream[2] << 8) | (stream[3] << 16);
  let p = 4, o = 0;
  while (o < outLen) {
    const flags = stream[p++];
    for (let bit = 7; bit >= 0 && o < outLen; bit--) {
      if ((flags >> bit) & 1) {
        const b0 = stream[p++], b1 = stream[p++];
        const len = (b0 >> 4) + 3;
        const dist = (((b0 & 0xf) << 8) | b1) + 1;
        if (dist === 1) {
          throw new Error(`LZ77 stream for ${label} contains a distance-1 copy at output offset ${o}; GBA VRAM decoder corrupts these`);
        }
        o += len;
      } else {
        p++; o++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// LZ77 (GBA BIOS type 1)
// ---------------------------------------------------------------------------
export function compressLZ77(data) {
  const chunks = [];
  const header = Buffer.alloc(4);
  header[0] = 0x10;
  header[1] = data.length & 0xff;
  header[2] = (data.length >> 8) & 0xff;
  header[3] = (data.length >> 16) & 0xff;
  chunks.push(header);

  let inPos = 0;
  while (inPos < data.length) {
    let flagByte = 0;
    const blockData = [];
    for (let bit = 7; bit >= 0 && inPos < data.length; bit--) {
      let bestLen = 0, bestDist = 0;
      const maxLen = Math.min(18, data.length - inPos);
      const minPos = Math.max(0, inPos - 4096);
      // Start at inPos - 2: distance must be >= 2. The GBA hardware/VRAM LZ77
      // decompressor mishandles distance-1 (disp=0) copies, leaving stale VRAM
      // and causing striped / transparent line artifacts.
      for (let p = inPos - 2; p >= minPos; p--) {
        let len = 0;
        while (len < maxLen && data[p + len] === data[inPos + len]) len++;
        if (len > bestLen && len >= 3) {
          bestLen = len; bestDist = inPos - p;
          if (bestLen === maxLen) break;
        }
      }
      if (bestLen >= 3) {
        flagByte |= (1 << bit);
        blockData.push(((bestLen - 3) << 4) | (((bestDist - 1) >> 8) & 0x0f));
        blockData.push((bestDist - 1) & 0xff);
        inPos += bestLen;
      } else {
        blockData.push(data[inPos++]);
      }
    }
    chunks.push(Buffer.from([flagByte]), Buffer.from(blockData));
  }
  const stream = Buffer.concat(chunks);
  assertNoDistance1(stream);
  return stream;
}

export function readPalBank(rom, offset) {
  const bank = [];
  for (let p = 0; p < 16; p++) {
    const pal = [];
    for (let i = 0; i < 16; i++) {
      const c = rom.readUInt16LE(offset + p * 32 + i * 2);
      pal.push([
        Math.round((c & 0x1f) * 255 / 31),
        Math.round(((c >> 5) & 0x1f) * 255 / 31),
        Math.round(((c >> 10) & 0x1f) * 255 / 31),
      ]);
    }
    bank.push(pal);
  }
  return bank;
}

// ---------------------------------------------------------------------------
// Screen encoder
// ---------------------------------------------------------------------------
export function encodeTranslatedScreen(rom, scr, cleanRom = null) {
  const rgb = loadSourceRGB(scr.hex);
  if (!rgb) return null;

  const clean = cleanRom || getCleanRom();
  const transMask = clean ? getCleanTransparentMask(clean, scr.mapId, scr.tilesId) : null;

  const palBank = readPalBank(rom, resolvePalOffset(rom, scr));
  const uniqueTiles = [];
  const tileHashes = new Map();
  const blankTile = Buffer.alloc(32);
  uniqueTiles.push(blankTile);
  tileHashes.set(blankTile.toString('hex'), 0);

  const tilemap = Buffer.alloc(2048);
  const previewRGB = Buffer.alloc(240 * 160 * 3);

  for (let ty = 0; ty < 20; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      if (transMask && transMask[ty * 32 + tx] === 1) {
        tilemap.writeUInt16LE(0, (ty * 32 + tx) * 2);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const at = ((ty * 8 + y) * 240 + (tx * 8 + x)) * 3;
            previewRGB[at] = 0;
            previewRGB[at + 1] = 0;
            previewRGB[at + 2] = 0;
          }
        }
        continue;
      }

      let bestPal = scr.allowedPals[0];
      let bestPalScore = Infinity;

      // Pick the sub-palette that quantises this cell with the least error.
      for (const p of scr.allowedPals) {
        const pal = palBank[p];
        let pScore = 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const at = ((ty * 8 + y) * 240 + (tx * 8 + x)) * 3;
            const r = rgb[at], g = rgb[at + 1], b = rgb[at + 2];
            let minDist = Infinity;
            // Index 0 is the BG backdrop, never an opaque pixel colour.
            for (let c = 1; c < 16; c++) {
              const d = (r - pal[c][0]) ** 2 + (g - pal[c][1]) ** 2 + (b - pal[c][2]) ** 2;
              if (d < minDist) minDist = d;
            }
            pScore += minDist;
          }
        }
        if (pScore < bestPalScore) {
          bestPalScore = pScore;
          bestPal = p;
        }
      }

      const pal = palBank[bestPal];
      const tileBuf = Buffer.alloc(32);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x += 2) {
          const at1 = ((ty * 8 + y) * 240 + (tx * 8 + x)) * 3;
          const at2 = ((ty * 8 + y) * 240 + (tx * 8 + x + 1)) * 3;
          let bestC1 = 1, dist1 = Infinity;
          let bestC2 = 1, dist2 = Infinity;
          for (let c = 1; c < 16; c++) {
            const d1 = (rgb[at1] - pal[c][0]) ** 2 + (rgb[at1 + 1] - pal[c][1]) ** 2 + (rgb[at1 + 2] - pal[c][2]) ** 2;
            if (d1 < dist1) { dist1 = d1; bestC1 = c; }
            const d2 = (rgb[at2] - pal[c][0]) ** 2 + (rgb[at2 + 1] - pal[c][1]) ** 2 + (rgb[at2 + 2] - pal[c][2]) ** 2;
            if (d2 < dist2) { dist2 = d2; bestC2 = c; }
          }
          tileBuf[y * 4 + x / 2] = (bestC2 << 4) | bestC1;

          previewRGB[at1] = pal[bestC1][0];
          previewRGB[at1 + 1] = pal[bestC1][1];
          previewRGB[at1 + 2] = pal[bestC1][2];
          previewRGB[at2] = pal[bestC2][0];
          previewRGB[at2 + 1] = pal[bestC2][1];
          previewRGB[at2 + 2] = pal[bestC2][2];
        }
      }

      const key = bestPal + ':' + tileBuf.toString('hex');
      let tileIdx = tileHashes.get(key);
      if (tileIdx === undefined) {
        tileIdx = uniqueTiles.length;
        tileHashes.set(key, tileIdx);
        uniqueTiles.push(tileBuf);
      }
      tilemap.writeUInt16LE(tileIdx | (bestPal << 12), (ty * 32 + tx) * 2);
    }
  }

  const rawTiles = Buffer.concat(uniqueTiles);
  return {
    uniqueTilesCount: uniqueTiles.length,
    rawTiles,
    compTiles: compressLZ77(rawTiles),
    tilemap,
    compMap: compressLZ77(tilemap),
    previewRGB,
  };
}

export function translatedScratchFor(index) {
  const tiles = TRANSLATED_SCRATCH_BASE + index * TRANSLATED_SCRATCH_STRIDE;
  return { tiles, map: tiles + 0x00004000 };
}

// ---------------------------------------------------------------------------
// Patcher
// ---------------------------------------------------------------------------
export function patchTranslatedScreens(rom, cleanRom = null) {
  console.log(`--- Patching ${TRANSLATED_SCREENS.length} translated_screens ---`);
  let count = 0;

  for (let i = 0; i < TRANSLATED_SCREENS.length; i++) {
    const scr = TRANSLATED_SCREENS[i];
    const enc = encodeTranslatedScreen(rom, scr, cleanRom);
    if (!enc) {
      console.warn(`[SKIP] Missing ${path.join(TRANSLATED_SRC_DIR, scr.hex + '.png')}`);
      continue;
    }

    if (enc.uniqueTilesCount > 1024) {
      console.error(`[ERROR] ${scr.hex} exceeded 1024 GBA tiles: ${enc.uniqueTilesCount}`);
      continue;
    }
    if (enc.compTiles.length > 0x4000) {
      console.error(`[ERROR] ${scr.hex} compressed tiles exceed 16 KiB: ${enc.compTiles.length}`);
      continue;
    }
    if (enc.compMap.length > 0x1000) {
      console.error(`[ERROR] ${scr.hex} compressed map exceeds 4 KiB: ${enc.compMap.length}`);
      continue;
    }

    const { tiles, map } = translatedScratchFor(i);
    enc.compTiles.copy(rom, tiles);
    enc.compMap.copy(rom, map);

    const pTiles = ASSET_TABLE + scr.tilesId * 8;
    const pMap = ASSET_TABLE + scr.mapId * 8;
    rom.writeUInt32LE(enc.compTiles.length, pTiles);
    rom.writeUInt32LE(0x08000000 + tiles, pTiles + 4);
    rom.writeUInt32LE(enc.compMap.length, pMap);
    rom.writeUInt32LE(0x08000000 + map, pMap + 4);

    console.log(
      `[PATCHED] ${scr.hex.padEnd(8)} ${scr.title.padEnd(30)} ` +
      `${String(enc.uniqueTilesCount).padStart(4)} tiles, ` +
      `tiles ${String(enc.compTiles.length).padStart(5)}b @0x${tiles.toString(16)}, ` +
      `map ${String(enc.compMap.length).padStart(4)}b @0x${map.toString(16)}`,
    );
    count++;
  }

  console.log(`Successfully patched ${count}/${TRANSLATED_SCREENS.length} Community translated assets into ROM!`);
  return count;
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('patch-translated-screens.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchTranslatedScreens(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
