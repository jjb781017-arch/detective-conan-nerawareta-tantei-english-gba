// work/nameplate-patch.mjs
//
// Thumb rewrite of FUN_08041090, the speaker-name-plate drawer.
//
// The retail function is called once per revealed glyph from 0x41442. It read
// the current name index from 0x030000B5, then:
//   * drew a FIXED number of name slots (3 in the retail ROM, 8 in our first
//     English build) and left the text cursor after them, so line 1 text always
//     started at the same x no matter how long the name was;
//   * when the cursor was not at the text origin (i.e. on line 2, after 0xFF02),
//     drew 3 blank slots instead - that was the line-2 indent.
//
// The rewrite:
//   * draws the name until the table's 0x0000 terminator. The terminator is
//     drawn too (one blank 12 px slot), so it doubles as the gap between the
//     name plate and the dialogue text;
//   * caps the plate at 8 name glyphs and draws one extra blank slot if all 8
//     are used, so a full-length name still gets its gap;
//   * returns immediately when the cursor is not at the text origin, so line 2
//     starts at the box's left edge, x = 8.
//
// Result: line 1 text starts at x = 8 + 12 * min(nameLen + 1, 9), and a box with
// no name plate (name index 0) starts at x = 8.
//
// The name table is 16 bytes per entry and lives wherever the caller puts it
// (0x08F00000 in the release build).

export const NAMEPLATE_ADDR = 0x41090;

/** Name table entry stride: lsls r0,r0,#4. */
export const NAMEPLATE_STRIDE = 16;

export const NAMEPLATE_ASM = [
  0xb5f0,             // push {r4,r5,r6,r7,lr}
  0x1c05,             // add  r5,r0,#0
  0x4a15,             // ldr  r2,[pc,#0x54]  -> 0x030000B5 (name index)
  0x7810,             // ldrb r0,[r2,#0]
  0x2800,             // cmp  r0,#0
  0xd024,             // beq  0x410e6        (no name plate)
  0x6b29,             // ldr  r1,[r5,#0x30]
  0x6aa8,             // ldr  r0,[r5,#0x28]
  0x4281,             // cmp  r1,r0
  0xd120,             // bne  0x410e6        (Y != originY -> line 2: draw nothing)
  0x6b69,             // ldr  r1,[r5,#0x34]
  0x6ae8,             // ldr  r0,[r5,#0x2c]
  0x4281,             // cmp  r1,r0
  0xd11c,             // bne  0x410e6        (X != originX -> mid line: draw nothing)
  0x7810,             // ldrb r0,[r2,#0]
  0x3801,             // subs r0,#1
  0x0100,             // lsls r0,r0,#4       16 bytes per entry
  0x490f,             // ldr  r1,[pc,#0x3c]  -> 0x08F00000 (name table)
  0x1846,             // adds r6,r0,r1
  0x2400,             // movs r4,#0
  0x0060,             // lsls r0,r4,#1
  0x1980,             // adds r0,r0,r6
  0x8801,             // ldrh r1,[r0,#0]
  0x1c0f,             // add  r7,r1,#0
  0x1c28,             // add  r0,r5,#0
  0xf000, 0xf817,     // bl   0x410f4
  0x3401,             // adds r4,#1
  0x2f00,             // cmp  r7,#0
  0xd00c,             // beq  0x410e6        (terminator drawn: it was the gap)
  0x2c08,             // cmp  r4,#8
  0xd3f3,             // bcc  0x410b8
  0x1c28,             // add  r0,r5,#0
  0x2100,             // movs r1,#0
  0xf000, 0xf80e,     // bl   0x410f4        (separator blank when all 8 slots are used)
  0xe005,             // b    0x410e6
  0x46c0, 0x46c0, 0x46c0, 0x46c0, 0x46c0, 0x46c0, // nop padding
  0xbcf0,             // pop  {r4,r5,r6,r7}
  0xbc01,             // pop  {r0}
  0x4700,             // bx   r0
];

if (NAMEPLATE_ASM.length !== 46) {
  throw new Error('nameplate patch must be 46 halfwords (got ' + NAMEPLATE_ASM.length + ')');
}

/** Literal pool the rewritten function reads from. */
export const NAMEPLATE_LITERALS_ADDR = NAMEPLATE_ADDR + NAMEPLATE_ASM.length * 2; // 0x410ec
export const NAME_INDEX_PTR = 0x030000b5;

/** Write the rewrite (plus its literal pool) into `rom`. */
export function applyNameplatePatch(rom, tableAddr) {
  for (let i = 0; i < NAMEPLATE_ASM.length; i++) {
    rom.writeUInt16LE(NAMEPLATE_ASM[i], NAMEPLATE_ADDR + i * 2);
  }
  rom.writeUInt32LE(NAME_INDEX_PTR, NAMEPLATE_LITERALS_ADDR);
  rom.writeUInt32LE(0x08000000 + tableAddr, NAMEPLATE_LITERALS_ADDR + 4);
}

/**
 * @returns {string[]} human-readable problems; empty means the ROM holds the
 *   rewrite and its literal pool exactly as expected.
 */
export function verifyNameplatePatch(rom, tableAddr) {
  const problems = [];
  for (let i = 0; i < NAMEPLATE_ASM.length; i++) {
    const addr = NAMEPLATE_ADDR + i * 2;
    const got = rom.readUInt16LE(addr);
    if (got !== NAMEPLATE_ASM[i]) {
      problems.push(`0x${addr.toString(16)}: expected ${NAMEPLATE_ASM[i].toString(16)}, got ${got.toString(16)}`);
    }
  }
  const idxPtr = rom.readUInt32LE(NAMEPLATE_LITERALS_ADDR);
  if (idxPtr !== NAME_INDEX_PTR) {
    problems.push(`0x${NAMEPLATE_LITERALS_ADDR.toString(16)}: name-index pointer is 0x${idxPtr.toString(16)}`);
  }
  const tbl = rom.readUInt32LE(NAMEPLATE_LITERALS_ADDR + 4);
  if (tbl !== (0x08000000 + tableAddr)) {
    problems.push(`0x${(NAMEPLATE_LITERALS_ADDR + 4).toString(16)}: table pointer is 0x${tbl.toString(16)}`);
  }
  return problems;
}
