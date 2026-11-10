// Regression check for dialogue-box line widths.
//
// Geometry, measured from in-game captures and from the engine's text renderer:
//
//   * Glyph tiles are 12x12px and the renderer hard-clips at x=240
//     (FUN_08040c8c sets width 0x0C, limit 0xF0). The clip mode byte is 0
//     (FUN_08040cb0(0)), so text past 240px is CUT OFF / TRUNCATED, not wrapped.
//   * A dialogue box line 1 shares its row with the speaker name plate. With
//     longer names the text starts further right, leaving fewer tiles.
//   * Line 2 starts at the box margin (x~8) and fits up to 17 tiles = 34 characters.
//
// QUOTES are re-paginated by the build (src/paginate.mjs) and checked against
// the paginator's own budgets. Line 1 is per-quote: the speaker name plate is
// drawn into the text cursor, so a short name leaves more room (see
// src/quote-name-index.mjs, which replays the engine's name-index rule).
//
// NARRATION spans are NOT re-paginated: their '\n' breaks are hard. A fixed
// budget would be wrong for them because whether a name plate is drawn varies
// per box. Instead the budget per line is
//
//     max(worst-case geometry, width the ORIGINAL Japanese line used)
//
// The original line width is a proof: if the retail game drew N tiles on that
// line of that box, N tiles fit there. The geometry floor covers boxes whose
// Japanese line happened to be short.
//
// Usage: node src/check-box-widths.mjs   (exit 1 if any line is over)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { paginateDualText, L1_MAX, L2_MAX } from './paginate.mjs';
import { loadL1Budget } from './quote-name-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cleanCandidates = [
  process.env.CONAN_CLEAN_ROM,
  path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba'),
  path.resolve(__dirname, '../../Meitantei Conan - Nerawareta Tantei.gba'),
].filter(Boolean);

let cleanRomPath = cleanCandidates.find(p => fs.existsSync(p));
if (!cleanRomPath) {
  console.error('Error: Clean ROM not found.');
  console.error('Please place "Meitantei Conan - Nerawareta Tantei.gba" in the repo directory or set CONAN_CLEAN_ROM.');
  process.exit(1);
}

const quotesPath = path.resolve(__dirname, '../data/dialogue_translations.json');
const extractedPath = path.resolve(__dirname, '../data/extracted_dialogue.json');
const narrationPath = path.resolve(__dirname, '../data/narration_translations.json');
const platesPath = path.resolve(__dirname, '../data/speaker_nameplates.json');

const clean = fs.readFileSync(cleanRomPath);
const quotes = JSON.parse(fs.readFileSync(quotesPath, 'utf8'));
const narration = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));
const { l1MaxForQuote } = loadL1Budget(cleanRomPath, extractedPath, platesPath);

// Worst-case measured geometry, in tiles (2 characters per pair glyph).
const NAR_L1_FLOOR = 9;      // plate row, AGASA case
const NAR_L2_FLOOR = 14;     // box margin
const NAR_LABEL_FLOOR = 20;  // centred banner, full screen width

// Operand counts, from the decompiled handlers. FF12 is 3 params, or 4 when the
// high byte of its first param is 2 (FUN_08041cdc).
const ARITY = {
  0xff00: 0, 0xff01: 0, 0xff02: 0, 0xff03: 0, 0xff04: 3, 0xff05: 1, 0xff06: 1,
  0xff07: 2, 0xff08: 1, 0xff09: 1, 0xff0a: 1, 0xff0b: 1, 0xff0c: 1, 0xff0d: 0,
  0xff0e: 0, 0xff0f: 0, 0xff10: 1, 0xff11: 3, 0xff13: 4, 0xff14: 1, 0xff15: 1,
  0xff16: 0, 0xff17: 0, 0xff18: 1, 0xff19: 1, 0xff1a: 4, 0xff1b: 4, 0xff1c: 4,
  0xff1d: 0, 0xff1e: 0, 0xff1f: 1, 0xff20: 1, 0xff21: 1, 0xff22: 1, 0xff23: 1,
  0xff24: 3, 0xff25: 1, 0xff26: 1, 0xff27: 1, 0xff28: 1, 0xff29: 1,
};

function opArity(p) {
  const w = clean.readUInt16LE(p);
  if (w === 0xff12) return clean.readUInt16LE(p + 2) >> 8 === 2 ? 4 : 3;
  return ARITY[w];
}

// Tiles per line of the original span. Every non-opcode word is one 12px tile,
// including 0x0000 (the space glyph). 0xFF02 starts a new line.
function originalTilesPerLine(start, end) {
  const tiles = [0];
  for (let p = start; p < end; ) {
    const w = clean.readUInt16LE(p);
    if (w === 0xff02) { tiles.push(0); p += 2; continue; }
    const n = opArity(p);
    if (n !== undefined) { p += (n + 1) * 2; continue; }
    tiles[tiles.length - 1]++;
    p += 2;
  }
  return tiles;
}

// Pair glyphs are 2 characters per 12px tile.
const tiles = (line) => Math.ceil(line.length / 2);

const problems = [];
let quoteLines = 0;
let quoteBoxes = 0;
let narLines = 0;

for (const q of quotes) {
  const text = (q.english || '').trim();
  if (!text) continue;
  const l1Max = l1MaxForQuote(q);
  const boxes = paginateDualText(text, l1Max);
  quoteBoxes += boxes.length;
  for (const box of boxes) {
    for (let li = 0; li < box.length; li++) {
      const line = box[li];
      const max = li === 0 ? l1Max : L2_MAX;
      quoteLines++;
      if (line.length > max) {
        problems.push({ kind: 'OVER', id: `q${q.id}`, line: li + 1, len: line.length, max, text: line });
      }
      for (const word of line.split(' ')) {
        if (word.length > max) {
          problems.push({ kind: 'WORD', id: `q${q.id}`, line: li + 1, len: word.length, max, text: word });
        }
      }
    }
  }
}

for (const n of narration) {
  const isLabel = n.wrapper === '0xff02';
  const orig = originalTilesPerLine(parseInt(n.offset, 16), parseInt(n.endOffset, 16));
  const origMax = Math.max(...orig);
  const lines = String(n.english || '').split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    narLines++;
    const floor = isLabel ? NAR_LABEL_FLOOR : li === 0 ? NAR_L1_FLOOR : NAR_L2_FLOOR;
    const proved = orig[li] !== undefined ? orig[li] : origMax;
    const budget = Math.max(floor, proved); // tiles
    const maxChars = budget * 2;
    if (line.length > maxChars) {
      problems.push({
        kind: 'OVER', id: `nar${n.index}@${n.offset}`, line: li + 1,
        len: line.length, max: maxChars, text: line,
      });
    }
    for (const word of line.split(' ')) {
      if (word.length > maxChars) {
        problems.push({
          kind: 'WORD', id: `nar${n.index}@${n.offset}`, line: li + 1,
          len: word.length, max: maxChars, text: word,
        });
      }
    }
  }
}

const budgetHistogram = new Map();
for (const q of quotes) {
  if (!(q.english || '').trim()) continue;
  const k = l1MaxForQuote(q);
  budgetHistogram.set(k, (budgetHistogram.get(k) || 0) + 1);
}
console.log(`quotes checked : ${quotes.length} (${quoteBoxes} boxes, ${quoteLines} lines)`);
console.log(`narration      : ${narration.length} spans (${narLines} lines)`);
console.log(`quote limits   : line 1 per speaker name (${[...budgetHistogram.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}ch x${v}`).join(', ')}), line 2 <= ${L2_MAX} chars`);
console.log(`               : default worst case line 1 <= ${L1_MAX} chars (7-glyph name)`);
console.log(`narration rule : budget = max(${NAR_L1_FLOOR} tiles, original line width); floor ${NAR_L2_FLOOR} for later lines, ${NAR_LABEL_FLOOR} for labels`);
console.log(`problems       : ${problems.length}`);

for (const p of problems.slice(0, 200)) {
  console.log(`  ${p.kind.padEnd(4)} ${p.id.padEnd(22)} line ${p.line} ${p.len} chars (${tiles(p.text)} tiles) > ${p.max}  ${JSON.stringify(p.text)}`);
}
if (problems.length > 200) console.log(`  ... and ${problems.length - 200} more`);

if (problems.length) process.exitCode = 1;

