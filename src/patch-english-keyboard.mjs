import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// work/patch-english-keyboard.mjs
//
// Implements Option 1: English Keyboard & Text Input System
// 1. Burns the English keyboard graphic (Asset 0x2e68 / 0x2e67)
// 2. Burns the 90-byte English input grid into ROM 0x294040
// 3. Burns English answer strings (length byte + 16-bit glyph words) into riddle table +4

import fs from 'fs';
import { decompressLZ77 } from './patch-all-confirmed-ui.mjs';
import { decodePNGtoRGB, readPalBank, compressLZ77 } from './patch-translated-screens.mjs';
import { charToGlyphId, generateEnglishGridTable } from './generate_english_keyboard.mjs';
import { assembleThumbHook, buildMultiAnswerData } from './assemble_riddle_hook.mjs';

export const KANA_GRID_ROM_OFFSET = 0x294040;
export const RIDDLE_TABLE_BASE = 0x3b1b0;
export const ENGLISH_ANSWERS_SCRATCH = 0x00860000;

export function patchEnglishKeyboardGraphic(rom, cleanRom) {
  const ASSET_TABLE = 0xa7108;
  const tilesOffset = cleanRom.readUInt32LE(ASSET_TABLE + 0x2e67 * 8 + 4) & 0x01ffffff;
  const cleanTiles = decompressLZ77(cleanRom, tilesOffset);

  const cleanMapOffset = cleanRom.readUInt32LE(ASSET_TABLE + 0x2e68 * 8 + 4) & 0x01ffffff;
  const cleanMap = decompressLZ77(cleanRom, cleanMapOffset);

  // Load the English keyboard image
  const keyboardPath = fs.existsSync(path.resolve(__dirname, '../assets/eng_keyboard/0x2e68.png'))
    ? path.resolve(__dirname, '../assets/eng_keyboard/0x2e68.png')
    : path.resolve(__dirname, '../assets/bin/0x2e68.png');
  const imgBuf = fs.readFileSync(keyboardPath);
  const { w, h, rgb } = decodePNGtoRGB(imgBuf);

  // Read 512-byte palette bank at 0x776a38
  const palBank = readPalBank(cleanRom, 0x776a38);
  const allowedPals = [0, 1, 2, 3, 4];

  // Prepare combined tiles: start with a copy of cleanTiles (867 tiles)
  // Preserving clean tiles 0..658 ensures:
  // - Riddle Card Selection (0x2e6e) is 100% intact with zero visual corruption
  // - Riddle Question Card Frame (0x2e6a) is 100% intact
  // - The Input Text Box Frame (tiles 645..649) is 100% genuine clean ROM
  const mergedTiles = Buffer.alloc(1024 * 32);
  cleanTiles.subarray(0, 659 * 32).copy(mergedTiles, 0);

  const blankTileIdx = 866;
  const dividerTileIdx = 356;
  const KB_START_TILE = 659;
  let nextTileIdx = KB_START_TILE;
  const tileMap = new Map(); // hash -> tileIdx

  function hashTile(buf) { return buf.toString('hex'); }

  const blankTileBytes = cleanTiles.subarray(blankTileIdx * 32, (blankTileIdx + 1) * 32);
  tileMap.set(hashTile(blankTileBytes), blankTileIdx);

  const dividerTileBytes = cleanTiles.subarray(dividerTileIdx * 32, (dividerTileIdx + 1) * 32);
  tileMap.set(hashTile(dividerTileBytes), dividerTileIdx);

  // Build 2048-byte tilemap (32x32 entries)
  const newMap = Buffer.alloc(2048);

  // 1. Copy rows 0..6 directly from clean ROM tilemap:
  // This guarantees the input box has transparent interior (tile 866),
  // completely eliminating any black bar over typed letters!
  for (let ty = 0; ty <= 6; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      newMap.writeUInt16LE(cleanMap.readUInt16LE((ty * 32 + tx) * 2), (ty * 32 + tx) * 2);
    }
  }

  // 2. Encode keyboard rows 7..19
  for (let ty = 7; ty < 20; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      // Row 15: only Block 1 (tx = 10..19) holds the Spacebar; Block 0 and Block 2 are transparent
      if (ty === 15 && (tx < 10 || tx >= 20)) {
        newMap.writeUInt16LE(blankTileIdx, (ty * 32 + tx) * 2);
        continue;
      }
      // Rows 18..19: transparent bottom margin
      if (ty >= 18) {
        newMap.writeUInt16LE(blankTileIdx, (ty * 32 + tx) * 2);
        continue;
      }

      let isAllBlack = true;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const at = ((ty * 8 + py) * w + (tx * 8 + px)) * 3;
          if (rgb[at] !== 0 || rgb[at + 1] !== 0 || rgb[at + 2] !== 0) {
            isAllBlack = false;
            break;
          }
        }
        if (!isAllBlack) break;
      }

      if (isAllBlack) {
        newMap.writeUInt16LE(blankTileIdx, (ty * 32 + tx) * 2);
        continue;
      }

      let bestPal = allowedPals[0];
      let bestPalScore = Infinity;

      for (const p of allowedPals) {
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
        }
      }

      const th = hashTile(tileBuf);
      let assignedIdx = tileMap.get(th);
      if (assignedIdx === undefined) {
        assignedIdx = nextTileIdx++;
        tileMap.set(th, assignedIdx);
        tileBuf.copy(mergedTiles, assignedIdx * 32);
      }

      const entry = ((bestPal & 0xf) << 12) | (assignedIdx & 0x3ff);
      newMap.writeUInt16LE(entry, (ty * 32 + tx) * 2);
    }
  }

  // Preserve tile 866 (blank tile) at its original position
  blankTileBytes.copy(mergedTiles, 866 * 32);

  const finalTileCount = Math.max(867, nextTileIdx);
  const finalTilesSlice = mergedTiles.subarray(0, finalTileCount * 32);

  const compTiles = compressLZ77(finalTilesSlice);
  const compMap = compressLZ77(newMap);

  // Allocate in high scratch space: 0x00FC0000
  const tilesDest = 0x00FC0000;
  const mapDest = tilesDest + ((compTiles.length + 3) & ~3);

  compTiles.copy(rom, tilesDest);
  compMap.copy(rom, mapDest);

  // Update Table 0 pointers at 0xa7108
  const pTiles = ASSET_TABLE + 0x2e67 * 8;
  rom.writeUInt32LE(compTiles.length, pTiles);
  rom.writeUInt32LE(0x08000000 + tilesDest, pTiles + 4);

  const pMap = ASSET_TABLE + 0x2e68 * 8;
  rom.writeUInt32LE(compMap.length, pMap);
  rom.writeUInt32LE(0x08000000 + mapDest, pMap + 4);

  console.log(`Patched English Keyboard Graphic 0x2e68: merged tiles (${finalTileCount} tiles, ${compTiles.length}b @ 0x${tilesDest.toString(16)}), map (${compMap.length}b @ 0x${mapDest.toString(16)})`);
}

export function patchEnglishInputGrid(rom) {
  const grid = generateEnglishGridTable();
  grid.copy(rom, KANA_GRID_ROM_OFFSET);
  console.log(`Patched English 90-byte input grid at 0x${KANA_GRID_ROM_OFFSET.toString(16)}`);
}

export function encodeEnglishAnswer(ansStr) {
  const clean = (ansStr || '').toUpperCase().trim();
  // Length is capped at 10 by the game engine
  const len = Math.min(clean.length, 10);
  const buf = Buffer.alloc(2 + len * 2);
  buf[0] = len;
  buf[1] = 0x00; // padding byte
  for (let i = 0; i < len; i++) {
    buf.writeUInt16LE(charToGlyphId(clean[i]), 2 + i * 2);
  }
  return buf;
}

export function patchEnglishRiddleAnswers(rom) {
  const riddles = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/riddles_analysis.json'), 'utf8'));
  let cursor = ENGLISH_ANSWERS_SCRATCH;

  let patchedCount = 0;
  for (const r of riddles) {
    const cardId = r.cardId;
    if (cardId < 0 || cardId > 100) continue;

    // Use Romaji pronunciation answer as default English solution
    // e.g. "AYATORI"
    const ans = (r.answerRomaji || '').toUpperCase().trim();
    if (!ans) continue;

    const ansBytes = encodeEnglishAnswer(ans);
    ansBytes.copy(rom, cursor);

    // Repoint riddle table entry +4 to this scratch address
    const pTableEntry = RIDDLE_TABLE_BASE + cardId * 12 + 4;
    rom.writeUInt32LE(0x08000000 + cursor, pTableEntry);

    cursor += ansBytes.length;
    cursor = (cursor + 3) & ~3; // 4-byte align
    patchedCount++;
  }

  console.log(`Patched ${patchedCount} English riddle answers starting at 0x${ENGLISH_ANSWERS_SCRATCH.toString(16)}`);
}

export function patchRiddleAnswerCheckerHook(rom) {
  console.log('--- Patching Multi-Variation Riddle Answer Checker Hook ---');
  const HOOK_TABLE_OFFSET = 0x00868000;
  const HOOK_CODE_OFFSET  = 0x00869000;

  const cardsConfig = {
    10: [
      '9',
      '9 ',
      ' 9',
      '9 YEARS',
      '9YEARS',
      '9 YEAR',
      '9YEAR',
      'NINE',
      'NINE ',
      ' NINE',
      'NINE YEARS',
      'NINEYEARS',
      'NINE YEAR',
      'NINEYEAR',
      '10',
      '10 ',
      ' 10',
      '10 YEARS',
      '10YEARS',
      '10 YEAR',
      '10YEAR',
      'TEN',
      'TEN ',
      ' TEN',
      'TEN YEARS',
      'TENYEARS',
      'TEN YEAR',
      'TENYEAR',
      'KYUUNEN'
    ]
  };

  const data = buildMultiAnswerData(cardsConfig, 0x08000000 + HOOK_TABLE_OFFSET);
  data.tableBuf.copy(rom, HOOK_TABLE_OFFSET);
  data.varsBuf.copy(rom, HOOK_TABLE_OFFSET + data.tableBuf.length);

  const hookCode = assembleThumbHook(0x08000000 + HOOK_TABLE_OFFSET);
  hookCode.copy(rom, HOOK_CODE_OFFSET);

  // Install trampoline at 0x48aee
  // 0x48aee: ldr r3, [pc, #4]   -> 0x4b01
  // 0x48af0: bx  r3             -> 0x4718
  // 0x48af2: nop                -> 0x46c0
  // 0x48af4: .word 0x08869001
  rom.writeUInt16LE(0x4b01, 0x48aee);
  rom.writeUInt16LE(0x4718, 0x48af0);
  rom.writeUInt16LE(0x46c0, 0x48af2);
  rom.writeUInt32LE(0x08000000 + HOOK_CODE_OFFSET + 1, 0x48af4);

  // Fill remainder up to 0x48b58 with NOP (0x46c0)
  for (let p = 0x48af8; p < 0x48b58; p += 2) {
    rom.writeUInt16LE(0x46c0, p);
  }

  console.log(`Installed Multi-Variation Answer Hook at 0x48aee -> 0x${(0x08000000 + HOOK_CODE_OFFSET).toString(16)} (Card 10 has ${cardsConfig[10].length} accepted variations)`);
}

export function patchEnglishKeyboardSystem(rom, cleanRom) {
  patchEnglishKeyboardGraphic(rom, cleanRom);
  patchEnglishInputGrid(rom);
  patchEnglishRiddleAnswers(rom);
  patchRiddleAnswerCheckerHook(rom);
}
