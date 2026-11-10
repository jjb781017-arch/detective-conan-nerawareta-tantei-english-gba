import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Audit LZ77 distance-1 (disp=0) tokens in graphical assets.
 *
 * The game's in-game decompressor mishandles distance-1 copies: a `disp=0`
 * token decodes to stale VRAM instead of repeating the previous byte. The
 * original Eteko UI streams (0x3205/0x3206/0x3219) never use them, but the
 * project's build compressors used to emit them. This script reports every
 * asset that still contains one, and hard-fails if the Eteko overlay regresses.
 *
 * Usage:
 *   node src/audit-lz77-distance1.mjs [rom] [--strict]
 *
 *   --strict  exit 1 if ANY changed asset contains a distance-1 token
 *             (default: only the Eteko UI assets are treated as fatal)
 */
import fs from 'fs';

const TABLE = 0xa7108;
const REQUIRED_SAFE = new Set([
  0x3205, 0x3206, 0x3219,
  0xc58, 0xc59, 0xc5b, 0xc5c, 0xc5e, 0xc5f, 0xc61, 0xc62, 0xc64, 0xc65, 0xc67, 0xc68, 0xc6a, 0xc6b, 0xc6d, 0xc6e
]);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const romPath = args.find(a => !a.startsWith('--')) || path.resolve(__dirname, '../build/Detective Conan - English Translated.gba');
const cleanPath = process.env.CONAN_CLEAN_ROM || path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba');

const rom = fs.readFileSync(romPath);
const clean = fs.readFileSync(cleanPath);

function tokenStats(src, id) {
  const entry = TABLE + id * 8;
  if (entry + 8 > src.length) return null;
  const ptr = src.readUInt32LE(entry + 4) & 0x1ffffff;
  if (ptr + 4 > src.length || src[ptr] !== 0x10) return null;
  const outLen = src[ptr + 1] | (src[ptr + 2] << 8) | (src[ptr + 3] << 16);
  if (outLen <= 0 || outLen > 0x40000) return null;

  let p = ptr + 4, o = 0, copies = 0, d1 = 0, d1Bytes = 0;
  while (o < outLen && p < src.length) {
    const flags = src[p++];
    for (let bit = 7; bit >= 0 && o < outLen; bit--) {
      if (flags & (1 << bit)) {
        const b0 = src[p++], b1 = src[p++];
        const len = (b0 >> 4) + 3;
        const dist = (((b0 & 0xf) << 8) | b1) + 1;
        copies++;
        if (dist === 1) { d1++; d1Bytes += len; }
        o += len;
      } else {
        p++;
        o++;
      }
    }
  }
  return { ptr, outLen, copies, d1, d1Bytes };
}

console.log(`ROM   : ${romPath}`);
console.log(`Clean : ${cleanPath}\n`);

let failed = false;
console.log('=== Eteko UI assets (must be distance-1-free) ===');
for (const id of REQUIRED_SAFE) {
  const s = tokenStats(rom, id);
  if (!s) {
    console.log(`  0x${id.toString(16)}: not an LZ77 asset`);
    continue;
  }
  const ok = s.d1 === 0;
  if (!ok) failed = true;
  console.log(`  0x${id.toString(16)}: ${ok ? 'OK' : 'FAIL'} - ${s.copies} copies, ${s.d1} distance-1 (${s.d1Bytes} B), outLen=${s.outLen}`);
}

console.log('\n=== Changed assets containing distance-1 tokens ===');
let changed = 0, changedWithD1 = 0;
const affected = [];
for (let id = 0; id < 0x3600; id++) {
  const e = TABLE + id * 8;
  if (e + 8 > clean.length) break;
  const cs = clean.readUInt32LE(e), cp = clean.readUInt32LE(e + 4);
  const ns = rom.readUInt32LE(e), np = rom.readUInt32LE(e + 4);
  if (cs === ns && cp === np) continue;
  changed++;
  const s = tokenStats(rom, id);
  if (s && s.d1 > 0) {
    changedWithD1++;
    const cleanD1 = (tokenStats(clean, id) || {}).d1 ?? 0;
    affected.push({ id, ...s, cleanD1 });
  }
}
console.log(`  ${changedWithD1} of ${changed} changed assets still contain distance-1 tokens`);

for (const a of affected.slice(0, 25)) {
  console.log(`    0x${a.id.toString(16)}: d1=${a.d1} (${a.d1Bytes} B), cleanD1=${a.cleanD1}, outLen=${a.outLen}`);
}
if (affected.length > 25) console.log(`    ... and ${affected.length - 25} more`);

console.log('\n=== Clean-ROM distance-1 usage (for reference) ===');
const cleanD1 = [];
for (let id = 0; id < 0x3600; id++) {
  const s = tokenStats(clean, id);
  if (s && s.d1 > 0) cleanD1.push({ id, ...s });
}
console.log(`  ${cleanD1.length} original asset(s) use distance-1 tokens (none are the Eteko UI assets)`);

if (strict && changedWithD1 > 0) failed = true;

console.log(`\n${failed ? 'AUDIT FAILED' : 'AUDIT PASSED'}`);
process.exit(failed ? 1 : 0);
