// work/patch-karate-ui.mjs
//
// Patches the genuine uncompressed Karate Minigame sprite assets:
//   1. Asset 0x2fc2 (Table 2: 0x9cb4): Round start banner 「はじめっ！！」 -> "START!!" (offset 0x7b5f38, 1536 B)
//   2. Asset 0x2fc5 (Table 2: 0x9cb7): Round end banner 「そこまで！！」 -> "TIME'S UP!!" (offset 0x7b6570, 1536 B)
//   3. Asset 0x2fdd (Table 2: 0x9ccf): Results header 「結果」 -> "RESULTS" (offset 0x7b71f0, 320 B)
//   4. Asset 0x2fe0 (Table 2: 0x9cd2): Results fail stamp 「不合格！」 -> "FAILED!" (offset 0x7b7368, 576 B)
//   5. Asset 0x2fe2 (Table 2: 0x9cd4): Results pass stamp 「合格！！」 -> "PASSED!!" (offset 0x7b75e4, 576 B)
//
// Also restores clean Table 0 entries for 0x30ec, 0x30ee, 0x30f8, 0x3325 that were previously mistakenly overwritten.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ASSET_TABLE = 0xa7108;

export function patchKarateUi(rom) {
  console.log('=== Patching Karate Minigame Graphics & Result Card ===');

  // 1. Restore clean Table 0 entries for mistakenly patched assets
  const cleanRestorations = [
    { id: 0x30ec, len: 1064, ptr: 0x087c7f58 },
    { id: 0x30ee, len: 1020, ptr: 0x087c83ac },
    { id: 0x30f8, len: 1100, ptr: 0x087c8938 },
    { id: 0x3325, len: 1220, ptr: 0x087e4c0c },
  ];

  for (const r of cleanRestorations) {
    const pEntry = ASSET_TABLE + r.id * 8;
    rom.writeUInt32LE(r.len, pEntry);
    rom.writeUInt32LE(r.ptr, pEntry + 4);
    console.log(`  Restored Table 0 entry 0x${r.id.toString(16)}: len=${r.len}, ptr=0x${r.ptr.toString(16)}`);
  }

  // 2. Patch the 5 genuine Karate sprite assets using clean English binaries
  const karateAssets = [
    { id: 0x2fc2, file: path.resolve(__dirname, '../assets/bin/asset_0x2fc2_clean.bin'), off: 0x7b5f38, name: 'START!! (round start banner)' },
    { id: 0x2fc5, file: path.resolve(__dirname, '../assets/bin/asset_0x2fc5_clean.bin'), off: 0x7b6570, name: "TIME'S UP!! (round end banner)" },
    { id: 0x2fdd, file: path.resolve(__dirname, '../assets/bin/asset_0x2fdd_clean.bin'), off: 0x7b71f0, name: 'RESULTS (parchment header)' },
    { id: 0x2fe0, file: path.resolve(__dirname, '../assets/bin/asset_0x2fe0_clean.bin'), off: 0x7b7368, name: 'FAILED! (result stamp)' },
    { id: 0x2fe2, file: path.resolve(__dirname, '../assets/bin/asset_0x2fe2_clean.bin'), off: 0x7b75e4, name: 'PASSED!! (result stamp)' },
  ];

  for (const a of karateAssets) {
    const fullPath = path.isAbsolute(a.file) ? a.file : path.join(process.cwd(), a.file);
    const buf = fs.readFileSync(fullPath);
    buf.copy(rom, a.off);

    const pEntry = ASSET_TABLE + a.id * 8;
    rom.writeUInt32LE(buf.length, pEntry);
    rom.writeUInt32LE(0x08000000 + a.off, pEntry + 4);

    console.log(`  Patched 0x${a.id.toString(16)} ${a.name}: ${buf.length}b @ 0x${(0x08000000 + a.off).toString(16)}`);
  }

  console.log('=== Karate Minigame Graphics Successfully Patched ===');
}
