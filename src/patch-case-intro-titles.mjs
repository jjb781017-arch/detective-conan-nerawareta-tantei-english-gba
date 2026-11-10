import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'fs';

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
    chunks.push(Buffer.from([flagByte]), Buffer.from(blockData));
  }
  return Buffer.concat(chunks);
}

// Universal 240x160 Tilemap Screen Encoder
function encodeScreen(canvas240x160) {
  const uniqueTiles = [];
  const tileHashes = new Map();

  // Tile 0 is always the blank tile
  const blankTile = Buffer.alloc(32);
  uniqueTiles.push(blankTile);
  tileHashes.set(blankTile.toString('hex'), 0);

  const tilemap = Buffer.alloc(2048); // 32x32 uint16 entries

  for (let ty = 0; ty < 20; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      const tileBuf = Buffer.alloc(32);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x += 2) {
          const p1 = canvas240x160[(ty * 8 + y) * 240 + (tx * 8 + x)] & 0xf;
          const p2 = canvas240x160[(ty * 8 + y) * 240 + (tx * 8 + x + 1)] & 0xf;
          tileBuf[y * 4 + x / 2] = (p2 << 4) | p1;
        }
      }
      const hex = tileBuf.toString('hex');
      let tileIdx = tileHashes.get(hex);
      if (tileIdx === undefined) {
        tileIdx = uniqueTiles.length;
        tileHashes.set(hex, tileIdx);
        uniqueTiles.push(tileBuf);
      }
      // Tilemap entry: tileIdx (bits 0..9), no flip, pal 0 (bits 12..15)
      tilemap.writeUInt16LE(tileIdx, (ty * 32 + tx) * 2);
    }
  }

  const rawTiles = Buffer.concat(uniqueTiles);
  const compTiles = compressLZ77(rawTiles);
  const compMap = compressLZ77(tilemap);
  return { uniqueTilesCount: uniqueTiles.length, rawTiles, compTiles, tilemap, compMap };
}

export function patchCaseIntroTitles(rom) {
  console.log('--- Patching Case Intro English Title Screens ---');

  const cases = [
    { name: 'Case 1', file: 'case1_pixels.bin', tilesId: 0x2dc5, mapId: 0x2dc6, expTiles: 0x00C40000, expMap: 0x00C44000 },
    { name: 'Case 2', file: 'case2_pixels.bin', tilesId: 0x2dd9, mapId: 0x2dda, expTiles: 0x00C46000, expMap: 0x00C4A000 },
    { name: 'Case 3', file: 'case3_pixels.bin', tilesId: 0x2ded, mapId: 0x2dee, expTiles: 0x00C4C000, expMap: 0x00C50000 },
    { name: 'Case 4', file: 'case4_pixels.bin', tilesId: 0x2e01, mapId: 0x2e02, expTiles: 0x00C52000, expMap: 0x00C56000 },
    { name: 'Case 5', file: 'case5_pixels.bin', tilesId: 0x2e15, mapId: 0x2e16, expTiles: 0x00C58000, expMap: 0x00C5C000 },
    { name: 'Subtitle', file: 'subtitle_pixels.bin', tilesId: 0x2e29, mapId: 0x2e2a, expTiles: 0x00C5E000, expMap: 0x00C62000 }
  ];

  for (const c of cases) {
    const pixelPath = path.join(path.resolve(__dirname, '../assets/bin'), c.file);
    if (!fs.existsSync(pixelPath)) {
      console.warn(`Missing ${pixelPath}, skipping ${c.name}`);
      continue;
    }
    const canvas = fs.readFileSync(pixelPath);
    const enc = encodeScreen(canvas);
    console.log(`${c.name}: ${enc.uniqueTilesCount} unique tiles, compTiles: ${enc.compTiles.length}b, compMap: ${enc.compMap.length}b`);

    // Write to expanded space to avoid any size constraint
    enc.compTiles.copy(rom, c.expTiles);
    enc.compMap.copy(rom, c.expMap);

    // Update Table 0 pointers
    const pTiles = 0xa7108 + c.tilesId * 8;
    const pMap = 0xa7108 + c.mapId * 8;

    rom.writeUInt32LE(enc.compTiles.length, pTiles);
    rom.writeUInt32LE(0x08000000 + c.expTiles, pTiles + 4);

    rom.writeUInt32LE(enc.compMap.length, pMap);
    rom.writeUInt32LE(0x08000000 + c.expMap, pMap + 4);

    console.log(`  Patched ${c.name} in Table 0: Tiles @ 0x${(0x08000000 + c.expTiles).toString(16)}, Map @ 0x${(0x08000000 + c.expMap).toString(16)}`);
  }

  // Patch 0x2085 (Mystery Menu Choices: HUMAN, ANGEL, DEVIL)
  const choicesTilesPath = path.join(path.resolve(__dirname, '../assets/bin'), 'mystery_choices_tiles.bin');
  if (fs.existsSync(choicesTilesPath)) {
    console.log('Patching 0x2085 (Mystery Choices: Human, Angel, Devil)...');
    const rawTiles = fs.readFileSync(choicesTilesPath);
    const compTiles = compressLZ77(rawTiles);
    const expChoices = 0x00C64000;
    compTiles.copy(rom, expChoices);

    const pChoices = 0xa7108 + 0x2085 * 8;
    rom.writeUInt32LE(compTiles.length, pChoices);
    rom.writeUInt32LE(0x08000000 + expChoices, pChoices + 4);
    console.log(`  Patched Asset 0x2085 in Table 0: ${compTiles.length}b @ 0x${(0x08000000 + expChoices).toString(16)}`);
  }

  console.log('Batch 1 graphics successfully patched into ROM!');
}

// Standalone execution
if (process.argv[1].endsWith('patch-case-intro-titles.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchCaseIntroTitles(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
