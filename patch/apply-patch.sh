#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$DIR/Detective_Conan_Nerawareta_Tantei_English_v1.0.bps"
OUT_FILE="$DIR/Detective Conan - English Translated.gba"

IN_ROM=""
if [ -f "$DIR/Meitantei Conan - Nerawareta Tantei.gba" ]; then
    IN_ROM="$DIR/Meitantei Conan - Nerawareta Tantei.gba"
elif [ -f "$DIR/../Meitantei Conan - Nerawareta Tantei.gba" ]; then
    IN_ROM="$DIR/../Meitantei Conan - Nerawareta Tantei.gba"
elif [ -n "$1" ] && [ -f "$1" ]; then
    IN_ROM="$1"
fi

if [ -z "$IN_ROM" ]; then
    echo "Please provide your clean Japanese ROM as an argument, or place it here as:"
    echo "  'Meitantei Conan - Nerawareta Tantei.gba'"
    exit 1
fi

echo "========================================================"
echo "  Detective Conan: Nerawareta Tantei - English Patcher"
echo "========================================================"
echo "Source ROM : $IN_ROM"
echo "Patch File : $PATCH_FILE"
echo "Target ROM : $OUT_FILE"
echo ""

node "$DIR/../scripts/bps.mjs" apply "$IN_ROM" "$PATCH_FILE" "$OUT_FILE"
echo ""
echo "========================================================"
echo "  PATCH SUCCESSFUL! Output: $OUT_FILE"
echo "========================================================"

