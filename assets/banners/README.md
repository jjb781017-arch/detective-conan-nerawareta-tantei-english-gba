# UI Result Banners & Stamps

This folder contains translated in-game banners and stamps.

## Directory Structure

* `custom_0x<id>_<name>.png`: Active English translated banners injected into the ROM during compilation.

## Assets List & Dimensions

| Asset ID | File | English Text | Dimensions (W × H) | Type |
| :--- | :--- | :--- | :--- | :--- |
| `0x30e0` | `custom_0x30e0_clear.png` | **CLEAR!** | **176 × 64** | Starburst banner |
| `0x30e2` | `custom_0x30e2_failed.png` | **FAILED!** | **128 × 64** | Starburst banner |
| `0x2227` | `custom_0x2227_correct.png` | **CORRECT!** | **128 × 64** | Correct card |
| `0x30d8` | `custom_0x30d8_caught.png` | **CAUGHT!** | **176 × 64** | Starburst banner |
| `0x30fa` | `custom_0x30fa_success.png` | **SUCCESS!** | **128 × 64** | Starburst banner |
| `0x30fc` | `custom_0x30fc_timeover.png` | **TIME OVER** | **176 × 64** | Starburst banner |
| `0x309b` | `custom_0x309b_found.png` | **FOUND!!** | **120 × 48** | Starburst banner |
| `0x30cd` | `custom_0x30cd_back.png` | **[L] BACK** | **64 × 16** | Button label |
| `0x30a1` | `custom_0x30a1_wrong.png` | **WRONG** | **64 × 40** | Mini counter label |

## Editing Banners

1. Edit or replace any `custom_0x<id>_*.png` keeping the exact required width and height in pixels.
2. Run `npm run build` to re-encode and burn the updated banner into the ROM.
