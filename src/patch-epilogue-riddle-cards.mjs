// Section 6b: Relocate epilogue riddle-card Q&A (ids 2763–2855)
//
// The epilogue region (0x3b71a..0x3e952) is compacted and fully packed, so
// in-place patching is not possible (English tokens almost always exceed the
// Japanese slot size).  Instead we use two strategies:
//
// 1. DIRECT POINTER: For any pointer-table entry in 0x3b1b0–0x3b668 whose
//    target equals an epilogue quote's byteOffset, we compile the English
//    tokens, write them to a scratch region just past the main script area
//    (0x831000..0x832000), and rewrite that pointer to point to the new
//    scratch location.  This covers 3 of 93 quotes.
//
// 2. IN-PLACE SHORTEN: For the remaining 90 quotes (no direct pointer table
//    entry), we patch them in-place IF the compiled English token count fits
//    in the existing slot; otherwise we record them in `notInjected` and let
//    the manifest writer report them as known gaps.  In practice, the epilogue
//    slots are compacted Japanese and most English translations will NOT fit
//    in-place — they will show up as "not injected" in the manifest, which is
//    the correct behaviour.
//
// The key insight: the epilogue is NOT in the master scene table (0x290000),
// so the main build's scene relocator never touches it.  These quotes are
// reached via direct pointer-table entries that the riddle-card system reads
// at runtime.  For the subset with no direct pointer entry, the riddle-card
// system reads them via a different mechanism (in-place slot reads), and the
// only correct injection path is in-place patching when the translation
// physically fits.

import fs from 'fs';

export const EPILOGUE_PTR_TABLE_START = 0x3b1b0;
export const EPILOGUE_PTR_TABLE_END   = 0x3b668 + 4;
export const EPILOGUE_SCRATCH_START   = 0x00831000;
export const EPILOGUE_SCRATCH_END     = 0x00832000;

const EPILOGUE_ID_MIN = 2763;
const EPILOGUE_ID_MAX = 2855;

export function patchEpilogueRiddleCards(rom, cleanRom, compileDualDialogue, quotes, allTranslations) {
  const epilogueQuotes = quotes.filter(q => q.id >= EPILOGUE_ID_MIN && q.id <= EPILOGUE_ID_MAX);

  // Build target -> pointer-locations index from the epilogue pointer table.
  // A pointer "covers" a quote if its target is within 256 bytes before the
  // quote's start (the pointer may target the block entry point, not the quote).
  const targetToPtrs = new Map();
  for (let p = EPILOGUE_PTR_TABLE_START; p < EPILOGUE_PTR_TABLE_END; p += 4) {
    const target = rom.readUInt32LE(p) - 0x08000000;
    if (target < 0x3b700) continue; // only epilogue targets
    if (!targetToPtrs.has(target)) targetToPtrs.set(target, []);
    targetToPtrs.get(target).push(p);
  }
  // Sorted targets for nearest-coverage lookup
  const sortedTargets = [...targetToPtrs.keys()].sort((a, b) => a - b);

  // Find the covering pointer for a quote offset:
  // the pointer with the largest target that is <= qOff + 0x100
  // and is also >= qOff - 0x100
  function findCoveringPtrs(qOff) {
    const hits = [];
    for (const t of sortedTargets) {
      if (t > qOff + 0x100) break;
      if (t < qOff - 0x100) continue;
      hits.push(...(targetToPtrs.get(t) || []));
    }
    return hits;
  }

  let scratchOffset = EPILOGUE_SCRATCH_START;
  let directPtrs = 0;
  let inPlace    = 0;
  const notInjected = [];
  const noTranslation = [];

  for (const q of epilogueQuotes) {
    const trans = allTranslations[q.id];
    if (!trans || !trans.trim()) { noTranslation.push(q.id); continue; }

    const words      = compileDualDialogue(trans);
    const bytesNeeded = words.length * 2;
    const slotSize    = q.endOffset + 2 - q.byteOffset;

    // Strategy 1: relocate to scratch if a covering pointer-table entry exists.
    // This rewrites the pointer so the riddle-card engine jumps to English.
    const covering = findCoveringPtrs(q.byteOffset);
    if (covering.length) {
      if (scratchOffset + bytesNeeded > EPILOGUE_SCRATCH_END) {
        notInjected.push({ id: q.id, reason: 'scratch-full' });
        continue;
      }
      const dest = scratchOffset;
      for (let i = 0; i < words.length; i++) {
        rom.writeUInt16LE(words[i], dest + i * 2);
      }
      scratchOffset += bytesNeeded;
      while (scratchOffset % 4 !== 0) scratchOffset++;
      for (const p of covering) {
        rom.writeUInt32LE(0x08000000 + dest, p);
      }
      directPtrs++;
      continue;
    }

    // Strategy 2: patch in-place if the translation fits the slot.
    if (bytesNeeded <= slotSize) {
      for (let i = 0; i < words.length; i++) {
        rom.writeUInt16LE(words[i], q.byteOffset + i * 2);
      }
      // Null-pad remainder of slot
      for (let i = bytesNeeded; i < slotSize; i += 2) {
        rom.writeUInt16LE(0x0000, q.byteOffset + i);
      }
      inPlace++;
    } else {
      notInjected.push({ id: q.id, reason: 'slot-too-small', slotSize, bytesNeeded });
    }
  }

  console.log(
    `Epilogue riddle cards: ${directPtrs} direct-pointer relocations, ` +
    `${inPlace} in-place patches, ${notInjected.length} not injected ` +
    `(${noTranslation.length} no-translation).` +
    ` Scratch used ${scratchOffset - EPILOGUE_SCRATCH_START}B of ${EPILOGUE_SCRATCH_END - EPILOGUE_SCRATCH_START}B.`
  );
  if (notInjected.length) {
    const over = notInjected.filter(n => n.reason === 'slot-too-small');
    if (over.length) console.log('  slot-too-small ids:', over.map(n => n.id).join(', '));
    const nf = notInjected.filter(n => n.reason === 'scratch-full');
    if (nf.length) console.log('  scratch-full ids:', nf.map(n => n.id).join(', '));
  }

  const injectedIds = epilogueQuotes.filter(q =>
    !notInjected.some(n => n.id === q.id) &&
    !noTranslation.includes(q.id)
  ).map(q => q.id);

  return {
    directPtrs, inPlace, notInjected, noTranslation,
    injectedIds,
    scratchStart: EPILOGUE_SCRATCH_START,
    scratchEnd:   EPILOGUE_SCRATCH_END,
    scratchUsed:  scratchOffset - EPILOGUE_SCRATCH_START,
  };
}
