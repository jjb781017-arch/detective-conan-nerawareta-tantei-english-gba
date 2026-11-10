@echo off
setlocal
echo ========================================================
echo   Detective Conan: Nerawareta Tantei - English Patcher
echo ========================================================
echo.

set "PATCH_FILE=%~dp0Detective_Conan_Nerawareta_Tantei_English_v1.0.bps"
set "OUT_FILE=%~dp0Detective Conan - English Translated.gba"

REM Check for input ROM from drag-and-drop or local file
set "IN_ROM="
if not "%~1"=="" set "IN_ROM=%~1"
if "%IN_ROM%"=="" if exist "%~dp0Meitantei Conan - Nerawareta Tantei.gba" set "IN_ROM=%~dp0Meitantei Conan - Nerawareta Tantei.gba"
if "%IN_ROM%"=="" if exist "%~dp0..\Meitantei Conan - Nerawareta Tantei.gba" set "IN_ROM=%~dp0..\Meitantei Conan - Nerawareta Tantei.gba"

if "%IN_ROM%"=="" (
    echo [!] No ROM detected.
    echo.
    echo Please drag and drop your clean Japanese ROM (.gba) onto this file,
    echo or place "Meitantei Conan - Nerawareta Tantei.gba" in this folder.
    echo.
    echo Alternatively, you can apply "Detective_Conan_Nerawareta_Tantei_English_v1.0.bps"
    echo directly with Floating IPS (Flips) or online at:
    echo   https://www.romhacking.net/patch/
    echo.
    pause
    exit /b 1
)

echo Source ROM : %IN_ROM%
echo Patch File : %PATCH_FILE%
echo Target ROM : %OUT_FILE%
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] Node.js was not detected in PATH.
    echo.
    echo To patch without Node.js, you can:
    echo   1. Use an online BPS patcher in your browser (no install needed):
    echo      https://www.romhacking.net/patch/
    echo   2. Or use Floating IPS (Flips):
    echo      https://www.romhacking.net/utilities/1040/
    echo   3. Or place the .bps in the same folder as your ROM for auto-loading
    echo      in modern GBA emulators.
    echo.
    echo If you want to use this script, install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

node "%~dp0..\scripts\bps.mjs" apply "%IN_ROM%" "%PATCH_FILE%" "%OUT_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   PATCH SUCCESSFUL!
    echo   Output: %OUT_FILE%
    echo ========================================================
) else (
    echo.
    echo [ERROR] Patching failed. Please make sure your source is a clean,
    echo unheadered 8 MiB Japanese ROM of Meitantei Conan - Nerawareta Tantei.
)
echo.
pause
