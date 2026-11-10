import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Translate the HUD [L] MAP button graphic (Asset 0x30CB).
//
// Asset 0x30CB is a 64x16 sprite pair (two 32x16 sprites, 8 4bpp tiles each):
//   Part 0: [L] shoulder button icon (preserved from clean ROM)
//   Part 1: MAP button text (replaces Japanese みる / "View")
// It is used as the top-left HUD prompt in the Eteko minigame and map views.
//
// Scratch slot 0x00E00000 is unused by every other patcher (the highest scratch
// address in the build is 0x00D4C000), so it cannot collide.

import fs from 'fs';
import { COND7 } from './en-fonts.mjs';
import { decompress } from './asset-render.mjs';

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

function textWidth(text, tracking = 1) {
  let w = 0;
  for (const ch of text) {
    const g = COND7[ch] || COND7[' '];
    w += g[0].length + tracking;
  }
  return w > 0 ? w - tracking : 0;
}

function drawText(grid, text, startX, startY, outline, fill, tracking = 1) {
  const h = grid.length, w = grid[0].length;
  const pts = [];
  let curX = startX;
  for (const ch of text) {
    const g = COND7[ch] || COND7[' '];
    const gw = g[0].length, gh = g.length;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (g[gy][gx] === '#') pts.push([curX + gx, startY + gy]);
      }
    }
    curX += gw + tracking;
  }
  const inside = new Set(pts.map(([x, y]) => `${x},${y}`));
  const ring = new Set();
  const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [x, y] of pts) {
    for (const [dx, dy] of deltas) {
      const nx = x + dx, ny = y + dy;
      if (!inside.has(`${nx},${ny}`)) ring.add(`${nx},${ny}`);
    }
  }
  for (const k of ring) {
    const [x, y] = k.split(',').map(Number);
    if (y >= 0 && y < h && x >= 0 && x < w) grid[y][x] = outline;
  }
  for (const [x, y] of pts) {
    if (y >= 0 && y < h && x >= 0 && x < w) grid[y][x] = fill;
  }
}

// One 32x16 sprite -> 8 4bpp tiles (4 across, 2 down).
function spriteToTiles(grid) {
  const buf = Buffer.alloc(256);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const tileIdx = ty * 4 + tx;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px += 2) {
          const y = ty * 8 + py, x = tx * 8 + px;
          const p1 = grid[y][x] & 0xf;
          const p2 = grid[y][x + 1] & 0xf;
          buf[tileIdx * 32 + py * 4 + px / 2] = (p2 << 4) | p1;
        }
      }
    }
  }
  return buf;
}

export const CHOICE_LABEL_SCRATCH = 0x00e00000;

export function patchChoiceLabels(rom, cleanRom) {
  console.log('--- Patching HUD [L] MAP button (0x30CB) ---');
  if (!cleanRom) {
    const p = process.env.CONAN_CLEAN_ROM || 
      (fs.existsSync(path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba'))
        ? path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba')
        : path.resolve(__dirname, '../../Meitantei Conan - Nerawareta Tantei.gba'));
    cleanRom = fs.readFileSync(p);
  }
  const ASSET_TABLE = 0xa7108;
  const off = cleanRom.readUInt32LE(ASSET_TABLE + 0x30cb * 8 + 4) & 0x01ffffff;
  const cleanData = decompress(cleanRom, off);

  // Full 64x16 sprite (two 32x16 sprites = Part 0: x=0..31, Part 1: x=32..63)
  const fullGrid = Array.from({ length: 16 }, () => Array(64).fill(0));

  // Part 0 (tiles 0, 1, 4, 5): authentic [L] button icon from clean ROM
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const tileIdx = ty * 4 + tx;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px += 2) {
          const b = cleanData[tileIdx * 32 + py * 4 + px / 2];
          fullGrid[ty * 8 + py][tx * 8 + px] = b & 0xf;
          fullGrid[ty * 8 + py][tx * 8 + px + 1] = b >> 4;
        }
      }
    }
  }

  // Draw 'MAP' starting after [L] with 2px gap (at x=18, y=2):
  drawText(fullGrid, 'MAP', 18, 2, 8, 11, 1);

  // Split into Part 0 (x=0..31) and Part 1 (x=32..63)
  const part0Grid = fullGrid.map(row => row.slice(0, 32));
  const part1Grid = fullGrid.map(row => row.slice(32, 64));
  const part0 = spriteToTiles(part0Grid);
  const part1 = spriteToTiles(part1Grid);

  const raw = Buffer.concat([part0, part1]);
  const comp = compressLZ77(raw);
  if (comp.length > 0x1000) throw new Error(`0x30CB blob too big: ${comp.length}`);

  comp.copy(rom, CHOICE_LABEL_SCRATCH);
  const p = 0xa7108 + 0x30cb * 8;
  rom.writeUInt32LE(comp.length, p);
  rom.writeUInt32LE(0x08000000 + CHOICE_LABEL_SCRATCH, p + 4);
  console.log(`  Patched 0x30CB ([L] MAP): ${comp.length}b @ 0x${(0x08000000 + CHOICE_LABEL_SCRATCH).toString(16)}`);
}

// Standalone execution if run directly
if (process.argv[1] && process.argv[1].endsWith('patch-choice-labels.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchChoiceLabels(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
