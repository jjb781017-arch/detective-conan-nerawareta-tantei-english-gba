# Assets Needing Translation & Localization

This directory holds the original Japanese reference graphics for assets that have **not yet been translated**, or are currently using temporary programmatic placeholders.

---

## List of Untranslated Assets

### 1. `0x2446_invitation_letter.png` (Case 1 — Invitation Letter / Riddle Card)
* **Dimensions:** 240 × 160 (Full screen cutscene)
* **Context:** The mystery invitation letter received by Kogoro Mouri at the start of Case 1 (The Runaway Security System).
* **Japanese Content:** Formal written Japanese invitation containing the initial riddle and challenge text.
* **Current In-Game State:** Displays the original Japanese graphic.

### 2. `0x25d7_dojo_calligraphy.png` (Case 3 — Martial Arts Dojo Plaque)
* **Dimensions:** 240 × 160 (Full screen cutscene)
* **Context:** The interior calligraphy banner hanging inside Wang's Chinese Martial Arts Dojo in Chinatown.
* **Japanese Content:** Traditional four-character martial arts calligraphy idiom.
* **Current In-Game State:** Displays the original Japanese graphic.

### 3. `0x2289_cipher_note.png` (Case 3 — Handwritten Cipher Clue)
* **Dimensions:** 64 × 64 (Sprite / parts asset)
* **Context:** An investigative note found during the Chinatown case.
* **Current In-Game State:** Uses a temporary programmatic font replacement ("KOBUN"). Needs an authentic handwritten English graphic note.

### 4. `0x231d_handwritten_memo_1.png` & `0x2325_handwritten_memo_2.png` (Case 3 — Torn Memos)
* **Dimensions:** 64 × 64 each (Sprite / parts asset)
* **Context:** Two torn memo slips found during the Case 3 investigation.
* **Current In-Game State:** Uses a temporary programmatic font replacement ("KUSOSHITA?"). Needs authentic handwritten English memo doodles.

### 5. Minigame Tutorial Boards (Located in `assets/tutorials/`)
* **Assets:** `0x1ffc.png`, `0x3111.png`, `0x319f.png`, `0x31c7.png`, `0x31f1.png`, `0x3230.png`, `0x3231.png`, `0x325a.png`, `0x3296.png`.
* **Current In-Game State:** Functional but **placeholders**. The English text and button prompts are readable, but they are rough initial drafts that need proper graphic cleanup, layout refinement, and aesthetic matching with authentic GBA pixel art.

---

## How to Add New Translated Assets

### 1. File Naming Convention
The build system identifies assets strictly by their hexadecimal **Table 0 Asset ID**:
* Must start with `0x<hex>`, e.g., `0x2446.png` or `0x25d7.png`.
* Place completed cutscenes into `assets/cutscenes/`.
* Place completed tutorial boards into `assets/tutorials/`.
* Place completed result banners into `assets/banners/`.

### 2. Exact Image Size & Format Requirements (CRITICAL)

Images MUST be saved in the exact pixel dimensions expected by the GBA GPU:
* **Format:** PNG format (24-bit RGB or 32-bit RGBA). Never save as JPEG (JPEG compression artifacts ruin GBA palette quantization and tile deduplication).
* **`0x2446_invitation_letter.png`:** Exactly **240 × 160 px** (save as `assets/cutscenes/0x2446.png`).
* **`0x25d7_dojo_calligraphy.png`:** Exactly **240 × 160 px** (save as `assets/cutscenes/0x25d7.png`).
* **`0x2289_cipher_note.png`:** Exactly **64 × 64 px** (save as `assets/needs_translation/0x2289.png`).
* **`0x231d_handwritten_memo_1.png`:** Exactly **64 × 64 px** (save as `assets/needs_translation/0x231d.png`).
* **`0x2325_handwritten_memo_2.png`:** Exactly **64 × 64 px** (save as `assets/needs_translation/0x2325.png`).
* **Tutorial Boards (`assets/tutorials/`):** Exactly **240 × 160 px**.

**Why size is critical:**
GBA video hardware organizes screens into $8 \times 8$ pixel tiles ($240 \times 160$ equals $30 \times 20$ tiles). An image saved at non-standard dimensions will cause tilemap indices to wrap prematurely or corrupt adjacent VRAM banks.

---

## How the ROM Knows Where to Put Them (Table 0 Architecture)

You do not need to manually patch hex offsets. The build pipeline handles relocation and ROM injection automatically.

### 1. Master Table 0 (`0x000A7108`)
The retail GBA game indexes every graphic, tileset, and tilemap through a master pointer table located at ROM address `0x000A7108`. Each entry is 8 bytes:
```
[Offset + 0] (4 bytes): Compressed payload size
[Offset + 4] (4 bytes): 32-bit GBA memory pointer (0x08xxxxxx)
```
When the game engine wants to display asset `0x2446`, it loads entry:
$$\text{Entry Address} = \text{0x000A7108} + (0x2446 \times 8)$$

### 2. How the Build Injects New Assets
When you place a translated `0x<hex>.png` in `assets/` and run `npm run build`:
1. **Palette Extraction:** The build reads the original hardware palette bank from the clean Japanese ROM (`palOffset` or `tilesPtr - 0x200`).
2. **Quantization & Tile Conversion:** The image is quantized against the 16 hardware colors per 8×8 tile, creating a deduplicated 4bpp tilebank and a 32×32 GBA tilemap.
3. **LZ77 Compression:** The tilebank and tilemap are compressed using GBA BIOS LZ77 format, with safety checks to ensure zero "distance-1" corruption tokens.
4. **ROM Allocation:** The compressed blob is written into clean, unfragmented expanded ROM space (`0x00C00000`–`0x00F80000`).
5. **Table 0 Redirection:** The build updates the 8-byte descriptor in Table 0 (`0x000A7108 + id * 8`) to point to the new expanded ROM address.
6. **In-Game Result:** The next time the game executes the scene, it automatically loads your English graphic.

