import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// work/patch-pause-asset.mjs
// Inserts a translated 48x16 pause banner into the GBA ROM.
// Can read from:
//   - "translated_screens/0x952.png"
//   - "work/for-translation/assets/0x952.png"
//   - "work/pause_banner_48x16_translated.png"

import fs from 'fs';
import { decodePNG } from './png-decode.mjs';

const ROM_PATH = path.resolve(__dirname, '../build/Detective Conan - English Translated.gba');
const ASSET_ID = 0x952;
const ROM_OFFSET = 0x3b884c; // Asset 0x952 ROM offset
const ASSET_TABLE = 0xa7108;

// In-game OBJ palette 5 colors
const PALETTE_RGB = [
  [168, 168, 248], // 0: transparent (rendered as #FF00FF in PNG)
  [128, 72, 96],   // 1
  [216, 144, 104], // 2
  [248, 200, 168], // 3
  [56, 0, 136],    // 4
  [0, 0, 248],     // 5
  [0, 104, 248],   // 6
  [120, 0, 48],    // 7: dark red shadow
  [248, 0, 0],     // 8: red background
  [136, 72, 16],   // 9: brown outline
  [248, 208, 0],   // 10: yellow
  [248, 184, 0],   // 11: dark yellow
  [104, 96, 128],  // 12: dark shadow
  [168, 160, 160], // 13: grey shadow
  [248, 248, 248], // 14: white text
  [16, 0, 0]       // 15: black outline
];

function findNearestColor(r, g, b) {
  // If transparent / magenta (#FF00FF)
  if (r > 240 && g < 30 && b > 240) return 0;
  // If white
  if (r > 220 && g > 220 && b > 220) return 14;
  // If bright red
  if (r > 200 && g < 50 && b < 50) return 8;
  // If dark red
  if (r > 80 && r < 160 && g < 30 && b < 70) return 7;
  // If black / near black
  if (r < 40 && g < 40 && b < 40) return 15;
  // General Euclidean distance
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 1; i < PALETTE_RGB.length; i++) {
    const dr = r - PALETTE_RGB[i][0];
    const dg = g - PALETTE_RGB[i][1];
    const db = b - PALETTE_RGB[i][2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function encodePauseBannerTiles(pngPath = null) {
  const candidates = [
    pngPath,
    path.resolve(__dirname, '../assets/bin/pause_banner_english.png')
  ].filter(Boolean);

  let targetPng = candidates.find(f => fs.existsSync(f));
  if (!targetPng) {
    console.error('No translated pause PNG found in candidates:');
    candidates.forEach(c => console.error('  - ' + c));
    return null;
  }

  const img = decodePNG(targetPng);
  if (img.w !== 48 || (img.h !== 16 && img.h !== 24)) {
    console.error(`Invalid dimensions: expected 48x16 (or 48x24), got ${img.w}x${img.h}`);
    return null;
  }

  const tileIndices = [
    { id: 0, x: 0, y: 0 }, { id: 1, x: 8, y: 0 }, { id: 2, x: 16, y: 0 }, { id: 3, x: 24, y: 0 },
    { id: 4, x: 0, y: 8 }, { id: 5, x: 8, y: 8 }, { id: 6, x: 16, y: 8 }, { id: 7, x: 24, y: 8 },
    { id: 8, x: 32, y: 0 }, { id: 9, x: 40, y: 0 },
    { id: 10, x: 32, y: 8 }, { id: 11, x: 40, y: 8 }
  ];

  const tilesBuf = Buffer.alloc(384);
  for (const t of tileIndices) {
    const tileBytes = Buffer.alloc(32);
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px += 2) {
        const x0 = t.x + px;
        const y0 = t.y + py;
        const i0 = (y0 * img.w + x0) * 3;
        const c0 = findNearestColor(img.rgb[i0], img.rgb[i0 + 1], img.rgb[i0 + 2]);

        const x1 = t.x + px + 1;
        const y1 = t.y + py;
        const i1 = (y1 * img.w + x1) * 3;
        const c1 = findNearestColor(img.rgb[i1], img.rgb[i1 + 1], img.rgb[i1 + 2]);

        tileBytes[py * 4 + (px >> 1)] = (c0 & 0xf) | ((c1 & 0xf) << 4);
      }
    }
    tileBytes.copy(tilesBuf, t.id * 32);
  }
  return { tilesBuf, sourceFile: targetPng };
}

export function patchPauseAsset(romOrPath = null) {
  const encoded = encodePauseBannerTiles();
  if (!encoded) return false;

  if (Buffer.isBuffer(romOrPath)) {
    encoded.tilesBuf.copy(romOrPath, ROM_OFFSET);
    console.log(`Patched pause banner (384 bytes) into ROM buffer at 0x${ROM_OFFSET.toString(16)} (from ${encoded.sourceFile})`);
    return true;
  }

  const romFiles = [
    path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'),
    path.resolve(__dirname, '../build/Detective Conan - working copy.gba')
  ];

  for (const f of romFiles) {
    if (fs.existsSync(f)) {
      try {
        const rom = fs.readFileSync(f);
        encoded.tilesBuf.copy(rom, ROM_OFFSET);
        fs.writeFileSync(f, rom);
        console.log(`Patched pause banner into ${f} at 0x${ROM_OFFSET.toString(16)}!`);
      } catch (e) {
        console.warn(`Could not write to ${f} (${e.message})`);
      }
    }
  }
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('patch-pause-asset.mjs')) {
  patchPauseAsset();
}
