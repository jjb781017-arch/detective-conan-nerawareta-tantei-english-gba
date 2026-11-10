import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function decompressLZ77(buf, offset) {
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

// Universal 240x160 Screen Encoder (deduplicated tiles + tilemap + compression)
function encodeScreen(canvas240x160) {
  const uniqueTiles = [];
  const tileHashes = new Map();

  const blankTile = Buffer.alloc(32);
  uniqueTiles.push(blankTile);
  tileHashes.set(blankTile.toString('hex'), 0);

  const tilemap = Buffer.alloc(2048);

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
      tilemap.writeUInt16LE(tileIdx, (ty * 32 + tx) * 2);
    }
  }

  const rawTiles = Buffer.concat(uniqueTiles);
  const compTiles = compressLZ77(rawTiles);
  const compMap = compressLZ77(tilemap);
  return { uniqueTilesCount: uniqueTiles.length, rawTiles, compTiles, tilemap, compMap };
}

// 7x7 Bold Pixel Font for Buttons and Headers
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
  'W': ['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],
  'X': ['#...#','#...#','.##.#','..#..','.##.#','#...#','#...#'],
  'Y': ['#...#','#...#','.##.#','..#..','..#..','..#..','..#..'],
  'Z': ['######','....#.', '...#..', '..#...', '.#....', '#.....', '######'],
  ' ': ['..','..','..','..','..','..','..'],
  '!': ['#','#','#','#','#','.','#'],
  '?': ['.###.','#...#','....#','..##.','..#..','.....','..#..']
};

function measureTextWidth(text) {
  let w = 0;
  for (const ch of text) {
    const g = boldFont7x7[ch] || boldFont7x7[' '];
    w += g[0].length + 1;
  }
  return w > 0 ? w - 1 : 0;
}

// Draws outlined text onto a 2D pixel array [y][x]
function drawOutlinedText(grid, text, startX, startY, outlineColor, fillColor) {
  let curX = startX;
  const h = grid.length;
  const w = grid[0].length;

  for (const ch of text) {
    const g = boldFont7x7[ch] || boldFont7x7[' '];
    const gw = g[0].length;
    const gh = g.length;

    // First pass: outline
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

    // Second pass: fill
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

// 1. Register system prompt dual-character pairs so font table burns them cleanly
export function registerSystemPromptPairs(getPairId) {
  if (!getPairId) return;
  const promptStrings = [
    'Please select.',
    'Retry?',
    'Save and quit?',
    'Check descriptions',
    "of Conan's gadgets.",
    'Retry from',
    'checkpoint?',
    'Save and',
    'return to menu?',
    'Continue game?',
    'Save data found.',
    'Continue from save?'
  ];

  for (const str of promptStrings) {
    for (let i = 0; i < str.length; i += 2) {
      const c1 = str[i];
      const c2 = (i + 1 < str.length) ? str[i + 1] : ' ';
      getPairId(c1 + c2);
    }
  }
  // Ensure space pair is registered
  getPairId('  ');
}

// 2. Patch bytecode script prompts with 100% word parity
export function patchSystemPrompts(rom, getPairId) {
  console.log('--- Patching System Bytecode Prompts ---');
  if (!getPairId) {
    console.warn('getPairId not provided, skipping script bytecode prompt patch.');
    return;
  }

  function encodePromptWords(str, targetWords) {
    const words = [];
    for (let i = 0; i < str.length; i += 2) {
      const c1 = str[i];
      const c2 = (i + 1 < str.length) ? str[i + 1] : ' ';
      words.push(getPairId(c1 + c2));
    }
    const spaceId = getPairId('  ');
    while (words.length < targetWords) {
      words.push(spaceId);
    }
    return words;
  }

  // 1) 0x00D404: "Please select." (8 words) + 0xff00 at 0xd414
  const p1 = encodePromptWords('Please select.', 8);
  for (let i = 0; i < 8; i++) rom.writeUInt16LE(p1[i], 0x00D404 + i * 2);

  // 2) 0x00E984: "Retry?" (9 words) + 0xff29 at 0xe996
  const p2 = encodePromptWords('Retry?', 9);
  for (let i = 0; i < 9; i++) rom.writeUInt16LE(p2[i], 0x00E984 + i * 2);

  // 3) 0x00E9AA: "Save and quit?" (18 words) + 0xff29 at 0xe9ce
  const p3 = encodePromptWords('Save and quit?', 18);
  for (let i = 0; i < 18; i++) rom.writeUInt16LE(p3[i], 0x00E9AA + i * 2);

  // 3b) 0x00E9FA: Item 1 Action Menu description:
  // Line 1: "Check descriptions" (9 words) + 0xff02 at 0xea0c
  // Line 2: "of Conan's gadgets." (11 words) + 0xff00 at 0xea24
  const p3b_l1 = encodePromptWords('Check descriptions', 9);
  for (let i = 0; i < 9; i++) rom.writeUInt16LE(p3b_l1[i], 0x00E9FA + i * 2);
  const p3b_l2 = encodePromptWords("of Conan's gadgets.", 11);
  for (let i = 0; i < 11; i++) rom.writeUInt16LE(p3b_l2[i], 0x00EA0E + i * 2);

  // 4) 0x00EA2C: Line 1 "Retry from" (11 words) \n Line 2 "checkpoint?" (7 words)
  const p4_l1 = encodePromptWords('Retry from', 11);
  for (let i = 0; i < 11; i++) rom.writeUInt16LE(p4_l1[i], 0x00EA2C + i * 2);
  const p4_l2 = encodePromptWords('checkpoint?', 7);
  for (let i = 0; i < 7; i++) rom.writeUInt16LE(p4_l2[i], 0x00EA44 + i * 2);

  // 5) 0x00EA5A: Line 1 "Save and" (6 words) \n Line 2 "return to menu?" (11 words)
  const p5_l1 = encodePromptWords('Save and', 6);
  for (let i = 0; i < 6; i++) rom.writeUInt16LE(p5_l1[i], 0x00EA5A + i * 2);
  const p5_l2 = encodePromptWords('return to menu?', 11);
  for (let i = 0; i < 11; i++) rom.writeUInt16LE(p5_l2[i], 0x00EA68 + i * 2);

  // 6) 0x00EA88: "Continue game?" (10 words) + 0xff29 at 0xea9c
  const p6 = encodePromptWords('Continue game?', 10);
  for (let i = 0; i < 10; i++) rom.writeUInt16LE(p6[i], 0x00EA88 + i * 2);
  rom.writeUInt16LE(0xFF29, 0x00EA9C);

  // 7) 0x00EAB0: Line 1 "Save data found." (12 words) \n Line 2 "Continue from save?" (15 words)
  const p7_l1 = encodePromptWords('Save data found.', 12);
  for (let i = 0; i < 12; i++) rom.writeUInt16LE(p7_l1[i], 0x00EAB0 + i * 2);
  rom.writeUInt16LE(0xFF02, 0x00EAC8);
  const p7_l2 = encodePromptWords('Continue from save?', 15);
  for (let i = 0; i < 15; i++) rom.writeUInt16LE(p7_l2[i], 0x00EACA + i * 2);
  rom.writeUInt16LE(0xFF29, 0x00EAE8);

  console.log('Successfully patched all 8 system bytecode prompts in ROM.');
}

// 3. Patch Choice Buttons 0x30CB (YES, NO) and 0x30CD (BACK)
export function patchChoiceButtons(rom) {
  console.log('--- Patching Choice Buttons (0x30CB: YES/NO, 0x30CD: BACK) ---');

  // Helper to convert 32x16 pixel array [y][x] into 8 4bpp sprite tiles (Row 0: tiles 0..3, Row 1: tiles 4..7)
  function sprite32x16ToTiles(grid) {
    const buf = Buffer.alloc(256); // 8 tiles * 32 bytes
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const tileIdx = ty * 4 + tx;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px += 2) {
            const y = ty * 8 + py;
            const x = tx * 8 + px;
            const p1 = grid[y][x] & 0xf;
            const p2 = grid[y][x + 1] & 0xf;
            buf[tileIdx * 32 + py * 4 + px / 2] = (p2 << 4) | p1;
          }
        }
      }
    }
    return buf;
  }

  // --- 0x30CB: Sprite 0 (YES, 32x16), Sprite 1 (NO, 32x16) ---
  const yesGrid = Array.from({ length: 16 }, () => Array(32).fill(0));
  const noGrid = Array.from({ length: 16 }, () => Array(32).fill(0));

  // Colors: 8 = dark border, 11 (0xb) = bright fill
  const yesW = measureTextWidth('YES');
  const yesX = Math.floor((32 - yesW) / 2);
  drawOutlinedText(yesGrid, 'YES', yesX, 4, 8, 11);

  const noW = measureTextWidth('NO');
  const noX = Math.floor((32 - noW) / 2);
  drawOutlinedText(noGrid, 'NO', noX, 4, 8, 11);

  const yesTiles = sprite32x16ToTiles(yesGrid);
  const noTiles = sprite32x16ToTiles(noGrid);
  const raw30cb = Buffer.concat([yesTiles, noTiles]);
  const comp30cb = compressLZ77(raw30cb);

  const exp30cb = 0x00D00000;
  comp30cb.copy(rom, exp30cb);
  rom.writeUInt32LE(comp30cb.length, 0xa7108 + 0x30cb * 8);
  rom.writeUInt32LE(0x08000000 + exp30cb, 0xa7108 + 0x30cb * 8 + 4);
  console.log(`  Patched Asset 0x30CB (YES/NO): ${comp30cb.length}b @ 0x${(0x08000000 + exp30cb).toString(16)}`);

  // --- 0x30CD: BACK (64x16 sprite split into Sprite 0: 32x16 and Sprite 1: 32x16) ---
  const back64x16 = Array.from({ length: 16 }, () => Array(64).fill(0));
  const backW = measureTextWidth('BACK');
  const backX = Math.floor((64 - backW) / 2);
  drawOutlinedText(back64x16, 'BACK', backX, 4, 8, 11);

  const backLeft = Array.from({ length: 16 }, (_, y) => back64x16[y].slice(0, 32));
  const backRight = Array.from({ length: 16 }, (_, y) => back64x16[y].slice(32, 64));

  const backTiles0 = sprite32x16ToTiles(backLeft);
  const backTiles1 = sprite32x16ToTiles(backRight);
  const raw30cd = Buffer.concat([backTiles0, backTiles1]);
  const comp30cd = compressLZ77(raw30cd);

  const exp30cd = 0x00D01000;
  comp30cd.copy(rom, exp30cd);
  rom.writeUInt32LE(comp30cd.length, 0xa7108 + 0x30cd * 8);
  rom.writeUInt32LE(0x08000000 + exp30cd, 0xa7108 + 0x30cd * 8 + 4);
  console.log(`  Patched Asset 0x30CD (BACK): ${comp30cd.length}b @ 0x${(0x08000000 + exp30cd).toString(16)}`);
}

// 4. Patch Brick Submenu Buttons (0x21AD..0x21BB: SCENARIO, MINIGAME, RIDDLE CARD, ALBUM)
export function patchSubmenuButtons(rom) {
  console.log('--- Patching Brick Submenu Buttons (SCENARIO, MINIGAME, RIDDLE CARD, ALBUM) ---');

  // Decompose 72 tiles into 144x32 grid
  function tilesTo144x32(dec) {
    const grid = Array.from({ length: 32 }, () => Array(144).fill(0));
    for (let y = 0; y < 32; y++) {
      const ty = Math.floor(y / 8), py = y % 8;
      for (let x = 0; x < 144; x++) {
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
        const b = dec[tileIdx * 32 + py * 4 + Math.floor(px / 2)];
        grid[y][x] = (px % 2 === 0) ? (b & 0xf) : (b >> 4);
      }
    }
    return grid;
  }

  // Convert 144x32 grid back into 72 4bpp tiles
  function grid144x32ToTiles(grid) {
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

  const buttons = [
    { text: 'SCENARIO', unselId: 0x21ad, selId: 0x21af, expUnsel: 0x00D02000, expSel: 0x00D03000 },
    { text: 'MINIGAME', unselId: 0x21b1, selId: 0x21b3, expUnsel: 0x00D04000, expSel: 0x00D05000 },
    { text: 'RIDDLE CARD', unselId: 0x21b5, selId: 0x21b7, expUnsel: 0x00D06000, expSel: 0x00D07000 },
    { text: 'ALBUM', unselId: 0x21b9, selId: 0x21bb, expUnsel: 0x00D08000, expSel: 0x00D09000 }
  ];

  for (const b of buttons) {
    for (const [id, expDest, mode] of [[b.unselId, b.expUnsel, 'unselected'], [b.selId, b.expSel, 'selected']]) {
      const p = 0xa7108 + id * 8;
      const ptr = rom.readUInt32LE(p + 4) & 0x01ffffff;
      const dec = decompressLZ77(rom, ptr);
      if (!dec) continue;

      const grid = tilesTo144x32(dec);

      // Clear the text area between x=16 and x=128 to clean background bar stripes
      for (let y = 10; y <= 21; y++) {
        let baseColor = 0;
        if (y === 10 || y === 11) baseColor = 0;
        else if (y >= 12 && y <= 15) baseColor = 0xd; // light orange
        else if (y === 16) baseColor = 0xe;          // mid orange
        else if (y === 17) baseColor = 0xd;
        else if (y >= 18 && y <= 19) baseColor = 0xe; // dark orange
        else if (y >= 20 && y <= 21) baseColor = 0x2; // bottom border
        for (let x = 16; x < 128; x++) {
          grid[y][x] = baseColor;
        }
      }

      // Draw centered English text (outline color 1, fill color 0xf)
      const tw = measureTextWidth(b.text);
      const tx = Math.floor(16 + (112 - tw) / 2);
      drawOutlinedText(grid, b.text, tx, 12, 1, 0xf);

      const rawTiles = grid144x32ToTiles(grid);
      const compTiles = compressLZ77(rawTiles);

      compTiles.copy(rom, expDest);
      rom.writeUInt32LE(compTiles.length, 0xa7108 + id * 8);
      rom.writeUInt32LE(0x08000000 + expDest, 0xa7108 + id * 8 + 4);
      console.log(`  Patched 0x${id.toString(16)} (${b.text} ${mode}): ${compTiles.length}b @ 0x${(0x08000000 + expDest).toString(16)}`);
    }
  }
}

// 5. Patch Save Slot Notebook Headers (0x223F, 0x2241)
export function patchNotebookHeaders(rom) {
  console.log('--- Patching Save Slot Notebook Headers (SCENARIO, TIME, CARDS) ---');

  for (const [id, expDest] of [[0x223f, 0x00D0A000], [0x2241, 0x00D0B000]]) {
    const p = 0xa7108 + id * 8;
    const ptr = rom.readUInt32LE(p + 4) & 0x01ffffff;
    const dec = decompressLZ77(rom, ptr);
    if (!dec) continue;

    // 64x24 canvas
    const grid = Array.from({ length: 24 }, () => Array(64).fill(0));
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const tileIdx = ty * 8 + tx;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px += 2) {
            const y = ty * 8 + py;
            const x = tx * 8 + px;
            const b = dec[tileIdx * 32 + py * 4 + px / 2];
            grid[y][x] = b & 0xf;
            grid[y][x + 1] = (b >> 4) & 0xf;
          }
        }
      }
    }

    // Preserve column 0 (tile 0: notebook binder rings), clear columns 1..7 (x=8..63)
    for (let y = 0; y < 24; y++) {
      for (let x = 8; x < 64; x++) {
        grid[y][x] = 0;
      }
    }

    // Row 0: SCENARIO (y=0..7)
    // Row 1: TIME (y=8..15)
    // Row 2: CARDS (y=16..23)
    // In notebook palette: outline = 1 (dark navy), fill = 0xd (cream/tan) or 0xb
    drawOutlinedText(grid, 'SCENARIO', 9, 0, 1, 0xd);
    drawOutlinedText(grid, 'TIME', 18, 8, 1, 0xd);
    drawOutlinedText(grid, 'CARDS', 15, 16, 1, 0xd);

    // Reconstruct 24 tiles
    const buf = Buffer.alloc(768);
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const tileIdx = ty * 8 + tx;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px += 2) {
            const y = ty * 8 + py;
            const x = tx * 8 + px;
            const p1 = grid[y][x] & 0xf;
            const p2 = grid[y][x + 1] & 0xf;
            buf[tileIdx * 32 + py * 4 + px / 2] = (p2 << 4) | p1;
          }
        }
      }
    }

    const compTiles = compressLZ77(buf);
    compTiles.copy(rom, expDest);
    rom.writeUInt32LE(compTiles.length, 0xa7108 + id * 8);
    rom.writeUInt32LE(0x08000000 + expDest, 0xa7108 + id * 8 + 4);
    console.log(`  Patched 0x${id.toString(16)} (Notebook Headers): ${compTiles.length}b @ 0x${(0x08000000 + expDest).toString(16)}`);
  }
}

// 6. Patch Case Intro Splash (0x2E81 Tiles & 0x2E82 Map: "ONLY YOU CAN SOLVE THIS CASE!!")
export function patchCaseIntroSplash(rom) {
  console.log('--- Patching Case Intro Splash Screen (0x2E81/0x2E82) ---');
  const probePath = path.resolve(__dirname, '../assets/bin/probe_2e82.bmp');
  if (!fs.existsSync(probePath)) {
    console.warn('Missing probe_2e82.bmp, skipping splash screen patch.');
    return;
  }

  const bmp = fs.readFileSync(probePath);
  const canvas = Buffer.alloc(240 * 160);

  // Read grayscale pixel values (0..15)
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 240; x++) {
      const off = 54 + (159 - y) * (240 * 3) + x * 3;
      canvas[y * 240 + x] = Math.floor(bmp[off + 2] / 16) & 0xf;
    }
  }

  // Clear Japanese text in center (y=62 to 104, x=24 to 216) to clean halo
  for (let y = 62; y <= 104; y++) {
    for (let x = 24; x <= 216; x++) {
      // Calculate radial distance from center (120, 83)
      const dx = (x - 120) * 0.7;
      const dy = (y - 83);
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Clean radial brightness fade
      let c = Math.floor(15 - (dist / 40) * 8);
      if (c < 3) c = 3;
      if (c > 14) c = 14;
      canvas[y * 240 + x] = c;
    }
  }

  // Draw English text:
  // Line 1: "ONLY YOU CAN" (y=68)
  // Line 2: "SOLVE THIS CASE!!" (y=84)
  const grid = Array.from({ length: 160 }, (_, y) => Array.from({ length: 240 }, (_, x) => canvas[y * 240 + x]));

  const l1 = 'ONLY YOU CAN';
  const l2 = 'SOLVE THIS CASE!!';
  const w1 = measureTextWidth(l1);
  const w2 = measureTextWidth(l2);
  const x1 = Math.floor((240 - w1) / 2);
  const x2 = Math.floor((240 - w2) / 2);

  // Outline = 1 (black), fill = 15 (brightest white)
  drawOutlinedText(grid, l1, x1, 68, 1, 15);
  drawOutlinedText(grid, l2, x2, 84, 1, 15);

  // Flatten back to canvas
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 240; x++) {
      canvas[y * 240 + x] = grid[y][x];
    }
  }

  const enc = encodeScreen(canvas);
  console.log(`Splash screen encoded: ${enc.uniqueTilesCount} unique tiles, compTiles: ${enc.compTiles.length}b, compMap: ${enc.compMap.length}b`);

  const expTiles = 0x00D10000;
  const expMap = 0x00D18000;


  enc.compTiles.copy(rom, expTiles);
  enc.compMap.copy(rom, expMap);

  rom.writeUInt32LE(enc.compTiles.length, 0xa7108 + 0x2e81 * 8);
  rom.writeUInt32LE(0x08000000 + expTiles, 0xa7108 + 0x2e81 * 8 + 4);

  rom.writeUInt32LE(enc.compMap.length, 0xa7108 + 0x2e82 * 8);
  rom.writeUInt32LE(0x08000000 + expMap, 0xa7108 + 0x2e82 * 8 + 4);

  console.log(`  Patched 0x2E81/0x2E82 (Case Intro Splash): Tiles @ 0x${(0x08000000 + expTiles).toString(16)}, Map @ 0x${(0x08000000 + expMap).toString(16)}`);
}

// Master patch function
export function patchSystemUI(rom, getPairId) {
  console.log('=== Patching All Untranslated System UI, Graphic Buttons & Prompts ===');
  patchSystemPrompts(rom, getPairId);
  patchChoiceButtons(rom);
  patchSubmenuButtons(rom);
  patchNotebookHeaders(rom);
  patchCaseIntroSplash(rom);
  console.log('=== All System UI & Graphics Patched Successfully ===');
}
