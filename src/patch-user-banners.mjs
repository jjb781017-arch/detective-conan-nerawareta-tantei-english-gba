import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// work/patch-user-banners.mjs
//
// Processes the 10 translated result banners created by the community
// in remaining_assets_to_translate/3_ui_result_banners/:
//   1. Makes outer background transparent (removes white/outer halos)
//   2. Scales down and quantizes to authentic 16-color GBA palettes
//   3. Packs into 4bpp tile buffers using writeBackParts (with 0 conflicts)
//   4. LZ77-compresses and burns into ROM scratch area at 0x00D60000
//   5. Repoints Table 0 entries at 0xa7108 + id * 8

import fs from 'fs';
import { decodePNG } from './png-decode.mjs';
import { decodePNGtoRGB } from './patch-translated-screens.mjs';
import { loadAsset, writeBackParts } from './asset-canvas.mjs';
import { getAssetPalette } from './asset-palettes.mjs';

export const USER_BANNER_SCRATCH_BASE = 0x00D60000;
export const USER_BANNER_SCRATCH_SLOT = 0x00002000; // 8 KiB per banner slot
export const ASSET_TABLE = 0xa7108;

function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

// GBA BIOS LZ77 Compressor
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

export const USER_BANNERS = [
  { id: 0x30e0, file: 'custom_0x30e0_clear.png', name: 'CLEAR!', w: 176, h: 64, type: 'white_starburst' },
  { id: 0x30e2, file: 'custom_0x30e2_failed.png', name: 'FAILED!', w: 128, h: 64, type: 'white_starburst' },
  { id: 0x2227, file: 'custom_0x2227_correct.png', name: 'CORRECT!', w: 128, h: 64, type: 'correct_card' },
  { id: 0x30d8, file: 'custom_0x30d8_caught.png', name: 'CAUGHT!', w: 176, h: 64, type: 'white_starburst' },
  { id: 0x30fa, file: 'custom_0x30fa_success.png', name: 'SUCCESS!', w: 128, h: 64, type: 'white_starburst' },
  { id: 0x30fc, file: 'custom_0x30fc_timeover.png', name: 'TIME OVER', w: 176, h: 64, type: 'white_starburst' },
  { id: 0x309b, file: 'custom_0x309b_found.png', name: 'FOUND!!', w: 120, h: 48, type: 'white_starburst' },
  { id: 0x30cd, file: 'custom_0x30cd_back.png', name: '[L] BACK', w: 64, h: 16, type: 'l_back' },
  { id: 0x30a1, file: 'custom_0x30a1_wrong.png', name: 'WRONG', w: 64, h: 40, type: 'white_starburst' }
];

export function generateUserBannerGrid(banner) {
  const dir = path.resolve(__dirname, '../assets/banners');
  const p = path.join(dir, banner.file);
  const { w: W_s, h: H_s, rgb: rgb_s, alpha: a_s } = decodePNG(p);
  const pal = getAssetPalette(banner.id).sub;
  const W_d = banner.w, H_d = banner.h;
  const grid = new Uint8Array(W_d * H_d);

  // If already at 1:1 native GBA sprite dimensions:
  if (W_s === W_d && H_s === H_d) {
    for (let i = 0; i < W_d * H_d; i++) {
      if (a_s && a_s[i] < 128) {
        grid[i] = 0;
        continue;
      }
      const off = i * 3;
      const r = rgb_s[off], g = rgb_s[off + 1], b = rgb_s[off + 2];
      let bestIdx = 0, bestDist = 1e9;
      for (let k = 0; k < pal.length; k++) {
        const c = pal[k];
        const dist = colorDist(r, g, b, c[0], c[1], c[2]);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = k;
        }
      }
      grid[i] = bestIdx;
    }
    return grid;
  }

  const isBg = new Uint8Array(W_s * H_s);

  if (banner.type === 'white_starburst') {
    const q = [];
    function check(x, y) {
      const idx = y * W_s + x;
      if (isBg[idx]) return;
      const off = idx * 3;
      const r = rgb_s[off], g = rgb_s[off+1], b = rgb_s[off+2];
      if (r > 215 && g > 215 && b > 215) {
        isBg[idx] = 1;
        q.push([x, y]);
      }
    }
    for (let x = 0; x < W_s; x++) { check(x, 0); check(x, H_s - 1); }
    for (let y = 0; y < H_s; y++) { check(0, y); check(W_s - 1, y); }
    while (q.length > 0) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < W_s && ny >= 0 && ny < H_s) check(nx, ny);
      }
    }
  } else if (banner.type === 'correct_card') {
    for (let y = 0; y < H_s; y++) {
      for (let x = 2880; x < W_s; x++) isBg[y * W_s + x] = 1;
    }
  } else if (banner.type === 'l_back') {
    const q = [];
    function checkL(x, y) {
      const idx = y * W_s + x;
      if (isBg[idx]) return;
      const off = idx * 3;
      const r = rgb_s[off], g = rgb_s[off+1], b = rgb_s[off+2];
      if ((r > 220 && g > 220 && b > 220) || (r > 200 && g < 50 && b < 50)) {
        isBg[idx] = 1;
        q.push([x, y]);
      }
    }
    for (let x = 0; x < W_s; x++) { checkL(x, 0); checkL(x, H_s - 1); }
    for (let y = 0; y < H_s; y++) { checkL(0, y); checkL(W_s - 1, y); }
    while (q.length > 0) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < W_s && ny >= 0 && ny < H_s) checkL(nx, ny);
      }
    }
  }

  const srcMaxX = (banner.type === 'correct_card') ? 2880 : W_s;

  for (let dy = 0; dy < H_d; dy++) {
    const sy0 = Math.floor((dy / H_d) * H_s);
    const sy1 = Math.floor(((dy + 1) / H_d) * H_s);
    for (let dx = 0; dx < W_d; dx++) {
      const sx0 = Math.floor((dx / W_d) * srcMaxX);
      const sx1 = Math.floor(((dx + 1) / W_d) * srcMaxX);

      let totR = 0, totG = 0, totB = 0, fgCount = 0, cellBg = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const sIdx = sy * W_s + sx;
          if (isBg[sIdx]) {
            cellBg++;
          } else {
            fgCount++;
            const off = sIdx * 3;
            totR += rgb_s[off];
            totG += rgb_s[off+1];
            totB += rgb_s[off+2];
          }
        }
      }

      if (fgCount <= cellBg) {
        grid[dy * W_d + dx] = 0;
      } else {
        const avgR = totR / fgCount, avgG = totG / fgCount, avgB = totB / fgCount;
        let bestIdx = 1, bestDist = 1e9;
        for (let i = 1; i < pal.length; i++) {
          const c = pal[i];
          const dist = colorDist(avgR, avgG, avgB, c[0], c[1], c[2]);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        grid[dy * W_d + dx] = bestIdx;
      }
    }
  }

  // Polish L_BACK: remove red artifacts from text area
  if (banner.id === 0x30cd) {
    for (let y = 0; y < H_d; y++) {
      for (let x = 20; x < W_d; x++) {
        if (grid[y * W_d + x] === 8 || grid[y * W_d + x] === 9) {
          grid[y * W_d + x] = 0;
        }
      }
    }
  }

  return grid;
}

export function patchUserBanners(rom, cleanRom) {
  console.log('=== Patching 10 Translated Result Banners ===');

  USER_BANNERS.forEach((banner, idx) => {
    const a = loadAsset(banner.id);
    const grid = generateUserBannerGrid(banner);

    // Repack into GBA 4bpp tile buffer
    const { tiles, conflicts } = writeBackParts(a, grid);
    if (conflicts > 0) {
      console.warn(`[WARN] 0x${banner.id.toString(16)} (${banner.name}) had ${conflicts} part conflicts!`);
    }

    // Compress with LZ77
    const compTiles = compressLZ77(tiles);
    const scratchOffset = USER_BANNER_SCRATCH_BASE + idx * USER_BANNER_SCRATCH_SLOT;

    // Burn into ROM scratch space
    compTiles.copy(rom, scratchOffset);

    // Update Table 0 pointer
    const pEntry = ASSET_TABLE + banner.id * 8;
    rom.writeUInt32LE(compTiles.length, pEntry);
    rom.writeUInt32LE(0x08000000 + scratchOffset, pEntry + 4);

    console.log(`  Patched 0x${banner.id.toString(16).padStart(4, '0')} (${banner.name.padEnd(16)}): ${compTiles.length}b @ 0x${(0x08000000 + scratchOffset).toString(16)} (conflicts: ${conflicts})`);
  });

  console.log('=== Translated Result Banners Successfully Patched ===');
}

