#!/usr/bin/env node
/**
 * Pure Node.js BPS (Beat / Floating IPS) patch generator and applier.
 *
 * Implements the standard BPS specification with zero external dependencies.
 * Compatible with Flips (Floating IPS), Romhacking.net, and emulator patchers.
 */

import fs from 'fs';
import path from 'path';

export function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

export function writeVlq(val, out) {
  while (true) {
    let b = val & 0x7f;
    val >>>= 7;
    if (val === 0) {
      out.push(0x80 | b);
      break;
    }
    out.push(b);
    val--;
  }
}

export function readVlq(buf, posRef) {
  let val = 0, shift = 1;
  while (true) {
    if (posRef.pos >= buf.length) throw new Error('Unexpected EOF reading BPS VLQ');
    const b = buf[posRef.pos++];
    val += (b & 0x7f) * shift;
    if (b & 0x80) break;
    shift <<= 7;
    val += shift;
  }
  return val;
}

/**
 * Creates a standard BPS patch from source buffer to target buffer.
 */
export function createBpsPatch(source, target, metadata = '') {
  const patch = [];
  // Magic 'BPS1'
  patch.push(0x42, 0x50, 0x53, 0x31);
  writeVlq(source.length, patch);
  writeVlq(target.length, patch);

  const metaBuf = Buffer.from(metadata, 'utf8');
  writeVlq(metaBuf.length, patch);
  for (let i = 0; i < metaBuf.length; i++) {
    patch.push(metaBuf[i]);
  }

  let tPos = 0;
  while (tPos < target.length) {
    // Check match with source at same position
    let sMatchLen = 0;
    while (
      tPos + sMatchLen < target.length &&
      tPos + sMatchLen < source.length &&
      source[tPos + sMatchLen] === target[tPos + sMatchLen]
    ) {
      sMatchLen++;
    }

    if (sMatchLen > 0) {
      // SourceRead (Action 0)
      writeVlq(((sMatchLen - 1) << 2) | 0, patch);
      tPos += sMatchLen;
      continue;
    }

    // Literal mismatch: collect bytes until next match run (>= 4 bytes)
    let litLen = 0;
    while (tPos + litLen < target.length) {
      if (tPos + litLen < source.length && source[tPos + litLen] === target[tPos + litLen]) {
        let testLen = 0;
        while (
          tPos + litLen + testLen < target.length &&
          tPos + litLen + testLen < source.length &&
          source[tPos + litLen + testLen] === target[tPos + litLen + testLen]
        ) {
          testLen++;
        }
        if (testLen >= 4) break;
      }
      litLen++;
    }

    if (litLen > 0) {
      // TargetRead (Action 1)
      writeVlq(((litLen - 1) << 2) | 1, patch);
      for (let i = 0; i < litLen; i++) {
        patch.push(target[tPos + i]);
      }
      tPos += litLen;
    }
  }

  // Footer: source CRC32, target CRC32, patch CRC32
  const pBuf = Buffer.from(patch);
  const footer = Buffer.alloc(12);
  footer.writeUInt32LE(crc32(source), 0);
  footer.writeUInt32LE(crc32(target), 4);

  const fullWithoutPatchCrc = Buffer.concat([pBuf, footer.subarray(0, 8)]);
  footer.writeUInt32LE(crc32(fullWithoutPatchCrc), 8);
  return Buffer.concat([fullWithoutPatchCrc, footer.subarray(8, 12)]);
}

/**
 * Applies a standard BPS patch to a source buffer.
 */
export function applyBpsPatch(source, patch) {
  if (patch.length < 16 || patch.toString('ascii', 0, 4) !== 'BPS1') {
    throw new Error('Invalid BPS patch file (header magic mismatch)');
  }

  const posRef = { pos: 4 };
  const srcLen = readVlq(patch, posRef);
  const dstLen = readVlq(patch, posRef);
  const metaLen = readVlq(patch, posRef);
  posRef.pos += metaLen;

  if (source.length !== srcLen) {
    console.warn(`[Warning] Source size (${source.length}) does not match expected patch source size (${srcLen})`);
  }

  const target = Buffer.alloc(dstLen);
  let tPos = 0;
  let sOffset = 0, tOffset = 0;

  while (posRef.pos < patch.length - 12) {
    const data = readVlq(patch, posRef);
    const action = data & 3;
    const length = (data >>> 2) + 1;

    if (action === 0) {
      // SourceRead
      for (let i = 0; i < length; i++) target[tPos + i] = source[tPos + i];
      tPos += length;
    } else if (action === 1) {
      // TargetRead
      for (let i = 0; i < length; i++) target[tPos + i] = patch[posRef.pos++];
      tPos += length;
    } else if (action === 2) {
      // SourceCopy
      const offData = readVlq(patch, posRef);
      sOffset += (offData & 1 ? -1 : 1) * (offData >>> 1);
      for (let i = 0; i < length; i++) target[tPos + i] = source[sOffset + i];
      tPos += length;
      sOffset += length;
    } else if (action === 3) {
      // TargetCopy
      const offData = readVlq(patch, posRef);
      tOffset += (offData & 1 ? -1 : 1) * (offData >>> 1);
      for (let i = 0; i < length; i++) target[tPos + i] = target[tOffset + i];
      tPos += length;
      tOffset += length;
    }
  }

  // Verify target CRC32
  const expectedTargetCrc = patch.readUInt32LE(patch.length - 8);
  const actualTargetCrc = crc32(target);
  if (actualTargetCrc !== expectedTargetCrc) {
    throw new Error(`CRC32 mismatch on patched output! Expected 0x${expectedTargetCrc.toString(16)}, got 0x${actualTargetCrc.toString(16)}`);
  }

  return target;
}

// CLI Interface
if (process.argv[1] && process.argv[1].endsWith('bps.mjs')) {
  const [cmd, srcFile, patchOrTgtFile, outFile] = process.argv.slice(2);
  if (cmd === 'create' && srcFile && patchOrTgtFile && outFile) {
    const src = fs.readFileSync(srcFile);
    const tgt = fs.readFileSync(patchOrTgtFile);
    console.log(`Creating BPS patch: ${srcFile} -> ${patchOrTgtFile}...`);
    const p = createBpsPatch(src, tgt);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, p);
    console.log(`Wrote patch to ${outFile} (${p.length} bytes)`);
  } else if (cmd === 'apply' && srcFile && patchOrTgtFile && outFile) {
    const src = fs.readFileSync(srcFile);
    const p = fs.readFileSync(patchOrTgtFile);
    console.log(`Applying BPS patch: ${patchOrTgtFile} to ${srcFile}...`);
    const tgt = applyBpsPatch(src, p);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, tgt);
    console.log(`Wrote patched file to ${outFile} (${tgt.length} bytes)`);
  } else {
    console.log('Usage:');
    console.log('  node bps.mjs create <clean.gba> <translated.gba> <out.bps>');
    console.log('  node bps.mjs apply <clean.gba> <patch.bps> <out.gba>');
  }
}
