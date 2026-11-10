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

export function patchTitleScreenLogos(rom) {
  console.log('--- Patching Title Screen English Logos ---');

  // 1. Load Palettes
  const palTop = fs.readFileSync(path.resolve(__dirname, '../assets/bin/palette_top.bin'));
  const palSub = fs.readFileSync(path.resolve(__dirname, '../assets/bin/palette_sub.bin'));

  // Write palettes to original locations:
  // Asset 0x2219 (0x5d966c) and Asset 0x3362 (0x7e6110)
  palTop.copy(rom, 0x5d966c);
  palTop.copy(rom, 0x7e6110);

  // Asset 0x221a (0x5d968c) and Asset 0x3363 (0x7e6130)
  palSub.copy(rom, 0x5d968c);
  palSub.copy(rom, 0x7e6130);
  console.log('Injected custom GBA RGB555 palettes for both logos.');

  // 2. Encode Top Logo ("DETECTIVE CONAN")
  const topFlat = fs.readFileSync(path.resolve(__dirname, '../assets/bin/top_logo_pixels.bin'));
  const topTiles = Buffer.alloc(6144);
  for (let s = 0; s < 3; s++) {
    const sStartX = s * 64;
    const sTileOffset = s * 64;
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const tileIdx = sTileOffset + ty * 8 + tx;
        const tileBuf = topTiles.subarray(tileIdx * 32, (tileIdx + 1) * 32);
        for (let y = 0; y < 8; y++) {
          const cy = ty * 8 + y;
          for (let x = 0; x < 8; x += 2) {
            const cx1 = sStartX + tx * 8 + x;
            const cx2 = sStartX + tx * 8 + x + 1;
            const p1 = topFlat[cy * 192 + cx1] & 0x0f;
            const p2 = topFlat[cy * 192 + cx2] & 0x0f;
            tileBuf[y * 4 + x / 2] = (p2 << 4) | p1;
          }
        }
      }
    }
  }
  const topComp = compressLZ77(topTiles);
  console.log(`Top Logo: 6144 raw bytes -> ${topComp.length} LZ77 bytes.`);

  // Write Top Logo into ROM:
  // Copy to 0x5d96ac and 0x7e6150 (fits in 2520 bytes)
  topComp.copy(rom, 0x5d96ac);
  topComp.copy(rom, 0x7e6150);

  // Also write to expanded ROM at 0x00C20000 and update Table 0
  topComp.copy(rom, 0x00C20000);
  rom.writeUInt32LE(topComp.length, 0xb81e0);
  rom.writeUInt32LE(0x08C20000, 0xb81e4);
  rom.writeUInt32LE(topComp.length, 0xc0c28);
  rom.writeUInt32LE(0x08C20000, 0xc0c2c);

  // 3. Encode Subtitle Logo ("~ The Targeted Detective ~")
  const subFlat = fs.readFileSync(path.resolve(__dirname, '../assets/bin/sub_logo_pixels.bin'));
  const subTiles = Buffer.alloc(2880);

  function encodeRect(startX, startY, tilesX, tilesY, tileDestOffset) {
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tileIdx = tileDestOffset + ty * tilesX + tx;
        const tileBuf = subTiles.subarray(tileIdx * 32, (tileIdx + 1) * 32);
        for (let y = 0; y < 8; y++) {
          const cy = startY + ty * 8 + y;
          for (let x = 0; x < 8; x += 2) {
            const cx1 = startX + tx * 8 + x;
            const cx2 = startX + tx * 8 + x + 1;
            const p1 = subFlat[cy * 168 + cx1] & 0x0f;
            const p2 = subFlat[cy * 168 + cx2] & 0x0f;
            tileBuf[y * 4 + x / 2] = (p2 << 4) | p1;
          }
        }
      }
    }
  }

  // Map to the 5 GBA sprites:
  encodeRect(0, 16, 8, 4, 0);       // Sprite 0: 64x32 at (0, 16) -> 32 tiles
  encodeRect(64, 16, 8, 4, 32);     // Sprite 1: 64x32 at (64, 16) -> 32 tiles
  encodeRect(128, 16, 4, 4, 64);    // Sprite 2: 32x32 at (128, 16) -> 16 tiles
  encodeRect(0, 0, 4, 2, 80);       // Sprite 3: 32x16 at (0, 0) -> 8 tiles
  encodeRect(160, 24, 1, 2, 88);    // Sprite 4: 8x16 at (160, 24) -> 2 tiles

  const subComp = compressLZ77(subTiles);
  console.log(`Subtitle Logo: 2880 raw bytes -> ${subComp.length} LZ77 bytes.`);

  // Write Subtitle Logo into ROM:
  // Copy to 0x5da0c0 and 0x7e6b64 (fits in 2248 bytes)
  subComp.copy(rom, 0x5da0c0);
  subComp.copy(rom, 0x7e6b64);

  // Also write to expanded ROM at 0x00C24000 and update Table 0
  subComp.copy(rom, 0x00C24000);
  rom.writeUInt32LE(subComp.length, 0xb81f0);
  rom.writeUInt32LE(0x08C24000, 0xb81f4);
  rom.writeUInt32LE(subComp.length, 0xc0c38);
  rom.writeUInt32LE(0x08C24000, 0xc0c3c);

  console.log('Successfully injected both English Title Screen logos into ROM!');
}

// Standalone execution
if (process.argv[1].endsWith('patch-title-screen-logos.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchTitleScreenLogos(rom);
      fs.writeFileSync(romPath, rom);
      console.log('Patched ' + romPath);
    }
  }
}
