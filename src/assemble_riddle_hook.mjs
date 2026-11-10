import fs from 'fs';
import { charToGlyphId } from './generate_english_keyboard.mjs';

// Table entry:
// cardId (1B), pad (1B), varCount (2B), varPtr (4B) -> 8 bytes
// Each variation:
// len (1B), chars (11B) -> 12 bytes

export function buildMultiAnswerData(cardsConfig, baseAddr) {
  const varBuffers = [];
  const tableEntries = [];

  const cardIds = Object.keys(cardsConfig).map(Number).sort((a,b) => a - b);
  const tableSize = (cardIds.length + 1) * 8;
  let varCursor = baseAddr + tableSize;

  for (const cardId of cardIds) {
    const list = cardsConfig[cardId];
    const varBuf = Buffer.alloc(list.length * 12);
    for (let i = 0; i < list.length; i++) {
      const str = list[i].toUpperCase();
      const len = Math.min(str.length, 10);
      varBuf[i * 12] = len;
      for (let c = 0; c < len; c++) {
        varBuf[i * 12 + 1 + c] = charToGlyphId(str[c]);
      }
    }
    const varAddr = varCursor;
    varCursor += varBuf.length;

    const entry = Buffer.alloc(8);
    entry[0] = cardId;
    entry[1] = 0x00;
    entry.writeUInt16LE(list.length, 2);
    entry.writeUInt32LE(varAddr, 4);
    tableEntries.push(entry);
    varBuffers.push(varBuf);
  }

  // End of table marker
  const endEntry = Buffer.alloc(8);
  endEntry[0] = 0xFF;
  tableEntries.push(endEntry);

  return {
    tableBuf: Buffer.concat(tableEntries),
    varsBuf: Buffer.concat(varBuffers),
    totalBytes: tableSize + varBuffers.reduce((a, b) => a + b.length, 0)
  };
}

// Verified Thumb Instruction Builders
const PUSH = (rlist) => 0xb400 | (rlist & 0xff);
const POP  = (rlist) => 0xbc00 | (rlist & 0xff);
const MOVS_IMM = (rd, imm) => 0x2000 | (rd << 8) | (imm & 0xff);
const CMP_IMM  = (rn, imm) => 0x2800 | (rn << 8) | (imm & 0xff);
const ADDS_IMM8 = (rd, imm) => 0x3000 | (rd << 8) | (imm & 0xff);
const SUBS_IMM8 = (rd, imm) => 0x3800 | (rd << 8) | (imm & 0xff);
const ADDS_IMM3 = (rd, rn, imm) => 0x1c00 | ((imm & 7) << 6) | (rn << 3) | rd;
const ADDS_REG = (rd, rn, rm) => 0x1800 | (rm << 6) | (rn << 3) | rd;
const LSLS_IMM = (rd, rm, imm) => 0x0000 | ((imm & 0x1f) << 6) | (rm << 3) | rd;
const CMP_REG  = (rn, rm) => 0x4280 | (rm << 3) | rn;
const LDR_IMM  = (rd, rn, imm) => 0x6800 | (((imm / 4) & 0x1f) << 6) | (rn << 3) | rd;
const LDRB_IMM = (rd, rn, imm) => 0x7800 | ((imm & 0x1f) << 6) | (rn << 3) | rd;
const STRB_IMM = (rd, rn, imm) => 0x7000 | ((imm & 0x1f) << 6) | (rn << 3) | rd;
const LDRH_IMM = (rd, rn, imm) => 0x8800 | (((imm / 2) & 0x1f) << 6) | (rn << 3) | rd;
const BX = (rm) => 0x4700 | (rm << 3);

export function assembleThumbHook(tableAddr) {
  const code = [];
  const labels = new Map();
  const fixups = [];

  function emit(w) { code.push(w & 0xffff); }
  function mark(name) { labels.set(name, code.length); }

  function b(target) {
    fixups.push({ pos: code.length, target, type: 'b' });
    emit(0);
  }
  function beq(target) {
    fixups.push({ pos: code.length, target, type: 'beq' });
    emit(0);
  }
  function bne(target) {
    fixups.push({ pos: code.length, target, type: 'bne' });
    emit(0);
  }

  // push {r4-r7}
  emit(PUSH(0xf0));

  // ldr r5, =0x03000128
  const ldrStatePos = code.length;
  emit(0x4d00); // ldr r5, [pc, #imm]

  // r4 = cardId = [r5, #15]
  emit(LDRB_IMM(4, 5, 15));
  // r6 = user_len = [r5, #14]
  emit(LDRB_IMM(6, 5, 14));
  // r7 = user_chars = r5 + 16
  emit(ADDS_IMM3(7, 5, 0)); // mov r7, r5
  emit(ADDS_IMM8(7, 16));   // r7 += 16

  // ldr r1, =tableAddr
  const ldrTablePos = code.length;
  emit(0x4900); // ldr r1, [pc, #imm]

  mark('search_card');
  emit(LDRB_IMM(0, 1, 0));  // r0 = entry.cardId
  emit(CMP_IMM(0, 0xff));   // end of table?
  beq('check_default');
  emit(CMP_REG(0, 4));      // r0 == cardId?
  beq('found_card');
  emit(ADDS_IMM8(1, 8));    // r1 += 8
  b('search_card');

  mark('found_card');
  emit(LDRH_IMM(2, 1, 2));  // r2 = varCount
  emit(LDR_IMM(3, 1, 4));   // r3 = varPtr

  mark('check_var');
  emit(CMP_IMM(2, 0));      // varCount == 0?
  beq('check_default');
  emit(SUBS_IMM8(2, 1));    // varCount--
  emit(LDRB_IMM(0, 3, 0));  // r0 = var_len
  emit(CMP_REG(0, 6));      // var_len == user_len?
  bne('next_var');

  // Both lengths match, compare characters
  emit(MOVS_IMM(0, 0));     // loop index i = 0

  mark('compare_loop');
  emit(CMP_REG(0, 6));      // i == user_len?
  beq('match_found');
  // r4 = user_chars[i] = [r7 + i]
  emit(ADDS_REG(1, 7, 0));
  emit(LDRB_IMM(4, 1, 0));
  // r1 = var_chars[i] = [r3 + 1 + i]
  emit(ADDS_IMM3(1, 3, 1));
  emit(ADDS_REG(1, 1, 0));
  emit(LDRB_IMM(1, 1, 0));
  // compare r4, r1
  emit(CMP_REG(4, 1));
  bne('next_var_reload');
  emit(ADDS_IMM8(0, 1));    // i++
  b('compare_loop');

  mark('next_var_reload');
  emit(LDRB_IMM(4, 5, 15)); // reload r4 = cardId

  mark('next_var');
  emit(ADDS_IMM8(3, 12));   // r3 += 12
  b('check_var');

  mark('match_found');
  emit(MOVS_IMM(0, 1));     // 1 = CORRECT!
  emit(STRB_IMM(0, 5, 27)); // [r5, #27] = 1
  b('finish');

  mark('check_default');
  emit(LDRB_IMM(4, 5, 15)); // reload r4 = cardId
  // ldr r2, =0x0803b1b0
  const ldrDefaultPos = code.length;
  emit(0x4a00); // ldr r2, [pc, #imm]

  // cardId * 12:
  emit(LSLS_IMM(0, 4, 1));   // r0 = cardId * 2
  emit(ADDS_REG(0, 0, 4));   // r0 = cardId * 3
  emit(LSLS_IMM(0, 0, 2));   // r0 = cardId * 12
  emit(ADDS_IMM8(2, 4));     // r2 += 4
  emit(ADDS_REG(0, 0, 2));   // r0 = 0x0803b1b0 + 4 + cardId * 12
  emit(LDR_IMM(1, 0, 0));    // r1 = ansPtr

  emit(LDRB_IMM(0, 1, 0));   // r0 = ans_len
  emit(CMP_REG(0, 6));       // ans_len == user_len?
  bne('fail');

  emit(MOVS_IMM(0, 0));      // loop index i = 0

  mark('default_comp_loop');
  emit(CMP_REG(0, 6));       // i == user_len?
  beq('success');
  // r4 = user_chars[i] = [r7 + i] (byte)
  emit(ADDS_REG(2, 7, 0));
  emit(LDRB_IMM(4, 2, 0));
  // r2 = ans_chars[i] = [r1 + 2 + i * 2] (halfword)
  emit(LSLS_IMM(2, 0, 1));   // i * 2
  emit(ADDS_IMM8(2, 2));     // i * 2 + 2
  emit(ADDS_REG(2, 1, 2));   // r1 + 2 + i * 2
  emit(LDRH_IMM(2, 2, 0));   // 16-bit halfword
  emit(CMP_REG(4, 2));
  bne('fail');
  emit(ADDS_IMM8(0, 1));     // i++
  b('default_comp_loop');

  mark('success');
  emit(MOVS_IMM(0, 1));      // CORRECT
  emit(STRB_IMM(0, 5, 27));
  b('finish');

  mark('fail');
  emit(MOVS_IMM(0, 2));      // WRONG
  emit(STRB_IMM(0, 5, 27));

  mark('finish');
  // pop {r4-r7}
  emit(POP(0xf0));
  // ldr r3, =0x08048b59
  const ldrReturnPos = code.length;
  emit(0x4b00); // ldr r3, [pc, #imm]
  emit(BX(3));  // bx r3

  // Literal pool (align 4)
  if (code.length % 2 !== 0) emit(0x46c0); // nop

  const litStatePos = code.length;
  code.push(0x0128, 0x0300); // 0x03000128

  const litTablePos = code.length;
  code.push(tableAddr & 0xffff, (tableAddr >> 16) & 0xffff);

  const litDefaultPos = code.length;
  code.push(0xb1b0, 0x0803); // 0x0803b1b0

  const litReturnPos = code.length;
  code.push(0x8b59, 0x0804); // 0x08048b59

  // Resolve PC-relative LDRs:
  function resolveLdr(pcIndex, targetIndex, reg) {
    const pcAddr = pcIndex * 2;
    const alignedPc = (pcAddr + 4) & ~3;
    const targetAddr = targetIndex * 2;
    const offset = targetAddr - alignedPc;
    const imm = offset / 4;
    code[pcIndex] = 0x4800 | (reg << 8) | (imm & 0xff);
  }

  resolveLdr(ldrStatePos, litStatePos, 5);
  resolveLdr(ldrTablePos, litTablePos, 1);
  resolveLdr(ldrDefaultPos, litDefaultPos, 2);
  resolveLdr(ldrReturnPos, litReturnPos, 3);

  // Resolve branches
  for (const f of fixups) {
    const targetIdx = labels.get(f.target);
    const offsetWords = targetIdx - f.pos - 2; // (target - (pc + 4)) / 2
    if (f.type === 'b') {
      code[f.pos] = 0xe000 | (offsetWords & 0x7ff);
    } else if (f.type === 'beq') {
      code[f.pos] = 0xd000 | (offsetWords & 0xff);
    } else if (f.type === 'bne') {
      code[f.pos] = 0xd100 | (offsetWords & 0xff);
    }
  }

  const buf = Buffer.alloc(code.length * 2);
  for (let i = 0; i < code.length; i++) buf.writeUInt16LE(code[i], i * 2);
  return buf;
}
