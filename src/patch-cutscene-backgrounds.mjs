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
          bestLen = len; bestDist = inPos - p;
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

// Read raw 512-byte GBA palette bank from ROM
function readPalBank(rom, offset) {
  return rom.slice(offset, offset + 512);
}

// Read BMP file and return 32bpp RGBA pixel array (W x H)
function readBmpPixels(filePath) {
  const data = fs.readFileSync(filePath);
  const bfOffBits = data.readUInt32LE(10);
  const width = data.readInt32LE(18);
  const height = data.readInt32LE(22);
  const bpp = data.readUInt16LE(28);
  const pixels = new Uint8Array(width * Math.abs(height) * 4);
  const absHeight = Math.abs(height);
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;

  for (let y = 0; y < absHeight; y++) {
    const srcY = height > 0 ? (absHeight - 1 - y) : y;
    const rowOff = bfOffBits + srcY * rowSize;
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      if (bpp === 32) {
        pixels[dst]     = data[rowOff + x * 4 + 2]; // R
        pixels[dst + 1] = data[rowOff + x * 4 + 1]; // G
        pixels[dst + 2] = data[rowOff + x * 4];     // B
        pixels[dst + 3] = 255;
      } else if (bpp === 24) {
        pixels[dst]     = data[rowOff + x * 3 + 2]; // R
        pixels[dst + 1] = data[rowOff + x * 3 + 1]; // G
        pixels[dst + 2] = data[rowOff + x * 3];     // B
        pixels[dst + 3] = 255;
      }
    }
  }
  return { pixels, width, height: absHeight };
}

// Convert GBA BGR15 to RGB888
function bgr15ToRgb(c) {
  return { r: (c & 0x1f) * 8, g: ((c >> 5) & 0x1f) * 8, b: ((c >> 10) & 0x1f) * 8 };
}

// Find nearest color in palette bank (all sub-palettes)
function findBestPaletteColor(r, g, b, palBank, allowedPals) {
  let bestPal = 0, bestIdx = 0, bestDist = Infinity;
  for (const pal of allowedPals) {
    const palOff = pal * 32; // 16 colors * 2 bytes each
    for (let ci = 1; ci < 16; ci++) { // skip ci=0 (transparent)
      const gbacol = palBank.readUInt16LE(palOff + ci * 2);
      const { r: pr, g: pg, b: pb } = bgr15ToRgb(gbacol);
      const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (dist < bestDist) {
        bestDist = dist; bestPal = pal; bestIdx = ci;
      }
    }
  }
  return { bestPal, bestIdx };
}

// Encode 240x160 RGBA pixel array using multi-palette tilemap for GBA BG
function encodeScreenMultiPal(pixels, palBank, allowedPals) {
  const uniqueTiles = [];
  const tileHashes = new Map();
  const blankTile = Buffer.alloc(32);
  uniqueTiles.push(blankTile);
  tileHashes.set(blankTile.toString('hex'), 0);

  const tilemap = Buffer.alloc(2048);
  const width = 240, height = 160;

  for (let ty = 0; ty < 20; ty++) {
    for (let tx = 0; tx < 30; tx++) {
      // Build quantized tile using best palette for this tile
      // First determine dominant palette for this tile
      const palVotes = new Array(16).fill(0);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const pidx = ((ty * 8 + y) * width + (tx * 8 + x)) * 4;
          const r = pixels[pidx], g = pixels[pidx + 1], b = pixels[pidx + 2];
          const { bestPal } = findBestPaletteColor(r, g, b, palBank, allowedPals);
          palVotes[bestPal]++;
        }
      }
      let bestPal = allowedPals[0];
      let maxVotes = 0;
      for (const pal of allowedPals) {
        if (palVotes[pal] > maxVotes) { maxVotes = palVotes[pal]; bestPal = pal; }
      }

      const tileBuf = Buffer.alloc(32);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x += 2) {
          const pidx1 = ((ty * 8 + y) * width + (tx * 8 + x)) * 4;
          const pidx2 = ((ty * 8 + y) * width + (tx * 8 + x + 1)) * 4;
          const { bestIdx: ci1 } = findBestPaletteColor(pixels[pidx1], pixels[pidx1+1], pixels[pidx1+2], palBank, [bestPal]);
          const { bestIdx: ci2 } = findBestPaletteColor(pixels[pidx2], pixels[pidx2+1], pixels[pidx2+2], palBank, [bestPal]);
          tileBuf[y * 4 + x / 2] = (ci2 << 4) | ci1;
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
  const compTiles = compressLZ77(rawTiles);
  const compMap = compressLZ77(tilemap);
  return { uniqueTilesCount: uniqueTiles.length, rawTiles, compTiles, tilemap, compMap };
}

export function patchCutsceneBackgrounds(rom) {
  console.log('--- Patching 17 Cutscene Background Screens ---');

  const TABLE_BASE = 0xa7108;
  const WORK_DIR = path.resolve(__dirname, '../assets/cutscenes');
  const ASSETS_DIR = path.resolve(__dirname, '../assets/screens');

  // Expanded ROM space starts at 0x00CE6000 (after minigame tutorials which end at 0x00CE4000)
  // Each screen gets 0x6000 bytes for tiles + 0x2000 bytes for map = 0x8000 per screen
  // But we'll be more conservative: tiles 0x5000 + map 0x2000 = 0x7000 per screen, aligned to 0x4000
  const screens = [
    { name: '0x240a', mapId: 0x240a, tilesId: 0x2409, palBankOffset: 0x61a5b0, expTiles: 0x00CE6000, expMap: 0x00CEA000, allowedPals: [0] },
    { name: '0x2b2e', mapId: 0x2b2e, tilesId: 0x2b2d, palBankOffset: 0x72809c, expTiles: 0x00CEE000, expMap: 0x00CF2000, allowedPals: [0] },
  ];

  // Check we have enough ROM space (16MB = 0x01000000)
  const lastEnd = 0x00D4A000 + 0x2000;
  if (lastEnd > 0x01000000) {
    console.error(`ERROR: Would exceed 16MB ROM! Last address: 0x${lastEnd.toString(16)}`);
    return;
  }

  let count = 0;
  for (const s of screens) {
    const bmpPath = path.join(WORK_DIR, `cutscene_${s.name}.bmp`);
    if (!fs.existsSync(bmpPath)) {
      console.warn(`Missing ${bmpPath}, skipping ${s.name}`);
      continue;
    }

    const { pixels } = readBmpPixels(bmpPath);
    const palBank = readPalBank(rom, s.palBankOffset);
    const enc = encodeScreenMultiPal(pixels, palBank, s.allowedPals);

    // Verify compressed data fits in allocated space
    if (enc.compTiles.length > 0x4000) {
      console.warn(`  ${s.name}: tiles compressed to ${enc.compTiles.length}b > 16KB! May overflow.`);
    }
    if (enc.compMap.length > 0x2000) {
      console.warn(`  ${s.name}: map compressed to ${enc.compMap.length}b > 8KB! May overflow.`);
    }

    // Write to expanded ROM area
    enc.compTiles.copy(rom, s.expTiles);
    enc.compMap.copy(rom, s.expMap);

    // Update Table 0 pointers
    const pTiles = TABLE_BASE + s.tilesId * 8;
    const pMap   = TABLE_BASE + s.mapId   * 8;

    rom.writeUInt32LE(enc.compTiles.length, pTiles);
    rom.writeUInt32LE(0x08000000 + s.expTiles, pTiles + 4);

    rom.writeUInt32LE(enc.compMap.length, pMap);
    rom.writeUInt32LE(0x08000000 + s.expMap, pMap + 4);

    console.log(`${s.name}: ${enc.uniqueTilesCount} tiles, compTiles: ${enc.compTiles.length}b, compMap: ${enc.compMap.length}b`);
    console.log(`  Tiles @ 0x${(0x08000000 + s.expTiles).toString(16)}, Map @ 0x${(0x08000000 + s.expMap).toString(16)}`);

    // Copy preview PNG to gallery
    const pngSrc = path.join(WORK_DIR, `cutscene_${s.name}.png`);
    const pngDest = path.join(ASSETS_DIR, `tilemap_screen_${s.name}.png`);
    if (fs.existsSync(pngSrc)) {
      fs.copyFileSync(pngSrc, pngDest);
    }

    count++;
  }

  console.log(`All ${count} cutscene background screens patched into ROM!`);
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('patch-cutscene-backgrounds.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchCutsceneBackgrounds(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
