import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'fs';
import { decodePNGtoRGB, downsampleTo240x160 } from './patch-translated-screens.mjs';

function decompressLZ77(rom, offset) {
  if (rom[offset] !== 0x10) return null;
  const size = rom[offset + 1] | (rom[offset + 2] << 8) | (rom[offset + 3] << 16);
  const out = Buffer.alloc(size);
  let input = offset + 4, write = 0;
  while (write < size && input < rom.length) {
    const flags = rom[input++];
    for (let bit = 7; bit >= 0 && write < size; bit--) {
      if (!(flags & (1 << bit))) {
        if (input >= rom.length) return null;
        out[write++] = rom[input++];
      } else {
        if (input + 1 >= rom.length) return null;
        const a = rom[input++], b = rom[input++];
        const len = (a >> 4) + 3, dist = ((a & 15) << 8 | b) + 1;
        if (write < dist) return null;
        for (let n = 0; n < len && write < size; n++) {
          out[write] = out[write - dist];
          write++;
        }
      }
    }
  }
  return write === size ? out : null;
}

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

export function patchBeikaDpcPlaque(rom) {
  console.log('--- Patching Beika DPC Doorway Plaque (Asset 0x1697) ---');

  // Decompress original 0x1697 tiles
  const tiles = decompressLZ77(rom, 0x47824c);
  if (!tiles) {
    console.error('Failed to decompress original 0x1697 tiles!');
    return;
  }

  const plaqueTileIndices = [0x22, 0x29, 0x30, 0x39, 0x42, 0x4d, 0x56];
  const plaque = Buffer.alloc(8 * 56, 0x0c);

  for (let i = 0; i < 7; i++) {
    const t = plaqueTileIndices[i];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x += 2) {
        const b = tiles[t * 32 + y * 4 + x / 2];
        plaque[(i * 8 + y) * 8 + x] = b & 0xf;
        plaque[(i * 8 + y) * 8 + x + 1] = (b >> 4) & 0xf;
      }
    }
  }

  // Clear interior (X=1..6, Y=4..50) with base plaque color 0xc
  for (let y = 4; y <= 50; y++) {
    for (let x = 1; x <= 6; x++) {
      plaque[y * 8 + x] = 0x0c;
    }
  }

  // 4x5 font
  const font = {
    B: ['####', '#..#', '###.', '#..#', '####'],
    E: ['####', '#...', '###.', '#...', '####'],
    I: ['###.', '.#..', '.#..', '.#..', '###.'],
    K: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
    A: ['.##.', '#..#', '####', '#..#', '#..#'],
    D: ['###.', '#..#', '#..#', '#..#', '###.'],
    P: ['####', '#..#', '####', '#...', '#...'],
    C: ['.###', '#...', '#...', '#...', '.###']
  };

  function drawChar(ch, startY, startX = 2) {
    const glyph = font[ch];
    if (!glyph) return;
    for (let r = 0; r < glyph.length; r++) {
      const line = glyph[r];
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '#') {
          plaque[(startY + r) * 8 + (startX + c)] = 0x09; // dark text color
        }
      }
    }
  }

  drawChar('B', 4);
  drawChar('E', 10);
  drawChar('I', 16);
  drawChar('K', 22);
  drawChar('A', 28);
  drawChar('D', 35);
  drawChar('P', 41);
  drawChar('C', 47);

  // Write modified plaque back into tiles
  for (let i = 0; i < 7; i++) {
    const t = plaqueTileIndices[i];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x += 2) {
        const p1 = plaque[(i * 8 + y) * 8 + x] & 0xf;
        const p2 = plaque[(i * 8 + y) * 8 + x + 1] & 0xf;
        tiles[t * 32 + y * 4 + x / 2] = (p2 << 4) | p1;
      }
    }
  }

  const comp = compressLZ77(tiles);
  console.log(`Plaque tiles: 5728 raw bytes -> ${comp.length} LZ77 bytes.`);

  // Write to expanded ROM at 0x00C70000 to be safe and update Table 0
  const expOffset = 0x00C70000;
  comp.copy(rom, expOffset);

  // Update Table 0 for Asset 0x1697 (5783)
  const pEntry = 0xa7108 + 5783 * 8;
  rom.writeUInt32LE(comp.length, pEntry);
  rom.writeUInt32LE(0x08000000 + expOffset, pEntry + 4);

  // If fits in original 3492 bytes, also write in-place
  if (comp.length <= 3492) {
    comp.copy(rom, 0x47824c);
    console.log('Also patched in-place at 0x47824c!');
  }

  console.log('Successfully patched Beika DPC building plaque!');
}

export function patchBeikaDpcPosters(rom, cleanRom) {
  console.log('--- Patching Beika DPC Wall Posters (Asset 0x16af) ---');

  // Decompress original 0x16af tiles (349 tiles = 11168 bytes)
  const baseRom = cleanRom || rom;
  const tiles = decompressLZ77(baseRom, 0x479854);
  if (!tiles) {
    console.error('Failed to decompress original 0x16af tiles!');
    return;
  }

  // Load user translated 0x16b0 image
  const userPath = path.resolve(__dirname, '../assets/cutscenes/0x16b0.png');
  if (!fs.existsSync(userPath)) {
    console.warn(`[SKIP] Missing ${userPath}`);
    return;
  }

  // Palette 12 for 0x16af room
  const pal12 = [
    [0, 0, 0], [49, 41, 49], [165, 33, 16], [255, 0, 0],
    [82, 74, 82], [255, 49, 49], [123, 115, 107], [214, 99, 33],
    [156, 148, 132], [247, 140, 66], [181, 165, 148], [206, 181, 156],
    [222, 206, 181], [239, 230, 214], [255, 255, 255], [16, 16, 16]
  ];

  const decoded = decodePNGtoRGB(fs.readFileSync(userPath));
  const fullRgb = (decoded.w === 240 && decoded.h === 160) ? decoded.rgb : downsampleTo240x160(decoded.w, decoded.h, decoded.rgb);

  function crop(x0, y0, w, h) {
    const out = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = ((y0 + y) * 240 + (x0 + x)) * 3;
        const dst = (y * w + x) * 3;
        out[dst] = fullRgb[src]; out[dst+1] = fullRgb[src+1]; out[dst+2] = fullRgb[src+2];
      }
    }
    return out;
  }

  const leftCrop = crop(88, 8, 32, 48);
  const rightCrop = crop(144, 16, 32, 48);

  const leftTiles = [
    [296, 297, 298, 299],
    [304, 305, 306, 307],
    [312, 313, 314, 315],
    [320, 321, 322, 323],
    [328, 329, 330, 331],
    [336, 337, 338, 339],
  ];

  const rightTiles = [
    [300, 301, 302, 303],
    [308, 309, 310, 311],
    [316, 317, 318, 319],
    [324, 325, 326, 327],
    [332, 333, 334, 335],
    [340, 341, 342, 343],
  ];

  function quantizeGrid(rgbCrop, grid) {
    for (let ty = 0; ty < 6; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const ti = grid[ty][tx];
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x += 2) {
            const at1 = ((ty * 8 + y) * 32 + (tx * 8 + x)) * 3;
            const at2 = ((ty * 8 + y) * 32 + (tx * 8 + x + 1)) * 3;

            let bestC1 = 0, dist1 = Infinity;
            let bestC2 = 0, dist2 = Infinity;

            for (let c = 1; c < 16; c++) {
              const d1 = (rgbCrop[at1] - pal12[c][0]) ** 2 + (rgbCrop[at1 + 1] - pal12[c][1]) ** 2 + (rgbCrop[at1 + 2] - pal12[c][2]) ** 2;
              if (d1 < dist1) { dist1 = d1; bestC1 = c; }
              const d2 = (rgbCrop[at2] - pal12[c][0]) ** 2 + (rgbCrop[at2 + 1] - pal12[c][1]) ** 2 + (rgbCrop[at2 + 2] - pal12[c][2]) ** 2;
              if (d2 < dist2) { dist2 = d2; bestC2 = c; }
            }
            tiles[ti * 32 + y * 4 + x / 2] = (bestC2 << 4) | bestC1;
          }
        }
      }
    }
  }

  quantizeGrid(leftCrop, leftTiles);
  quantizeGrid(rightCrop, rightTiles);

  const comp = compressLZ77(tiles);
  console.log(`Poster tiles: 11168 raw bytes -> ${comp.length} LZ77 bytes.`);

  // Write to expanded ROM at 0x00C72000 and update Table 0
  const expOffset = 0x00C72000;
  comp.copy(rom, expOffset);

  // Update Table 0 for Asset 0x16af (5807)
  const pEntry = 0xa7108 + 5807 * 8;
  rom.writeUInt32LE(comp.length, pEntry);
  rom.writeUInt32LE(0x08000000 + expOffset, pEntry + 4);

  // If fits in original 8752 bytes, also write in-place
  if (comp.length <= 8752) {
    comp.copy(rom, 0x479854);
    console.log('Also patched in-place at 0x479854!');
  }

  console.log('Successfully patched Beika DPC wall posters!');
}

// Standalone execution
if (process.argv[1].endsWith('patch-beika-dpc.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchBeikaDpcPlaque(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
