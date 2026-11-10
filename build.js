#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createBpsPatch, applyBpsPatch } from './scripts/bps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cleanRomPath = process.argv[2] ||
  [
    path.join(__dirname, 'Meitantei Conan - Nerawareta Tantei.gba'),
    path.resolve(__dirname, '../Meitantei Conan - Nerawareta Tantei.gba'),
    path.resolve(__dirname, '../../Meitantei Conan - Nerawareta Tantei.gba')
  ].find(fs.existsSync);

if (!cleanRomPath || !fs.existsSync(cleanRomPath)) {
  console.error('Error: Clean Japanese ROM not found.');
  console.error('Place "Meitantei Conan - Nerawareta Tantei.gba" in this directory or pass the path as an argument:');
  console.error('  node build.js path/to/clean.gba');
  process.exit(1);
}

const buildDir = path.join(__dirname, 'build');
fs.mkdirSync(buildDir, { recursive: true });

const patchedRomPath = path.join(buildDir, 'Detective Conan - English Translated.gba');
const manifestPath = path.join(buildDir, 'build_manifest.json');

const env = {
  ...process.env,
  CONAN_CLEAN_ROM: cleanRomPath,
  CONAN_OUT: patchedRomPath,
  CONAN_MANIFEST: manifestPath
};

console.log('Target clean ROM: ' + cleanRomPath);

// Build patched ROM
console.log('Compiling English ROM...');
execSync(`node "${path.join(__dirname, 'src/build-dual-char-game.mjs')}"`, {
  cwd: __dirname,
  env,
  stdio: 'inherit'
});

// Run verification checks
console.log('Verifying ROM integrity...');
execSync(`node "${path.join(__dirname, 'src/verify-rom.mjs')}"`, {
  cwd: __dirname,
  env,
  stdio: 'inherit'
});

// Run LZ77 VRAM decompression safety audit
console.log('Auditing LZ77 safety...');
execSync(`node "${path.join(__dirname, 'src/audit-lz77-distance1.mjs')}"`, {
  cwd: __dirname,
  env,
  stdio: 'inherit'
});

// Create patches
console.log('Creating BPS patches...');
const cleanRomBuf = fs.readFileSync(cleanRomPath);
const patchedRomBuf = fs.readFileSync(patchedRomPath);

const patchDir = path.join(__dirname, 'patch');
fs.mkdirSync(patchDir, { recursive: true });

const patchBuf = createBpsPatch(cleanRomBuf, patchedRomBuf, 'Detective Conan: Nerawareta Tantei English Translation');

const stdPatchPath = path.join(patchDir, 'Detective_Conan_Nerawareta_Tantei_English_v1.0.bps');
fs.writeFileSync(stdPatchPath, patchBuf);

const softPatchPath = path.join(patchDir, 'Meitantei Conan - Nerawareta Tantei.bps');
fs.writeFileSync(softPatchPath, patchBuf);

console.log('Built patch: ' + stdPatchPath + ' (' + patchBuf.length + ' bytes)');
console.log('Built soft-patch: ' + softPatchPath);

const docsPatchDir = path.join(__dirname, 'docs/patch');
if (fs.existsSync(docsPatchDir)) {
  fs.copyFileSync(stdPatchPath, path.join(docsPatchDir, 'Detective_Conan_Nerawareta_Tantei_English_v1.0.bps'));
}

// Verify BPS patch round-trip produces byte-identical output
console.log('Verifying BPS patch round-trip...');
const verifiedPatched = applyBpsPatch(cleanRomBuf, patchBuf);
if (!verifiedPatched.equals(patchedRomBuf)) {
  console.error('Error: BPS patch round-trip verification failed! Output differs from patched ROM.');
  process.exit(1);
}
console.log('BPS round-trip verification: PASS (100% byte-for-byte identical)');

// Keep parent workspace ROM synchronized with the latest verified build if unlocked
const parentWorkspaceRom = path.resolve(__dirname, '../Detective Conan - English Translated.gba');
try {
  if (fs.existsSync(path.dirname(parentWorkspaceRom))) {
    fs.copyFileSync(patchedRomPath, parentWorkspaceRom);
    console.log('Synchronized workspace ROM: ' + parentWorkspaceRom);
  }
} catch (err) {
  console.log('Notice: Parent workspace ROM is currently locked (likely open in an emulator); latest ROM available at ' + patchedRomPath);
}

console.log('Build complete.');
