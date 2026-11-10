import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Fix stale sub-script pointers in the translated ROM.
//
// Problem
// -------
// The build relocates the 81 master scenes to 0x800000+, and rewrites the master
// scene table. But many scenes contain *nested sub-scripts* whose headers are
// referenced by their own pointers (ARM literal pools / tables) outside the
// master table. Those pointers still point into the original Japanese script
// region, so the game shows Japanese for those sub-scripts.
//
// Approach
// --------
// 1. The build recompiles each scene word-by-word, copying every non-quote word
//    verbatim and replacing only translated quote spans. So an *exact*
//    sequential alignment between the clean scene and its relocated copy exists.
//    We recover it by walking both buffers in lock-step and, at every quote,
//    resynchronising on the verbatim run that follows the compiled quote.
//    This yields an exact origOffset -> relocatedOffset map for every verbatim
//    byte, including nested sub-script headers whose offsets shifted.
// 2. We only patch pointers whose target is a verified sub-script header
//    (the 0xff20 0000 ff07 0002 signature). Everything else in the 0x0800xxxx
//    range is overwhelmingly coincidental data (0x0000, 0x5f00, ... words),
//    and patching those would corrupt unrelated tables.
import fs from 'fs';

const CLEAN_PATH = process.env.CONAN_CLEAN_ROM || path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba');
const ROM_PATH   = path.resolve(__dirname, '../build/Detective Conan - English Translated.gba');
const MANIFEST_PATH = path.resolve(__dirname, '../build/build_manifest.json');
const QUOTES_PATH   = path.resolve(__dirname, '../data/extracted_dialogue.json');
const NARRATION_PATH = path.resolve(__dirname, '../data/narration_translations.json');

const SCRIPT_END_ORIG = 0x3b1a4; // sentinel appended to uniqueStarts by the build

export function remapScenePointers(rom, options = {}) {
  const clean = options.clean || fs.readFileSync(CLEAN_PATH);
  const manifest = options.manifest || JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const dryRun = options.dryRun ?? false;

  // ---- Scene table ------------------------------------------------------------
  const scenes = manifest.scenes
    .map(s => ({ orig: parseInt(s.origStart, 16), rel: parseInt(s.romPointer, 16) }))
    .sort((a, b) => a.orig - b.orig);

  const SCRIPT_START = parseInt(manifest.scriptRegionStart, 16);
  const SCRIPT_END   = parseInt(manifest.scriptRegionEnd, 16);

  for (let i = 0; i < scenes.length; i++) {
    scenes[i].origEnd = (i + 1 < scenes.length) ? scenes[i + 1].orig : SCRIPT_END_ORIG;
    scenes[i].relFile = scenes[i].rel - 0x08000000;
    scenes[i].nextRelFile = (i + 1 < scenes.length) ? scenes[i + 1].rel - 0x08000000 : SCRIPT_END;
  }

  function findScene(origOff) {
    let lo = 0, hi = scenes.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (scenes[mid].orig <= origOff) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  // ---- Quote spans ------------------------------------------------------------
  const quotes = JSON.parse(fs.readFileSync(QUOTES_PATH, 'utf8'))
    .map(q => ({ start: q.byteOffset, end: q.endOffset + 2, id: q.id }))
    .sort((a, b) => a.start - b.start);

  const narrationSpans = fs.existsSync(NARRATION_PATH)
    ? JSON.parse(fs.readFileSync(NARRATION_PATH, 'utf8'))
        .map(n => ({ start: parseInt(n.offset, 16), end: parseInt(n.endOffset, 16), id: 'nar' + n.index }))
    : [];

  const spans = [...quotes, ...narrationSpans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const sp of spans) {
    if (merged.length && sp.start < merged[merged.length - 1].end) continue;
    merged.push(sp);
  }
  const quoteStarts = merged.map(q => q.start);

  function firstQuoteAtOrAfter(o) {
    let lo = 0, hi = quoteStarts.length - 1, ans = merged.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (quoteStarts[mid] >= o) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }
  function quoteContaining(o) {
    const i = firstQuoteAtOrAfter(o);
    for (const j of [i - 1, i]) {
      if (j >= 0 && j < merged.length && merged[j].start <= o && o < merged[j].end) return merged[j];
    }
    return null;
  }

  // ---- Sub-script headers -----------------------------------------------------
  const headerSet = new Set();
  for (let i = 0xeb40; i < SCRIPT_END_ORIG; i += 2) {
    if (clean.readUInt16LE(i) === 0xff20 &&
        clean.readUInt16LE(i + 2) === 0x0000 &&
        clean.readUInt16LE(i + 4) === 0xff07 &&
        clean.readUInt16LE(i + 6) === 0x0002) {
      headerSet.add(i);
    }
  }

  // ---- Exact scene alignment --------------------------------------------------
  const MAX_GAP = 0x1000;
  const SIG_BYTES = 64;
  const MAX_RUNS = 4;

  function buildRuns(from, sceneEnd) {
    const runs = [];
    let p = from;
    let gathered = 0;
    while (p < sceneEnd && runs.length < MAX_RUNS && gathered < SIG_BYTES) {
      const q = quoteContaining(p);
      if (q) { p = q.end; continue; }
      const qi = firstQuoteAtOrAfter(p);
      const nextQ = qi < merged.length && merged[qi].start < sceneEnd ? merged[qi] : null;
      const stop = nextQ ? nextQ.start : sceneEnd;
      const len = Math.min(stop - p, SIG_BYTES - gathered);
      if (len > 0) {
        runs.push(clean.subarray(p, p + len));
        gathered += len;
        p += len;
      }
      if (nextQ) p = nextQ.end; else break;
    }
    return runs;
  }

  function findRunMatches(buf, lo, hi, runs) {
    const out = [];
    if (!runs.length || runs[0].length === 0) return out;
    const r0 = runs[0];
    const limit = Math.min(hi, buf.length - r0.length);
    let idx = lo;
    while (idx <= limit) {
      const hit = buf.indexOf(r0, idx);
      if (hit === -1 || hit > limit) break;
      let pos = hit + r0.length;
      let ok = true;
      for (let i = 1; i < runs.length; i++) {
        const r = runs[i];
        const found = buf.indexOf(r, pos);
        if (found === -1 || found - pos > MAX_GAP) { ok = false; break; }
        pos = found + r.length;
      }
      if (ok) out.push(hit);
      idx = hit + 1;
    }
    return out;
  }

  function alignScene(S) {
    const origEnd = S.origEnd;
    const relEnd = Math.min(S.nextRelFile, rom.length);
    const segs = [];

    let startA = S.orig;
    const cont = quoteContaining(startA);
    if (cont && cont.start < startA) startA = cont.end;

    let posA = startA;
    let posB = S.relFile;

    while (posA < origEnd) {
      const qi = firstQuoteAtOrAfter(posA);
      const q = (qi < merged.length && merged[qi].start < origEnd) ? merged[qi] : null;
      const chunkEnd = q ? q.start : origEnd;
      const len = chunkEnd - posA;

      if (len > 0) {
        if (clean.subarray(posA, posA + len).compare(rom.subarray(posB, posB + len)) !== 0) {
          return null;
        }
        segs.push({ a0: posA, a1: chunkEnd, delta: posB - posA });
        posA = chunkEnd;
        posB += len;
      }

      if (!q) break;

      posA = q.end;
      if (posA >= origEnd) break;

      const runs = buildRuns(posA, origEnd);
      if (runs.length === 0) {
        const left = origEnd - posA;
        if (left > 0) segs.push({ a0: posA, a1: origEnd, delta: posB - posA });
        break;
      }

      const matches = findRunMatches(rom, posB, relEnd, runs);
      if (matches.length === 0) return null;

      const chosenB = matches[0];
      posB = chosenB;
    }
    return segs;
  }

  const alignments = new Map();
  let alignFail = 0;
  for (const S of scenes) {
    const segs = alignScene(S);
    if (!segs) { alignFail++; continue; }
    alignments.set(S.orig, segs);
  }

  function mapOffset(origOff) {
    const si = findScene(origOff);
    if (si === -1) return null;
    const S = scenes[si];
    const segs = alignments.get(S.orig);
    if (!segs) return null;
    for (const seg of segs) {
      if (origOff >= seg.a0 && origOff < seg.a1) return origOff + seg.delta;
    }
    return null;
  }

  // ---- Scan pointers ----------------------------------------------------------
  const SCENE_MIN = 0x0800eb40;
  const SCENE_MAX = 0x0803e90a;
  const ORIG_SCRIPT_LO = 0xeb40, ORIG_SCRIPT_HI = SCRIPT_END_ORIG;

  function inExcludedRegion(off) {
    if (off >= ORIG_SCRIPT_LO && off < ORIG_SCRIPT_HI) return true;
    if (off >= SCRIPT_START && off < SCRIPT_END) return true;
    return false;
  }

  const patches = [];
  let headerPtrs = 0, alreadyFixed = 0, mappedFail = 0;

  // Sub-script pointers only reside in code / literal pools / asset tables (< 0x0c0000).
  // The compressed asset region starts at 0x0c0e3c, and the expanded ROM starts at 0x800000.
  // Scanning asset or expanded data would falsely match coincidental bytes and corrupt assets.
  const SCAN_LIMIT = Math.min(rom.length - 3, 0x0c0000);
  for (let off = 0; off < SCAN_LIMIT; off += 4) {
    if (inExcludedRegion(off)) continue;
    const v = rom.readUInt32LE(off);
    if (v < SCENE_MIN || v >= SCENE_MAX) continue;

    const o = v - 0x08000000;
    if (o >= SCRIPT_END_ORIG) continue;

    // Must point to a valid script bytecode opcode (0xFFxx)
    const w0 = clean.readUInt16LE(o);
    if ((w0 & 0xff00) !== 0xff00) continue;

    headerPtrs++;
    const newOff = mapOffset(o);
    if (newOff === null) { mappedFail++; continue; }

    const newVal = 0x08000000 + newOff;
    if (newVal === v) { alreadyFixed++; continue; }

    const n = Math.min(4, SCRIPT_END_ORIG - o);
    if (clean.subarray(o, o + n).compare(rom.subarray(newOff, newOff + n)) !== 0) {
      mappedFail++;
      continue;
    }

    patches.push({ off, oldVal: v, newVal, target: o, newOffset: newOff });
    if (!dryRun) {
      rom.writeUInt32LE(newVal, off);
    }
  }

  console.log(`[SCENE POINTERS] Aligned ${alignments.size}/${scenes.length} scenes; patched ${patches.length} ARM sub-script pointers (${alreadyFixed} already correct, ${mappedFail} failed)`);
  return { patchedCount: patches.length, patches, alignmentsCount: alignments.size };
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('remap-scene-pointers.mjs')) {
  const DRY_RUN = process.env.DRY_RUN !== '0';
  for (const romPath of [path.resolve(__dirname, '../build/Detective Conan - English Translated.gba'), path.resolve(__dirname, '../build/Detective Conan - working copy.gba')]) {
    if (fs.existsSync(romPath)) {
      const rom = fs.readFileSync(romPath);
      const res = remapScenePointers(rom, { dryRun: DRY_RUN });
      if (!DRY_RUN && res.patchedCount > 0) {
        fs.writeFileSync(romPath, rom);
        console.log(`Updated ${romPath}`);
      }
    }
  }
}
