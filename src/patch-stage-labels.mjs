import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Patch the stage-label table at 0xd5a0–0xdaff in the ROM.
// This table stores the stage title banner shown when entering each action/event stage.
// It uses the single-char font encoding (same charMap as the rest of the game).
//
// Label format:  ff03 [glyph_words...] ff00
// Glyph words use the same charMap as the dialogue system:
//   digits: charMap[n] = 0x0001 + n  (so '1'=0x0002, '2'=0x0003, ... '9'=0x000A)
//   '-'  = 0x0016
//   letters: A-Z = 0x0020-0x0039, a-z = 0x0040-0x0059
//   space = 0x0000
//
// Japanese label structure (decoded from clean ROM):
//   アクションパート X-Y  = ACTION PART X-Y
//   イベントパート X-Y    = EVENT PART X-Y
//   イベントテスト N      = EVENT TEST N  (internal / unused labels)
//   セーブのテスト        = SAVE TEST     (internal)
//
// English translation policy:
//   ACTION X-Y  (fits cleanly in the bottom dialogue banner)
//   EVENT X-Y
//   (test labels left as-is since they're internal/debug)

import fs from 'fs';

const CLEAN_PATH = process.env.CONAN_CLEAN_ROM || path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba');

// charMap (same as build-dual-char-game.mjs)
const charMap = {
  ' ': 0x0000, '!': 0x000B, '?': 0x0010, '(': 0x0012, ')': 0x0013, '-': 0x0016,
  "'": 0x001E, ':': 0x001F, '.': 0x003C, ',': 0x003D, '"': 0x001C, '…': 0x005F, '/': 0x0017,
};
for (let i = 0; i <= 9; i++) charMap[String(i)] = 0x0001 + i;
for (let i = 0; i < 26; i++) {
  charMap[String.fromCharCode(65 + i)] = 0x0020 + i;
  charMap[String.fromCharCode(97 + i)] = 0x0040 + i;
}

function encodeLabel(str) {
  const words = [];
  for (const ch of str) {
    const w = charMap[ch];
    if (w === undefined) {
      console.warn('WARNING: unmapped char', JSON.stringify(ch), 'in label', JSON.stringify(str));
      continue;
    }
    words.push(w);
  }
  return words;
}

const LABEL_START = 0xd5a0;
const LABEL_END   = 0xdb60;

const JP_AKUSHON  = [0xc0, 0xc7, 0xcb]; // アクション... prefix
const JP_IBENTO   = [0xc1, 0x102, 0xef]; // イベント... prefix
const JP_IBENTO_T = [0xc1, 0x102, 0xef, 0xd3, 0xd2]; // イベントテスト prefix
const JP_SAVE_T   = [0xcd, 0x3f, 0x101]; // セーブテスト prefix

function matchPrefix(glyphs, prefix) {
  if (glyphs.length < prefix.length) return false;
  return prefix.every((g, i) => glyphs[i] === g);
}

export function patchStageLabels(rom, cleanRom) {
  const clean = cleanRom || fs.readFileSync(CLEAN_PATH);

  const labels = [];
  let p = LABEL_START;
  while (p < LABEL_END) {
    const w = clean.readUInt16LE(p);
    if (w === 0xff03) {
      p += 2;
      const startOff = p;
      const glyphs = [];
      while (p < LABEL_END) {
        const gw = clean.readUInt16LE(p);
        if (gw === 0xff00) break;
        glyphs.push(gw);
        p += 2;
      }
      labels.push({ startOff, endOff: p, glyphs });
    } else {
      p += 2;
    }
  }

  let patched = 0;
  let skipped = 0;

  for (const label of labels) {
    const { startOff, glyphs } = label;
    const slotBytes = glyphs.length * 2;

    if (glyphs.length === 0) { skipped++; continue; }

    let engStr = null;

    if (matchPrefix(glyphs, JP_IBENTO_T) || matchPrefix(glyphs, JP_SAVE_T)) {
      skipped++;
      continue;
    } else if (matchPrefix(glyphs, JP_AKUSHON)) {
      if (glyphs.length >= 3) {
        const last3 = glyphs.slice(-3);
        const isDashPattern = last3[1] === 0x0016 && last3[0] >= 0x0001 && last3[0] <= 0x000A && last3[2] >= 0x0001 && last3[2] <= 0x000A;
        if (isDashPattern) {
          const caseNum = last3[0] - 0x0001;
          const stageNum = last3[2] - 0x0001;
          engStr = 'ACTION ' + caseNum + '-' + stageNum;
        } else if (glyphs.length >= 2 && glyphs.at(-2) === 0x0016) {
          const caseNum = glyphs.at(-3) - 0x0001;
          const stageNum = glyphs.at(-1) - 0x0001;
          engStr = 'ACTION ' + caseNum + '-' + stageNum;
        } else {
          engStr = 'ACTION';
        }
      } else {
        engStr = 'ACTION';
      }
    } else if (matchPrefix(glyphs, JP_IBENTO)) {
      if (glyphs.length >= 3) {
        const last3 = glyphs.slice(-3);
        const isDashPattern = last3[1] === 0x0016 && last3[0] >= 0x0001 && last3[0] <= 0x000A && last3[2] >= 0x0001 && last3[2] <= 0x000A;
        if (isDashPattern) {
          const caseNum = last3[0] - 0x0001;
          const stageNum = last3[2] - 0x0001;
          engStr = 'EVENT ' + caseNum + '-' + stageNum;
        } else {
          engStr = 'EVENT';
        }
      } else {
        engStr = 'EVENT';
      }
    } else {
      skipped++;
      continue;
    }

    const engWords = encodeLabel(engStr);
    if (engWords.length > slotBytes / 2) {
      engWords.length = Math.floor(slotBytes / 2);
    }

    for (let i = 0; i < engWords.length; i++) {
      rom.writeUInt16LE(engWords[i], startOff + i * 2);
    }
    for (let i = engWords.length; i < slotBytes / 2; i++) {
      rom.writeUInt16LE(0x0000, startOff + i * 2);
    }

    patched++;
  }

  console.log(`[STAGE LABELS] Patched ${patched} labels in ROM (0xd5a0–0xdb60)`);
  return { patched, skipped, total: labels.length };
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('patch-stage-labels.mjs')) {
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      patchStageLabels(rom);
      fs.writeFileSync(romPath, rom);
      console.log(`Updated ${romPath}`);
    }
  }
}
