import fs from 'fs';
import path from 'path';
import { buildOne } from './en-build-one.mjs';
import { loadAsset, writeBackParts } from './asset-canvas.mjs';

// Standard GBA BIOS Type 0x10 LZ77 Compressor
export function compressLZ77(data) {
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

// Standard GBA BIOS Type 0x10 LZ77 Decompressor
export function decompressLZ77(buf, offset) {
  if (offset < 0 || offset >= buf.length || buf[offset] !== 0x10) return null;
  const size = buf[offset + 1] | (buf[offset + 2] << 8) | (buf[offset + 3] << 16);
  if (size === 0 || size > 512 * 1024) return null;
  const out = Buffer.alloc(size);
  let input = offset + 4, write = 0;
  while (write < size && input < buf.length) {
    const flags = buf[input++];
    for (let bit = 7; bit >= 0 && write < size; bit--) {
      if (!(flags & (1 << bit))) {
        if (input >= buf.length) return null;
        out[write++] = buf[input++];
      } else {
        if (input + 1 >= buf.length) return null;
        const a = buf[input++], b = buf[input++];
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

// 7x7 Bold Pixel Font for UI text
const boldFont7x7 = {
  'A': ['.####.','#....#','#....#','######','#....#','#....#','#....#'],
  'B': ['#####.','#....#','#....#','#####.','#....#','#....#','#####.'],
  'C': ['.####.','#....#','#.....','#.....','#.....','#....#','.####.'],
  'D': ['#####.','#....#','#....#','#....#','#....#','#....#','#####.'],
  'E': ['######','#.....','#.....','#####.','#.....','#.....','######'],
  'F': ['######','#.....','#.....','#####.','#.....','#.....','#.....'],
  'G': ['.####.','#....#','#.....','#.####','#....#','#....#','.####.'],
  'H': ['#....#','#....#','#....#','######','#....#','#....#','#....#'],
  'I': ['###','.##','.##','.##','.##','.##','###'],
  'J': ['..###','...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  'K': ['#...#','#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....','#....','#....','#....','#....','#....','#####'],
  'M': ['#...#','##.##','#.#.#','#...#','#...#','#...#','#...#'],
  'N': ['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],
  'O': ['.####.','#....#','#....#','#....#','#....#','#....#','.####.'],
  'P': ['#####.','#....#','#....#','#####.','#.....','#.....','#.....'],
  'Q': ['.####.','#....#','#....#','#....#','#..#.#','#...##','.####.'],
  'R': ['#####.','#....#','#....#','#####.','#..#..','#...#.','#....#'],
  'S': ['.####.','#....#','#.....','.####.','.....#','#....#','.####.'],
  'T': ['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
  'U': ['#....#','#....#','#....#','#....#','#....#','#....#','.####.'],
  'V': ['#...#','#...#','#...#','#...#','.##.#','.##.#','..#..'],
  'W': ['#...#','#...#','#...#','#...#','#.#.#','##.##','#...#'],
  'X': ['#...#','#...#','.##.#','..#..','.##.#','#...#','#...#'],
  'Y': ['#...#','#...#','.##.#','..#..','..#..','..#..','..#..'],
  'Z': ['######','....#.', '...#..', '..#...', '.#....', '#.....', '######'],
  '0': ['.####.','#...##','#..#.#','#.#..#','##...#','#....#','.####.'],
  '1': ['..##.','.###.','..##.','..##.','..##.','..##.','######'],
  '2': ['.####.','#....#','....#.', '...#..', '..#...', '.#....', '######'],
  '3': ['#####.','....#.', '...#..', '..###.', '....#.', '#...#.', '.####.'],
  '4': ['#...#.', '#...#.', '#...#.', '######', '....#.', '....#.', '....#.'],
  '5': ['######','#.....','#####.','....#.', '....#.', '#...#.', '.####.'],
  '6': ['.####.','#.....','#####.','#....#','#....#','#....#','.####.'],
  '7': ['######','....#.', '...#..', '..#...', '..#...', '..#...', '..#...'],
  '8': ['.####.','#....#','#....#','.####.','#....#','#....#','.####.'],
  '9': ['.####.','#....#','#....#','.#####','....#.', '....#.', '.####.'],
  ' ': ['..','..','..','..','..','..','..'],
  '!': ['#','#','#','#','#','.','#'],
  '?': ['.###.','#...#','....#','..##.','..#..','.....','..#..'],
  '-': ['.....','.....','.....','#####','.....','.....','.....'],
  '\'':['##','##','.#' ,'..','..','..','..'],
  '/': ['....#','...#.', '..#..', '.#...', '#....', '.....', '.....'],
};

function measureTextWidth(text) {
  let w = 0;
  for (const ch of text) {
    const g = boldFont7x7[ch] || boldFont7x7[' '];
    w += g[0].length + 1;
  }
  return w > 0 ? w - 1 : 0;
}

function drawOutlinedText(grid, text, startX, startY, outlineColor, fillColor) {
  let curX = startX;
  const h = grid.length;
  const w = grid[0].length;

  for (const ch of text) {
    const g = boldFont7x7[ch] || boldFont7x7[' '];
    const gw = g[0].length;
    const gh = g.length;

    // Pass 1: Outline
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (g[gy][gx] === '#') {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = startY + gy + dy;
              const nx = curX + gx + dx;
              if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                if (grid[ny][nx] !== fillColor) grid[ny][nx] = outlineColor;
              }
            }
          }
        }
      }
    }

    // Pass 2: Fill
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (g[gy][gx] === '#') {
          const ny = startY + gy;
          const nx = curX + gx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            grid[ny][nx] = fillColor;
          }
        }
      }
    }

    curX += gw + 1;
  }
}

// =========================================================================
// 1. PATCH 8 MINIGAME BANNERS (0x21ad..0x21bb)
// 144x32 composite = Sprite 0 (64x32) + Sprite 1 (64x32) + Sprite 2 (16x32) = 72 tiles
// =========================================================================
export function patchMinigameBanners(rom, cleanRom) {
  console.log('--- Patching 8 Minigame Banners (0x21ad..0x21bb) ---');

  function gridTo144x32Tiles(grid) {
    const buf = Buffer.alloc(2304); // 72 tiles * 32 bytes
    for (let y = 0; y < 32; y++) {
      const ty = Math.floor(y / 8), py = y % 8;
      for (let x = 0; x < 144; x += 2) {
        let tileIdx = 0, px = 0;
        if (x < 64) {
          tileIdx = ty * 8 + Math.floor(x / 8);
          px = x % 8;
        } else if (x < 128) {
          tileIdx = 32 + ty * 8 + Math.floor((x - 64) / 8);
          px = (x - 64) % 8;
        } else {
          tileIdx = 64 + ty * 2 + Math.floor((x - 128) / 8);
          px = (x - 128) % 8;
        }
        const p1 = grid[y][x] & 0xf;
        const p2 = grid[y][x + 1] & 0xf;
        buf[tileIdx * 32 + py * 4 + px / 2] = (p2 << 4) | p1;
      }
    }
    return buf;
  }

  const minigames = [
    { id: 0x21ad, text: '4x4 SECURITY',        expDest: 0x00D00000 },
    { id: 0x21af, text: 'STUN-GUN WRISTWATCH', expDest: 0x00D01000 },
    { id: 0x21b1, text: 'STATUE OF TRUTH',     expDest: 0x00D02000 },
    { id: 0x21b3, text: "RAN'S KARATE TRAINING", expDest: 0x00D03000 },
    { id: 0x21b5, text: 'POWER KICK SHOES',    expDest: 0x00D04000 },
    { id: 0x21b7, text: 'PLAY WITH ETEKO',     expDest: 0x00D05000 },
    { id: 0x21b9, text: 'BOMB DEFUSER',        expDest: 0x00D06000 },
    { id: 0x21bb, text: 'TURBO SKATEBOARD',    expDest: 0x00D07000 },
  ];

  for (const mg of minigames) {
    const p = 0xa7108 + mg.id * 8;
    const grid = Array.from({ length: 32 }, () => Array(144).fill(0));

    // Reconstruct pure, pristine gold banner background with zero Japanese remnants:
    // y=0..11: transparent (0)
    // y=12..15: gold highlight (0xd)
    // y=16: mid tone (0xe)
    // y=17: highlight (0xd)
    // y=18..19: dark shadow (0xe)
    // y=20..21: drop shadow (0x2)
    // y=22..31: transparent (0)
    for (let x = 0; x < 142; x++) {
      grid[12][x] = 0xd;
      grid[13][x] = 0xd;
      grid[14][x] = 0xd;
      grid[15][x] = 0xd;
      grid[16][x] = 0xe;
      grid[17][x] = 0xd;
      grid[18][x] = 0xe;
      grid[19][x] = 0xe;
    }
    // Drop shadow at bottom and right edge
    for (let x = 2; x < 144; x++) {
      grid[20][x] = 0x2;
      grid[21][x] = 0x2;
    }
    for (let y = 14; y <= 19; y++) {
      grid[y][142] = 0x2;
      grid[y][143] = 0x2;
    }

    // Center English text:
    // Outline: color 1 (dark brown), Fill: color 0xf (pure bright white)
    // Text placed at y=9 so it is centered on the banner bar
    const tw = measureTextWidth(mg.text);
    const tx = Math.floor((142 - tw) / 2);
    drawOutlinedText(grid, mg.text, Math.max(2, tx), 9, 1, 0xf);

    const rawTiles = gridTo144x32Tiles(grid);
    const compTiles = compressLZ77(rawTiles);

    compTiles.copy(rom, mg.expDest);
    rom.writeUInt32LE(compTiles.length, p);
    rom.writeUInt32LE(0x08000000 + mg.expDest, p + 4);
    console.log(`  Patched Minigame Banner 0x${mg.id.toString(16)}: "${mg.text}" (${compTiles.length}b @ 0x${(0x08000000 + mg.expDest).toString(16)})`);
  }
}

// =========================================================================
// 2. PATCH 6 BRICK WALL SUBMENU BUTTONS (0x21bd..0x21c7)
// 112x32 composite = Sprite 0 (64x32) + Sprite 1 (32x32) + Sprite 2 (16x32) = 56 tiles
// =========================================================================
export function patchBrickSubmenuButtons(rom, cleanRom) {
  console.log('--- Patching 6 Brick Wall Submenu Buttons (0x21bd..0x21c7) ---');

  function gridTo112x32Tiles(grid) {
    const buf = Buffer.alloc(1792); // 56 tiles * 32 bytes
    for (let y = 0; y < 32; y++) {
      const ty = Math.floor(y / 8), py = y % 8;
      for (let x = 0; x < 112; x += 2) {
        let tileIdx = 0, px = 0;
        if (x < 64) {
          tileIdx = ty * 8 + Math.floor(x / 8);
          px = x % 8;
        } else if (x < 96) {
          tileIdx = 32 + ty * 4 + Math.floor((x - 64) / 8);
          px = (x - 64) % 8;
        } else {
          tileIdx = 48 + ty * 2 + Math.floor((x - 96) / 8);
          px = (x - 96) % 8;
        }
        const p1 = grid[y][x] & 0xf;
        const p2 = grid[y][x + 1] & 0xf;
        buf[tileIdx * 32 + py * 4 + px / 2] = (p2 << 4) | p1;
      }
    }
    return buf;
  }

  const buttons = [
    { id: 0x21bd, text: 'SCENARIO',    expDest: 0x00D08000 },
    { id: 0x21bf, text: 'MINIGAME',    expDest: 0x00D09000 },
    { id: 0x21c1, text: 'RIDDLE CARD', expDest: 0x00D0A000 },
    { id: 0x21c3, text: 'FILE',        expDest: 0x00D0B000 },
    { id: 0x21c5, text: 'ALBUM',       expDest: 0x00D0C000 },
    { id: 0x21c7, text: 'GRAPHICS',    expDest: 0x00D0D000 },
  ];

  for (const b of buttons) {
    const p = 0xa7108 + b.id * 8;
    const grid = Array.from({ length: 32 }, () => Array(112).fill(0));

    // Reconstruct clean brick bar:
    // y=0..11: transparent (0)
    // y=12..15: stone top color 0xa
    // y=16..19: stone bottom color 0xb
    // y=20..21: drop shadow color 0x2
    // right shadow at x=110..111: color 0x2
    for (let x = 0; x < 110; x++) {
      grid[12][x] = 0xa;
      grid[13][x] = 0xa;
      grid[14][x] = 0xa;
      grid[15][x] = 0xa;
      grid[16][x] = 0xb;
      grid[17][x] = 0xb;
      grid[18][x] = 0xb;
      grid[19][x] = 0xb;
    }
    for (let x = 2; x < 112; x++) {
      grid[20][x] = 0x2;
      grid[21][x] = 0x2;
    }
    for (let y = 14; y <= 19; y++) {
      grid[y][110] = 0x2;
      grid[y][111] = 0x2;
    }

    // Center English text:
    // Outline: color 1 (dark charcoal border), Fill: color 0xf (pure bright white)
    // Placed at y=9 so it extends across the bar
    const tw = measureTextWidth(b.text);
    const tx = Math.floor((110 - tw) / 2);
    drawOutlinedText(grid, b.text, Math.max(2, tx), 9, 1, 0xf);

    const rawTiles = gridTo112x32Tiles(grid);
    const compTiles = compressLZ77(rawTiles);

    compTiles.copy(rom, b.expDest);
    rom.writeUInt32LE(compTiles.length, p);
    rom.writeUInt32LE(0x08000000 + b.expDest, p + 4);
    console.log(`  Patched Submenu Button 0x${b.id.toString(16)}: "${b.text}" (${compTiles.length}b @ 0x${(0x08000000 + b.expDest).toString(16)})`);
  }
}

// =========================================================================
// 3. PATCH UI BUTTONS (0x223f: TO INPUT SCREEN, 0x30cd: BACK with [L])
// =========================================================================
export function patchUIButtons(rom, cleanRom) {
  console.log('--- Patching UI Buttons (0x223f: TO INPUT SCREEN, 0x30cd: BACK) ---');

  // --- Asset 0x223f: [R] INPUT (96x16 pixels, three 32x16 sprites = 24 tiles) ---
  {
    const id = 0x223f;
    const expDest = 0x00D0E000;
    const p = 0xa7108 + id * 8;

    const r = buildOne('0x223f');
    const asset = loadAsset(id);
    const wb = writeBackParts(asset, r.grid);
    const compTiles = compressLZ77(wb.tiles);

    compTiles.copy(rom, expDest);
    rom.writeUInt32LE(compTiles.length, p);
    rom.writeUInt32LE(0x08000000 + expDest, p + 4);
    console.log(`  Patched 0x223f ([R] INPUT): ${compTiles.length}b @ 0x${(0x08000000 + expDest).toString(16)}`);
  }

  // --- Asset 0x30cd: BACK (Two 32x16 sprites = 16 tiles) ---
  // Sprite 0 (tiles 0..7): [L] shoulder trigger icon - 100% PRESERVED UNTOUCHED (x=0..17)
  // Sprite 1 (tiles 8..15): BACK (translated)
  {
    const id = 0x30cd;
    const expDest = 0x00D0F000;
    const p = 0xa7108 + id * 8;
    const ptr = cleanRom.readUInt32LE(p + 4) - 0x08000000;
    const dec = decompressLZ77(cleanRom, ptr);

    if (dec) {
      // 64x16 grid
      const grid = Array.from({ length: 16 }, () => Array(64).fill(0));

      // 1. Copy Sprite 0 (tiles 0..7) for x=0..17 only (the [L] button icon)
      for (let y = 0; y < 16; y++) {
        const py = y % 8, ty = Math.floor(y / 8);
        for (let x = 0; x < 18; x++) {
          const tileIdx = ty * 4 + Math.floor(x / 8);
          const px = x % 8;
          const byte = dec[tileIdx * 32 + py * 4 + Math.floor(px / 2)];
          grid[y][x] = (px % 2 === 0) ? (byte & 0xf) : (byte >> 4);
        }
      }

      // 2. Clear x=18..63 to 0 (completely remove Japanese 'もどる')
      for (let y = 0; y < 16; y++) {
        for (let x = 18; x < 64; x++) {
          grid[y][x] = 0;
        }
      }

      // 3. Draw "BACK" centered in the remaining x=18..63 space (width = 46px)
      // Outline: color 8 (dark gray), Fill: color 11 (0xb bright white)
      const bw = measureTextWidth('BACK');
      const bx = Math.floor(18 + (46 - bw) / 2);
      drawOutlinedText(grid, 'BACK', bx, 4, 8, 11);

      // 4. Convert back to 16 tiles (Sprite 0: 4x2 tiles, Sprite 1: 4x2 tiles)
      const buf = Buffer.alloc(512);
      for (let s = 0; s < 2; s++) {
        const sOffX = s * 32;
        const sBaseTile = s * 8;
        for (let ty = 0; ty < 2; ty++) {
          for (let tx = 0; tx < 4; tx++) {
            const tileIdx = sBaseTile + ty * 4 + tx;
            for (let py = 0; py < 8; py++) {
              for (let px = 0; px < 8; px += 2) {
                const y = ty * 8 + py, x = sOffX + tx * 8 + px;
                const p1 = grid[y][x] & 0xf;
                const p2 = grid[y][x + 1] & 0xf;
                buf[tileIdx * 32 + py * 4 + px / 2] = (p2 << 4) | p1;
              }
            }
          }
        }
      }

      const compTiles = compressLZ77(buf);
      compTiles.copy(rom, expDest);
      rom.writeUInt32LE(compTiles.length, p);
      rom.writeUInt32LE(0x08000000 + expDest, p + 4);
      console.log(`  Patched 0x30cd (BACK with [L] trigger preserved): ${compTiles.length}b @ 0x${(0x08000000 + expDest).toString(16)}`);
    }
  }
}

// Master patch function
export function patchAllConfirmedUI(rom, cleanRom) {
  console.log('=== Patching All User-Confirmed UI Elements & Buttons ===');
  patchMinigameBanners(rom, cleanRom);
  patchBrickSubmenuButtons(rom, cleanRom);
  patchUIButtons(rom, cleanRom);
  console.log('=== Confirmed UI Assets Successfully Patched ===');
}
