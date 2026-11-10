import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'fs';
import { decompressLZ77 } from './patch-all-confirmed-ui.mjs';
import { decodePNGtoRGB } from './patch-translated-screens.mjs';
import { readPalBank512 } from './asset-palettes.mjs';
import { MINI9 } from './en-fonts.mjs';

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
      // IMPORTANT: the game's LZ77 decoder mishandles distance-1 (disp=0) copies.
      // Original 0x3205/0x3219 streams never use them; our re-compressor must not
      // either, or every run-length token decodes to stale VRAM and corrupts the
      // BG1 overlay (tile 0xa7 cutout included). Start at inPos-2 (distance >= 2).
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
        blockData.push(((bestLen - 3) << 4) | (((bestDist - 1) >> 8) & 0x0f));
        blockData.push((bestDist - 1) & 0xff);
        inPos += bestLen;
      } else {
        blockData.push(data[inPos++]);
      }
    }
    chunks.push(Buffer.from([flagByte]), Buffer.from(blockData));
  }
  return Buffer.concat(chunks);
}

const GLYPHS = {
  // Standard 4x8 letters for HINT, ONLY, and LEFT
  'H': ['#..#', '#..#', '#..#', '####', '#..#', '#..#', '#..#', '#..#'],
  'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  'N': ['#..#', '##.#', '##.#', '#.##', '#.##', '#..#', '#..#', '#..#'],
  'T': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '.#.', '.#.'],
  'O': ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  'L': ['#...', '#...', '#...', '#...', '#...', '#...', '#...', '####'],
  'Y': ['#..#', '#..#', '.##.', '..#.', '..#.', '..#.', '..#.', '..#.'],
  'E': ['####', '#...', '#...', '###.', '#...', '#...', '#...', '####'],
  'F': ['####', '#...', '#...', '###.', '#...', '#...', '#...', '#...'],
};

function drawBoxText(grid, text, startX, startY, outline = 8, fill = 11) {
  const pts = [];
  let curX = startX;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) continue;
    const gw = g[0].length, gh = g.length;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (g[y][x] === '#') pts.push([curX + x, startY + y]);
      }
    }
    curX += gw + 1;
  }
  const inside = new Set(pts.map(([x, y]) => x + ',' + y));
  const ring = new Set();
  const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [x, y] of pts) {
    for (const [dx, dy] of deltas) {
      const nx = x + dx, ny = y + dy;
      if (!inside.has(nx + ',' + ny)) ring.add(nx + ',' + ny);
    }
  }
  for (const k of ring) {
    const [x, y] = k.split(',').map(Number);
    if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) grid[y][x] = outline;
  }
  for (const [x, y] of pts) {
    if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) grid[y][x] = fill;
  }
}

function assertNoDistance1(stream) {
  const outLen = stream[1] | (stream[2] << 8) | (stream[3] << 16);
  let p = 4, o = 0;
  while (o < outLen) {
    const flags = stream[p++];
    for (let bit = 7; bit >= 0 && o < outLen; bit--) {
      if (flags & (1 << bit)) {
        const b0 = stream[p++], b1 = stream[p++];
        const len = (b0 >> 4) + 3;
        const dist = (((b0 & 0xf) << 8) | b1) + 1;
        if (dist === 1) {
          throw new Error(`LZ77 stream contains a distance-1 copy at output offset ${o}; the game decoder corrupts these`);
        }
        o += len;
      } else {
        p++;
        o++;
      }
    }
  }
}

export function patchEtekoMinigameUI(rom, cleanRom) {
  console.log('--- Patching Eteko Minigame UI (0x3205: HINT & ONLY 1 LEFT) ---');
  if (!cleanRom) {
    const p = process.env.CONAN_CLEAN_ROM || 
      (fs.existsSync(path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba'))
        ? path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba')
        : path.resolve(__dirname, '../../Meitantei Conan - Nerawareta Tantei.gba'));
    cleanRom = fs.readFileSync(p);
  }
  const ASSET_TABLE = 0xa7108;

  // 1. Build authentic seamless HINT background grid (16x48, tx=22..27)
  const hintGrid = Array.from({ length: 16 }, () => Array(48).fill(0));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 48; x++) {
      if (x < 2) {
        hintGrid[y][x] = 3; // light blue wave border
      } else if (x < 6) {
        hintGrid[y][x] = (y < 12) ? 1 : 6;
      } else {
        if (y < 2) hintGrid[y][x] = 1;
        else if (y === 2 && x < 24) hintGrid[y][x] = 4;
        else if (y === 2) hintGrid[y][x] = 5;
        else hintGrid[y][x] = 6; // yellow wave body
      }
    }
  }
  // Centered above the pink belt preview (tx=23..27)
  drawBoxText(hintGrid, 'HINT', 14, 4, 8, 11);

  // 2. Build authentic seamless ONLY background grid (16x32, tx=21..24)
  const onlyGrid = Array.from({ length: 16 }, () => Array(32).fill(0));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      if (x < 2) onlyGrid[y][x] = (x === 0) ? 0xf : 0xe;
      else if (x < 8) onlyGrid[y][x] = 0xd;
      else {
        if (y < 2) onlyGrid[y][x] = 1;
        else if (y < 13) onlyGrid[y][x] = 6;
        else if (y === 13) onlyGrid[y][x] = 5;
        else onlyGrid[y][x] = 3;
      }
    }
  }
  // Placed at x=9 so outline ends at x=29, leaving safe gap at x=30..31 before dynamic digit 1
  drawBoxText(onlyGrid, 'ONLY', 9, 4, 8, 11);

  // 3. Build authentic seamless LEFT background grid (16x32, tx=26..29)
  const leftGrid = Array.from({ length: 16 }, () => Array(32).fill(0));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      if (y < 1) leftGrid[y][x] = 1;
      else if (y < 13) leftGrid[y][x] = 6;
      else if (y === 13) leftGrid[y][x] = 5;
      else leftGrid[y][x] = 3;
    }
  }
  // Placed at x=5 so outline begins at x=4 (x=44 absolute), leaving safe gap after dynamic digit 1
  drawBoxText(leftGrid, 'LEFT', 5, 4, 8, 11);

  // --- Patch 0x3205 (Minigame UI tiles) ---
  const tPtr3205 = cleanRom.readUInt32LE(ASSET_TABLE + 0x3205 * 8 + 4) & 0x01ffffff;
  const mPtr3206 = cleanRom.readUInt32LE(ASSET_TABLE + 0x3206 * 8 + 4) & 0x01ffffff;
  const tiles3205 = Buffer.from(decompressLZ77(cleanRom, tPtr3205));
  const map3206 = decompressLZ77(cleanRom, mPtr3206);

  // Copy HINT into tiles3205 across unique tiles only (tx=22..27, ty=4..5)
  // tx=28..29 on ty=5 uses shared background tile 0x56 - NEVER overwrite it!
  for (let ty = 0; ty < 2; ty++) {
    const mapY = 4 + ty;
    for (let tx = 0; tx < 6; tx++) {
      const mapX = 22 + tx;
      const tileIdx = map3206.readUInt16LE((mapY * 32 + mapX) * 2) & 0x3ff;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px += 2) {
          const c1 = hintGrid[ty * 8 + py][tx * 8 + px];
          const c2 = hintGrid[ty * 8 + py][tx * 8 + px + 1];
          tiles3205[tileIdx * 32 + py * 4 + px / 2] = (c2 << 4) | (c1 & 0xf);
        }
      }
    }
  }

  // Copy ONLY into tiles3205 across unique tiles (tx=21..24, ty=11..12)
  for (let ty = 0; ty < 2; ty++) {
    const mapY = 11 + ty;
    for (let tx = 0; tx < 4; tx++) {
      const mapX = 21 + tx;
      const tileIdx = map3206.readUInt16LE((mapY * 32 + mapX) * 2) & 0x3ff;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px += 2) {
          const c1 = onlyGrid[ty * 8 + py][tx * 8 + px];
          const c2 = onlyGrid[ty * 8 + py][tx * 8 + px + 1];
          tiles3205[tileIdx * 32 + py * 4 + px / 2] = (c2 << 4) | (c1 & 0xf);
        }
      }
    }
  }

  // Copy LEFT into tiles3205 across unique tiles (tx=26..29, ty=11..12)
  for (let ty = 0; ty < 2; ty++) {
    const mapY = 11 + ty;
    for (let tx = 0; tx < 4; tx++) {
      const mapX = 26 + tx;
      const tileIdx = map3206.readUInt16LE((mapY * 32 + mapX) * 2) & 0x3ff;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px += 2) {
          const c1 = leftGrid[ty * 8 + py][tx * 8 + px];
          const c2 = leftGrid[ty * 8 + py][tx * 8 + px + 1];
          tiles3205[tileIdx * 32 + py * 4 + px / 2] = (c2 << 4) | (c1 & 0xf);
        }
      }
    }
  }

  // 4. Copy translated Top Banner (tx=8..21, ty=0..1, Palette 4) from official art asset
  const bank = readPalBank512(0x7d65dc);
  const pal4 = bank[4];
  const transSmallPath = path.resolve(__dirname, '../assets/cutscenes/translated_0x3206_small.png');
  if (fs.existsSync(transSmallPath)) {
    const { w, h, rgb } = decodePNGtoRGB(fs.readFileSync(transSmallPath));
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 8; tx <= 21; tx++) {
        const entry = map3206.readUInt16LE((ty * 32 + tx) * 2);
        const tile = entry & 0x3ff;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px += 2) {
            let bestC1 = 13, minDist1 = Infinity, bestC2 = 13, minDist2 = Infinity;
            const idx1 = ((ty * 8 + py) * w + (tx * 8 + px)) * 3;
            const idx2 = ((ty * 8 + py) * w + (tx * 8 + px + 1)) * 3;
            for (let c = 1; c < 16; c++) {
              const col = pal4[c];
              const d1 = (rgb[idx1] - col[0])**2 + (rgb[idx1+1] - col[1])**2 + (rgb[idx1+2] - col[2])**2;
              if (d1 < minDist1) { minDist1 = d1; bestC1 = c; }
              const d2 = (rgb[idx2] - col[0])**2 + (rgb[idx2+1] - col[1])**2 + (rgb[idx2+2] - col[2])**2;
              if (d2 < minDist2) { minDist2 = d2; bestC2 = c; }
            }
            tiles3205[tile * 32 + py * 4 + px / 2] = (bestC2 << 4) | (bestC1 & 0xf);
          }
        }
      }
    }

    // 5. Draw English D-pad directions (N, W, E, S) using the exact MINI9 font
    // from the pressed sprite overlays (0x30c3..0x30c9) so unpressed and pressed match
    function setBgPixel(x, y, color) {
      const tx = Math.floor(x / 8), ty = Math.floor(y / 8);
      const px = x % 8, py = y % 8;
      const entry = map3206.readUInt16LE((ty * 32 + tx) * 2);
      const tile = entry & 0x3ff;
      const flipX = (entry >> 10) & 1;
      const flipY = (entry >> 11) & 1;
      const sx = flipX ? (7 - px) : px;
      const sy = flipY ? (7 - py) : py;
      const byteIdx = tile * 32 + sy * 4 + (sx >> 1);
      const curByte = tiles3205[byteIdx];
      if (sx & 1) {
        tiles3205[byteIdx] = (curByte & 0x0f) | ((color & 0xf) << 4);
      } else {
        tiles3205[byteIdx] = (curByte & 0xf0) | (color & 0xf);
      }
    }

    function fillBox(x0, y0, w, h, col) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          setBgPixel(x, y, col);
        }
      }
    }

    function drawGlyph(glyph, startX, startY, col) {
      for (let y = 0; y < glyph.length; y++) {
        const row = glyph[y];
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '#') setBgPixel(startX + x, startY + y, col);
        }
      }
    }

    // Clear button face interiors to light blue 0xf
    fillBox(26, 22, 20, 12, 0xf); // North (x=26..45, y=22..33)
    fillBox(5, 38, 18, 12, 0xf);  // West (x=5..22, y=38..49)
    fillBox(49, 38, 15, 12, 0xf); // East (x=49..63, y=38..49)
    fillBox(26, 54, 20, 12, 0xf); // South (x=26..45, y=54..65)

    // Draw identical MINI9 letters in dark blue 0xd (exact pixel match with sprite overlay at ox=4, oy=12)
    drawGlyph(MINI9['N'], 31, 23, 0xd);
    drawGlyph(MINI9['W'], 9, 39, 0xd);
    drawGlyph(MINI9['E'], 53, 40, 0xd);
    drawGlyph(MINI9['S'], 31, 55, 0xd);
  }

  // Explicitly ensure center board and portrait transparent window tile 0xa7 is transparent
  tiles3205.fill(0, 0xa7 * 32, 0xa7 * 32 + 32);
  // Ensure bottom border tile 0xa6 is solid clean black
  tiles3205.fill(0x22, 0xa6 * 32, 0xa6 * 32 + 32);

  // Write patched compressed tiles to ROM in-place at clean offset 0x7d67dc (within original 2832-byte slot)
  const ORIG_3205_OFFSET = 0x7d67dc;
  const ORIG_3205_LEN = 2832;
  const comp3205 = compressLZ77(tiles3205);
  assertNoDistance1(comp3205);
  if (comp3205.length > ORIG_3205_LEN) {
    throw new Error(`comp3205 too large for in-place patch: ${comp3205.length} > ${ORIG_3205_LEN}`);
  }
  comp3205.copy(rom, ORIG_3205_OFFSET);
  rom.fill(0, ORIG_3205_OFFSET + comp3205.length, ORIG_3205_OFFSET + ORIG_3205_LEN);
  rom.writeUInt32LE(comp3205.length, ASSET_TABLE + 0x3205 * 8);
  rom.writeUInt32LE(0x08000000 + ORIG_3205_OFFSET, ASSET_TABLE + 0x3205 * 8 + 4);

  // Restore 0x3219 pointer to clean ROM (never patch 0x3219)
  const cleanLen3219 = cleanRom.readUInt32LE(ASSET_TABLE + 0x3219 * 8);
  const cleanPtr3219 = cleanRom.readUInt32LE(ASSET_TABLE + 0x3219 * 8 + 4);
  rom.writeUInt32LE(cleanLen3219, ASSET_TABLE + 0x3219 * 8);
  rom.writeUInt32LE(cleanPtr3219, ASSET_TABLE + 0x3219 * 8 + 4);

  const clean3219 = Buffer.from(decompressLZ77(cleanRom, cleanPtr3219 & 0x1ffffff));

  console.log(`  Patched 0x3205 in-place: ${comp3205.length}b @ 0x${(0x08000000 + ORIG_3205_OFFSET).toString(16)} (slot ${ORIG_3205_LEN}b)`);
  console.log(`  Restored 0x3219: clean ptr 0x${cleanPtr3219.toString(16)}`);

  return { tiles3205, tiles3219: clean3219 };
}

if (process.argv[1] && process.argv[1].endsWith('patch-eteko-minigame-ui.mjs')) {
  const romPath = path.resolve(__dirname, '../build/Detective Conan - English Translated.gba');
  const p = process.env.CONAN_CLEAN_ROM || 
    (fs.existsSync(path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba'))
      ? path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba')
      : path.resolve(__dirname, '../../Meitantei Conan - Nerawareta Tantei.gba'));
  const cleanRom = fs.readFileSync(p);
  const rom = fs.readFileSync(romPath);
  patchEtekoMinigameUI(rom, cleanRom);
  fs.writeFileSync(romPath, rom);
  fs.writeFileSync(path.resolve(__dirname, '../build/Detective Conan - working copy.gba'), rom);
  console.log('Updated', romPath, 'and working copy');
}
