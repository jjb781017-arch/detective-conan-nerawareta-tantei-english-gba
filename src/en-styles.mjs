// Per-asset style configuration for the English recreations.
//
// Each entry is its own creation: the font, weight, outline, shadow, colours and
// anchor are read off that asset, not inherited from a generic template. The
// shared looks below only cover assets that genuinely share a design.
//
// erase:
//   mode  'holes' | 'recolor' | 'flat'
//   box   search/erase rectangle
//   ink   glyph ink palette indices (recolor)
//   bg    background palette indices instead of ink (recolor)
//   face  plate face index (holes)
// draw:
//   face      BOLD9 | COND7 | COND6 | THIN7
//   tracking  extra pixels between glyphs
//   scale     integer pixel magnification (comic lettering)
//   dilate    thicken the letterform by N pixels (fat comic lettering)
//   style     hollow | fill | shadow | bevel | outline3
//   fill / outline / shadow / highlight / dark / shadowDX / shadowDY
//   cx / top / left / valign / maxW
// lines:  array of draw specs for multi-line assets

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

// --- shared looks -----------------------------------------------------------
// 64x32 pill plate: authentic filled lettering on clean white plate face (face: 14)
// YES: light blue fill (Index 3) with dark outline (Index 1)
const PLATE_YES = {
  text: 'YES',
  erase: { mode: 'holes', box: box(4, 3, 59, 22) },
  draw: { face: 'BOLD9', tracking: 4, style: 'fill', fill: 3, outline: 1, valign: 'center' },
};

// NO: vibrant orange fill (Index 10) with dark outline (Index 1)
const PLATE_NO = {
  text: 'NO',
  erase: { mode: 'holes', box: box(4, 3, 59, 22) },
  draw: { face: 'BOLD9', tracking: 4, style: 'fill', fill: 10, outline: 1, valign: 'center' },
};

// Grey bar with white outlined lettering, left-aligned like the kana.
const bar = (text, W) => ({
  text,
  erase: { mode: 'rows', ink: [15, 1, 3], dilateInk: [2], dilatePasses: 2, box: box(0, 3, W - 1, 21) },
  draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 15, outline: 1, left: 1, maxW: W - 2, valign: 'center' },
});

// Title Scenario select bar (cyan/white gradient bar with crimson bottom shadow)
const scenarioBar = (text, W) => ({
  text,
  erase: {
    mode: 'rows',
    ink: [15, 1, 2, 3],
    box: box(0, 3, W - 1, 17),
    bgRows: {
      6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0,
      12: 13, 13: 13, 14: 13, 15: 13, 16: 14, 17: 13
    }
  },
  draw: { face: 'COND7', faces: ['COND7', 'COND6'], tracking: 1, style: 'fill', fill: 15, outline: 1, left: 1, maxW: W - 2, valign: 'center' },
});

// Dark rounded capsule: light grey text with black outline. The Japanese fills
// the pill right up to its rim, so the frame is reconstructed by flooding in
// from the outer edge rather than by matching glyph colours. The pill is often
// narrower than the full canvas, so `cx`/`maxW` can be pinned to its real body.
const capsule = (text, W, y0, y1, opts = {}) => ({
  text,
  erase: {
    mode: 'frame', body: 5, rimColours: [4], frameColours: [4],
    box: box(1, y0, W - 2, y1),
  },
  draw: {
    face: opts.face ?? 'COND7',
    faces: opts.faces ?? ['COND7'],
    tracking: opts.tracking ?? 1,
    scale: opts.scale ?? 1,
    dilate: opts.dilate ?? 0,
    slant: opts.slant ?? 0,
    minTrack: opts.minTrack ?? 0,
    style: 'fill', fill: 14, outline: 1,
    cx: opts.cx ?? W / 2, maxW: opts.maxW ?? W - 30, valign: 'center',
  },
});

// Starburst comic. Measured off the originals: the kana ink is 150x32 px on the
// 176px bursts and 115x42 on the 128px ones, with 7px strokes. English needs
// roughly twice as many letters, so the lettering is set at 3x to reach that
// height and the face is picked to keep the strokes at the same weight:
//   * 176px bursts have room for COND7/COND6B (2px stems at 1x = 6px at 3x), so
//     no extra dilation is needed - dilating them turns the counters to mush.
//   * 128px bursts have to fit 8 letters in 115px, i.e. the 5px COND5 face,
//     which already carries 2px stems at 1x (6px at 3x) and needs no dilation.
// Both are set on a lean, which is why the draw spec shears the glyphs and the
// exclamation mark is pre-slanted in en-fonts.mjs.
const burst = (text, W, H, fill, y0, y1, extra = {}) => ({
  text,
  erase: { mode: 'recolor', bg: [0, 11, 12, 13], box: box(2, y0, W - 3, y1) },
  draw: {
    face: 'COND7', faces: ['COND7', 'COND6B', 'COND5'], tracking: 4, scale: 3, dilate: 0, slant: 0.2,
    style: 'shadow', fill, outline: 14, shadow: 2, shadowDX: 3, shadowDY: 4,
    cx: W / 2, maxW: W - 18, valign: 'center',
    ...extra,
  },
});

// 128x64 starbursts: same comic style as the 176px ones, but an 8-letter word
// has to fit the 115px the kana occupy, so the face is the 5px COND5 set at 3x.
const burstBig = (text, fill, extra = {}) => ({
  text,
  erase: { mode: 'recolor', bg: [0, 11, 12, 13], box: box(2, 4, 125, 59) },
  draw: {
    face: 'COND5', faces: ['COND5'], tracking: 1, scale: 3, dilate: 1, slant: 0.14, minTrack: 0,
    style: 'shadow', fill, outline: 14, shadow: 2, shadowDX: 3, shadowDY: 4,
    cx: 64, maxW: 122, valign: 'center',
    ...extra,
  },
});

// ---------------------------------------------------------------------------
// 128x64 answer plates: a bordered card with a large word stamped on it. The
// glyphs are the same index as the card's border, so the card edge is rebuilt by
// flooding in from outside and the glyph is whatever is left inside. The corner
// anti-aliasing of the border shares its index with the glyph's AA, so it is
// listed in frameColours: the flood only reaches the two corner pixels, and the
// glyph's own AA stays in the erase mask.

// 96x64 triple label strip: three white bars with a right-hand gradient, dark
// lettering at the left of each bar.
const tripleBar = (texts) => ({
  lines: texts.map((t, i) => ({
    text: t,
    rows: [2 + i * 24, 13 + i * 24],
    draw: {
      face: 'COND7', faces: ['COND7', 'COND6B'], tracking: 2, minTrack: 0,
      style: 'fill', fill: 1, outline: 4, left: 2, maxW: 92, valign: 'center',
    },
  })),
  erase: { mode: 'recolor', ink: [1, 3, 4], box: box(1, 1, 94, 62) },
});

// 64x64 d-pad: five keycaps. Four carry a compass kanji and one already reads
// STOP, so only the four directions are replaced. The pressed keycap is drawn in
// the plate's own pressed palette (grey face, darker glyph) while the rest are
// white-faced; both are separated from their 1px rim by flooding the box edge.
const dpadPlate = (b, pressed) => ({
  erase: { mode: 'holes', face: pressed ? 12 : 15, box: box(b[0], b[1], b[2], b[3]) },
  draw: {
    face: 'MINI9', faces: ['MINI9'], tracking: 0,
    style: 'fill', fill: pressed ? 10 : 13, outline: null,
    cx: (b[0] + b[2]) / 2, top: b[1] + 2,
  },
});

const DPAD_N = [21, 9, 42, 22];
const DPAD_W = [0, 25, 19, 38];
const DPAD_E = [44, 26, 63, 38];
const DPAD_S = [21, 41, 42, 54];

const dpad = (pressed) => ({
  items: [
    { ...dpadPlate(DPAD_N, pressed === 'N'), text: 'N' },
    { ...dpadPlate(DPAD_W, pressed === 'W'), text: 'W' },
    { ...dpadPlate(DPAD_E, pressed === 'E'), text: 'E' },
    { ...dpadPlate(DPAD_S, pressed === 'S'), text: 'S' },
  ],
});

// ---------------------------------------------------------------------------
// 240x160 gadget cards. A framed picture at the top, a title line at the head of
// a white card, then three lines of instruction text. The original sets both in
// a dense 10-11px kana; COND6's 1px stems at 12px read as a grey smear, so the
// recreation uses COND7 (2px stems) for both the title and the body and puts the
// body on a 13px pitch so the three lines never touch. The card's own 1px border
// and inner AA column are index 1/14 as well, so both erase boxes stop one pixel
// inside them.
const gadgetCard = (title, lines, row0 = 98) => ({
  items: [
    {
      erase: { mode: 'recolor', ink: [8, 14], box: box(19, 83, 221, 96) },
      draw: {
        face: 'COND7', faces: ['COND7'], tracking: 1, style: 'fill', fill: 1, outline: null,
        cx: 120, top: 84, maxW: 196,
      },
      text: title,
    },
    {
      erase: { mode: 'recolor', ink: [1, 14], box: box(19, 97, 221, 136) },
      lines: lines.map((t, i) => ({
        text: t,
        rows: [row0 + i * 13, row0 + 12 + i * 13],
        draw: {
          face: 'COND7', faces: ['COND7'], tracking: 1, minTrack: 0,
          style: 'fill', fill: 1, outline: null,
          left: 22, top: row0 + i * 13, maxW: 198,
        },
      })),
    },
  ],
});

// 240x160 case-title card: a plain white screen carrying large architectural
// display lettering. The original is a blocky structural sans whose letter
// interiors are filled with diagonal hatching lines, like a pen sketch on a
// blueprint, so the English uses the `crosshatch` style: a heavy 2px outline, a
// mid-grey body and light diagonal hatching clipped to the glyph. English titles
// are two to three times longer than the kana, so they run on two centred lines
// at COND7's scale-2 size (14x24 per glyph).
const titleCard = (lines) => {
  const pitch = 30;
  const top0 = lines.length > 1 ? 46 : 62;
  return {
    erase: { mode: 'recolor', bg: [15], box: box(0, 0, 239, 159) },
    lines: lines.map((t, i) => ({
      text: t,
      rows: [top0 + i * pitch, top0 + i * pitch + 25],
      draw: {
        face: 'COND7', faces: ['COND7'], scale: 2, tracking: 1, minTrack: 0,
        style: 'crosshatch', fill: 6, hatch: 13, outline: 1, outlineWidth: 2,
        cx: 120, top: top0 + i * pitch, maxW: 226,
      },
    })),
  };
};

// ---------------------------------------------------------------------------
export const ASSETS = {
  // --- 64x32 pill plates: authentic filled YES / NO ---------------------
  '0x2171': PLATE_YES,
  '0x2173': PLATE_NO,
  '0xd4a':  PLATE_YES,
  '0xd4c':  PLATE_NO,
  '0x30fe': PLATE_YES,
  '0x30e8': PLATE_NO,

  // --- title screen banners (already English in original ROM) -----------
  '0x2165': { text: 'PUSH START', passthrough: true },
  '0x2167': { text: 'NEW GAME', passthrough: true },
  '0x2169': { text: 'LOAD GAME', passthrough: true },
  '0x216b': { text: 'CONTINUE', passthrough: true },

  // --- 64x32 BACK plate: solid grey fill, black outline ------------------
  '0x216f': {
    text: 'BACK',
    erase: { mode: 'holes', box: box(2, 2, 61, 23), clip: box(6, 4, 44, 20) },
    draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 10, outline: 1, cx: 25, valign: 'center' },
  },

  // --- grey bar + white outlined text (LEVEL n) --------------------------
  '0x2183': bar('LEVEL 1', 64),
  '0x2185': bar('LEVEL 2', 64),
  '0x2187': bar('LEVEL 3', 64),
  '0x2189': bar('LEVEL 4', 64),

  // --- Title Scenario select bar (SCENARIO n), 80x32 --------------------
  '0x2175': scenarioBar('SCENARIO 1', 80),
  '0x2177': scenarioBar('SCENARIO 2', 80),
  '0x2179': scenarioBar('SCENARIO 3', 80),
  '0x217b': scenarioBar('SCENARIO 4', 80),
  '0x217d': scenarioBar('SCENARIO 5', 80),
  '0x217f': scenarioBar('SCENARIO 6', 80),
  '0x2181': bar('???', 80),
  '0x21ab': bar('???', 56),

  // --- 144x32 minigame name plates --------------------------------------
  '0x21ad': bar('4x4 SECURITY', 144),
  '0x21af': bar('STUN-GUN WRISTWATCH', 144),
  '0x21b1': bar('STATUE OF TRUTH', 144),
  '0x21b3': bar("RAN'S KARATE TRAINING", 144),
  '0x21b5': bar('POWER KICK SHOES', 144),
  '0x21b7': bar('PLAY WITH ETEKO', 144),
  '0x21b9': bar('BOMB DEFUSER', 144),
  '0x21bb': bar('TURBO SKATEBOARD', 144),

  // --- 112x32 menu buttons ----------------------------------------------
  '0x21bd': bar('SCENARIO', 112),
  '0x21bf': bar('MINIGAME', 112),
  '0x21c1': bar('RIDDLE CARD', 112),
  '0x21c3': bar('FILE', 112),
  '0x21c5': bar('ALBUM', 112),
  '0x21c7': bar('GRAPHICS', 112),

  // --- 192x32 dark capsules ---------------------------------------------
  '0x2246': capsule('You got rare card No. 101', 192, 8, 23),
  '0x30e6': capsule('Play the next level?', 192, 8, 24),
  '0x30ea': capsule('You cleared every level', 192, 9, 24),
  // "Play the next stage?" - 20 chars. COND6 (6px) at tracking=0 fits in 120px.
  // Capsule body is ~160px wide (192 - 32 rim). Center at cx=96, maxW=150.
  // USER FIX: English exceeded the capsule shape — moved the text more to the
  // left (cx 96 -> 84, tx 36 -> 24) so it fits comfortably inside the box.
  '0x30f8': capsule('Play the next stage?', 192, 8, 24, { face: 'COND6', faces: ['COND6'], tracking: 0, cx: 84, maxW: 150, minTrack: 0 }),
  '0x3310': {
    lines: [
      { text: 'LEVEL CLEAR', draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 14, outline: 1, top: 2 } },
      { text: 'YOU GOT A RIDDLE CARD', draw: { face: 'COND6', tracking: 0, style: 'fill', fill: 14, outline: 1, top: 15 } },
    ],
    erase: { mode: 'frame', body: 5, rimColours: [4], frameColours: [4], box: box(1, 1, 190, 30) },
    splitRows: 16,
  },

  // --- 128x64 prompt capsules -------------------------------------------
  '0x30ec': capsule('Exit?', 128, 25, 40),
  '0x30ee': capsule('Try again?', 128, 25, 40),

  // --- 176x64 starburst comics ------------------------------------------
  // USER FIX (disapproved notes): comic bursts needed thicker letterforms and a
  // tilted exclamation like the Japanese original.
  '0x30d8': burst('Caught!', 176, 64, 8, 15, 49, { dilate: 1 }),
  '0x30fc': burst('Game Over', 176, 64, 8, 14, 46, { face: 'COND5B', faces: ['COND5B'], tracking: 2, dilate: 1, slant: 0.18 }),
  '0x30e0': burst('Clear!', 176, 64, 8, 12, 51, { dilate: 1 }),

  // --- 120x48 starburst comics ------------------------------------------
  // Approved as-is, so they keep the upright 2x lettering of the first pass
  // instead of inheriting the bigger, slanted comic look above.
  '0x3099': burst('Wrong', 120, 48, 6, 7, 41, { top: 10, scale: 2, tracking: 6, dilate: 1, slant: 0, maxW: 100 }),
  '0x309b': burst('Found!', 120, 48, 8, 7, 41, { top: 10, scale: 2, tracking: 6, dilate: 1, slant: 0, maxW: 100 }),

  // --- 128x64 result starbursts -----------------------------------------
  // USER FIX (disapproved notes): thicker stamp lettering for the result bursts.
  '0x30e2': burstBig('Failed!', 6, { dilate: 2 }),
  '0x30fa': burstBig('Success!', 6, { dilate: 2 }),

  // --- 64x40 dark bevelled banner, white embossed text on the top edge ---
  '0x309f': {
    text: 'Found',
    erase: {
      mode: 'rows', ink: [1, 14, 15], box: box(2, 0, 55, 12),
      bgRows: [
        0, 0, 0, 0, 0, 15, 3, 3, 3, 3, 3, 3, 3,
      ],
    },
    draw: {
      face: 'BOLD9', tracking: 2, style: 'bevel', fill: 14, highlight: 15, dark: 14,
      outline: 1, left: 3, top: 0, maxW: 53,
    },
  },

  // --- 64x16 "L button" label: embossed grey word + boxed L keycap ---------
  // User feedback: "text needs to be thicker" — increased dilate from 1 to 2
  '0x30cd': {
    text: 'Back',
    erase: { mode: 'flat', bg0: 0, box: box(0, 0, 63, 15), bbox: box(8, 2, 55, 13) },
    draw: {
      face: 'BOLD9', tracking: 1, style: 'bevel', fill: 8, highlight: 11, dark: 9,
      outline: 0, left: 21, top: 2, dilate: 2, maxW: 43,
    },
    rects: [
      { x: 8, y: 2, w: 13, h: 12, c: 8 },
      { x: 9, y: 3, w: 11, h: 10, c: 10 },
      { x: 10, y: 4, w: 9, h: 8, c: 9 },
      { x: 12, y: 5, w: 2, h: 7, c: 11 },
      { x: 12, y: 10, w: 5, h: 2, c: 11 },
    ],
  },

  // --- 96x16 shoulder-button strips: boxed R keycap + embossed label ------
  // The label column is only 74px wide, so the original five-glyph phrases are
  // shortened to the action word rather than shrunk into illegibility.
  '0x223f': {
    text: 'Input',
    erase: { mode: 'flat', bg0: 0, box: box(16, 0, 95, 15), bbox: box(21, 2, 95, 14) },
    draw: {
      face: 'COND7', tracking: 4, style: 'shadow', fill: 13, outline: 1, shadow: 10,
      shadowDX: 1, shadowDY: 2, left: 21, top: 2, maxW: 74,
    },
  },
  '0x2241': {
    text: 'Check',
    erase: { mode: 'flat', bg0: 0, box: box(16, 0, 95, 15), bbox: box(21, 2, 95, 14) },
    draw: {
      face: 'COND7', tracking: 4, style: 'shadow', fill: 13, outline: 1, shadow: 10,
      shadowDX: 1, shadowDY: 2, left: 21, top: 2, maxW: 74,
    },
  },
  '0x2243': {
    text: 'Guide',
    erase: { mode: 'flat', bg0: 0, box: box(16, 0, 95, 15), bbox: box(21, 2, 95, 14) },
    draw: {
      face: 'COND7', tracking: 4, style: 'shadow', fill: 13, outline: 1, shadow: 10,
      shadowDX: 1, shadowDY: 2, left: 21, top: 2, maxW: 74,
    },
  },

  // --- 96x64 triple label strips ----------------------------------------
  '0x2087': tripleBar(['3rd', '4th', '2nd']),
  '0x2089': tripleBar(['4th', '5th', '6th']),
  '0x208b': tripleBar(['1st', '2nd', '3rd']),
  '0x208d': tripleBar(['Golden Boots', 'Diamond Sweater', 'Silk Jacket']),

  // --- 112x40 stats label panel -----------------------------------------
  // Three labels over ruled separators. The separators run through the text, so
  // the erase is an inpaint: the line is rebuilt from its own left/right pixels.
  '0x216d': {
    lines: [
      { text: 'Case', rows: [4, 12], draw: { face: 'MINI7', faces: ['MINI7'], minTrack: 0, tracking: 1, style: 'fill', fill: 1, outline: null, left: 11, top: 4, maxW: 42 } },
      { text: 'Time', rows: [15, 23], draw: { face: 'MINI7', faces: ['MINI7'], minTrack: 0, tracking: 1, style: 'fill', fill: 1, outline: null, left: 11, top: 15, maxW: 42 } },
      { text: 'Cards', rows: [26, 34], draw: { face: 'MINI7', faces: ['MINI7'], minTrack: 0, tracking: 1, style: 'fill', fill: 1, outline: null, left: 11, top: 26, maxW: 42 } },
    ],
    erase: {
      mode: 'rows', ink: [1, 2, 3], box: box(10, 3, 103, 35),
      bgRows: [
        15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 14, 14,
        15, 15, 15, 15, 15, 15, 15, 15, 15, 8, 8, 15, 15,
        15, 15, 15, 15, 15, 15, 15, 11, 11, 15, 15, 15, 15, 15,
      ],
    },
  },

  // --- 40x72 vertical time gauge ----------------------------------------
  // A white label strip (rows 0-9) with 10px black kana, a grey divider band,
  // then a tall hollow rounded frame that fills as the clock runs down. The kana
  // exactly fill the strip, so the label is the short word TIME rather than a
  // nine-character phrase that would have to shrink below the original weight.
  '0x3075': {
    text: 'Time',
    erase: {
      mode: 'recolor', ink: [1, 2, 3, 4, 5, 6, 7, 12, 13, 14],
      box: box(1, 1, 38, 9),
    },
    draw: {
      face: 'MINI7', faces: ['MINI7'], minTrack: 0, tracking: 1,
      style: 'fill', fill: 14, outline: null, cx: 20, top: 1, maxW: 38,
    },
  },

  // --- 64x64 d-pad, one variant per pressed direction -------------------
  '0x30c3': dpad('N'),
  '0x30c5': dpad('E'),
  '0x30c7': dpad('S'),
  '0x30c9': dpad('W'),

  // --- 240x160 case-title cards ------------------------------------------
  '0x2dd9': titleCard(['Detective', 'Theme Park']),
  '0x2ded': titleCard(['The Chinatown', 'Brawl Incident']),
  // The Targeted Detective: bold architectural display font with diagonal
  // cross-hatching (blueprint sketch style). TITLE5 at scale 2 = 10x24 glyphs,
  // 2px stems, heavy outline, hatched interior.
  '0x2e29': {
    erase: { mode: 'recolor', bg: [15], box: box(0, 0, 239, 159) },
    lines: [
      {
        text: 'The Targeted',
        rows: [46, 71],
        draw: {
          face: 'TITLE5', faces: ['TITLE5'], scale: 2, tracking: 1, minTrack: 0,
          style: 'crosshatch', fill: 6, hatch: 13, outline: 1, outlineWidth: 2,
          cx: 120, top: 46, maxW: 226,
        },
      },
      {
        text: 'Detective',
        rows: [76, 101],
        draw: {
          face: 'TITLE5', faces: ['TITLE5'], scale: 2, tracking: 1, minTrack: 0,
          style: 'crosshatch', fill: 6, hatch: 13, outline: 1, outlineWidth: 2,
          cx: 120, top: 76, maxW: 226,
        },
      },
    ],
  },
  '0x2e01': titleCard(['Haunted Hospital', 'Treasure Case']),
  '0x2e15': titleCard(['The Pet Robot', 'Bombing Incident']),
  '0x2dc5': titleCard(['Security System', 'Out of Control']),

  // --- 240x160 parcel label (event scene) --------------------------------
  // Original: Japanese vertical text on a parcel/box reading 工藤新一.
  // Recreation: horizontal "SHINICHI KUDO" on a white label plate with dark
  // outline, centred on the parcel face. Uses BOLD9 for weight/clarity.
  '0x254a': {
    erase: { mode: 'recolor', ink: [1, 14, 15], box: box(60, 50, 180, 110) },
    lines: [
      {
        text: 'SHINICHI',
        rows: [58, 70],
        draw: {
          face: 'BOLD9', faces: ['BOLD9'], tracking: 2, minTrack: 0,
          style: 'fill', fill: 1, outline: 4, cx: 120, top: 58, maxW: 110,
        },
      },
      {
        text: 'KUDO',
        rows: [78, 90],
        draw: {
          face: 'BOLD9', faces: ['BOLD9'], tracking: 2, minTrack: 0,
          style: 'fill', fill: 1, outline: 4, cx: 120, top: 78, maxW: 110,
        },
      },
    ],
  },

  // --- 240x160 gadget description cards --------------------------------
  '0xc58': gadgetCard('Power Kick Shoes', [
    'Press R to kick, then',
    'pick a direction with',
    'the D-pad. Hold for 2x.',
  ]),
  '0xc5e': gadgetCard('Voice-Changing Bow Tie', [
    'Press R to speak with',
    "someone else's voice.",
    'Not while running.',
  ]),
  '0xc61': gadgetCard('Turbo Skateboard', [
    'Press R to ride. Press',
    'it again to hop off.',
    'Hold B to boost.',
  ]),
  '0xc64': gadgetCard('Tracking Glasses', [
    'Picks up the Detective',
    'Boys badge signal, so',
    'you can track them.',
  ]),
  '0xc67': gadgetCard('Detective Boys Badge', [
    'A tiny transceiver.',
    'Works up to 20 km and',
    'can send a signal.',
  ]),
  '0xc6a': gadgetCard('Earring Phone', [
    'The ornament holds the',
    'number buttons. Wear',
    'it to talk and listen.',
  ]),
  '0xc6d': gadgetCard('Wristwatch Tranquilizer', [
    'Fires a tranquilizer',
    'needle. Aim with the',
    'sight. Only one shot.',
  ]),

  // --- 128x64 answer plates ---------------------------------------------
  // Both are rubber-stamp cards: a huge word with a 1px body-coloured gap and a
  // mid-grey drop shadow, centred on a plain card.
  '0x2227': {
    text: 'Correct!',
    erase: { mode: 'frame', body: 14, rimColours: [8], frameColours: [8, 9], box: box(1, 1, 126, 62) },
    draw: {
      face: 'COND5', faces: ['COND5'], tracking: 1, scale: 3, minTrack: 0, dilate: 2, slant: 0.16,
      style: 'shadow', fill: 8, outline: 14, shadow: 12, shadowDX: 3, shadowDY: 4,
      cx: 64, maxW: 122, valign: 'center',
    },
  },
  '0x2229': {
    lines: [
      {
        text: 'Incorrect',
        draw: {
          face: 'COND7', faces: ['COND7', 'COND6B'], tracking: 2, scale: 2, minTrack: 0,
          style: 'shadow', fill: 14, outline: 2, shadow: 2, shadowDX: 2, shadowDY: 2,
          cx: 64, maxW: 118, valign: 'center',
        },
      },
      {
        text: 'Please enter again',
        draw: { face: 'COND7', tracking: 0, style: 'fill', fill: 14, outline: 2, cx: 64, maxW: 116, top: 49 },
      },
    ],
    erase: { mode: 'frame', body: 15, rimColours: [11], frameColours: [11, 6], box: box(1, 1, 126, 62) },
    splitRows: 48,
  },

  // --- 240x160 intro line: white text on black background ----------------
  '0xc44': {
    erase: { mode: 'flat', bg0: 1, box: box(0, 0, 239, 159), bbox: box(10, 55, 230, 105) },
    lines: [
      { text: 'You are the only one', rows: [64, 76], draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 15, outline: null, cx: 120, top: 64, maxW: 220 } },
      { text: 'who can solve this case!', rows: [80, 92], draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 15, outline: null, cx: 120, top: 80, maxW: 220 } },
    ],
  },

  // --- 240x160 Ghost Doctor case title: misty background -----------------
  '0x2be7': {
    erase: { mode: 'recolor', ink: [1], box: box(88, 15, 145, 155) },
    lines: [
      { text: 'Ghost', rows: [60, 84], draw: { face: 'COND7', scale: 2, tracking: 2, style: 'fill', fill: 1, outline: 2, cx: 114, top: 60 } },
      { text: 'Doctor', rows: [90, 114], draw: { face: 'COND7', scale: 2, tracking: 2, style: 'fill', fill: 1, outline: 2, cx: 114, top: 90 } },
    ],
  },

  // --- 64x40 "Strike" panel (minigame result indicator) ------------------
  '0x30a1': {
    text: 'Strike',
    erase: {
      mode: 'rows', ink: [1, 14, 15], box: box(2, 0, 55, 12),
      bgRows: [0, 0, 15, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    },
    draw: {
      face: 'BOLD9', tracking: 2, style: 'bevel', fill: 14, highlight: 15, dark: 14,
      outline: 1, left: 3, top: 0, maxW: 53,
    },
  },

  // --- 240x160 tutorial/minigame title card ------------------------------
  // "Bowling Strike" panel — a full-screen title card with bold lettering.
  '0x3205': {
    erase: { mode: 'recolor', ink: [1, 14, 15], box: box(0, 0, 239, 159) },
    lines: [
      { text: 'BOWLING', rows: [50, 74], draw: { face: 'COND7', scale: 2, tracking: 2, style: 'fill', fill: 15, outline: 1, cx: 120, top: 50, maxW: 226 } },
      { text: 'STRIKE', rows: [80, 104], draw: { face: 'COND7', scale: 2, tracking: 2, style: 'fill', fill: 15, outline: 1, cx: 120, top: 80, maxW: 226 } },
    ],
  },

  // --- 240x160 saving screen -------------------------------------------
  // Three lines of instructional text over a dark background. Uses recolor
  // mode to detect the Japanese text ink and replace with English.
  '0x32c0': {
    erase: { mode: 'recolor', ink: [1, 14, 15], box: box(0, 0, 239, 159) },
    lines: [
      { text: 'DATA IS BEING SAVED', rows: [40, 52], draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 15, outline: null, cx: 120, top: 40, maxW: 220 } },
      { text: 'Please wait a moment.', rows: [70, 82], draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 15, outline: null, cx: 120, top: 70, maxW: 220 } },
      { text: 'Do not turn off the power.', rows: [86, 98], draw: { face: 'COND7', tracking: 1, style: 'fill', fill: 15, outline: null, cx: 120, top: 86, maxW: 220 } },
    ],
  },

  // --- 64x64 handwritten "KOBUN" (event name plate) ---------------------
  '0x2289': {
    text: 'KOBUN',
    erase: { mode: 'flat', bg0: 0, box: box(0, 0, 63, 63), bbox: box(4, 4, 60, 28) },
    draw: { face: 'BOLD9', tracking: 1, style: 'fill', fill: 15, outline: 1, cx: 32, top: 12, maxW: 55 },
  },

  // --- 64x64 handwritten "KUSOSHITA?" (event clue, two variants) --------
  // Both 0x231d and 0x2325 are 64x64 handwritten panels sharing the same
  // text content (different doodles). Rendered identically.
  '0x231d': {
    text: 'KUSOSHITA?',
    erase: { mode: 'flat', bg0: 0, box: box(0, 0, 63, 63), bbox: box(4, 4, 60, 28) },
    draw: { face: 'BOLD9', tracking: 1, style: 'fill', fill: 15, outline: 1, cx: 32, top: 12, maxW: 55 },
  },
  '0x2325': {
    text: 'KUSOSHITA?',
    erase: { mode: 'flat', bg0: 0, box: box(0, 0, 63, 63), bbox: box(4, 4, 60, 28) },
    draw: { face: 'BOLD9', tracking: 1, style: 'fill', fill: 15, outline: 1, cx: 32, top: 12, maxW: 55 },
  },
};

