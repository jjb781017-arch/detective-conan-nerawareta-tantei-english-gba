// work/quote-name-index.mjs
//
// Which speaker name plate does each dialogue box draw?
//
// The dialogue engine keeps the current name index in one byte of IWRAM
// (0x030000B5). The 0xFF12 opcode handler (FUN_08041cdc, table entry 0x12 at
// 0x08292f58) copies operand byte +5 of the opcode into that byte:
//
//     0x41CFE  ldr  r0,[pc,#0x8C]   ; 0x030000B5
//     0x41D00  mov  r1,r9           ; r9 = opcode byte +5
//     0x41D02  strb r1,[r0,#0]
//
// Nothing clears it per box, so a box without its own 0xFF12 keeps the previous
// speaker. It is only cleared by the dialogue-start init (0x40A4A: ldr r0,
// [pc,#0x3C] -> 0x030000B5 ; strb r2,[r0,#0] with r2 = 0), which the scripts
// bracket with the 0xFFFF scene terminator.
//
// This module replays that rule over the pristine ROM so the paginator can give
// every box the line-1 width its real name plate leaves. Both the build and the
// width checker use it, so the layout they assume can never drift apart.

import path from 'path';
import fs from 'fs';
import { l1MaxForName, L1_MAX } from './paginate.mjs';

/** `nameLen` used when no name plate is drawn at all (name index 0). */
export const NO_NAME = -1;

/** Minigame sub-scripts draw a literal 3-glyph speaker name inside the text. */
export const INLINE_NAME_LEN = 3;

/** Quotes 46..60 are the sub-scripts that carry a 3-glyph inline speaker name. */
export const INLINE_NAME_MAX_ID = 60;
export const INLINE_NAME_MIN_ID = 46;

/**
 * Replay the engine's name-index rule over the clean ROM.
 * @returns {Map<number, number>} quote id -> speaker name index (0 = no plate)
 */
export function buildQuoteNameIndex(cleanRomPath, quotesPath) {
  const clean = fs.readFileSync(cleanRomPath);
  const quotes = JSON.parse(fs.readFileSync(quotesPath, 'utf8'));

  const byOffset = new Map();
  for (const q of quotes) byOffset.set(q.byteOffset, q);

  const quoteToName = new Map();
  let last = 0;
  for (let p = 0x4000; p < 0x40000; p += 2) {
    const w = clean.readUInt16LE(p);
    if (w === 0xff12) {
      last = clean[p + 5];
      p += 6; // the opcode is 8 bytes: opcode + 3 operands
      continue;
    }
    if (w === 0xffff) { last = 0; continue; }
    const q = byOffset.get(p);
    if (q) quoteToName.set(q.id, last);
  }
  return quoteToName;
}

/**
 * @returns {Map<number, number>} name index -> English plate length (0 = blank)
 */
export function buildNameLenByIndex(platesPath) {
  const plates = JSON.parse(fs.readFileSync(platesPath, 'utf8'));
  const m = new Map();
  for (const p of plates) {
    m.set(p.name_index, (p.english || '').toUpperCase().trim().length);
  }
  return m;
}

/**
 * Build the per-quote line-1 character budget.
 *
 * The name plate drawer (FUN_08041090) now stops at the table's 0x0000
 * terminator, which is itself drawn as one blank 12 px slot, so:
 *
 *   line 1 x = 8 + 12 * min(nameLen + 1, 9)
 *
 * `NO_NAME` (-1) means the plate is skipped entirely and text starts at x = 8.
 */
export function makeL1Budget(quoteNameIndex, nameLenByIndex) {
  return function l1MaxForQuote(q) {
    if (!q) return L1_MAX;
    if (q.id >= INLINE_NAME_MIN_ID && q.id <= INLINE_NAME_MAX_ID) {
      return l1MaxForName(INLINE_NAME_LEN);
    }
    const idx = quoteNameIndex.get(q.id);
    if (idx === undefined) return L1_MAX; // unknown: keep the safe default
    if (idx === 0) return l1MaxForName(NO_NAME);
    const len = nameLenByIndex.get(idx);
    return l1MaxForName(len === undefined ? NO_NAME : len);
  };
}

/** Convenience wrapper used by the standalone checker. */
export function loadL1Budget(cleanRomOrRoot, quotesPath, platesPath) {
  const cleanRomPath = fs.existsSync(cleanRomOrRoot) && fs.statSync(cleanRomOrRoot).isFile()
    ? cleanRomOrRoot
    : path.resolve(cleanRomOrRoot, 'Meitantei Conan - Nerawareta Tantei.gba');
  const quoteNameIndex = buildQuoteNameIndex(cleanRomPath, quotesPath);
  const nameLenByIndex = buildNameLenByIndex(platesPath);
  return { quoteNameIndex, nameLenByIndex, l1MaxForQuote: makeL1Budget(quoteNameIndex, nameLenByIndex) };
}
