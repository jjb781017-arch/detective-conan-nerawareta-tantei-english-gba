// Shared text paginator for the dual-character dialogue font.
//
// This used to live inline in build-dual-char-game.mjs. It is a separate module
// so work/check-box-widths.mjs can verify the exact same layout rules that the
// build applies, instead of re-implementing them and silently drifting.
//
// Measured in-game geometry (calibrated against GBA emulator screenshots; the
// measurement helper is work/_measure-dialogue.mjs, which prints the ink column
// runs of each text row in a real screenshot):
//
//   * The dialogue box interior spans x = 3 .. 236. Pair glyphs are 12 px wide
//     and hold 2 characters, i.e. 6 px per character.
//   * The speaker name plate is drawn INTO the text cursor by FUN_08041090: each
//     name glyph is one 12 px slot starting at x = 8, and the cursor is left on
//     the slot after the name (the name table is terminated by 0x0000, which is
//     itself drawn as one blank slot, so there is always a 12 px gap between the
//     name and the dialogue text).
//       x(line 1) = 8 + 12 * min(nameLen + 1, 9)
//     A box with no speaker name plate starts line 1 at x = 8.
//   * Line 2 starts at the box's left edge, x = 8 (the engine's NEWLINE opcode
//     0xFF02 resets the cursor to the text origin; FUN_08041090 no longer pads
//     line 2 with the old 3 blank slots).
//   * Verified end points: 9 glyphs from x = 104 end at 212.3 px and are safe;
//     10 glyphs (ending at 224) were clipped in-game. So the last glyph slot may
//     start at x <= 200, i.e. every line ends at x <= 212.
//   * The compiler wraps every box in 「 」; those two glyphs are part of the
//     line width. BRACKETS REMOVED: compileDualDialogue() no longer emits them,
//     so the whole budget is available for text.
//
// Budgets are therefore per-quote: a short name gives line 1 more room.

export const GLYPH_W = 12;
export const TEXT_ORIGIN_X = 8;
export const LINE_LAST_SLOT_X = 200; // last glyph slot may start at or before this
export const LINE_END_X = 212;       // ...which means the line ends at or before this

// Line 2 always starts at the box's left edge.
export const L2_X = TEXT_ORIGIN_X;

/**
 * Name plate slots consumed by a speaker name of `nameLen` characters.
 *
 * `nameLen` = -1 means "no name plate is drawn at all" (name index 0), which
 * leaves the text cursor on the box's left edge. `nameLen` = 0 is a real but
 * blank plate: the 0x0000 terminator is still drawn as one blank 12 px slot.
 */
export function nameSlots(nameLen) {
  // 8 glyphs max, plus the terminator blank that acts as the separator.
  return Math.max(0, Math.min(nameLen + 1, 9));
}

/** x where line 1 text starts for a speaker name of `nameLen` characters. */
export function line1X(nameLen) {
  return TEXT_ORIGIN_X + GLYPH_W * nameSlots(nameLen);
}

/** How many 12 px pair glyphs fit on a line that starts at x. */
export function glyphsFrom(x) {
  return Math.floor((LINE_LAST_SLOT_X - x) / GLYPH_W) + 1;
}

/** Character budget of line 1 for a speaker name of `nameLen` characters. */
export function l1MaxForName(nameLen) {
  return 2 * glyphsFrom(line1X(nameLen));
}

// Conservative default: the 7-glyph name case (x = 104, 9 glyphs, 18 chars).
export const L1_MAX = l1MaxForName(7);
// Line 2 starts at x = 8 -> 17 glyphs -> 34 characters.
export const L2_MAX = 2 * glyphsFrom(L2_X);

export function paginateDualText(text, l1Max = L1_MAX, l2Max = L2_MAX) {
  if (text.includes('[LINE]')) {
    const rawLines = text.split('[LINE]').map(s => s.trim());
    const boxes = [];
    for (let i = 0; i < rawLines.length; i += 2) {
      if (i + 1 < rawLines.length) {
        boxes.push([rawLines[i], rawLines[i + 1]]);
      } else {
        boxes.push([rawLines[i]]);
      }
    }
    return boxes;
  }

  const hasLeadingSpace = text.startsWith(' ');
  const cleaned = text.replace(/\[BOX\]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ');
  if (!words.length || !words[0]) return [['']];
  if (hasLeadingSpace) words[0] = ' ' + words[0];

  const boxes = [];
  let i = 0;

  // Greedy pack: fill line 1 up to l1Max chars, then line 2 up to l2Max chars.
  while (i < words.length) {
    let l1 = '';
    while (i < words.length) {
      const next = l1 ? l1 + ' ' + words[i] : words[i];
      if (next.length <= l1Max) { l1 = next; i++; } else break;
    }
    if (!l1) { l1 = words[i]; i++; }

    let l2 = '';
    while (i < words.length) {
      const next = l2 ? l2 + ' ' + words[i] : words[i];
      if (next.length <= l2Max) { l2 = next; i++; } else break;
    }
    boxes.push(l2 ? [l1, l2] : [l1]);
  }

  // Backward merge: when the last box is a single short line (a stranded word
  // or short phrase), fix it.
  //   Case A — full merge: all words from last fit into prev L2 (or L1) →
  //            last box disappears.
  //   Case C — single-line prev: merge last into prev L1 if it fits.
  // Repeat backward from the last box.
  // NOTE: Case B (rebalance) removed — it was causing worse fragmentation
  // by splitting reasonably-sized final lines into two short lines.
  for (let bi = boxes.length - 1; bi >= 1; bi--) {
    const last = boxes[bi];
    const prev = boxes[bi - 1];
    if (last.length !== 1) continue;
    const lastWords = last[0].split(' ');

    if (prev.length === 2) {
      // Case A: can all last words fit into prev L2?
      const fullMerge = prev[1] + ' ' + lastWords.join(' ');
      if (fullMerge.length <= l2Max) {
        prev[1] = fullMerge;
        boxes.splice(bi, 1);
        continue;
      }
    } else {
      // Case C: prev is single-line — merge last into prev L1 if it fits
      const tryMerged = prev[0] + ' ' + lastWords.join(' ');
      if (tryMerged.length <= l1Max) {
        prev[0] = tryMerged;
        boxes.splice(bi, 1);
      }
    }
  }
  return boxes;
}
