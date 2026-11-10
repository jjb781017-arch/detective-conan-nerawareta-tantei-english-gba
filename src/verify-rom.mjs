import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Static ROM verifier (README Section 8, Layer 1).
//
// Reads the built ROM plus work/build_manifest.json and checks everything that
// can be proven without an emulator. No screenshots, no manual play.
//
//   node work/verify-rom.mjs                    # verify the release ROM
//   node work/verify-rom.mjs --rom <path>       # verify a specific ROM
//   node work/verify-rom.mjs --strict           # also fail on translation gaps
//
// Exit codes:  0 = pass   1 = structural failure   2 = --strict coverage failure

import fs from 'fs';
import crypto from 'crypto';
import { verifyNameplatePatch } from './nameplate-patch.mjs';

const SOURCE_ROM = process.env.CONAN_CLEAN_ROM || path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba');
const DEFAULT_ROM = path.resolve(__dirname, '../build/Detective Conan - English Translated.gba');
const DEFAULT_MANIFEST = path.resolve(__dirname, '../build/build_manifest.json');

const EXPECTED_SOURCE_SHA256 = '3158689E1FA4B9891CC73CFA1F63150CEB3DFD8B7B030E8FA149A9B211FD2834';
const EXPECTED_ROM_SIZE = 16 * 1024 * 1024;
const GLYPH_BYTES = 36;
const TABLE0 = 0xa7108;
const FONT_ENTRY = 0xb720c; // 0x4e21 font asset: [size][ptr] then [size][ptr]

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const strict = process.argv.includes('--strict');
const romPath = arg('rom', DEFAULT_ROM);
const manifestPath = arg('manifest', DEFAULT_MANIFEST);

const results = [];
function check(name, ok, detail = '', soft = false) {
  results.push({ name, ok, detail, soft });
  const tag = ok ? 'PASS' : (soft ? 'GAP ' : 'FAIL');
  console.log(`[${tag}] ${name}${detail ? ' - ' + detail : ''}`);
}
function info(msg) { console.log(`       ${msg}`); }

console.log('=== Static ROM Verifier ===');
console.log('ROM      :', romPath);
console.log('Manifest :', manifestPath);
console.log('');

// ---------------------------------------------------------------- inputs
if (!fs.existsSync(romPath)) { console.error('ROM not found:', romPath); process.exit(1); }
if (!fs.existsSync(manifestPath)) { console.error('Manifest not found:', manifestPath); process.exit(1); }
const rom = fs.readFileSync(romPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 1. Source ROM must be pristine.
const sourceSha = crypto.createHash('sha256').update(fs.readFileSync(SOURCE_ROM)).digest('hex').toUpperCase();
check('source ROM unmodified', sourceSha === EXPECTED_SOURCE_SHA256,
  sourceSha === EXPECTED_SOURCE_SHA256 ? '' : `got ${sourceSha}`);
check('manifest was built from that source ROM',
  manifest.sourceRomSha256 === EXPECTED_SOURCE_SHA256,
  manifest.sourceRomSha256 || 'missing');

// 2. Output ROM shape.
check('output ROM is 16 MiB', rom.length === EXPECTED_ROM_SIZE, `${rom.length} bytes`);
const outSha = crypto.createHash('sha256').update(rom).digest('hex').toUpperCase();
check('output ROM differs from source ROM', outSha !== EXPECTED_SOURCE_SHA256);

// 3. Font table pointers.
const fontPtr0 = rom.readUInt32LE(FONT_ENTRY);
const fontSize = rom.readUInt32LE(FONT_ENTRY + 4);
const fontPtr1 = rom.readUInt32LE(FONT_ENTRY + 8);
const fontBase = fontPtr0 - 0x08000000;
const base = manifest.baseGlyphIdDecimal;
const pairCount = manifest.pairCount;
const expectedSize = (base + pairCount) * GLYPH_BYTES;

check('font pointer #1 == #2', fontPtr0 === fontPtr1, `0x${fontPtr0.toString(16)} / 0x${fontPtr1.toString(16)}`);
check('font table is inside the ROM', fontBase > 0 && fontBase + expectedSize <= rom.length,
  `0x${fontBase.toString(16)} .. 0x${(fontBase + expectedSize).toString(16)}`);
check('font size field matches allocation', fontSize === expectedSize,
  `${fontSize} vs expected ${expectedSize}`);
check('manifest font pointer matches ROM', parseInt(manifest.fontPointer, 16) === fontPtr0);

// 4. Glyph collision guard. THIS is the bug that garbled all on-screen text.
const srcRom = fs.readFileSync(SOURCE_ROM);
const fontSrc = parseInt(manifest.fontSourceOffset, 16);
check('pair glyphs start after the last real glyph',
  base >= manifest.originalGlyphCount,
  `baseGlyphId=${base} originalGlyphCount=${manifest.originalGlyphCount}`);
check('pair glyph range does not overlap original glyph range',
  base + pairCount > manifest.originalGlyphCount && base >= manifest.originalGlyphCount,
  `pairs ${base}..${base + pairCount - 1}`);

let preserved = 0;
const corrupted = [];
for (let g = 0; g < manifest.originalGlyphCount; g++) {
  const a = srcRom.subarray(fontSrc + g * GLYPH_BYTES, fontSrc + (g + 1) * GLYPH_BYTES);
  const b = rom.subarray(fontBase + g * GLYPH_BYTES, fontBase + (g + 1) * GLYPH_BYTES);
  if (a.equals(b)) preserved++; else corrupted.push(g);
}
check('all original glyphs preserved byte-for-byte',
  preserved === manifest.originalGlyphCount,
  `${preserved}/${manifest.originalGlyphCount}` + (corrupted.length ? ` corrupted: ${corrupted.slice(0, 8).map(g => '0x' + g.toString(16)).join(',')}` : ''));
if (corrupted.length) {
  for (const g of [0x0162, 0x03d8, 0x0150]) {
    if (corrupted.includes(g)) info(`known-bad glyph 0x${g.toString(16)} is corrupted again`);
  }
}

// 5. Pair slots actually contain data.
let blankPairs = 0;
for (let i = 0; i < pairCount; i++) {
  const g = base + i;
  const b = rom.subarray(fontBase + g * GLYPH_BYTES, fontBase + (g + 1) * GLYPH_BYTES);
  if (b.every(x => x === 0)) blankPairs++;
}
check('pair glyph slots are populated', blankPairs <= pairCount * 0.01,
  `${blankPairs}/${pairCount} blank`);

// 6. Relocated scenes.
const regionStart = parseInt(manifest.scriptRegionStart, 16);
const regionEnd = parseInt(manifest.scriptRegionEnd, 16);
check('script region is inside the ROM', regionStart >= 0x800000 && regionEnd <= rom.length && regionEnd > regionStart,
  `0x${regionStart.toString(16)} .. 0x${regionEnd.toString(16)}`);

let badScenePtr = 0;
const scenePtrSet = new Set();
for (const s of manifest.scenes) {
  const ptr = parseInt(s.romPointer, 16);
  scenePtrSet.add(ptr);
  const off = ptr - 0x08000000;
  if (off < regionStart || off >= regionEnd || (off & 1) !== 0) badScenePtr++;
}
check('every manifest scene points into the relocated region',
  badScenePtr === 0, `${badScenePtr} bad of ${manifest.scenes.length}`);

// 7. Master scene table must be fully redirected.
const originalTable = [];
// Master scene tables strictly reside between 0x2930f4 and 0x2ae0f0.
// Scanning past 0x2ae100 collides with Table 0 asset data (e.g. Asset 0x7a at 0x2bb5a8).
for (let p = 0x290000; p <= 0x2ae100; p += 4) {
  const v = srcRom.readUInt32LE(p);
  if (v >= 0x0800eb40 && v <= 0x0803b1a4 && (v & 1) === 0) {
    const off = v - 0x08000000;
    const w0 = srcRom.readUInt16LE(off);
    if ((w0 & 0xff00) === 0xff00) originalTable.push(p);
  }
}
let redirected = 0, stillOld = 0, dangling = 0;
for (const p of originalTable) {
  const now = rom.readUInt32LE(p);
  if (now === srcRom.readUInt32LE(p)) stillOld++;
  else if (scenePtrSet.has(now)) redirected++;
  else dangling++;
}
check('every master scene pointer was redirected', stillOld === 0 && dangling === 0,
  `${redirected}/${originalTable.length} redirected, ${stillOld} untouched, ${dangling} dangling`);

// 7b. ARM sub-script & map interaction trigger pointers must be redirected.
// If any pointer remains in the 8 MiB range (< 0x08800000), interacting with
// signboards, items, or triggers executes old Japanese bytecode against the
// relocated dual-character font, causing Japanese or corrupt on-screen text.
const CRITICAL_INTERACTION_PTRS = [
  0x934d0, // Case 2 theme park entrance signboard ("Use your speed and spring...")
  0x934d8, // Case 2 theme park entrance secondary signboard
  0x93480, // Map interaction trigger
  0x93488, // Map interaction trigger
  0x93490, // Map interaction trigger
  0x93498, // Map interaction trigger
  0x934b4, // Map interaction trigger
  0x934c0, // Map interaction trigger
  0x934c8, // Map interaction trigger
  0x934e0, // Map interaction trigger
  0x934e8, // Map interaction trigger
  0x934f0, // Map interaction trigger
  0x934f8, // Map interaction trigger
  0x93514  // Map interaction trigger
];

let unredirectedTriggers = 0;
for (const p of CRITICAL_INTERACTION_PTRS) {
  const target = rom.readUInt32LE(p);
  if (target < 0x08800000) {
    unredirectedTriggers++;
  }
}
check('all critical map interaction trigger pointers redirected to English scripts',
  unredirectedTriggers === 0,
  unredirectedTriggers === 0 ? `${CRITICAL_INTERACTION_PTRS.length}/${CRITICAL_INTERACTION_PTRS.length} pointers redirected` : `${unredirectedTriggers} pointer(s) still point to original Japanese ROM`);

// 8. No script token may reference a glyph id that does not exist.
// Glyph ids are < 0x0B00; 0x0B00+ is the opcode space in this engine.
// Known engine opcodes 0xa00/0xa01/0xa02 appear in every script and are
// not glyph references - exclude them to avoid false positives.
const KNOWN_OPCODES = new Set([0x0a00, 0x0a01, 0x0a02]);
let badTokens = 0;
const badTokenValues = {};
const maxGlyphId = base + pairCount;
for (let p = regionStart; p < regionEnd - 1; p += 2) {
  const w = rom.readUInt16LE(p);
  if (w >= maxGlyphId && w < 0x0b00 && !KNOWN_OPCODES.has(w)) {
    badTokens++;
    badTokenValues[w] = (badTokenValues[w] || 0) + 1;
  }
}
check('no relocated token references an undefined glyph', badTokens === 0,
  badTokens === 0 ? '' :
    `${badTokens} bad id(s): ${Object.entries(badTokenValues).map(([v, c]) => '0x' + v.toString(16) + 'x' + c).join(', ')}`);

// 9. Coverage report.
const missing = manifest.missingCount;
const overflow = manifest.overflowCount;
info(`translations: ${manifest.translationsTotal}, injected: ${manifest.injectedCount}, missing: ${missing}, in-place overflow: ${overflow}`);
const epilogue = manifest.missing.filter(m => m.offset && parseInt(m.offset, 16) >= 0x3b796).length;
info(`  of the missing: ${epilogue} in the Case 5 epilogue (0x3b796+), ${missing - epilogue} minigame lines that do not fit in place`);
if (missing > 0) {
  const sample = manifest.missing.slice(0, 5).map(m => `#${m.id}@${m.offset}`).join(', ');
  info(`  first missing: ${sample}`);
}
check('translation coverage complete', missing === 0, `${missing} quote(s) not injected`, true);

// 10. Independent spot-proof: do not trust the manifest's own "injected" list.
// Scene text is relocated, so it must be checked in the relocated region, not at
// the original offset. For every scene that ought to contain English, the
// relocated blob must actually contain pair glyphs. Quotes outside the scene
// area (minigame/system prompts) are patched in place and are checked directly.
{
  const quotesPath = path.resolve(__dirname, '../data/extracted_dialogue.json');
  if (fs.existsSync(quotesPath)) {
    const quotes = JSON.parse(fs.readFileSync(quotesPath, 'utf8'));
    const injected = new Set(manifest.injected);
    const pairLo = base, pairHi = base + pairCount;
    const countPairs = (from, to) => {
      let n = 0;
      for (let p = from; p + 1 < to; p += 2) {
        const w = rom.readUInt16LE(p);
        if (w >= pairLo && w < pairHi) n++;
      }
      return n;
    };

    const scenes = manifest.scenes
      .map(s => ({ orig: parseInt(s.origStart, 16), ptr: parseInt(s.romPointer, 16) - 0x08000000 }))
      .sort((a, b) => a.orig - b.orig);

    let scenesWithEnglish = 0;
    const emptyScenes = [];
    for (let i = 0; i < scenes.length; i++) {
      const from = scenes[i].orig;
      const to = i + 1 < scenes.length ? scenes[i + 1].orig : 0x3b1a4;
      const expected = quotes.some(q => q.byteOffset >= from && q.byteOffset < to && injected.has(q.id));
      if (!expected) continue;
      const relFrom = scenes[i].ptr;
      const relTo = i + 1 < scenes.length ? scenes[i + 1].ptr : regionEnd;
      if (countPairs(relFrom, relTo) > 0) scenesWithEnglish++;
      else emptyScenes.push('0x' + from.toString(16));
    }
    check('every scene containing translated lines holds English glyph pairs',
      emptyScenes.length === 0,
      `${scenesWithEnglish} scene(s) proven` + (emptyScenes.length ? `; empty: ${emptyScenes.slice(0, 8).join(',')}` : ''));

    // Sub-scripts relocated through the pointer table at 0xDC10.
    const subScripts = (manifest.subScripts || [])
      .map(s => ({ orig: parseInt(s.origStart, 16), ptr: parseInt(s.romPointer, 16) - 0x08000000 }))
      .sort((a, b) => a.orig - b.orig);
    let subProven = 0, subBad = [];
    for (let i = 0; i < subScripts.length; i++) {
      const from = subScripts[i].orig;
      const to = i + 1 < subScripts.length ? subScripts[i + 1].orig : from + 0x40;
      const expected = quotes.some(q => q.byteOffset >= from && q.byteOffset < to && injected.has(q.id));
      if (!expected) continue;
      const relTo = i + 1 < subScripts.length ? subScripts[i + 1].ptr : subScripts[i].ptr + 0x100;
      if (countPairs(subScripts[i].ptr, relTo) > 0) subProven++;
      else subBad.push('0x' + from.toString(16));
    }
    check('every relocated sub-script holds English glyph pairs',
      subBad.length === 0,
      `${subProven} proven` + (subBad.length ? `; empty: ${subBad.slice(0, 8).join(',')}` : ''));

    // In-place quotes: the build recorded exactly which IDs it patched in place.
    const inPlaceIds = manifest.inPlaceQuoteIds || [];
    const badInPlace = [];
    for (const id of inPlaceIds) {
      const q = quotes.find(x => x.id === id);
      if (!q) continue;
      if (countPairs(q.byteOffset, q.endOffset + 2) === 0) badInPlace.push(id);
    }
    check('every in-place translated quote holds English glyph pairs',
      badInPlace.length === 0,
      `${inPlaceIds.length - badInPlace.length}/${inPlaceIds.length} proven` +
      (badInPlace.length ? `; suspicious: ${badInPlace.slice(0, 10).join(',')}` : ''));

    // Live minigame sub-script table at 0xDB60..0xDC64 (referenced by 19 code
    // literals). Each entry starts either directly with the 0x001C quote or with
    // a 3-glyph inline speaker name (コナン / 王師範) that the engine draws as
    // part of the text because these scripts never use the FF12 nameplate.
    // Follow the table so relocated entries are checked where they now live.
    const badNames = [];
    let namedScripts = 0;
    for (let p = 0xdb60; p <= 0xdc64; p += 4) {
      const ptr = rom.readUInt32LE(p);
      if (!ptr) continue;
      const s = ptr - 0x08000000;
      if (s < 0 || s + 6 > rom.length) { badNames.push('0x' + p.toString(16) + ':badptr'); continue; }
      const first = rom.readUInt16LE(s);
      if (first === 0x001c || first === 0x0000) continue; // no inline name / empty slot
      namedScripts++;
      const w = [0, 1, 2].map(k => rom.readUInt16LE(s + k * 2));
      if (!w.every(x => x >= pairLo && x < pairHi)) badNames.push('0x' + p.toString(16));
    }
    check('no live minigame sub-script keeps a Japanese inline speaker name',
      badNames.length === 0,
      badNames.length ? `still Japanese: ${badNames.slice(0, 10).join(',')}` : `${namedScripts} named sub-scripts translated`);
  } else {
    info('extracted_dialogue.json not found - skipped independent coverage proof');
  }
}

// ---------------------------------------------------------------- text layout
// The dialogue box shares its first row with the speaker name plate, so the
// plate drawer decides where line 1 starts. The rewrite in
// work/nameplate-patch.mjs must be present byte-for-byte, and the name table it
// reads must be shaped the way it expects.
const NAME_TABLE_DEST = 0xf00000;
const NAME_TABLE_ENTRIES = 58;
const NAME_TABLE_STRIDE = 16;
{
  const problems = verifyNameplatePatch(rom, NAME_TABLE_DEST);
  check('nameplate drawer is the dynamic-width rewrite', problems.length === 0,
    problems.length ? problems.slice(0, 3).join('; ') : '46 halfwords + literal pool match');

  const badPlates = [];
  const blankGlyph = 0x003a;
  let platesWithSpaces = 0;
  for (let i = 0; i < NAME_TABLE_ENTRIES; i++) {
    const base = NAME_TABLE_DEST + i * NAME_TABLE_STRIDE;
    let terminated = false;
    let len = 0;
    for (let k = 0; k < 8; k++) {
      const code = rom.readUInt16LE(base + k * 2);
      if (terminated) {
        if (code !== 0x0000) badPlates.push(`entry ${i}: glyph after terminator`);
        continue;
      }
      if (code === 0x0000) { terminated = true; continue; }
      len++;
      if (code >= manifest.originalGlyphCount) badPlates.push(`entry ${i}: glyph 0x${code.toString(16)} is not a base-font glyph`);
      if (code === blankGlyph) platesWithSpaces++;
    }
    if (!terminated && len !== 8) badPlates.push(`entry ${i}: ${len} glyphs and no terminator`);
  }
  check('name plates are terminated and use base-font glyphs', badPlates.length === 0,
    badPlates.length ? badPlates.slice(0, 5).join('; ') : `${NAME_TABLE_ENTRIES} entries, ${platesWithSpaces} blank separator glyphs`);
}

// 9. UI and Gadget streams must not use distance-1 LZ77 copies: the VRAM
//    decompressor decodes disp=0 to stale VRAM, causing horizontal striped corruption.
{
  const bad = [];
  for (const id of [0x3205, 0x3206, 0x3219, 0xc58, 0xc59, 0xc5b, 0xc5c]) {
    const entry = TABLE0 + id * 8;
    const ptr = rom.readUInt32LE(entry + 4) & 0x1ffffff;
    if (ptr + 4 > rom.length || rom[ptr] !== 0x10) { bad.push(`0x${id.toString(16)}: not LZ77`); continue; }
    const outLen = rom[ptr + 1] | (rom[ptr + 2] << 8) | (rom[ptr + 3] << 16);
    let p = ptr + 4, o = 0, d1 = 0;
    while (o < outLen && p < rom.length) {
      const flags = rom[p++];
      for (let bit = 7; bit >= 0 && o < outLen; bit--) {
        if (flags & (1 << bit)) {
          const b0 = rom[p++], b1 = rom[p++];
          const dist = (((b0 & 0xf) << 8) | b1) + 1;
          if (dist === 1) d1++;
          o += (b0 >> 4) + 3;
        } else { p++; o++; }
      }
    }
    if (d1 > 0) bad.push(`0x${id.toString(16)}: ${d1} distance-1 token(s)`);
  }
  check('UI and Gadget assets contain no distance-1 LZ77 copies', bad.length === 0,
    bad.length ? bad.join('; ') : '0x3205 / 0x3206 / 0x3219 / 0xc58 / 0xc59 / 0xc5b / 0xc5c clean');
}

// ---------------------------------------------------------------- summary
const hardFails = results.filter(r => !r.ok && !r.soft);
const gaps = results.filter(r => !r.ok && r.soft);
console.log('');
console.log(`=== ${results.filter(r => r.ok).length}/${results.length} checks passed, ${hardFails.length} failure(s), ${gaps.length} known gap(s) ===`);
for (const f of hardFails) console.log('  FAILED:', f.name, f.detail ? '- ' + f.detail : '');
if (gaps.length && strict) {
  for (const g of gaps) console.log('  STRICT:', g.name, g.detail ? '- ' + g.detail : '');
  process.exit(2);
}
process.exit(hardFails.length ? 1 : 0);
