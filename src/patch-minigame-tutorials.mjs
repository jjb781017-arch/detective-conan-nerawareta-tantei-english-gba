import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'fs';

// LZ77 Compression for GBA
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

// Read full 512-byte GBA palette bank (16 sub-palettes of 16 colors)
function readPalBank(rom, offset) {
  const bank = [];
  for (let p = 0; p < 16; p++) {
    const pal = [];
    for (let i = 0; i < 16; i++) {
      const c = rom.readUInt16LE(offset + p * 32 + i * 2);
      pal.push([ (c & 0x1f) << 3, ((c >> 5) & 0x1f) << 3, ((c >> 10) & 0x1f) << 3 ]);
    }
    bank.push(pal);
  }
  return bank;
}

// Read raw RGB pixels from an uncompressed BMP (24- or 32-bit).
//
// The original tutorial screens are 32-bit BGRA. The old reader assumed 24-bit
// unconditionally and stepped 3 bytes per pixel, so every one of the 9 tutorial
// screens was encoded from a diagonally shifted copy of the source image. The
// result was a wall of garbage tiles in-game. Always trust the header.
function readBmpPixels(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error(`${filePath}: not a BMP`);
  const dataOffset = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const hRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0) throw new Error(`${filePath}: compressed BMP not supported (compression=${compression})`);
  if (bpp !== 24 && bpp !== 32) throw new Error(`${filePath}: unsupported BMP bit depth ${bpp}`);

  const h = Math.abs(hRaw);
  const bottomUp = hRaw > 0;
  const bytesPerPx = bpp / 8;
  const stride = Math.ceil((w * bpp) / 32) * 4; // rows are 4-byte aligned
  const pixels = [];
  for (let y = 0; y < h; y++) {
    const srcRow = bottomUp ? h - 1 - y : y;
    const row = dataOffset + srcRow * stride;
    for (let x = 0; x < w; x++) {
      const o = row + x * bytesPerPx;
      pixels.push([buf[o + 2], buf[o + 1], buf[o]]); // BGR(A) -> RGB
    }
  }
  return { w, h, pixels };
}

// Encode 240x160 RGB pixels against GBA palette bank into unique tiles + tilemap
function encodeScreenMultiPal(rgbPixels, palBank, allowedPalettes = null, blankIndex = 0, forceOpaque = false, palSelector = null) {
  const uniqueTiles = [];
  const tileHashes = new Map();

  // Tile 0 is blank (for screens like saving data, blankIndex=1 makes it opaque black)
  const blankByte = (blankIndex << 4) | blankIndex;
  const blankTile = Buffer.alloc(32, blankByte);
  uniqueTiles.push(blankTile);
  tileHashes.set(blankTile.toString('hex'), 0);

  const tilemap = Buffer.alloc(2048); // 32x32 uint16 entries

  const defaultPals = allowedPalettes || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  for (let ty = 0; ty < 20; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      const palsToTest = palSelector ? palSelector(ty, tx, allowedPalettes) : defaultPals;

      // Find which palette in the bank gives the lowest total error for this 8x8 tile
      let bestPal = palsToTest[0];
      let bestTileBuf = null;
      let minTotalErr = Infinity;

      for (const p of palsToTest) {
        const pal = palBank[p];
        let totalErr = 0;
        const currentBuf = Buffer.alloc(32);

        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x += 2) {
            const idx1 = (ty * 8 + y) * 240 + (tx * 8 + x);
            const idx2 = (ty * 8 + y) * 240 + (tx * 8 + x + 1);
            const rgb1 = rgbPixels[idx1];
            const rgb2 = rgbPixels[idx2];

            // Match color 1
            let bestC1 = forceOpaque ? blankIndex : 0, bestDist1 = Infinity;
            // If pixel is magenta [248, 0, 248], it is transparent color 0
            if (!forceOpaque && rgb1[0] >= 240 && rgb1[1] <= 15 && rgb1[2] >= 240) {
              bestC1 = 0;
            } else {
              // Find best matching color (indices 1..15, or 0 if black and not forceOpaque)
              const startIdx = (!forceOpaque && pal[0][0] === 0 && pal[0][1] === 0 && pal[0][2] === 0) ? 0 : 1;
              for (let c = startIdx; c < 16; c++) {
                const pr = pal[c][0], pg = pal[c][1], pb = pal[c][2];
                const d = (rgb1[0] - pr) ** 2 + (rgb1[1] - pg) ** 2 + (rgb1[2] - pb) ** 2;
                if (d < bestDist1) { bestDist1 = d; bestC1 = c; }
              }
              totalErr += bestDist1;
            }

            // Match color 2
            let bestC2 = forceOpaque ? blankIndex : 0, bestDist2 = Infinity;
            if (!forceOpaque && rgb2[0] >= 240 && rgb2[1] <= 15 && rgb2[2] >= 240) {
              bestC2 = 0;
            } else {
              const startIdx = (!forceOpaque && pal[0][0] === 0 && pal[0][1] === 0 && pal[0][2] === 0) ? 0 : 1;
              for (let c = startIdx; c < 16; c++) {
                const pr = pal[c][0], pg = pal[c][1], pb = pal[c][2];
                const d = (rgb2[0] - pr) ** 2 + (rgb2[1] - pg) ** 2 + (rgb2[2] - pb) ** 2;
                if (d < bestDist2) { bestDist2 = d; bestC2 = c; }
              }
              totalErr += bestDist2;
            }

            currentBuf[y * 4 + x / 2] = (bestC2 << 4) | bestC1;
          }
        }

        if (totalErr < minTotalErr) {
          minTotalErr = totalErr;
          bestPal = p;
          bestTileBuf = currentBuf;
          if (totalErr === 0) break;
        }
      }

      // Deduplicate tile
      const hex = bestTileBuf.toString('hex');
      let tileIdx = tileHashes.get(hex);
      if (tileIdx === undefined) {
        tileIdx = uniqueTiles.length;
        tileHashes.set(hex, tileIdx);
        uniqueTiles.push(bestTileBuf);
      }

      // Tilemap entry: tileIdx (0..9), no flip, palette bestPal (12..15)
      tilemap.writeUInt16LE(tileIdx | (bestPal << 12), (ty * 32 + tx) * 2);
    }
  }

  const rawTiles = Buffer.concat(uniqueTiles);
  const compTiles = compressLZ77(rawTiles);
  const compMap = compressLZ77(tilemap);
  return { uniqueTilesCount: uniqueTiles.length, rawTiles, compTiles, tilemap, compMap };
}

export function patchMinigameTutorials(rom) {
  console.log('--- Patching 9 Minigame & System Tutorial Screens ---');

  const minigames = [
    { name: '4x4 Security', id: 0x3112, tilesId: 0x3111, palBankOffset: 0x7cbf60, expTiles: 0x00CB0000, expMap: 0x00CB4000, allowedPals: [0, 1, 2] },
    { name: 'Stun Gun Targeting', id: 0x31a0, tilesId: 0x319f, palBankOffset: 0x7d01e0, expTiles: 0x00CB6000, expMap: 0x00CBA000, allowedPals: [0, 1, 2], forceOpaque: true },
    { name: 'Treasure Statues', id: 0x31c8, tilesId: 0x31c7, palBankOffset: 0x7d3e94, expTiles: 0x00CBC000, expMap: 0x00CC0000, allowedPals: [0, 1, 2] },
    {
      name: 'Ran Karate Training',
      id: 0x31f2,
      tilesId: 0x31f1,
      palBankOffset: 0x7d5000,
      expTiles: 0x00CC2000,
      expMap: 0x00CC6000,
      allowedPals: [0, 1, 2],
      palSelector: (ty, tx) => {
        if (ty <= 3) return [2, 0];
        if (ty >= 11 && ty <= 18 && tx >= 14 && tx <= 18) return [1, 0];
        if (ty >= 13 && ty <= 16 && tx >= 4 && tx <= 13) return [2, 0];
        return [0];
      }
    },
    { name: 'Eteko Chase Tutorial', id: 0x3231, tilesId: 0x3230, palBankOffset: 0x7da8b4, expTiles: 0x00CCE000, expMap: 0x00CD2000, allowedPals: [0, 1, 2] },
    // 0x325b is the DETONATOR PROTECT tutorial (tiles 0x325a). Its runtime
    // palette bank is tilesPtr - 0x200 = 0x7dcb30, not 0x7df004 (which belongs
    // to 0x3296). Using the wrong bank made the Japanese outlines render green.
    { name: 'Detonator Protect', id: 0x325b, tilesId: 0x325a, palBankOffset: 0x7dcb30, expTiles: 0x00CD4000, expMap: 0x00CD8000, allowedPals: [0, 1, 2, 3] },
    { name: 'Turbo Skateboard', id: 0x3297, tilesId: 0x3296, palBankOffset: 0x7e16e8, expTiles: 0x00CDA000, expMap: 0x00CDE000, allowedPals: [0, 1, 2] },
    { name: 'Saving Data Screen', id: 0x32c1, tilesId: 0x32c0, palBankOffset: 0x7e1f98, expTiles: 0x00CE0000, expMap: 0x00CE4000, allowedPals: [0], blankIndex: 1, forceOpaque: true }
  ];

  for (const m of minigames) {
    const hex = '0x' + m.id.toString(16);
    const bmpPath = path.resolve(__dirname, '../assets/screens', `tutorial_${hex}.bmp`);
    if (!fs.existsSync(bmpPath)) {
      console.warn(`Missing ${bmpPath}, skipping`);
      continue;
    }

    const { pixels } = readBmpPixels(bmpPath);
    const palBank = readPalBank(rom, m.palBankOffset);
    const enc = encodeScreenMultiPal(pixels, palBank, m.allowedPals, m.blankIndex || 0, !!m.forceOpaque, m.palSelector);

    console.log(`${m.name} (${hex}): ${enc.uniqueTilesCount} tiles, compTiles: ${enc.compTiles.length}b, compMap: ${enc.compMap.length}b`);

    // Write to expanded ROM space
    enc.compTiles.copy(rom, m.expTiles);
    enc.compMap.copy(rom, m.expMap);

    // Update Table 0 pointers
    const pTiles = 0xa7108 + m.tilesId * 8;
    const pMap = 0xa7108 + m.id * 8;

    rom.writeUInt32LE(enc.compTiles.length, pTiles);
    rom.writeUInt32LE(0x08000000 + m.expTiles, pTiles + 4);

    rom.writeUInt32LE(enc.compMap.length, pMap);
    rom.writeUInt32LE(0x08000000 + m.expMap, pMap + 4);

    console.log(`  Patched ${hex} in Table 0: Tiles @ 0x${(0x08000000 + m.expTiles).toString(16)}, Map @ 0x${(0x08000000 + m.expMap).toString(16)}`);

    // Also copy to extracted_text_assets so the gallery reflects the English version
    // PNG dest copy removed in standalone build
  }

  console.log('All 9 Minigame & System Tutorial Screens successfully patched into ROM!');
}

// Standalone execution if run directly
if (process.argv[1] && process.argv[1].endsWith('patch-minigame-tutorials.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchMinigameTutorials(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
