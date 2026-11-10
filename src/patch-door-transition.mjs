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

// 7x14 Font for 64px width
const font7x14 = {
  'S': [
    '.#####.',
    '#######',
    '##...##',
    '##.....',
    '######.',
    '.######',
    '....###',
    '.....##',
    '##...##',
    '#######',
    '.#####.',
    '.......',
    '.......',
    '.......'
  ],
  'E': [
    '#######',
    '#######',
    '##.....',
    '##.....',
    '######.',
    '######.',
    '##.....',
    '##.....',
    '##.....',
    '#######',
    '#######',
    '.......',
    '.......',
    '.......'
  ],
  'C': [
    '.#####.',
    '#######',
    '##...##',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
    '##...##',
    '#######',
    '.#####.',
    '.......',
    '.......',
    '.......'
  ],
  'U': [
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '#######',
    '.#####.',
    '.......',
    '.......',
    '.......'
  ],
  'R': [
    '######.',
    '#######',
    '##...##',
    '##...##',
    '######.',
    '#######',
    '##.####',
    '##..###',
    '##...##',
    '##...##',
    '##...##',
    '.......',
    '.......',
    '.......'
  ],
  'I': [
    '.#####.',
    '.#####.',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '.#####.',
    '.#####.',
    '.......',
    '.......',
    '.......'
  ],
  'T': [
    '#######',
    '#######',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '.......',
    '.......',
    '.......'
  ],
  'Y': [
    '##...##',
    '##...##',
    '.#####.',
    '..###..',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '...#...',
    '.......',
    '.......',
    '.......'
  ],
  'M': [
    '##...##',
    '#######',
    '#######',
    '##.#.##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '.......',
    '.......',
    '.......'
  ],
  'N': [
    '##...##',
    '###..##',
    '#######',
    '##.####',
    '##..###',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '.......',
    '.......',
    '.......'
  ],
  'A': [
    '..###..',
    '.#####.',
    '##...##',
    '##...##',
    '#######',
    '#######',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '.......',
    '.......',
    '.......'
  ],
  'W': [
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##.#.##',
    '#######',
    '#######',
    '.#####.',
    '..#.#..',
    '..#.#..',
    '..#.#..',
    '.......',
    '.......',
    '.......'
  ],
  ' ': [
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......'
  ]
};

export function buildDoorTransitionTiles() {
  // Canvas: 64 wide x 160 high
  const W = 64, H = 160;
  const canvas = Array.from({length: H}, () => new Uint8Array(W));

  function drawText(str, startX, startY, charSpacing = 1) {
    let curX = startX;
    for (const ch of str) {
      const glyph = font7x14[ch] || font7x14[' '];
      for (let r = 0; r < 14; r++) {
        for (let c = 0; c < 7; c++) {
          const x = curX + c;
          const y = startY + r;
          if (x >= 0 && x < W && y >= 0 && y < H) {
            const pixel = glyph[r][c];
            if (pixel === '#') {
              // Palette 0x20b6 colors:
              // 6 = pure white, 5 = light cream, 2 = shadow bevel
              if (r <= 2 || c <= 1) canvas[y][x] = 5; // highlight
              else if (r >= 9 || c >= 5) canvas[y][x] = 2; // shadow
              else canvas[y][x] = 6; // core white
            }
          }
        }
      }
      curX += 7 + charSpacing;
    }
  }

  function addOutline() {
    const orig = canvas.map(row => new Uint8Array(row));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (orig[y][x] === 0) {
          let hasNeighbor = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy, nx = x + dx;
              if (ny >= 0 && ny < H && nx >= 0 && nx < W && orig[ny][nx] > 0) {
                hasNeighbor = true;
                break;
              }
            }
            if (hasNeighbor) break;
          }
          if (hasNeighbor) canvas[y][x] = 1; // dark outline
        }
      }
    }
  }

  // Section 1 (Y = 0..63, Sprite 0): "SECURITY" (8 chars * 8 - 1 = 63 px wide, startX = 1, startY = 25)
  drawText('SECURITY', 1, 25, 1);

  // Section 2 (Y = 64..127, Sprite 1): "SYSTEM" (6 chars * 8 - 1 = 47 px wide, startX = 9, startY = 89)
  drawText('SYSTEM', 9, 89, 1);

  // Section 3 (Y = 128..159, Sprite 2): "RUNAWAY CASE"
  // Height is 32 (Y = 128..159)
  // Let's put "CASE 1" or "RUNAWAY" (Y=132) and "CASE" (Y=146)
  drawText('RUNAWAY', 5, 131, 1);
  drawText('CASE', 16, 145, 1);

  addOutline();

  // Encode to 160 tiles (5120 bytes)
  // Sprite 0 (64x64): Y = 0..63 (64 tiles: 0..63)
  // Sprite 1 (64x64): Y = 64..127 (64 tiles: 64..127)
  // Sprite 2 (64x32): Y = 128..159 (32 tiles: 128..159)
  const tilesBuf = Buffer.alloc(5120);

  function encodeSprite(startY, tilesH, tileDestOffset) {
    for (let ty = 0; ty < tilesH; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const tileIdx = tileDestOffset + ty * 8 + tx;
        const tileBuf = tilesBuf.subarray(tileIdx * 32, (tileIdx + 1) * 32);
        for (let y = 0; y < 8; y++) {
          const cy = startY + ty * 8 + y;
          for (let x = 0; x < 8; x += 2) {
            const cx1 = tx * 8 + x;
            const cx2 = tx * 8 + x + 1;
            const p1 = canvas[cy][cx1] & 0x0f;
            const p2 = canvas[cy][cx2] & 0x0f;
            tileBuf[y * 4 + x / 2] = (p2 << 4) | p1;
          }
        }
      }
    }
  }

  encodeSprite(0, 8, 0);     // Sprite 0 (64x64) -> tiles 0..63
  encodeSprite(64, 8, 64);   // Sprite 1 (64x64) -> tiles 64..127
  encodeSprite(128, 4, 128); // Sprite 2 (64x32) -> tiles 128..159

  return tilesBuf;
}

export function patchDoorTransitionTitle(rom) {
  const rawTiles = buildDoorTransitionTiles();
  const comp = compressLZ77(rawTiles);
  console.log(`Door Transition Title: 5120 raw bytes -> ${comp.length} LZ77 bytes.`);

  // Write directly to Asset 0x20b7 at 0x5b0cb0 (fits in 2456 bytes)
  comp.copy(rom, 0x5b0cb0);

  // Also write to expanded ROM at 0x00C28000 and update Table 0 pointers
  comp.copy(rom, 0x00C28000);
  rom.writeUInt32LE(comp.length, 0xb76c0);
  rom.writeUInt32LE(0x08C28000, 0xb76c4);

  console.log('Successfully patched Case 1 Door Transition Title at 0x5b0cb0 and 0x08C28000!');
}

// Standalone execution
if (process.argv[1].endsWith('patch-door-transition.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchDoorTransitionTitle(rom);
      fs.writeFileSync(romPath, rom);
      console.log('Patched ' + romPath);
    }
  }
}
