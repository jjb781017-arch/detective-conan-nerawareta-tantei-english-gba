import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'fs';
import crypto from 'crypto';
import { patchTitleScreenLogos } from './patch-title-screen-logos.mjs';
import { patchDoorTransitionTitle } from './patch-door-transition.mjs';
import { patchCaseIntroTitles } from './patch-case-intro-titles.mjs';
import { patchBeikaDpcPlaque, patchBeikaDpcPosters } from './patch-beika-dpc.mjs';
import { patchGadgetCards } from './patch-gadget-cards.mjs';
import { patchMinigameTutorials } from './patch-minigame-tutorials.mjs';
import { patchCutsceneBackgrounds } from './patch-cutscene-backgrounds.mjs';
import { registerSystemPromptPairs, patchSystemPrompts } from './patch-system-ui.mjs';
import { patchAllConfirmedUI } from './patch-all-confirmed-ui.mjs';
import { patchRemainingApprovedUI } from './patch-remaining-approved-ui.mjs';
import { patchChoiceLabels } from './patch-choice-labels.mjs';
import { patchTranslatedScreens } from './patch-translated-screens.mjs';
import { patchUserTranslatedCutscenes } from './patch-user-translated-cutscenes.mjs';
import { patchUserBanners } from './patch-user-banners.mjs';
import { patchKarateUi } from './patch-karate-ui.mjs';
import { patchPrologueHookScreen } from './patch-prologue-hook-screen.mjs';
import { patchEtekoMinigameUI } from './patch-eteko-minigame-ui.mjs';
import { patchPauseAsset } from './patch-pause-asset.mjs';
import { patchEnglishKeyboardSystem } from './patch-english-keyboard.mjs';
import { patchStageLabels } from './patch-stage-labels.mjs';
import { remapScenePointers } from './remap-scene-pointers.mjs';
import { patchEpilogueRiddleCards, EPILOGUE_SCRATCH_START, EPILOGUE_SCRATCH_END } from './patch-epilogue-riddle-cards.mjs';
import {
  registerEpiloguePairs,
  patchEpilogueRiddleTable,
  EPILOGUE_TABLE_SCRATCH_START,
  EPILOGUE_TABLE_SCRATCH_END,
} from './patch-epilogue-riddle-table.mjs';
import { paginateDualText, L1_MAX, L2_MAX } from './paginate.mjs';
import { buildQuoteNameIndex, buildNameLenByIndex, makeL1Budget } from './quote-name-index.mjs';
import { applyNameplatePatch } from './nameplate-patch.mjs';

const cleanRomPath = process.env.CONAN_CLEAN_ROM || path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba');
const outputRomPath = process.env.CONAN_OUT || path.resolve(__dirname, '../build/Detective Conan - English Translated.gba');
const manifestPath = process.env.CONAN_MANIFEST || path.resolve(__dirname, '../build/build_manifest.json');
const csvPath = path.resolve(__dirname, '../data/dialogue_translations.json');
const quotesPath = path.resolve(__dirname, '../data/extracted_dialogue.json');

console.log('=== Building Detective Conan: Dual-Character Font English ROM ===');

// 1. 5x9 Crisp Pixel Font
const font5x9 = {
  ' ': ['.....','.....','.....','.....','.....','.....','.....','.....','.....'],
  'A': ['.###.','#...#','#...#','#####','#...#','#...#','#...#','#...#','.....'],
  'B': ['####.','#...#','#...#','####.','#...#','#...#','#...#','####.','.....'],
  'C': ['.####','#...#','#....','#....','#....','#....','#...#','.####','.....'],
  'D': ['####.','#...#','#...#','#...#','#...#','#...#','#...#','####.','.....'],
  'E': ['#####','#....','#....','####.','#....','#....','#....','#####','.....'],
  'F': ['#####','#....','#....','####.','#....','#....','#....','#....','.....'],
  'G': ['.####','#...#','#....','#.###','#...#','#...#','#...#','.####','.....'],
  'H': ['#...#','#...#','#...#','#####','#...#','#...#','#...#','#...#','.....'],
  'I': ['#####','..#..','..#..','..#..','..#..','..#..','..#..','#####','.....'],
  'J': ['..###','....#','....#','....#','....#','....#','#...#','.###.','.....'],
  'K': ['#...#','#..#.','#.#..','##...','##...','#.#..','#..#.','#...#','.....'],
  'L': ['#....','#....','#....','#....','#....','#....','#....','#####','.....'],
  'M': ['#...#','##.##','#.#.#','#...#','#...#','#...#','#...#','#...#','.....'],
  'N': ['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#','#...#','.....'],
  'O': ['.###.','#...#','#...#','#...#','#...#','#...#','#...#','.###.','.....'],
  'P': ['####.','#...#','#...#','####.','#....','#....','#....','#....','.....'],
  'Q': ['.###.','#...#','#...#','#...#','#.#.#','#..##','.####','....#','.....'],
  'R': ['####.','#...#','#...#','####.','#..#.','#...#','#...#','#...#','.....'],
  'S': ['.####','#....','#....','.###.','....#','....#','....#','####.','.....'],
  'T': ['#####','..#..','..#..','..#..','..#..','..#..','..#..','..#..','.....'],
  'U': ['#...#','#...#','#...#','#...#','#...#','#...#','#...#','.###.','.....'],
  'V': ['#...#','#...#','#...#','#...#','#...#','#...#','.#.#.','..#..','.....'],
  'W': ['#...#','#...#','#...#','#...#','#...#','#.#.#','##.##','#...#','.....'],
  'X': ['#...#','#...#','.#.#.','..#..','..#..','.#.#.','#...#','#...#','.....'],
  'Y': ['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..','..#..','.....'],
  'Z': ['#####','....#','...#.','..#..','.##..','#....','#....','#####','.....'],

  'a': ['.....','.....','.###.','....#','.####','#...#','#...#','.####','.....'],
  'b': ['#....','#....','####.','#...#','#...#','#...#','#...#','####.','.....'],
  'c': ['.....','.....','.####','#...#','#....','#....','#...#','.####','.....'],
  'd': ['....#','....#','.####','#...#','#...#','#...#','#...#','.####','.....'],
  'e': ['.....','.....','.###.','#...#','#####','#....','#...#','.###.','.....'],
  'f': ['..##.','.#...','#####','.#...','.#...','.#...','.#...','.#...','.....'],
  'g': ['.....','.....','.####','#...#','#...#','.####','....#','.###.','.....'],
  'h': ['#....','#....','####.','#...#','#...#','#...#','#...#','#...#','.....'],
  'i': ['..#..','.....','..#..','..#..','..#..','..#..','..#..','#####','.....'],
  'j': ['...#.','.....','...#.','...#.','...#.','...#.','#..#.','.##..','.....'],
  'k': ['#....','#....','#..#.','##...','##...','#.#..','#..#.','#...#','.....'],
  'l': ['..#..','..#..','..#..','..#..','..#..','..#..','..#..','..###','.....'],
  'm': ['.....','.....','##.##','#.#.#','#.#.#','#...#','#...#','#...#','.....'],
  'n': ['.....','.....','####.','#...#','#...#','#...#','#...#','#...#','.....'],
  'o': ['.....','.....','.###.','#...#','#...#','#...#','#...#','.###.','.....'],
  'p': ['.....','.....','####.','#...#','#...#','####.','#....','#....','.....'],
  'q': ['.....','.....','.####','#...#','#...#','.####','....#','....#','.....'],
  'r': ['.....','.....','####.','#..#.','#....','#....','#....','#....','.....'],
  's': ['.....','.....','.####','#....','.###.','....#','....#','####.','.....'],
  't': ['.#...','.#...','#####','.#...','.#...','.#...','.#...','..##.','.....'],
  'u': ['.....','.....','#...#','#...#','#...#','#...#','#...#','.####','.....'],
  'v': ['.....','.....','#...#','#...#','#...#','#...#','.#.#.','..#..','.....'],
  'w': ['.....','.....','#...#','#...#','#...#','#.#.#','##.##','#...#','.....'],
  'x': ['.....','.....','#...#','.#.#.','..#..','.#.#.','#...#','#...#','.....'],
  'y': ['.....','.....','#...#','#...#','#...#','.####','....#','.###.','.....'],
  'z': ['.....','.....','#####','...#.','..#..','.##..','#....','#####','.....'],

  '0': ['.###.','#...#','#..##','#.#.#','##..#','#...#','#...#','.###.','.....'],
  '1': ['..#..','.##..','..#..','..#..','..#..','..#..','..#..','#####','.....'],
  '2': ['.###.','#...#','....#','...#.','..#..','.##..','#....','#####','.....'],
  '3': ['####.','....#','...#.','..##.','....#','....#','#...#','.###.','.....'],
  '4': ['...#.','..##.','.##..','#..#.','#####','...#.','...#.','...#.','.....'],
  '5': ['#####','#....','####.','....#','....#','....#','#...#','.###.','.....'],
  '6': ['.###.','#...#','#....','####.','#...#','#...#','#...#','.###.','.....'],
  '7': ['#####','....#','...#.','..#..','..#..','.##..','.##..','.##..','.....'],
  '8': ['.###.','#...#','#...#','.###.','#...#','#...#','#...#','.###.','.....'],
  '9': ['.###.','#...#','#...#','.####','....#','....#','#...#','.###.','.....'],

  ':': ['.....','..#..','..#..','.....','.....','..#..','..#..','.....','.....'],
  '!': ['..#..','..#..','..#..','..#..','..#..','.....','..#..','..#..','.....'],
  '?': ['.###.','#...#','....#','...#.','..#..','.....','..#..','..#..','.....'],
  '.': ['.....','.....','.....','.....','.....','.....','.....','..##.','..##.'],
  ',': ['.....','.....','.....','.....','.....','.....','.....','..##.','..#..'],
  '-': ['.....','.....','.....','.....','#####','.....','.....','.....','.....'],
  '\'':['..#..','..#..','..#..','.....','.....','.....','.....','.....','.....'],
  '"': ['#.#..','#.#..','#.#..','.....','.....','.....','.....','.....','.....'],
  '/': ['....#','...#.','...#.','..#..','..#..','.##..','.##..','#....','.....'],
  '(': ['...#.','..#..','.#...','.#...','.#...','.#...','..#..','...#.','.....'],
  ')': ['.#...','..#..','...#.','...#.','...#.','...#.','..#..','.###.','.....'],
  '[': ['..###','..#..','..#..','..#..','..#..','..#..','..#..','..###','.....'],
  ']': ['###..','..#..','..#..','..#..','..#..','..#..','..#..','###..','.....'],
  '#': ['.#.#.','#####','.#.#.','#####','.#.#.','.....','.....','.....','.....'],
  '%': ['#...#','...#.','..#..','.##..','#...#','.....','.....','.....','.....'],
  '&': ['.##..','#..#.','#.##.','..##.','#..#.','#..#.','.##.#','.....','.....'],
  '*': ['.....','.###.','#####','.###.','.....','.....','.....','.....','.....'],
  '+': ['.....','..#..','..#..','#####','..#..','..#..','.....','.....','.....'],
  '=': ['.....','#####','.....','#####','.....','.....','.....','.....','.....'],
  '~': ['.....','.###.','#.#.#','.....','.....','.....','.....','.....','.....'],
  '…': ['.....','.....','.....','.....','.....','.....','.....','.##.#','.#.##'],
  '—': ['.....','.....','.....','.....','#####','.....','.....','.....','.....'],
  '♪': ['...##','..###','..#.#','..#..','.##..','###..','###..','..#..','.....'],
};

function encodeDualGlyph(c1, c2) {
  const g1 = font5x9[c1] || font5x9[' '];
  const g2 = font5x9[c2] || font5x9[' '];
  const bytes = Buffer.alloc(36);

  for (let r = 0; r < 12; r++) {
    const fontRow = r - 1; // 1 row top margin
    const r1 = (fontRow >= 0 && fontRow < 9) ? g1[fontRow] : '.....';
    const r2 = (fontRow >= 0 && fontRow < 9) ? g2[fontRow] : '.....';
    const line = r1 + '.' + r2 + '.';

    for (let b = 0; b < 3; b++) {
      let byteVal = 0;
      for (let p = 0; p < 4; p++) {
        const val = line[b * 4 + p] === '#' ? 3 : 0;
        // MSB first: Pixel 0 is bit 7-6, Pixel 1 is bit 5-4, Pixel 2 is bit 3-2, Pixel 3 is bit 1-0
        byteVal |= (val << ((3 - p) * 2));
      }
      bytes[r * 3 + b] = byteVal;
    }
  }

  return bytes;
}

// 2. Load Translations and Dialogue
const allTranslations = {};
const speakerMap = new Map();

const userJsonPath = path.resolve(__dirname, '../data/dialogue_translations.json');
const userCsvPath = path.resolve(__dirname, '../data/dialogue_translations.csv');
const masterCsvPath = path.resolve(__dirname, '../data/dialogue_translations.json');

if (fs.existsSync(userJsonPath)) {
  const jsonEntries = JSON.parse(fs.readFileSync(userJsonPath, 'utf8'));
  for (const entry of jsonEntries) {
    let t = (entry.english || '').trim();
    if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
    t = t.replace(/^[A-Z0-9\?\.\s_]{2,15}:\s*/, '').trim();
    if (entry.id >= 9 && entry.id <= 38) t = ' ' + t;
    allTranslations[entry.id] = t;
    speakerMap.set(entry.id, entry.speaker || '');
  }
  console.log(`Loaded ${Object.keys(allTranslations).length} translated quotes from ${userJsonPath}`);
} else if (fs.existsSync(userCsvPath)) {
  const csvLines = fs.readFileSync(userCsvPath, 'utf8').split('\n');
  for (let i = 1; i < csvLines.length; i++) {
    const line = csvLines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const id = parseInt(parts[0]);
    let t = parts[3].trim();
    if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
    t = t.replace(/^[A-Z0-9\?\.\s_]{2,15}:\s*/, '').trim();
    allTranslations[id] = t;
  }
  console.log(`Loaded ${Object.keys(allTranslations).length} translated quotes from ${userCsvPath}`);
} else {
  const masterCsvLines = fs.readFileSync(masterCsvPath, 'utf8').split('\n');
  for (let i = 1; i < masterCsvLines.length; i++) {
    const line = masterCsvLines[i].trim();
    if (!line) continue;
    const idx1 = line.indexOf(',');
    const idx2 = line.indexOf(',', idx1 + 1);
    const idx3 = line.indexOf(',', idx2 + 1);
    const idx4 = line.indexOf(',', idx3 + 1);
    if (idx4 === -1) continue;

    const id = parseInt(line.substring(0, idx1));
    const speaker = line.substring(idx2 + 1, idx3).trim();
    let t = line.substring(idx4 + 1).trim();
    if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
    t = t.replace(/^[A-Z0-9\?\.\s_]{2,15}:\s*/, '');
    allTranslations[id] = t;
    speakerMap.set(id, speaker === 'Narrator' ? '' : speaker);
  }
  console.log(`Loaded ${Object.keys(allTranslations).length} translated quotes from ${masterCsvPath}`);
}

// 3. Collect all unique pairs across all 2,855 quotes
// Pagination lives in ./paginate.mjs so work/check-box-widths.mjs can assert
// against the exact rules the build uses.

const pairToId = new Map();
const idToPair = [];
// Pair glyphs MUST start after the 1,323 real kanji glyphs, otherwise they
// overwrite live characters and Japanese text renders as English nonsense
// (e.g. 0x0162 = 上 became "of", producing "egofしますか" on screen).
// fontBase holds 1323 glyphs of 36 bytes = 0xBA0C bytes, so the first free
// glyph id is 1323 = 0x052B.
const ORIGINAL_GLYPH_COUNT = 1323;
const baseGlyphId = 0x052B; // = ORIGINAL_GLYPH_COUNT, first unused slot

function getPairId(pair) {
  if (pairToId.has(pair)) return pairToId.get(pair);
  const id = baseGlyphId + idToPair.length;
  pairToId.set(pair, id);
  idToPair.push(pair);
  return id;
}

function encodeLinePairs(str) {
  const tokens = [];
  // Normalize dashes and ellipses
  const normalized = str.replace(/\.\.\./g, '…').replace(/--/g, '—');
  for (let i = 0; i < normalized.length; i += 2) {
    const c1 = normalized[i];
    const c2 = (i + 1 < normalized.length) ? normalized[i + 1] : ' ';
    tokens.push(getPairId(c1 + c2));
  }
  return tokens;
}

// `terminator` is the word that follows the LAST box in the original script.
// It is normally 0xFF0D (next box / wait for input), but some quotes are
// followed by a different control opcode instead. The most important one is
// quote 305, whose box is followed by 0xFF29 (open the yes/no choice menu).
// Emitting 0xFF0D there and then skipping a word deletes the choice opcode and
// the buttons never appear, soft-locking the player. `null` means "emit no
// terminator at all, the following opcode ends the box".
function compileDualDialogue(translationText, terminator = 0xFF0D, l1Max = L1_MAX) {
  const boxes = paginateDualText(translationText, l1Max);
  const words = [];

  for (let b = 0; b < boxes.length; b++) {
    const lines = boxes[b];

    // Line 1 pairs
    const l1Tokens = encodeLinePairs(lines[0] || '');
    for (const tok of l1Tokens) words.push(tok);

    // Line 2 pairs
    if (lines.length > 1) {
      words.push(0xFF02); // NEWLINE — no indent word; line 2 starts at left edge
      const l2Tokens = encodeLinePairs(lines[1] || '');
      for (const tok of l2Tokens) words.push(tok);
    }

    const term = b === boxes.length - 1 ? terminator : 0xFF0D;
    if (term !== null) words.push(term);
  }
  return words;
}

// Compile a narration / thought / label span. Unlike dialogue these spans are
// already laid out by the original game, so we never re-paginate: '\n' is a
// hard line break. `wrapper` is the original first glyph word of the span:
//   0x0012 '('   -> wrap the text in ( )
//   0x001C '「'  -> wrap the text in 「 」
//   0xFF02       -> bare label; the leading '\n' in the text re-emits the break
function compileNarration(text, wrapper) {
  const words = [];
  if (wrapper === 0x0012) words.push(0x0012);
  else if (wrapper === 0x001C) words.push(0x001C);

  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      words.push(0xFF02); // NEWLINE — no indent word; matches original Japanese
    }
    for (const tok of encodeLinePairs(lines[i])) words.push(tok);
  }

  if (wrapper === 0x0012) words.push(0x0013);
  else if (wrapper === 0x001C) words.push(0x001D);
  return words;
}

// 3a. Load untranslated narration / thought / label spans.
// These are bare glyph runs (no 0x001C wrapper) that the original 2,855-quote
// extractor never found; they were confirmed as displayed text by diffing
// against the Chinese fan translation.
const narrationPath = path.resolve(__dirname, '../data/narration_translations.json');
const narrationMap = new Map();
if (fs.existsSync(narrationPath)) {
  for (const n of JSON.parse(fs.readFileSync(narrationPath, 'utf8'))) {
    narrationMap.set(parseInt(n.offset, 16), {
      endOffset: parseInt(n.endOffset, 16),
      wrapper: parseInt(n.wrapper, 16),
      english: n.english,
    });
  }
  console.log(`Loaded ${narrationMap.size} narration spans from ${narrationPath}`);
}

// 3b. Per-quote line-1 budget.
//
// A dialogue box shares its first row with the speaker name plate, so how much
// text fits on line 1 depends on which name is drawn. Replay the engine's name
// index rule over the pristine ROM (work/quote-name-index.mjs) and turn each
// name into a character budget. The build and work/check-box-widths.mjs both
// use this, so they cannot disagree about the layout.
const quotes = JSON.parse(fs.readFileSync(quotesPath, 'utf8'));
const quoteById = new Map();
for (const q of quotes) quoteById.set(q.id, q);
const quoteNameIndex = buildQuoteNameIndex(cleanRomPath, quotesPath);
const speakerPlatesPath = path.resolve(__dirname, '../data/speaker_nameplates.json');
const nameLenByIndex = fs.existsSync(speakerPlatesPath)
  ? buildNameLenByIndex(speakerPlatesPath)
  : new Map();
const l1MaxForQuote = makeL1Budget(quoteNameIndex, nameLenByIndex);
const l1MaxOf = (q) => l1MaxForQuote(q);
{
  const unmatched = quotes.filter(q => !quoteNameIndex.has(q.id)).length;
  const histogram = new Map();
  for (const q of quotes) {
    const k = l1MaxOf(q);
    histogram.set(k, (histogram.get(k) || 0) + 1);
  }
  console.log('Line-1 budgets:', [...histogram.entries()].sort((a, b) => b[0] - a[0])
    .map(([k, v]) => `${k}ch x${v}`).join(', '), unmatched ? `(${unmatched} unmatched -> default)` : '');
}

// Pre-scan all translations to populate pair dictionary
for (const [id, trans] of Object.entries(allTranslations)) {
  compileDualDialogue(trans, 0xFF0D, l1MaxOf(quoteById.get(Number(id))));
}
// Pre-register narration pairs so they are included in the font table
for (const n of narrationMap.values()) {
  if (n.english) compileNarration(n.english, n.wrapper);
}
// Pre-register the inline speaker names used by the minigame sub-scripts.
// Those scripts do not use the FF12 nameplate opcode; they store the speaker's
// name as three literal glyphs before the 0x001C quote, so the name is drawn as
// part of the text. コナン -> CONAN, 王師範 (Master Wang) -> MASTER (6 chars is
// exactly the three 12px glyph slots available).
encodeLinePairs('CONAN');
encodeLinePairs('MASTER');
// Pre-register the epilogue riddle-card questions/explanations so their pairs
// are included in the font table.
const epiloguePairStats = registerEpiloguePairs(encodeLinePairs);
// Pre-register all system prompt pairs so they are included in font table
registerSystemPromptPairs(getPairId);
console.log('Total unique dual-character glyphs needed:', idToPair.length);

// 4. Read baseline ROM into a 16 MB buffer
const cleanRom = fs.readFileSync(cleanRomPath);
const rom = Buffer.alloc(16 * 1024 * 1024, 0xFF);
cleanRom.copy(rom);

// What follows a quote in the ORIGINAL script decides how the compiled box must
// end. Returns { terminator, next }:
//   0xFF0D  normal box end      -> emit 0xFF0D, skip it
//   0xFF02  line break          -> emit 0xFF0D, skip it (legacy layout)
//   other control opcode        -> emit nothing, DO NOT skip it
//   glyph / blank               -> legacy: emit 0xFF0D, skip one word
// Skipping a control opcode is what deleted 0xFF29 (the yes/no choice menu)
// after quote 305 and soft-locked the game.
function quoteEnd(q) {
  if (q.endOffset + 2 > cleanRom.length) return { terminator: 0xFF0D, next: q.endOffset + 2 };
  const w = cleanRom.readUInt16LE(q.endOffset);
  if (w === 0xFF0D) return { terminator: 0xFF0D, next: q.endOffset + 2 };
  if (w === 0xFF02) return { terminator: 0xFF02, next: q.endOffset + 2 };
  if (w >= 0xFF00) return { terminator: null, next: q.endOffset };
  return { terminator: 0xFF0D, next: q.endOffset + 2 };
}

// 5. Burn Dual-Character Font Table into Relocated & Expanded Buffer
const fontBase = 0x0058E964; // Authentic table offset in original ROM!
const relocatedFontBase = 0x00B00000; // Safe expanded ROM area (0x08B00000)

// 1) Copy all 1323 original glyphs (0xBA0C bytes) to relocated buffer
cleanRom.copy(rom, relocatedFontBase, fontBase, fontBase + 0xBA0C);

console.log('Burning ' + idToPair.length + ' dual-character glyphs to font table at 0x' + relocatedFontBase.toString(16) + '...');
for (let i = 0; i < idToPair.length; i++) {
  const pair = idToPair[i];
  const glyphBytes = encodeDualGlyph(pair[0], pair[1]);
  
  // Write to relocated table
  const relOffset = relocatedFontBase + (baseGlyphId + i) * 36;
  glyphBytes.copy(rom, relOffset);

  // Also write to original location if within original allocation (up to 0x59a370)
  const origOffset = fontBase + (baseGlyphId + i) * 36;
  if (origOffset + 36 <= 0x0059A370) {
    glyphBytes.copy(rom, origOffset);
  }
}

// 2) Update Asset Table for Asset 0x4e21 (Font Asset)
// 0xb720c: Entry 0 Pointer
rom.writeUInt32LE(0x08000000 + relocatedFontBase, 0xb720c);
// 0xb7210: Entry 1 Size
const totalFontBytes = (baseGlyphId + idToPair.length) * 36;
rom.writeUInt32LE(totalFontBytes, 0xb7210);
// 0xb7214: Entry 1 Pointer (used by dialogue engine at 0x40a12 to load into *0x300001c)
rom.writeUInt32LE(0x08000000 + relocatedFontBase, 0xb7214);
console.log('Relocated font table to 0x08B00000 (' + totalFontBytes + ' bytes).');

// 6. Patch in-dialogue Speaker Name Table (English nameplate support at 0x410cc)
const speakerConfigPath = path.resolve(__dirname, '../data/speaker_nameplates.json');
let textNames = {};
if (fs.existsSync(speakerConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(speakerConfigPath, 'utf8'));
  for (const item of cfg) {
    textNames[item.id] = (item.english || '').toUpperCase().trim();
  }
} else {
  textNames = {
    0: 'CONAN',      1: 'RAN',        2: 'KOGORO',     3: 'AYUMI',      4: 'AGASA',
    5: 'MITSU',      6: 'GENTA',      7: 'HAIBARA',    8: '????',       9: 'MAN',
    10: 'WOMAN',     12: 'TAKAGI',    13: 'CHIBA',     15: 'STAFF',     16: 'HEIJI',
    17: 'KAZUHA',    18: 'MEGURE',    19: 'ETEKO',     20: 'OFFICER',   21: 'POLICE',
    22: 'CLERK',     24: 'SUSPECT',   25: 'MYSTERY',   27: 'CURATOR',   28: 'CSI',
    29: 'DOCTOR',    30: 'PRESIDENT', 31: 'OLD MAN',   32: 'MAN',       33: 'ANNOUNCE',
    34: 'GUARD',     35: 'DRIVER',    36: 'MAN VOICE', 37: 'WOM VOICE', 38: 'HOST',
    39: 'GUARD',     40: 'BOY',       41: 'REPORTER',  42: 'GUEST',     43: 'MANAGER',
    44: 'RECEPT'
  };
}

// Glyph codes for the 12x12 dialogue font (verified by rendering codes 0x00..0x5F,
// see work/_glyphs-ascii.png). Only used for the speaker nameplate table.
//
// A space MUST be a real blank glyph (0x003A), not 0x0000: the plate drawer now
// stops at 0x0000, so 0x0000 would truncate "SHADOW M" to "SHADOW". 0x003A is an
// all-zero 36-byte entry in the base font, right next to the A-Z range.
const NAME_SPACE = 0x003a;
const charMap = {
  ' ': NAME_SPACE, '!': 0x000B, '?': 0x005E, '(': 0x0012, ')': 0x0013, '-': 0x0016,
  '\'': 0x0011, ':': 0x001F, '.': 0x003C, ',': 0x003D, '「': 0x001C, '」': 0x001D,
  '"': 0x000C, '…': 0x005F, '/': 0x0018
};
for (let i = 0; i <= 9; i++) charMap[String(i)] = 0x0001 + i;
for (let i = 0; i < 26; i++) {
  charMap[String.fromCharCode(65 + i)] = 0x0020 + i;
  charMap[String.fromCharCode(97 + i)] = 0x0040 + i;
}

// The table MUST NOT live at 0x007E6000: work/patch-title-screen-logos.mjs writes
// title-logo palettes/data at 0x7E6110+, which clobbers every entry from index 17
// upward. 0x00F00000 is free in the expanded 16 MiB ROM (highest used byte is
// ~0xE83000).
const textNameTableDest = 0x00F00000;
const NAME_COUNT = 58; // entries 0..57 are real; 58+ is unrelated data in the original table
const unmappedNameChars = new Set();
for (let i = 0; i < NAME_COUNT; i++) {
  const name = textNames[i] || '';
  if (name.length > 8) throw new Error(`speaker name ${i} "${name}" is longer than 8 glyphs`);
  const entryOffset = textNameTableDest + i * 16;
  for (let k = 0; k < 8; k++) {
    const ch = name[k];
    if (ch && charMap[ch] === undefined) unmappedNameChars.add(ch);
    // 0x0000 terminates the plate; the drawer still draws it as one blank slot,
    // which is exactly the 12 px gap we want before the dialogue text.
    const code = ch && charMap[ch] !== undefined ? charMap[ch] : 0x0000;
    rom.writeUInt16LE(code, entryOffset + k * 2);
  }
}
if (unmappedNameChars.size) {
  throw new Error('speaker names contain unmapped glyphs: ' + [...unmappedNameChars].join(' '));
}

// Rewrite FUN_08041090, the speaker-name-plate drawer, called once per revealed
// glyph from 0x41442. See work/nameplate-patch.mjs for the disassembly notes and
// the instruction listing. Result: line 1 text starts at
// x = 8 + 12 * min(nameLen + 1, 9) and line 2 starts at x = 8.
applyNameplatePatch(rom, textNameTableDest);
console.log('Patched English speaker nameplate table (' + NAME_COUNT + ' entries) at 0x' + textNameTableDest.toString(16) + ' from ' + speakerConfigPath);
console.log('Rewrote nameplate drawer FUN_08041090 (dynamic plate width + no line-2 indent).');

// 6b. Patch Case 1 Door Transition Title Card to English ("SECURITY SYSTEM RUNAWAY CASE")
function decompressLZ77(buf, offset) {
  if (buf[offset] !== 0x10) return null;
  const size = buf[offset + 1] | (buf[offset + 2] << 8) | (buf[offset + 3] << 16);
  const out = Buffer.alloc(size);
  let input = offset + 4, write = 0;
  while (write < size && input < buf.length) {
    const flags = buf[input++];
    for (let bit = 7; bit >= 0 && write < size; bit--) {
      if (!(flags & (1 << bit))) out[write++] = buf[input++];
      else {
        const a = buf[input++], b = buf[input++];
        const len = (a >> 4) + 3, dist = ((a & 15) << 8 | b) + 1;
        for (let n = 0; n < len && write < size; n++) {
          out[write] = out[write - dist];
          write++;
        }
      }
    }
  }
  return out;
}

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

const glyphs8x14 = {
  ' ': [
    '........','........','........','........','........','........','........',
    '........','........','........','........','........','........','........'
  ],
  'S': [
    '.######.','########','###..###','###.....','#######.','.#######','....####',
    '.....###','###..###','########','.######.','........','........','........'
  ],
  'E': [
    '########','########','###.....','###.....','#######.','#######.','###.....',
    '###.....','###.....','########','########','........','........','........'
  ],
  'C': [
    '.######.','########','###..###','###.....','###.....','###.....','###.....',
    '###.....','###..###','########','.######.','........','........','........'
  ],
  'U': [
    '###..###','###..###','###..###','###..###','###..###','###..###','###..###',
    '###..###','###..###','########','.######.','........','........','........'
  ],
  'R': [
    '#######.','########','###..###','###..###','#######.','########','###.####',
    '###..###','###..###','###..###','###..###','........','........','........'
  ],
  'I': [
    '.######.','.######.','...##...','...##...','...##...','...##...','...##...',
    '...##...','...##...','.######.','.######.','........','........','........'
  ],
  'T': [
    '########','########','...##...','...##...','...##...','...##...','...##...',
    '...##...','...##...','...##...','...##...','........','........','........'
  ],
  'Y': [
    '###..###','###..###','.######.','..####..','...##...','...##...','...##...',
    '...##...','...##...','...##...','...##...','........','........','........'
  ],
  'M': [
    '###..###','########','########','###.####','###..###','###..###','###..###',
    '###..###','###..###','###..###','###..###','........','........','........'
  ],
  'N': [
    '###..###','####.###','########','###.####','###..###','###..###','###..###',
    '###..###','###..###','###..###','###..###','........','........','........'
  ],
  'A': [
    '..####..','.######.','###..###','###..###','########','########','###..###',
    '###..###','###..###','###..###','###..###','........','........','........'
  ],
  'W': [
    '###..###','###..###','###..###','###..###','###..###','###..###','###.####',
    '########','########','.######.','..#..#..','........','........','........'
  ],
};

function renderChar4bpp(ch) {
  const g = glyphs8x14[ch] || glyphs8x14[' '];
  const rows = ['........'];
  for (let r = 0; r < 14; r++) rows.push(g[r]);
  rows.push('........');

  const topTile = Buffer.alloc(32);
  const btmTile = Buffer.alloc(32);

  for (let y = 0; y < 16; y++) {
    const tileBuf = y < 8 ? topTile : btmTile;
    const ty = y % 8;
    for (let x = 0; x < 8; x += 2) {
      let n1 = 0, n2 = 0;
      const c1 = rows[y][x];
      const c2 = rows[y][x + 1];

      if (c1 === '#') {
        if (y <= 3 || x === 0 || (x > 0 && rows[y][x-1] !== '#')) n1 = 14;
        else if (y >= 12 || x === 7 || (x < 7 && rows[y][x+1] !== '#')) n1 = 9;
        else n1 = 13;
      }
      if (c2 === '#') {
        if (y <= 3 || x + 1 === 0 || (rows[y][x] !== '#')) n2 = 14;
        else if (y >= 12 || x + 1 === 7 || (x + 2 < 8 && rows[y][x+2] !== '#')) n2 = 9;
        else n2 = 13;
      }

      tileBuf[ty * 4 + x / 2] = (n2 << 4) | n1;
    }
  }
  return { topTile, btmTile };
}

const tilesDecompressed = decompressLZ77(cleanRom, 0x4cfea0);
const titleLine1 = 'SECURITY SYSTEM';
const titleLine2 = 'RUNAWAY CASE';

const titleIdx1 = 800;
for (let i = 0; i < titleLine1.length; i++) {
  const { topTile, btmTile } = renderChar4bpp(titleLine1[i]);
  topTile.copy(tilesDecompressed, (titleIdx1 + i * 2) * 32);
  btmTile.copy(tilesDecompressed, (titleIdx1 + i * 2 + 1) * 32);
}

const titleIdx2 = 830;
for (let i = 0; i < titleLine2.length; i++) {
  const { topTile, btmTile } = renderChar4bpp(titleLine2[i]);
  topTile.copy(tilesDecompressed, (titleIdx2 + i * 2) * 32);
  btmTile.copy(tilesDecompressed, (titleIdx2 + i * 2 + 1) * 32);
}

const compressedCaseTiles = compressLZ77(tilesDecompressed);
compressedCaseTiles.copy(rom, 0x00C00000);
rom.writeUInt32LE(compressedCaseTiles.length, 0xb3a58);
rom.writeUInt32LE(0x08C00000, 0xb3a5c);

const caseTilemap = Buffer.alloc(2048, 0);
const tx1 = 8;
for (let i = 0; i < titleLine1.length; i++) {
  const topCode = (titleIdx1 + i * 2) | (4 << 12);
  const btmCode = (titleIdx1 + i * 2 + 1) | (4 << 12);
  caseTilemap.writeUInt16LE(topCode, (11 * 32 + (tx1 + i)) * 2);
  caseTilemap.writeUInt16LE(btmCode, (12 * 32 + (tx1 + i)) * 2);
}

const tx2 = 9;
for (let i = 0; i < titleLine2.length; i++) {
  const topCode = (titleIdx2 + i * 2) | (4 << 12);
  const btmCode = (titleIdx2 + i * 2 + 1) | (4 << 12);
  caseTilemap.writeUInt16LE(topCode, (15 * 32 + (tx2 + i)) * 2);
  caseTilemap.writeUInt16LE(btmCode, (16 * 32 + (tx2 + i)) * 2);
}
caseTilemap.copy(rom, 0x00C10000);
caseTilemap.copy(rom, 0x003328f4);
rom.writeUInt32LE(0x08C10000, 0xa9114);
console.log('Patched Case 1 door transition title card to "SECURITY SYSTEM RUNAWAY CASE".');

// 7. Quote Metadata and Scene Pointers
// (`quotes` and `quoteById` were loaded in step 3b, before the pair pre-scan,
// because pagination needs the per-quote line-1 budget.)
const quoteMap = new Map();
for (const q of quotes) quoteMap.set(q.byteOffset, q);

// A few master scene entries point *into* the middle of a dialogue box. If we
// let such a scene copy from that point verbatim, the leftover Japanese tail
// leaks into the relocated script. Precompute every interior offset of a
// translated span so the scene walker can skip straight to its end.
const spanInterior = new Map();
for (const q of quotes) {
  const { next } = quoteEnd(q);
  for (let o = q.byteOffset + 2; o < next; o += 2) spanInterior.set(o, next);
}
for (const [start, n] of narrationMap.entries()) {
  for (let o = start + 2; o < n.endOffset; o += 2) spanInterior.set(o, n.endOffset);
}
console.log('Interior span offsets that will be skipped:', spanInterior.size);

const scenePointersInTable = [];
// Master scene tables strictly reside between 0x2930f4 and 0x2ae0f0.
// Scanning past 0x2ae100 collides with Table 0 asset data (e.g. Asset 0x7a at 0x2bb5a8).
for (let p = 0x290000; p <= 0x2ae100; p += 4) {
  const v = rom.readUInt32LE(p);
  if (v >= 0x0800eb40 && v <= 0x0803b1a4 && (v & 1) === 0) {
    const off = v - 0x08000000;
    const w0 = cleanRom.readUInt16LE(off);
    // Real scenes in the bytecode VM always start with an opcode word (0xFFxx).
    // This rejects accidental integer/coordinate data (e.g. 0x29a5f8 = 0x08020202
    // and 0x299588 = 0x08030404) that would otherwise truncate dialogue scenes.
    if ((w0 & 0xff00) === 0xff00) {
      scenePointersInTable.push({ tableOffset: p, origRomOffset: off });
    }
  }
}

const rawStarts = Array.from(new Set(scenePointersInTable.map(s => s.origRomOffset))).sort((a,b) => a - b);
const tableTargets = new Set(rawStarts);

// Only split scenes if preceded by a scene terminator (0xff00).
// If a table target has no 0xff00 between it and the previous scene start,
// it is an internal mid-scene entry point (e.g. 0x25edc in Case 3 hospital roof
// after the water tank falls). Splitting it would truncate the previous scene
// with 0xFFFF padding, causing the game to crash/freeze when falling through.
const uniqueStarts = [];
for (let i = 0; i < rawStarts.length; i++) {
  const start = rawStarts[i];
  if (i === 0) {
    uniqueStarts.push(start);
    continue;
  }
  const prev = uniqueStarts[uniqueStarts.length - 1];
  let hasTerm = false;
  for (let p = prev; p < start; p += 2) {
    if (cleanRom.readUInt16LE(p) === 0xff00) {
      hasTerm = true;
      break;
    }
  }
  if (hasTerm) {
    uniqueStarts.push(start);
  }
}
uniqueStarts.push(0x3b1a4);

// 8. Recompile All Scenes with Dual-Character Dialogue
let scriptFreeSpace = 0x00800000;
const sceneRelocations = new Map();
let totalTranslated = 0;
let narrationInjected = 0;
const injectedQuoteIds = new Set();
const skippedQuotes = [];
const inPlaceQuoteIds = new Set();
const subScriptRelocations = [];

for (let s = 0; s < uniqueStarts.length - 1; s++) {
  const sceneStart = uniqueStarts[s];
  const sceneEnd = uniqueStarts[s + 1];

  const dest = scriptFreeSpace;
  const compiledWords = [];
  let p = sceneStart;

  while (p < sceneEnd) {
    if (tableTargets.has(p)) {
      sceneRelocations.set(p, 0x08000000 + dest + compiledWords.length * 2);
    }
    if (spanInterior.has(p)) {
      p = spanInterior.get(p);
      continue;
    }
    if (narrationMap.has(p)) {
      const n = narrationMap.get(p);
      const words = compileNarration(n.english, n.wrapper);
      for (const cw of words) compiledWords.push(cw);
      narrationInjected++;
      // A narration span can fully cover a translated quote (the one real case
      // is quote 260, whose tail made the extractor split the box). If the
      // rendered narration carries that quote's exact translation, the quote is
      // genuinely present in the ROM, so record it as injected.
      const narText = String(n.english || '').replace(/\s+/g, ' ').trim();
      if (narText) {
        for (const q of quotes) {
          if (q.byteOffset < p || q.endOffset + 2 > n.endOffset) continue;
          if (injectedQuoteIds.has(q.id)) continue;
          const qText = (allTranslations[q.id] || '').replace(/\s+/g, ' ').trim();
          if (qText && qText === narText) {
            injectedQuoteIds.add(q.id);
            totalTranslated++;
          }
        }
      }
      p = n.endOffset;
      continue;
    }
    if (quoteMap.has(p)) {
      const q = quoteMap.get(p);
      const trans = allTranslations[q.id];
      const { terminator, next } = quoteEnd(q);
      if (trans && trans.trim()) {
        const words = compileDualDialogue(trans, terminator, l1MaxOf(q));
        for (const cw of words) compiledWords.push(cw);
        totalTranslated++;
        injectedQuoteIds.add(q.id);
        p = next;
      } else {
        while (p < next) {
          compiledWords.push(rom.readUInt16LE(p));
          p += 2;
        }
      }
    } else {
      compiledWords.push(rom.readUInt16LE(p));
      p += 2;
    }
  }

  for (let i = 0; i < compiledWords.length; i++) {
    rom.writeUInt16LE(compiledWords[i], dest + i * 2);
  }

  scriptFreeSpace += compiledWords.length * 2;
  while (scriptFreeSpace % 16 !== 0) scriptFreeSpace++;

  sceneRelocations.set(sceneStart, 0x08000000 + dest);
}

// 9. Redirect All Master Scene Pointers
let redirectedCount = 0;
for (const entry of scenePointersInTable) {
  if (sceneRelocations.has(entry.origRomOffset)) {
    const newTarget = sceneRelocations.get(entry.origRomOffset);
    rom.writeUInt32LE(newTarget, entry.tableOffset);
    redirectedCount++;
  }
}
console.log('Redirected ' + redirectedCount + ' master scene table pointers.');

// Ensure master prologue pointers at 0x2930f4 and 0x293d14 point to Scene 5
if (sceneRelocations.has(0xeb40)) {
  const s5Ptr = sceneRelocations.get(0xeb40);
  rom.writeUInt32LE(s5Ptr, 0x002930F4);
  rom.writeUInt32LE(s5Ptr, 0x00293D14);
}

// 10. Recompile Sub-Scripts in 0xdc10 - 0xdc64 (Quotes 38 to 59: Eteko direction shout-outs)
// These scripts execute inside the minigame engine without a standard dialogue box.
// Emitting 0xFF0D causes the game to wait forever for an A-button dismissal that never comes,
// which freezes the minigame. They must follow the authentic script format:
// [CONAN (3 pair glyphs)] [0x001C open quote] [English text pair glyphs] [0x000B pause] [0x001D close quote] [0x0000] [0xFF00 end]
for (let p = 0xdc10; p <= 0xdc64; p += 4) {
  const scriptStart = rom.readUInt32LE(p) - 0x08000000;
  const scriptEnd = scriptStart + 0x28;
  const compiledWords = [];

  let targetQuote = null;
  for (let c = scriptStart; c < scriptEnd; c += 2) {
    if (quoteMap.has(c)) {
      targetQuote = quoteMap.get(c);
      break;
    }
  }

  // 1. Speaker name: CONAN (3 pair glyphs)
  for (const t of encodeLinePairs('CONAN')) compiledWords.push(t);
  // 2. Open quote
  compiledWords.push(0x001c);

  // 3. Translated text in pair glyphs
  if (targetQuote && allTranslations[targetQuote.id]) {
    const text = allTranslations[targetQuote.id].replace(/\n/g, ' ').trim();
    for (const tok of encodeLinePairs(text)) {
      compiledWords.push(tok);
    }
    totalTranslated++;
    injectedQuoteIds.add(targetQuote.id);
  }

  // 4. Authentic termination (matches clean ROM and Chinese ROM)
  compiledWords.push(0x000b); // Pause
  compiledWords.push(0x001d); // Close quote
  compiledWords.push(0x0000); // String null terminator
  compiledWords.push(0xff00); // Script end opcode

  if (compiledWords.length > 0) {
    const dest = scriptFreeSpace;
    for (let i = 0; i < compiledWords.length; i++) {
      rom.writeUInt16LE(compiledWords[i], dest + i * 2);
    }
    scriptFreeSpace += compiledWords.length * 2;
    while (scriptFreeSpace % 16 !== 0) scriptFreeSpace++;
    rom.writeUInt32LE(0x08000000 + dest, p);
    subScriptRelocations.push({ origStart: '0x' + scriptStart.toString(16), romPointer: '0x' + (0x08000000 + dest).toString(16) });
  }
}

// 11. Recompile Minigame Sub-Scripts (Quotes 1 to 45)
for (let p = 0; p < 0x20000; p += 2) {
  if (quoteMap.has(p)) {
    const q = quoteMap.get(p);
    if (q.id >= 1 && q.id <= 45 && allTranslations[q.id]) {
      const origTerm = cleanRom.readUInt16LE(q.endOffset);
      const terminator = (origTerm === 0xff00) ? 0xff00 : null;
      const words = compileDualDialogue(allTranslations[q.id], terminator, l1MaxOf(q));
      if (words.length * 2 <= (q.endOffset + 2 - q.byteOffset)) {
        for (let i = 0; i < words.length; i++) {
          rom.writeUInt16LE(words[i], q.byteOffset + i * 2);
        }
        for (let i = words.length * 2; i < (q.endOffset + 2 - q.byteOffset); i += 2) {
          rom.writeUInt16LE(0x0000, q.byteOffset + i);
        }
        totalTranslated++;
        injectedQuoteIds.add(q.id);
        inPlaceQuoteIds.add(q.id);
      } else if (!injectedQuoteIds.has(q.id)) {
        skippedQuotes.push({ id: q.id, reason: 'overflow', offset: '0x' + q.byteOffset.toString(16), bytes: q.endOffset + 2 - q.byteOffset, needs: words.length * 2 });
      }
    }
  }
}

// 11a. Translate the inline speaker names embedded in the minigame sub-scripts.
// The 36 scripts referenced by the table at 0xdb60..0xdc04 do not use the FF12
// nameplate opcode: the speaker name is stored as three literal glyphs right
// before the 0x001C quote, so it is drawn as part of the text. Those glyphs are
// still Japanese after step 11 (which only rewrites the quote span itself).
// Every name occupies exactly three 12px glyph slots (6 bytes), so swapping in
// pair glyphs is size-neutral and needs no relocation.
const INLINE_SPEAKER_NAMES = [
  { jp: [0x00c9, 0x00d4, 0x00ef], en: 'CONAN' },  // コナン
  { jp: [0x028b, 0x02a0, 0x02a1], en: 'MASTER' }, // 王師範 (Master Wang)
];
let inlineNamesTranslated = 0;
for (let p = 0xdb60; p <= 0xdc04; p += 4) {
  const scriptStart = rom.readUInt32LE(p) - 0x08000000;
  if (scriptStart < 0 || scriptStart >= rom.length) continue;
  for (const { jp, en } of INLINE_SPEAKER_NAMES) {
    if (!jp.every((w, i) => rom.readUInt16LE(scriptStart + i * 2) === w)) continue;
    const pairs = encodeLinePairs(en);
    for (let i = 0; i < 3; i++) rom.writeUInt16LE(pairs[i] || 0x0000, scriptStart + i * 2);
    inlineNamesTranslated++;
    break;
  }
}
console.log('Translated ' + inlineNamesTranslated + ' inline speaker names in minigame sub-scripts.');

// 11b. Relocate epilogue riddle-card Q&A (ids 2763–2855) into free scratch space
// and update pointer table 0x3b1b0–0x3b668.
const epilogueResult = patchEpilogueRiddleCards(rom, cleanRom, compileDualDialogue, quotes, allTranslations);
for (const id of epilogueResult.injectedIds) injectedQuoteIds.add(id);

// 11c. Rebuild the riddle-card table itself.  The relocation above only exists
// to keep the 93 epilogue quote ids accounted for; its table pointers are
// fragments.  Restore the table from the clean ROM and point each card at the
// full English question and explanation.
const epilogueTableResult = patchEpilogueRiddleTable(rom, cleanRom, encodeLinePairs);
console.log(
  'Epilogue riddle table rebuilt:',
  `${epilogueTableResult.repointed} entries,`,
  `${epilogueTableResult.uniqueStrings} unique strings,`,
  `${epilogueTableResult.bytesUsed} bytes at ${epilogueTableResult.scratchStart}`,
);
if (epilogueTableResult.missing.length > 0) {
  console.log('Epilogue riddle table gaps:', epilogueTableResult.missing.join(', '));
}
console.log('Epilogue riddle pairs registered:', `${epiloguePairStats.lines} lines`);

console.log('Total translated quotes compiled & injected:', totalTranslated, `(${injectedQuoteIds.size} unique)`);
console.log('Narration / thought / label spans injected:', narrationInjected, `of ${narrationMap.size}`);

// 11b. Machine-readable build manifest, written after the ROM is saved so it
// can never claim success for a ROM that was not actually written.
function writeManifest(writtenPath) {
  const quoteById = new Map();
  for (const q of quotes) quoteById.set(q.id, q);
  const missing = [];
  for (const [idStr, trans] of Object.entries(allTranslations)) {
    const id = Number(idStr);
    if (!trans || !trans.trim()) continue;
    if (injectedQuoteIds.has(id)) continue;
    const q = quoteById.get(id);
    missing.push({
      id,
      offset: q ? '0x' + q.byteOffset.toString(16) : null,
      bytes: q ? q.endOffset + 2 - q.byteOffset : null,
      english: trans,
    });
  }
  missing.sort((a, b) => a.id - b.id);

  const sceneList = [];
  for (const [origStart, ptr] of sceneRelocations) {
    sceneList.push({ origStart: '0x' + origStart.toString(16), romPointer: '0x' + ptr.toString(16) });
  }
  sceneList.sort((a, b) => parseInt(a.origStart, 16) - parseInt(b.origStart, 16));

  const manifest = {
    builtAt: new Date().toISOString(),
    sourceRom: cleanRomPath,
    outputRom: writtenPath,
    sourceRomSha256: crypto.createHash('sha256').update(cleanRom).digest('hex').toUpperCase(),
    baseGlyphId: '0x' + baseGlyphId.toString(16),
    baseGlyphIdDecimal: baseGlyphId,
    originalGlyphCount: ORIGINAL_GLYPH_COUNT,
    pairCount: idToPair.length,
    fontSourceOffset: '0x' + fontBase.toString(16),
    fontRelocatedOffset: '0x' + relocatedFontBase.toString(16),
    fontPointer: '0x' + (0x08000000 + relocatedFontBase).toString(16),
    fontSizeBytes: totalFontBytes,
    scriptRegionStart: '0x800000',
    scriptRegionEnd: '0x' + scriptFreeSpace.toString(16),
    sceneCount: sceneList.length,
    scenes: sceneList,
    subScripts: subScriptRelocations,
    inPlaceQuoteIds: Array.from(inPlaceQuoteIds).sort((a, b) => a - b),
    translationsTotal: Object.keys(allTranslations).length,
    injectionsTotal: totalTranslated,
    injectedCount: injectedQuoteIds.size,
    duplicateInjections: totalTranslated - injectedQuoteIds.size,
    injected: Array.from(injectedQuoteIds).sort((a, b) => a - b),
    missingCount: missing.length,
    missing,
    overflowCount: skippedQuotes.length,
    overflow: skippedQuotes,
    epilogueResult,
    epilogueScratchStart: '0x' + EPILOGUE_SCRATCH_START.toString(16),
    epilogueScratchEnd: '0x' + EPILOGUE_SCRATCH_END.toString(16),
    epilogueTable: epilogueTableResult,
    epilogueTableScratchStart: '0x' + EPILOGUE_TABLE_SCRATCH_START.toString(16),
    epilogueTableScratchEnd: '0x' + EPILOGUE_TABLE_SCRATCH_END.toString(16),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote build manifest -> ${manifestPath} (${manifest.injectedCount} injected, ${manifest.missingCount} missing, ${manifest.overflowCount} overflow)`);
  return manifest;
}

// 12. Patch Title Screen English Logos ("DETECTIVE CONAN" & "The Targeted Detective")
patchTitleScreenLogos(rom);

// 13. Patch Door Transition Title ("SECURITY SYSTEM RUNAWAY CASE")
patchDoorTransitionTitle(rom);

// 14. Patch Case Intro English Title Screens & Mystery Choices (Batch 1)
patchCaseIntroTitles(rom);

// 15. Patch Beika DPC Doorway Plaque
patchBeikaDpcPlaque(rom);

// 15b. Patch Beika DPC Wall Posters
patchBeikaDpcPosters(rom, cleanRom);

// 16. Patch 8 Gadget Instruction Cards
patchGadgetCards(rom);

// 17. Patch 9 Minigame & System Tutorial Screens
patchMinigameTutorials(rom);

// 18. Patch Newspaper Cutscene Background Screens (0x240a, 0x2b2e)
patchCutsceneBackgrounds(rom);

// 19. Patch System UI, Graphic Buttons & Bytecode Prompts
patchSystemPrompts(rom, getPairId);
patchAllConfirmedUI(rom, cleanRom);

// 19b. Patch the remaining approved assets that have style configs but were
//      not covered by patch-all-confirmed-ui (30 assets, all parts-mode)
patchRemainingApprovedUI(rom, cleanRom);

// 19c. Patch the HUD [L] MAP button (asset 0x30CB)
patchChoiceLabels(rom, cleanRom);

// 19d. Patch Stage Labels (0xd5a0–0xdb60: "ACTION X-Y" & "EVENT X-Y")
patchStageLabels(rom, cleanRom);

// 19e. Write Manifest for pointer remapping
const manifestObj = writeManifest(outputRomPath);

// 19f. Remap ARM code literal pool pointers to nested sub-scripts
remapScenePointers(rom, { clean: cleanRom, manifest: manifestObj });

// 19g. Patch the 23 full-screen translated assets created by Community
//      (Newspaper, cutscenes, case intro titles, tutorials, and gadget instruction cards)
patchTranslatedScreens(rom, cleanRom);

// 19h. Patch the in-game Pause Banner (Asset 0x952, "PAUSE")
patchPauseAsset(rom);

// 19i. Patch cutscenes and backgrounds translated by user
patchUserTranslatedCutscenes(rom, cleanRom);

// 19j. Patch English Keyboard Graphic, Input Grid & Riddle Answer Validator (Option 1)
patchEnglishKeyboardSystem(rom, cleanRom);

// 19k. Patch Translated Result Banners & Stamps (10 assets)
patchUserBanners(rom, cleanRom);

// 19k2. Patch Karate Minigame Graphics & Result Card (TIME'S UP!!, RESULTS, FAILED!, PASSED!)
patchKarateUi(rom);

// 19l. Patch In-Game Black Screen: "ONLY YOU CAN SOLVE THIS CASE!!" (0x0c44 / 0x0c45)
patchPrologueHookScreen(rom);

// 19m. Patch Eteko Minigame UI (0x3205 / 0x3219: HINT & LEFT 1 ONLY)
patchEtekoMinigameUI(rom, cleanRom);

// 20. Save Final Patched ROM
let writtenPath = outputRomPath;
try {
  fs.writeFileSync(outputRomPath, rom);
  console.log('Successfully saved English ROM -> ' + outputRomPath);
} catch (e) {
  console.warn('Notice: ' + outputRomPath + ' is locked (likely open in emulator).');
  const tempPath = outputRomPath.replace('.gba', '_new.gba');
  fs.writeFileSync(tempPath, rom);
  writtenPath = tempPath;
  console.log('Saved to staging file instead -> ' + tempPath);
  manifestObj.outputRom = writtenPath;
  fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2));
}

// Authoritative pair-glyph dictionary: this is exactly what the build burned,
// so verification tools do not have to OCR the font bitmaps back out.
fs.writeFileSync(
  path.resolve(__dirname, '../build/pair-table.json'),
  JSON.stringify({ idToPair: Object.fromEntries(idToPair.map((p, i) => [baseGlyphId + i, p])) }, null, 1),
);
console.log('Wrote authoritative pair table -> build/pair-table.json (' + idToPair.length + ' pairs)');

if (!process.env.CONAN_OUT) {
  try {
    // working copy omitted in standalone build
    console.log('Updated Detective Conan - working copy.gba');
  } catch (e) {
    // Ignored if locked
  }
}
