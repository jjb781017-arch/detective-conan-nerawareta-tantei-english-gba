// Patch the remaining approved English assets that have style configs
// but were not yet written into the ROM.
//
// Uses the same en-build-one.mjs pipeline as the review PNGs, then writes the
// relocated tiles into the ROM at a free scratch address and repoints the
// asset table entry.
//
// To add: `import { patchRemainingApprovedUI } from './patch-remaining-approved-ui.mjs';`
//         call it in build-dual-char-game.mjs after step 19 (before step 20).

import fs from 'fs';
import { loadAsset, writeBackParts, writeBackTilemap } from './asset-canvas.mjs';
import { buildOne } from './en-build-one.mjs';
import { ASSETS } from './en-styles.mjs';

// The 30 approved assets that have en-styles configs and are NOT yet patched.
// The remaining 9 (0xd4a, 0xd4c, 0x2165, 0x2167, 0x2169, 0x216b, 0x2181,
// 0x21ab, 0x2243-bak) have no style config yet — they need manual style
// entries in en-styles.mjs before they can be patched.
const TARGETS = [
  '0xd4a', '0xd4c',
  '0x2087', '0x2089', '0x208b', '0x208d',
  '0x216d', '0x216f', '0x2171', '0x2173', '0x2175', '0x2177',
  '0x2179', '0x217b', '0x217d', '0x217f', '0x2181',
  '0x2183', '0x2185', '0x2187', '0x2189', '0x21ab',
  '0x2229', '0x2241', '0x2243', '0x2246',
  '0x3075', '0x3099', '0x309f',
  '0x30c3', '0x30c5', '0x30c7', '0x30c9',
  '0x30e6', '0x30e8', '0x30ea', '0x30fe',
  '0x3310',
];

// Start the scratch region just after the minigame banner / submenu / UI button
// space used by patch-all-confirmed-ui (0xD00000–0xD0FFFF).
// Each asset needs (compressed tile bytes + 8-byte header). Max raw tile size
// observed is 4096 b; LZ77 shrinks it ~2–4×. 4 KiB slots are generous.
const SCRATCH_START = 0x00D10000;
const SCRATCH_SLOT = 0x00001000; // 4 KiB per asset

function compressLZ77(data) {
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
      for (let p = inPos - 1; p >= minPos; p--) {
        let len = 0;
        while (len < maxLen && data[p + len] === data[inPos + len]) len++;
        if (len > bestLen && len >= 3) {
          bestLen = len;
          bestDist = inPos - p;
          if (bestLen === maxLen) break;
        }
      }
      if (bestLen >= 3) {
        flagByte |= (1 << bit);
        const a = ((bestLen - 3) << 4) | (((bestDist - 1) >> 8) & 0x0f);
        const b = (bestDist - 1) & 0xff;
        blockData.push(a, b);
        inPos += bestLen;
      } else {
        blockData.push(data[inPos++]);
      }
    }
    if (blockData.length) {
      chunks.push(Buffer.from([flagByte]), ...blockData.map((v) => Buffer.from([v])));
    }
  }
  return Buffer.concat(chunks);
}

export function patchRemainingApprovedUI(rom, cleanRom) {
  console.log('=== Patching Remaining Approved UI Assets (' + TARGETS.length + ') ===');
  const results = [];

  for (let i = 0; i < TARGETS.length; i++) {
    const hex = TARGETS[i];
    const id = parseInt(hex, 16);
    const dest = SCRATCH_START + i * SCRATCH_SLOT;

    // 1. Build the English recreation in memory (same as review PNG pipeline)
    let r;
    try {
      r = buildOne(hex);
    } catch (e) {
      console.log(`  SKIP ${hex}: ${e.message}`);
      continue;
    }
    if (!r.ok) {
      console.log(`  SKIP ${hex}: ${r.reason}`);
      continue;
    }

    // 2. Write back tiles from the modified grid, using the original asset
    const asset = loadAsset(id);
    let rawTiles;
    if (r.mode === 'parts') {
      const wb = writeBackParts(asset, r.grid);
      rawTiles = wb.tiles;
      if (wb.conflicts > 0) {
        console.log(`  WARNING ${hex}: ${wb.conflicts} tile pixel conflicts`);
      }
    } else if (r.mode === 'tilemap') {
      const wb = writeBackTilemap(asset, r.grid);
      // Tilemap mode: tiles + appended map. The ROM engine for tilemap-mode
      // assets reads the tileset first, then the map, from the same LZ blob.
      rawTiles = Buffer.concat([wb.tiles, Buffer.from(wb.map)]);
      if (wb.conflicts > 0) {
        console.log(`  WARNING ${hex}: ${wb.conflicts} tilemap pixel conflicts`);
      }
    } else {
      console.log(`  SKIP ${hex}: unknown mode ${r.mode}`);
      continue;
    }

    // 3. Compress and write to ROM scratch space
    const compTiles = compressLZ77(rawTiles);
    if (compTiles.length > SCRATCH_SLOT - 8) {
      console.log(`  SKIP ${hex}: compressed ${compTiles.length}b exceeds slot ${SCRATCH_SLOT - 8}b`);
      continue;
    }

    const p = 0xa7108 + id * 8;
    compTiles.copy(rom, dest);
    rom.writeUInt32LE(compTiles.length, p);
    rom.writeUInt32LE(0x08000000 + dest, p + 4);
    console.log(`  Patched ${hex} (${r.W}x${r.H}, ${r.mode}): ${compTiles.length}b @ 0x${(0x08000000 + dest).toString(16)}`);
    results.push({ hex, dest, size: compTiles.length, mode: r.mode });
  }

  console.log(`=== ${results.length}/${TARGETS.length} Remaining Approved UI Assets Patched ===`);
  return results;
}
