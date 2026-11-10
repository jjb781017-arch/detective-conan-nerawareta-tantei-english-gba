import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// work/asset-palettes.mjs
// Authentic in-game palettes for Detective Conan GBA assets.
import fs from 'fs';

const ROM_PATH = process.env.CONAN_CLEAN_ROM || path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba');
const TABLE = 0xa7108;

let rom = null;
function getRom() {
  if (!rom) rom = fs.readFileSync(ROM_PATH);
  return rom;
}

function ent(id) {
  const r = getRom();
  const e = TABLE + id * 8;
  return { size: r.readUInt32LE(e), ptr: r.readUInt32LE(e + 4) & 0x1ffffff };
}

function decodeBgr555(c) {
  return [
    Math.round((c & 0x1f) * 255 / 31),
    Math.round(((c >> 5) & 0x1f) * 255 / 31),
    Math.round(((c >> 10) & 0x1f) * 255 / 31)
  ];
}

// Read a 512-byte palette bank (16 sub-palettes of 16 colors) from ROM offset
export function readPalBank512(offset) {
  const r = getRom();
  const bank = [];
  for (let p = 0; p < 16; p++) {
    const sub = [];
    for (let i = 0; i < 16; i++) {
      const c = r.readUInt16LE(offset + p * 32 + i * 2);
      sub.push(decodeBgr555(c));
    }
    bank.push(sub);
  }
  return bank;
}

// Read a 32-byte palette (1 sub-palette of 16 colors) from Table 0 entry
export function readSubPalFromTable(id) {
  const r = getRom();
  const e = ent(id);
  const sub = [];
  for (let i = 0; i < 16; i++) {
    const c = r.readUInt16LE(e.ptr + i * 2);
    sub.push(decodeBgr555(c));
  }
  return sub;
}

// Known authentic palette mappings for tilemap screens (512-byte bank offsets)
export const TILEMAP_PALETTES = {
  0x2409: 0x61a5b0, // Newspaper cutscene (100% authentic newsprint cream/brown)
  0x2431: 0x61fd90, // Cutscene background
  0x254a: 0x64c408, // Event scene
  0x26ea: 0x6881e8, // Event scene
  0x2b2d: 0x72809c, // Event cutscene
  0x2be7: 0x747fc8, // Event art
  0x2dc5: 0x76f268, // Case title card 4 (Security System)
  0x2dd9: 0x7703a8, // Case title card 1 (Theme Park)
  0x2ded: 0x770e38, // Case title card 2 (Chinatown)
  0x2e01: 0x771b64, // Case title card 5 (Haunted Hospital)
  0x2e15: 0x772a90, // Case title card 6 (Pet Robot)
  0x2e29: 0x7737dc, // Case title card 3 (Targeted Detective)
  0x3111: 0x7c9bc8, // Tutorial 1
  0x319f: 0x7d01e0, // Tutorial 2
  0x31c7: 0x7d28ac, // Tutorial 3
  0x31f1: 0x7d5000, // Tutorial 4
  0x3205: 0x7d65dc, // Tutorial 5
  0x3219: 0x7d7580, // Tutorial 6
  0x3230: 0x7d8924, // Tutorial 7
  0x325a: 0x7dcb30, // Tutorial 8
  0x3296: 0x7dfffc, // Tutorial 9
  0x32c0: 0x7e1f98, // Save screen (white text, red silhouette, black BG)
  0xc44:  0x3ecdf0, // Intro prompt
  0xc58:  0x3ed608, // Gadget 1 (Kick shoes)
  0xc5e:  0x3ed608, // Gadget 2
  0xc61:  0x3ed608, // Gadget 3
  0xc64:  0x3ed608, // Gadget 4
  0xc67:  0x3ed608, // Gadget 5
  0xc6a:  0x3ed608, // Gadget 6
  0xc6d:  0x3ed608, // Gadget 7
};

// Known authentic palettes for sprite / parts assets (Table 0 palette ID or custom)
export const PARTS_PALETTES = {
  // Title / Scenario screen options (Blue/ice theme)
  0x2165: { tableId: 0x2161 }, // PUSH START
  0x2167: { tableId: 0x2161 },
  0x2169: { tableId: 0x2161 },
  0x216b: { tableId: 0x2161 }, // CONTINUE
  0x216d: { tableId: 0x2161 },
  0x216f: { tableId: 0x2161 }, // BACK
  0x2171: { tableId: 0x2f15 }, // YES (White plate, blue text)
  0x2173: { tableId: 0x2f15 }, // NO (White plate, orange text)
  0x2175: { tableId: 0x2161 }, // SCENARIO 1
  0x2177: { tableId: 0x2161 }, // SCENARIO 2
  0x2179: { tableId: 0x2161 }, // SCENARIO 3
  0x217b: { tableId: 0x2161 }, // SCENARIO 4
  0x217d: { tableId: 0x2161 }, // SCENARIO 5
  0x217f: { tableId: 0x2161 }, // SCENARIO 6
  0x2181: { tableId: 0x2161 }, // LOCKED
  0x2183: { tableId: 0x2161 },
  0x2185: { tableId: 0x2161 },
  0x2187: { tableId: 0x2161 },
  0x2189: { tableId: 0x2161 },
  0x21ab: { tableId: 0x2161 }, // LOCKED
  0x21ad: { tableId: 0x2161 },
  0x21af: { tableId: 0x2161 },
  0x21b1: { tableId: 0x2161 },
  0x21b3: { tableId: 0x2161 },
  0x21b5: { tableId: 0x2161 },
  0x21b7: { tableId: 0x2161 },
  0x21b9: { tableId: 0x2161 },
  0x21bb: { tableId: 0x2161 }, // Turbo Skateboard

  // Brick Wall Submenu buttons (Split vibrant orange / golden yellow banner)
  0x21bd: { tableId: 0x2037 }, // SCENARIO
  0x21bf: { tableId: 0x2037 }, // MINIGAME
  0x21c1: { tableId: 0x2037 }, // RIDDLE CARD
  0x21c3: { tableId: 0x2037 }, // FILE
  0x21c5: { tableId: 0x2037 }, // ALBUM
  0x21c7: { tableId: 0x2037 }, // GRAPHICS

  // Cursors & title icons
  0x2087: { tableId: 0x2084 },
  0x208b: { tableId: 0x2084 },
  0x208d: { tableId: 0x2093 },

  // Dialogue Choices YES / NO (Authentic dialogue prompt palette: white plate 14, blue text 3, orange text 10)
  0xd4a:  { tableId: 0x2f15 }, // YES (White plate, blue text)
  0xd4c:  { tableId: 0x2f15 }, // NO (White plate, orange text)
  0x30fe: { tableId: 0x2f15 }, // はい (YES, White plate, blue text)
  0x30e8: { tableId: 0x2f15 }, // いいえ (NO, White plate, orange text)

  // Minigame result starbursts & banners
  0x30d8: { tableId: 0x30c2 }, // つかまえた！ (Caught! Red on pale blue burst)
  0x30e0: { tableId: 0x30c2 }, // クリアー！ (Clear! Red on pale blue burst)
  0x30e2: { tableId: 0x30c2 }, // Failed!
  0x30fa: { tableId: 0x30c2 }, // 成功！ (Success!)
  0x30fc: { tableId: 0x30c2 }, // タイムオーバー (Game Over! Vibrant blue on pale blue burst)
  0x30cd: { tableId: 0x30c2 }, // もどる (BACK)
  0x30ea: { tableId: 0x30c2 },
  0x30ec: { tableId: 0x30c2 },
  0x30ee: { tableId: 0x30c2 },
  0x30e6: { tableId: 0x30c2 },
  0x30f8: { tableId: 0x30c2 },

  // Minigame plates & prompts
  0x3099: { tableId: 0x3098 }, // お手つき (Wrong, Red plate)
  0x309b: { tableId: 0x3098 }, // 見つけた！ (Found it!)
  0x309f: { tableId: 0x3098 },
  0x30a1: { tableId: 0x30a7 },
  0x3075: { tableId: 0x307b },
  0x30c3: { tableId: 0x30c2 }, // D-pad
  0x30c5: { tableId: 0x30c2 },
  0x30c7: { tableId: 0x30c2 },
  0x30c9: { tableId: 0x30c2 },

  // Result starbursts (Investigation)
  0x2227: { tableId: 0x2219 }, // 正解！ (Correct! Yellow plate, orange text, red shadow)
  0x2229: { tableId: 0x221a }, // 不正解 (Incorrect! White plate, blue text)

  // UI Buttons & Inputs
  0x223f: { tableId: 0x2245 }, // [R] 入力画面へ
  0x2241: { tableId: 0x2245 }, // 問題確認
  0x2243: { tableId: 0x2245 }, // [A] [B] Prompts
  0x2246: { tableId: 0x2245 },

  // Clues & Memos
  0x2289: { tableId: 0x228f }, // Handwritten clue
  0x231d: { tableId: 0x2318 }, // Handwritten memo 1
  0x2325: { tableId: 0x2329 }, // Handwritten memo 2
  0x3310: { tableId: 0x3312 }, // System screen
};

// Get the authentic color palette for any asset ID.
// Returns:
//   For tilemaps: 16 sub-palettes array [ [ [r,g,b] x 16 ] x 16 ]
//   For parts: single sub-palette [ [r,g,b] x 16 ]
export function getAssetPalette(id) {
  if (TILEMAP_PALETTES[id]) {
    const bank = readPalBank512(TILEMAP_PALETTES[id]);
    const defaultSub = (id >= 0xc58 && id <= 0xc6d) ? bank[13] : bank[0];
    return {
      type: 'tilemap',
      bank,
      sub: defaultSub
    };
  }
  if (PARTS_PALETTES[id]) {
    return {
      type: 'parts',
      sub: readSubPalFromTable(PARTS_PALETTES[id].tableId)
    };
  }
  // Fallback: try nearest palette in Table 0
  const r = getRom();
  for (let delta = 1; delta <= 10; delta++) {
    for (const dir of [-1, 1]) {
      const cand = id + dir * delta;
      if (cand < 0 || cand >= 0x4e1f) continue;
      const e = ent(cand);
      if (e.size === 32 && r[e.ptr] !== 0x10) {
        return { type: 'parts', sub: readSubPalFromTable(cand) };
      }
    }
  }
  return null;
}
