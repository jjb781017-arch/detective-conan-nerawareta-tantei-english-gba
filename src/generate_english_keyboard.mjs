import fs from 'fs';

// 6 rows x 15 columns English layout:
// Rows 0..5, Cols 0..14 (3 blocks of 5 cols)
//
// Block 0 (cols 0..4)   Block 1 (cols 5..9)   Block 2 (cols 10..14)
// Row 0: A B C D E      F G H I J             1 2 3 4 5
// Row 1: K L M N O      P Q R S T             6 7 8 9 0
// Row 2: U V W X Y      Z - ' ? !             - ' ? ! .
// Row 3: 1 2 3 4 5      6 7 8 9 0             , : / ( )
// Row 4: . , : / &      ( ) " # *             ! ? - ' "
// Row 5: [Empty]        S P A C E             [Empty]

export const layoutChars = [
  // Row 0
  ['A', 'B', 'C', 'D', 'E',  'F', 'G', 'H', 'I', 'J',  '1', '2', '3', '4', '5'],
  // Row 1
  ['K', 'L', 'M', 'N', 'O',  'P', 'Q', 'R', 'S', 'T',  '6', '7', '8', '9', '0'],
  // Row 2
  ['U', 'V', 'W', 'X', 'Y',  'Z', '-', '\'', '?', '!',  '-', '\'', '?', '!', '.'],
  // Row 3
  ['1', '2', '3', '4', '5',  '6', '7', '8', '9', '0',  ',', ':', '/', '(', ')'],
  // Row 4
  ['.', ',', ':', '/', '&',  '(', ')', '"', '#', '*',  '!', '?', '-', '\'', '"'],
  // Row 5: only Block 1 (middle) has the Spacebar!
  ['', '', '', '', '',       ' ', ' ', ' ', ' ', ' ',   '', '', '', '', '']
];

// Glyph mapping to in-game font IDs:
// A..Z: 0x20..0x39
// 0..9: 0x01..0x0A (0 is 0x01, 1 is 0x02, etc.)
// Space: 0x3A
// Empty: 0x00 (cursor cannot navigate here)
// Punctuation:
// !: 0x0B
// ': 0x11
// (: 0x12
// ): 0x13
// -: 0x16
// /: 0x18
// ": 0x0C
// .: 0x3C
// ,: 0x3D
// ?: 0x5E
// :: 0x1F

export function charToGlyphId(ch) {
  if (!ch) return 0x00;
  if (ch >= 'A' && ch <= 'Z') return 0x20 + (ch.charCodeAt(0) - 65);
  if (ch >= '0' && ch <= '9') {
    const d = ch.charCodeAt(0) - 48;
    return d === 0 ? 0x01 : (0x01 + d);
  }
  if (ch === ' ') return 0x3a;
  if (ch === '!') return 0x0b;
  if (ch === '\'') return 0x11;
  if (ch === '(') return 0x12;
  if (ch === ')') return 0x13;
  if (ch === '-') return 0x16;
  if (ch === '/') return 0x18;
  if (ch === '"') return 0x0c;
  if (ch === '.') return 0x3c;
  if (ch === ',') return 0x3d;
  if (ch === '?') return 0x5e;
  if (ch === ':') return 0x1f;
  return 0x00;
}

// Generate the 90-byte ROM table
export function generateEnglishGridTable() {
  const table = Buffer.alloc(90);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 15; c++) {
      const ch = layoutChars[r][c];
      table[r * 15 + c] = charToGlyphId(ch);
    }
  }
  return table;
}
