import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalErrors = 0;
let totalWarnings = 0;

function reportError(file, msg) {
  console.error(`Error (${file}): ${msg}`);
  totalErrors++;
}

function reportWarning(file, msg) {
  console.warn(`Warn (${file}): ${msg}`);
  totalWarnings++;
}

// Dialogue script
const dialoguePath = path.join(__dirname, 'data', 'dialogue_translations.json');
if (!fs.existsSync(dialoguePath)) {
  reportError('dialogue_translations.json', 'File not found');
} else {
  try {
    const raw = fs.readFileSync(dialoguePath, 'utf8');
    const data = JSON.parse(raw);
    const keys = Object.keys(data);
    console.log(`Checking dialogue script (${keys.length.toLocaleString()} quotes)...`);

    const caseCounts = {};
    let longLineCount = 0;
    let extraLineCount = 0;

    for (const [key, quote] of Object.entries(data)) {
      if (!quote.english || typeof quote.english !== 'string') {
        reportError('dialogue_translations.json', `Key ${key} has empty or invalid 'english' field`);
        continue;
      }

      const caseName = quote.case || 'Unknown';
      caseCounts[caseName] = (caseCounts[caseName] || 0) + 1;

      const lines = quote.english.split('\n');
      if (lines.length > 2) {
        extraLineCount++;
        if (extraLineCount <= 5) {
          reportWarning('dialogue_translations.json', `Key ${key} (${caseName}) has ${lines.length} lines (box fits 2 max): "${lines[0]}..."`);
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 34) {
          longLineCount++;
          if (longLineCount <= 5) {
            reportWarning('dialogue_translations.json', `Key ${key} line ${i + 1} exceeds 34 characters (${line.length} chars): "${line}"`);
          }
        }
      }
    }

    if (extraLineCount > 5) {
      reportWarning('dialogue_translations.json', `... and ${extraLineCount - 5} more quotes with >2 lines`);
    }
    if (longLineCount > 5) {
      reportWarning('dialogue_translations.json', `... and ${longLineCount - 5} more lines exceeding 34 characters`);
    }
  } catch (err) {
    reportError('dialogue_translations.json', `JSON parse error: ${err.message}`);
  }
}

// Speaker nameplates
const nameplatesPath = path.join(__dirname, 'data', 'speaker_nameplates.json');
if (!fs.existsSync(nameplatesPath)) {
  reportError('speaker_nameplates.json', 'File not found');
} else {
  try {
    const raw = fs.readFileSync(nameplatesPath, 'utf8');
    const data = JSON.parse(raw);
    console.log(`Checking speaker nameplates (${Object.keys(data).length} characters)...`);

    for (const [key, item] of Object.entries(data)) {
      if (typeof item.english !== 'string') {
        reportError('speaker_nameplates.json', `Entry ${key} missing valid 'english' string property`);
      }
      if (item.japanese && item.japanese.trim() !== '' && (!item.english || item.english.trim() === '')) {
        reportError('speaker_nameplates.json', `Entry ${key} (${item.japanese}) is missing English translation`);
      }
      if (item.english && item.english.length > 14) {
        reportWarning('speaker_nameplates.json', `Nameplate "${item.english}" is long (${item.english.length} chars), might stretch UI box`);
      }
    }
  } catch (err) {
    reportError('speaker_nameplates.json', `JSON parse error: ${err.message}`);
  }
}

// Narration & popups
const narrationPath = path.join(__dirname, 'data', 'narration_translations.json');
if (!fs.existsSync(narrationPath)) {
  reportError('narration_translations.json', 'File not found');
} else {
  try {
    const raw = fs.readFileSync(narrationPath, 'utf8');
    const data = JSON.parse(raw);
    console.log(`Checking narration & popups (${Object.keys(data).length} spans)...`);

    for (const [key, item] of Object.entries(data)) {
      if (!item.english || typeof item.english !== 'string') {
        reportError('narration_translations.json', `Entry ${key} missing valid 'english' string`);
      }
    }
  } catch (err) {
    reportError('narration_translations.json', `JSON parse error: ${err.message}`);
  }
}

// Epilogue riddles
const riddlesPath = path.join(__dirname, 'data', 'riddles_analysis.json');
if (!fs.existsSync(riddlesPath)) {
  reportError('riddles_analysis.json', 'File not found');
} else {
  try {
    const raw = fs.readFileSync(riddlesPath, 'utf8');
    const data = JSON.parse(raw);
    console.log(`Checking epilogue riddles (${Object.keys(data).length} cards)...`);

    for (const [key, item] of Object.entries(data)) {
      if (!item.questionEn || !item.explanationEn) {
        reportError('riddles_analysis.json', `Card ${key} missing questionEn or explanationEn`);
      }
    }
  } catch (err) {
    reportError('riddles_analysis.json', `JSON parse error: ${err.message}`);
  }
}

// Epilogue translations
const epiloguePath = path.join(__dirname, 'data', 'epilogue-translations.json');
if (!fs.existsSync(epiloguePath)) {
  reportError('epilogue-translations.json', 'File not found');
} else {
  try {
    const raw = fs.readFileSync(epiloguePath, 'utf8');
    JSON.parse(raw);
  } catch (err) {
    reportError('epilogue-translations.json', `JSON parse error: ${err.message}`);
  }
}

// Export cases helper
if (process.argv.includes('--export-cases')) {
  console.log('Exporting dialogue by case into cases/ directory...');
  const dialogueData = JSON.parse(fs.readFileSync(dialoguePath, 'utf8'));
  const casesDir = path.join(__dirname, 'cases');
  fs.mkdirSync(casesDir, { recursive: true });

  const grouped = {};
  for (const [key, quote] of Object.entries(dialogueData)) {
    const c = (quote.case || 'misc').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!grouped[c]) grouped[c] = {};
    grouped[c][key] = quote;
  }

  for (const [caseFile, quotes] of Object.entries(grouped)) {
    const outPath = path.join(casesDir, `${caseFile}.json`);
    fs.writeFileSync(outPath, JSON.stringify(quotes, null, 2), 'utf8');
  }
  console.log('Cases exported to cases/');
}

if (totalErrors === 0) {
  console.log(`Validation OK (0 errors, ${totalWarnings} warnings).`);
  process.exit(0);
} else {
  console.error(`Validation failed (${totalErrors} errors, ${totalWarnings} warnings).`);
  process.exit(1);
}
