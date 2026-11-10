import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// work/patch-user-translated-cutscenes.mjs
//
// Quantizes, compresses, and burns the user's high-resolution translated
// cutscene and background art into the GBA ROM.
//
// Source images reside in:
//   "cutscenes_to_translate/needs translatopn/translation/*.png"
//
// Each image is reduced to 240x160, quantised against its original GBA
// 512-byte palette bank (tilesPtr - 0x200), and LZ77-compressed into
// empty scratch space starting at 0x00F10000.
//

import fs from 'fs';
import { decodePNGtoRGB, downsampleTo240x160, compressLZ77, readPalBank } from './patch-translated-screens.mjs';
import { decompressLZ77 } from './patch-all-confirmed-ui.mjs';

export const USER_TRANSLATION_DIRS = [
  path.resolve(__dirname, '../assets/cutscenes'),
  path.resolve(__dirname, '../assets/tutorials'),
  path.resolve(__dirname, '../assets/screens'),
];

export const CUTSCENE_SCRATCH_BASE = 0x00f10000;
export const CUTSCENE_SCRATCH_STRIDE = 0x00006000; // 20 KiB tiles + 4 KiB map
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

// All 28 translated cutscene screens
export const CUTSCENE_SCREENS = JSON.parse(
  fs.readFileSync(new URL('./cutscene_metadata.json', import.meta.url), 'utf8')
);

export function loadUserCutsceneRGB(hex) {
  for (const dir of USER_TRANSLATION_DIRS) {
    const file = path.join(dir, `${hex}.png`);
    if (fs.existsSync(file)) {
      const { w, h, rgb } = decodePNGtoRGB(fs.readFileSync(file));
      return (w === 240 && h === 160) ? rgb : downsampleTo240x160(w, h, rgb);
    }
  }
  return null;
}

export function encodeCutsceneScreen(rom, scr, cleanRom = null) {
  const rgb = loadUserCutsceneRGB(scr.hex);
  if (!rgb) return null;

  const clean = cleanRom || getCleanRom();
  const transMask = clean ? getCleanTransparentMask(clean, scr.mapId, scr.tilesId) : null;

  const palBank = readPalBank(rom, scr.palOffset);
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

      for (const p of scr.allowedPals) {
        const pal = palBank[p];
        let pScore = 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const at = ((ty * 8 + y) * 240 + (tx * 8 + x)) * 3;
            const r = rgb[at], g = rgb[at + 1], b = rgb[at + 2];
            let minDist = Infinity;
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

export function cutsceneScratchFor(index) {
  const tiles = CUTSCENE_SCRATCH_BASE + index * CUTSCENE_SCRATCH_STRIDE;
  return { tiles, map: tiles + 0x00005000 };
}

export function patchUserTranslatedCutscenes(rom, cleanRom = null) {
  console.log(`--- Patching ${CUTSCENE_SCREENS.length} Cutscenes Translated by User ---`);
  let count = 0;

  for (let i = 0; i < CUTSCENE_SCREENS.length; i++) {
    const scr = CUTSCENE_SCREENS[i];
    const enc = encodeCutsceneScreen(rom, scr, cleanRom);
    if (!enc) {
      console.warn(`[SKIP] Missing ${scr.hex}.png in translation directories`);
      continue;
    }

    if (enc.uniqueTilesCount > 1024) {
      console.error(`[ERROR] ${scr.hex} exceeded 1024 GBA tiles: ${enc.uniqueTilesCount}`);
      continue;
    }
    if (enc.compTiles.length > 0x5000) {
      console.error(`[ERROR] ${scr.hex} compressed tiles exceed 20 KiB: ${enc.compTiles.length}`);
      continue;
    }
    if (enc.compMap.length > 0x1000) {
      console.error(`[ERROR] ${scr.hex} compressed map exceeds 4 KiB: ${enc.compMap.length}`);
      continue;
    }

    const { tiles, map } = cutsceneScratchFor(i);
    enc.compTiles.copy(rom, tiles);
    enc.compMap.copy(rom, map);

    const pTiles = ASSET_TABLE + scr.tilesId * 8;
    const pMap = ASSET_TABLE + scr.mapId * 8;
    rom.writeUInt32LE(enc.compTiles.length, pTiles);
    rom.writeUInt32LE(0x08000000 + tiles, pTiles + 4);
    rom.writeUInt32LE(enc.compMap.length, pMap);
    rom.writeUInt32LE(0x08000000 + map, pMap + 4);

    console.log(
      `[PATCHED] ${scr.hex.padEnd(8)} ${scr.title.padEnd(36)} ` +
      `${String(enc.uniqueTilesCount).padStart(4)} tiles, ` +
      `tiles ${String(enc.compTiles.length).padStart(5)}b @0x${tiles.toString(16)}, ` +
      `map ${String(enc.compMap.length).padStart(4)}b @0x${map.toString(16)}`,
    );
    count++;
  }

  console.log(`Successfully patched ${count}/${CUTSCENE_SCREENS.length} user cutscene assets into ROM!`);
  return count;
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('patch-user-translated-cutscenes.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchUserTranslatedCutscenes(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}

