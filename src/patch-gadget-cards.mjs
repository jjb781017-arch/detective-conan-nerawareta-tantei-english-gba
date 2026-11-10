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

      // Start at inPos - 2: distance must be >= 2 (no distance-1 tokens)
      for (let p = inPos - 2; p >= minPos; p--) {
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
      // Tilemap entry: tileIdx (bits 0..9), no flip, pal 13 (bits 12..15 = 0xd)
      tilemap.writeUInt16LE(tileIdx | (13 << 12), (ty * 32 + tx) * 2);
    }
  }

  const rawTiles = Buffer.concat(uniqueTiles);
  const compTiles = compressLZ77(rawTiles);
  const compMap = compressLZ77(tilemap);
  return { uniqueTilesCount: uniqueTiles.length, rawTiles, compTiles, tilemap, compMap };
}

export function patchGadgetCards(rom) {
  console.log('--- Patching 8 Gadget Instruction Cards ---');

  const cards = [
    { id: '0xc59', tilesId: 3160, mapId: 3161, expTiles: 0x00C80000, expMap: 0x00C84000 },
    { id: '0xc5c', tilesId: 3163, mapId: 3164, expTiles: 0x00C86000, expMap: 0x00C8A000 },
    { id: '0xc5f', tilesId: 3166, mapId: 3167, expTiles: 0x00C8C000, expMap: 0x00C90000 },
    { id: '0xc62', tilesId: 3169, mapId: 3170, expTiles: 0x00C92000, expMap: 0x00C96000 },
    { id: '0xc65', tilesId: 3172, mapId: 3173, expTiles: 0x00C98000, expMap: 0x00C9C000 },
    { id: '0xc68', tilesId: 3175, mapId: 3176, expTiles: 0x00C9E000, expMap: 0x00CA2000 },
    { id: '0xc6b', tilesId: 3178, mapId: 3179, expTiles: 0x00CA4000, expMap: 0x00CA8000 },
    { id: '0xc6e', tilesId: 3181, mapId: 3182, expTiles: 0x00CAA000, expMap: 0x00CAE000 }
  ];

  for (const c of cards) {
    const pixelPath = path.resolve(__dirname, '../assets/bin', `gadget_${c.id}_pixels.bin`);
    if (!fs.existsSync(pixelPath)) {
      console.warn(`Missing ${pixelPath}, skipping ${c.id}`);
      continue;
    }

    const canvas = fs.readFileSync(pixelPath);
    const enc = encodeScreen(canvas);
    console.log(`Gadget ${c.id}: ${enc.uniqueTilesCount} unique tiles, compTiles: ${enc.compTiles.length}b, compMap: ${enc.compMap.length}b`);

    // Write to expanded ROM space
    enc.compTiles.copy(rom, c.expTiles);
    enc.compMap.copy(rom, c.expMap);

    // Update Table 0 pointers
    const pTiles = 0xa7108 + c.tilesId * 8;
    const pMap = 0xa7108 + c.mapId * 8;

    rom.writeUInt32LE(enc.compTiles.length, pTiles);
    rom.writeUInt32LE(0x08000000 + c.expTiles, pTiles + 4);

    rom.writeUInt32LE(enc.compMap.length, pMap);
    rom.writeUInt32LE(0x08000000 + c.expMap, pMap + 4);

    console.log(`  Patched Gadget ${c.id} in Table 0: Tiles @ 0x${(0x08000000 + c.expTiles).toString(16)}, Map @ 0x${(0x08000000 + c.expMap).toString(16)}`);
  }

  console.log('All 8 Gadget Instruction Cards successfully patched into ROM!');
}

// Standalone execution
if (process.argv[1].endsWith('patch-gadget-cards.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchGadgetCards(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
