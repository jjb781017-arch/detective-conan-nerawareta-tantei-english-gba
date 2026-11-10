// Section 11c: Rebuild the epilogue riddle-card table (101 cards).
//
// Table layout: base 0x3b1b0, 303 entries = 101 cards x 3 pointers:
//   +0 -> question text   (rendered by FUN_08048598 -> FUN_08040b14)
//   +4 -> answer field    (never rendered; FUN_08048850 reads it as
//                          N=kana length, N hiragana glyphs, then display text)
//   +8 -> explanation     (rendered by the function at 0x48710 -> FUN_08040b14)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EPILOGUE_TABLE_BASE = 0x3b1b0;
export const EPILOGUE_CARD_COUNT = 101;
export const EPILOGUE_TABLE_SCRATCH_START = 0x850000;
export const EPILOGUE_TABLE_SCRATCH_END = 0x860000;

const TRANSLATIONS_PATH = path.resolve(__dirname, '../data/epilogue-translations.json');

export function loadEpilogueTranslations() {
  const data = JSON.parse(fs.readFileSync(TRANSLATIONS_PATH, 'utf8'));
  if (data.length !== EPILOGUE_CARD_COUNT) {
    throw new Error(`epilogue-translations.json must hold ${EPILOGUE_CARD_COUNT} cards, got ${data.length}`);
  }
  const byCard = new Map();
  for (const card of data) {
    if (byCard.has(card.card)) throw new Error(`duplicate card ${card.card}`);
    byCard.set(card.card, card);
  }
  for (let i = 0; i < EPILOGUE_CARD_COUNT; i++) {
    if (!byCard.has(i)) throw new Error(`missing card ${i}`);
  }
  return byCard;
}

// Formats riddle text with clean left padding and vertical optical centering
export function formatRiddleText(text, isQuestion = false) {
  const rawLines = String(text).split('\n');
  // 2 leading spaces (12px) prevents text from hugging the left blue border
  const indented = rawLines.map(l => (l.length > 0 ? '  ' + l : l));
  // If the question is short (<= 3 lines), prepend 1 blank line so it's vertically centered
  if (isQuestion && rawLines.length <= 3) {
    indented.unshift('');
  }
  return indented.join('\n');
}

// Plain riddle text -> glyph words.  '\n' becomes a single 0xFF02 word.
export function encodeRiddleString(text, encodeLinePairs) {
  const words = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) words.push(0xff02);
    if (lines[i].length > 0) {
      for (const tok of encodeLinePairs(lines[i])) words.push(tok);
    }
  }
  words.push(0xff00);
  return words;
}

// Must run before the font table is burned so every pair used by the riddle
// cards gets a glyph slot.
export function registerEpiloguePairs(encodeLinePairs) {
  const byCard = loadEpilogueTranslations();
  let lines = 0;
  for (const card of byCard.values()) {
    const qText = formatRiddleText(card.q, true);
    const eText = formatRiddleText(card.e, false);
    for (const fieldText of [qText, eText]) {
      for (const line of fieldText.split('\n')) {
        if (!line) continue;
        encodeLinePairs(line);
        lines++;
      }
    }
  }
  return { cards: byCard.size, lines };
}

export function patchEpilogueRiddleTable(rom, cleanRom, encodeLinePairs) {
  const byCard = loadEpilogueTranslations();

  // 1. Restore all 303 entries from the untouched source ROM.
  for (let i = 0; i < EPILOGUE_CARD_COUNT * 3; i++) {
    rom.writeUInt32LE(cleanRom.readUInt32LE(EPILOGUE_TABLE_BASE + i * 4), EPILOGUE_TABLE_BASE + i * 4);
  }

  // 2. Write each distinct string once and repoint the Q / E entries.
  let cursor = EPILOGUE_TABLE_SCRATCH_START;
  const placed = new Map(); // text -> file offset
  let repointed = 0;
  const missing = [];

  const emit = (text) => {
    if (placed.has(text)) return placed.get(text);
    const words = encodeRiddleString(text, encodeLinePairs);
    const bytes = words.length * 2;
    if (cursor + bytes > EPILOGUE_TABLE_SCRATCH_END) {
      throw new Error(`epilogue scratch overflow at 0x${cursor.toString(16)}`);
    }
    const dest = cursor;
    for (let i = 0; i < words.length; i++) rom.writeUInt16LE(words[i], dest + i * 2);
    cursor += bytes;
    while (cursor % 4 !== 0) cursor++;
    placed.set(text, dest);
    return dest;
  };

  for (let card = 0; card < EPILOGUE_CARD_COUNT; card++) {
    const entry = byCard.get(card);
    // Card 0 is the blank placeholder; leave it pointing at its original data.
    if (card === 0) continue;
    const qText = formatRiddleText(entry.q, true);
    const eText = formatRiddleText(entry.e, false);
    const fields = [
      [0, qText],
      [2, eText],
    ];
    for (const [slot, text] of fields) {
      if (!text || !text.trim()) {
        missing.push(`card ${card} slot ${slot}`);
        continue;
      }
      const dest = emit(text);
      rom.writeUInt32LE(0x08000000 + dest, EPILOGUE_TABLE_BASE + (card * 3 + slot) * 4);
      repointed++;
    }
  }

  return {
    cards: EPILOGUE_CARD_COUNT,
    repointed,
    uniqueStrings: placed.size,
    scratchStart: '0x' + EPILOGUE_TABLE_SCRATCH_START.toString(16),
    scratchEnd: '0x' + cursor.toString(16),
    bytesUsed: cursor - EPILOGUE_TABLE_SCRATCH_START,
    missing,
  };
}
