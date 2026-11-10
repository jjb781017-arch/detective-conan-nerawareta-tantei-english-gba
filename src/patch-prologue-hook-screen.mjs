// work/patch-prologue-hook-screen.mjs
//
// Patches the dramatic single-line in-game black screen:
//   Original: この事件を解決するのは君しかいない！！
//   English Option B: ONLY YOU CAN SOLVE THIS CASE!!
//
// Asset IDs in Table 0:
//   Tiles:   0x0c44 (LZ77 4bpp tile graphics)
//   Tilemap: 0x0c45 (LZ77 2048-byte GBA 32x32 screen tilemap)
//
// Destination in ROM scratch area:
//   Tiles:   0x00D80000 (0x08D80000)
//   Tilemap: 0x00D84000 (0x08D84000)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { decodePNGtoRGB } from './patch-translated-screens.mjs';
import { compressLZ77, decompressLZ77 } from './patch-all-confirmed-ui.mjs';

export const PROLOGUE_HOOK_TILES_ID = 0x0c44;
export const PROLOGUE_HOOK_MAP_ID = 0x0c45;
export const PROLOGUE_HOOK_SCRATCH_TILES = 0x00D80000;
export const PROLOGUE_HOOK_SCRATCH_MAP = 0x00D84000;
export const ASSET_TABLE_BASE = 0xa7108;

export function encodeTilemapScreen(canvas240x160) {
  const uniqueTiles = [];
  const tileHashes = new Map();

  // Tile 0 is strictly opaque black (all index 1, matching clean Japanese ROM)
  const blankTile = Buffer.alloc(32, 0x11);
  uniqueTiles.push(blankTile);
  tileHashes.set(blankTile.toString('hex'), 0);

  const tilemap = Buffer.alloc(2048);

  for (let ty = 0; ty < 20; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      const tileBuf = Buffer.alloc(32);
      let isBlank = true;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x += 2) {
          const p1 = canvas240x160[(ty * 8 + y) * 240 + (tx * 8 + x)] & 0xf;
          const p2 = canvas240x160[(ty * 8 + y) * 240 + (tx * 8 + x + 1)] & 0xf;
          if (p1 !== 1 || p2 !== 1) isBlank = false;
          tileBuf[y * 4 + x / 2] = (p2 << 4) | p1;
        }
      }

      if (isBlank) {
        tilemap.writeUInt16LE(0, (ty * 32 + tx) * 2);
        continue;
      }

      const hex = tileBuf.toString('hex');
      let tileIdx = tileHashes.get(hex);
      if (tileIdx === undefined) {
        tileIdx = uniqueTiles.length;
        tileHashes.set(hex, tileIdx);
        uniqueTiles.push(tileBuf);
      }
      // Bank 0, no flip
      tilemap.writeUInt16LE(tileIdx, (ty * 32 + tx) * 2);
    }
  }

  const rawTiles = Buffer.concat(uniqueTiles);
  const compTiles = compressLZ77(rawTiles);
  const compMap = compressLZ77(tilemap);
  return { uniqueTilesCount: uniqueTiles.length, rawTiles, compTiles, tilemap, compMap };
}

export function patchPrologueHookScreen(rom) {
  console.log('--- Step: Patching In-Game Screen: "ONLY YOU CAN SOLVE THIS CASE!!" (0x0c44/0x0c45) ---');

  const pngPath = path.resolve(__dirname, '../assets/bin/english_optionB_oneline.png');
  if (!fs.existsSync(pngPath)) {
    throw new Error(`Missing translated screen image: ${pngPath}`);
  }

  const { w, h, rgb } = decodePNGtoRGB(fs.readFileSync(pngPath));
  if (w !== 240 || h !== 160) {
    throw new Error(`Invalid dimensions for prologue hook screen: ${w}x${h} (expected 240x160)`);
  }

  // Convert RGB to 4bpp index: 1 = opaque black, 2 = dark shadow, 14 = crisp white text
  const canvas = new Uint8Array(240 * 160);
  for (let i = 0; i < 240 * 160; i++) {
    const r = rgb[i * 3];
    if (r === 0) canvas[i] = 1;
    else if (r === 60) canvas[i] = 2;
    else canvas[i] = 14;
  }

  const { uniqueTilesCount, rawTiles, compTiles, tilemap, compMap } = encodeTilemapScreen(canvas);

  // Verify round-trip decompression
  const verifyTiles = decompressLZ77(compTiles, 0);
  const verifyMap = decompressLZ77(compMap, 0);
  if (!verifyTiles.equals(rawTiles) || !verifyMap.equals(tilemap)) {
    throw new Error('Self-test failed: LZ77 decompress did not match uncompressed tile/map data!');
  }

  // Write tiles to scratch area
  compTiles.copy(rom, PROLOGUE_HOOK_SCRATCH_TILES);
  const tilesTableEntry = ASSET_TABLE_BASE + PROLOGUE_HOOK_TILES_ID * 8;
  rom.writeUInt32LE(compTiles.length, tilesTableEntry);
  rom.writeUInt32LE(0x08000000 + PROLOGUE_HOOK_SCRATCH_TILES, tilesTableEntry + 4);

  // Write tilemap to scratch area
  compMap.copy(rom, PROLOGUE_HOOK_SCRATCH_MAP);
  const mapTableEntry = ASSET_TABLE_BASE + PROLOGUE_HOOK_MAP_ID * 8;
  rom.writeUInt32LE(compMap.length, mapTableEntry);
  rom.writeUInt32LE(0x08000000 + PROLOGUE_HOOK_SCRATCH_MAP, mapTableEntry + 4);

  console.log(`  [OK] Asset 0x${PROLOGUE_HOOK_TILES_ID.toString(16)} (Tiles): ${uniqueTilesCount} tiles, comp ${compTiles.length} B -> 0x${PROLOGUE_HOOK_SCRATCH_TILES.toString(16)}`);
  console.log(`  [OK] Asset 0x${PROLOGUE_HOOK_MAP_ID.toString(16)} (Map): comp ${compMap.length} B -> 0x${PROLOGUE_HOOK_SCRATCH_MAP.toString(16)}`);
}

