# Graphics Assets Directory

This directory contains all raw and translated visual assets for the *Detective Conan: Nerawareta Tantei* English translation patch. During `npm run build`, these assets are parsed, quantized against their original GBA palettes, LZ77-compressed, and injected into the ROM.

---

## Directory Structure

* **`banners/`**
  * In-game result banners and stamps (`CLEAR!`, `FAILED!`, `CORRECT!`, `CAUGHT!`, `SUCCESS!`, `TIME OVER`, `FOUND IT!`, `[L] BACK`, `MISTAKES`).
* **`bin/`**
  * Hardware palette banks, compressed binary tilesets, and pre-rendered binary pixel blobs used by low-level injection routines (title screen logos, Case intro pixels, gadget pixel buffers).
* **`cutscenes/`**
  * High-resolution 240×160 cutscene and story artwork screens.
  * *Note on `0x16b0.png`:* The Beika Disaster Prevention Center room (`0x16af`) is a multi-palette 349-tile background. To avoid corrupting the room, `patch-beika-dpc.mjs` crops only the two 32×48 wall poster regions from this image (left: `x=88, y=8`; right: `x=144, y=16`) and quantizes them strictly into Palette 12.
* **`eng_keyboard/`**
  * `0x2e68.png`: English QWERTY keyboard graphic used for entering riddle answers in the Epilogue.
* **`gadgets/`**
  * `0xc58.png` – `0xc6d.png`: The 8 gadget explanation cards (Stun-Gun Wristwatch, Voice-Changing Bowtie, Power-Enhancing Kick Shoes, Criminal Tracking Glasses, Turbo Engine Skateboard, etc.).
* **`screens/`**
  * Newspaper headlines, investigation screens, and full-screen backdrop assets (`0x2409.png`, `0x2431.png`, `0x2b2d.png`, `0x3219.png`).
* **`titles/`**
  * `0x2dc5.png` – `0x2e29.png`: Case introduction title cards (Cases 1 through 5, plus epilogue subtitle screen).
* **`tutorials/`**
  * Visual tutorial boards and minigame button instructions (Kick shoes, Skateboarding, Lockpicking, Karate, Petrobo).
* **`needs_translation/`**
  * Original Japanese reference images for assets that are still untranslated or need proper handwritten English artwork (`0x2446`, `0x25d7`, `0x2289`, `0x231d`, `0x2325`). See [`needs_translation/README.md`](needs_translation/README.md) for full context and instructions.

---

## Exact Image Size & Saving Requirements

Saving images with the exact required pixel dimensions and file formatting is **critical**. GBA hardware renders graphics using $8 \times 8$ pixel tiles arranged in hardware tilemaps. An incorrect image size will cause the tilemap converter to misalign, wrap prematurely, or corrupt VRAM.

### 1. File Format
* **Format:** PNG (Portable Network Graphics).
* **Color Depth:** 24-bit RGB or 32-bit RGBA (or 8-bit indexed).
* **Do NOT use JPEG:** JPEG compression introduces color halos, artifacts, and noise around text borders that ruin palette quantization and prevent clean GBA tile deduplication.

### 2. Required Pixel Dimensions by Asset Type

| Category | Target Folder | Exact Dimensions | Tile Grid | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Full-Screen Cutscenes** | `cutscenes/` | **240 × 160 px** | 30 × 20 tiles | Full native GBA screen size (or 480×320 / 720×480 with 3:2 ratio) |
| **Case Title Cards** | `titles/` | **240 × 160 px** | 30 × 20 tiles | Full native screen |
| **Tutorial Boards** | `tutorials/` | **240 × 160 px** | 30 × 20 tiles | Full native screen |
| **Gadget Cards** | `gadgets/` | **240 × 160 px** | 30 × 20 tiles | Full native screen |
| **Investigation Screens** | `screens/` | **240 × 160 px** | 30 × 20 tiles | Full native screen |
| **Epilogue Keyboard** | `eng_keyboard/` | **240 × 160 px** | 30 × 20 tiles | Native keyboard screen |
| **CLEAR! Banner** | `banners/` | **176 × 64 px** | 22 × 8 tiles | Starburst banner slot |
| **CAUGHT! Banner** | `banners/` | **176 × 64 px** | 22 × 8 tiles | Starburst banner slot |
| **TIME OVER Banner** | `banners/` | **176 × 64 px** | 22 × 8 tiles | Starburst banner slot |
| **FAILED! Banner** | `banners/` | **128 × 64 px** | 16 × 8 tiles | Starburst banner slot |
| **SUCCESS! Banner** | `banners/` | **128 × 64 px** | 16 × 8 tiles | Starburst banner slot |
| **CORRECT! Stamp** | `banners/` | **128 × 64 px** | 16 × 8 tiles | Card stamp slot |
| **FOUND!! Banner** | `banners/` | **120 × 48 px** | 15 × 6 tiles | Small banner slot |
| **[L] BACK Button** | `banners/` | **64 × 16 px** | 8 × 2 tiles | Button label slot |
| **WRONG Label** | `banners/` | **64 × 40 px** | 8 × 5 tiles | Mini counter label slot |
| **Handwritten Notes** | `needs_translation/` | **64 × 64 px** | 8 × 8 tiles | Clue sprite panels |

### 3. Why Size & Alignment Matter on GBA Hardware

1. **The 8×8 Tile Boundary:**
   The GBA GPU does not store raw bitmaps for backgrounds; it stores an array of $8 \times 8$ pixel tiles and a $32 \times 32$ tilemap of 16-bit indices. Every image dimension must be an integer multiple of 8 pixels.
2. **Tile Budget & VRAM Limits:**
   Each GBA background layer can hold a maximum of 1,024 tiles in VRAM. Cutscenes and screens in this game share VRAM with sprites and HUD elements, so clean pixel art with flat background fills and crisp lettering compresses into fewer unique tiles (typically 100–250 tiles per screen), ensuring it easily fits in VRAM without visual corruption.
