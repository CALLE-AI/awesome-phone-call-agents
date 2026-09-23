// Finds every internationally written phone number in this app's own files: "+" or an
// "00" prefix, then 7-15 digits with any common separators, in any of the scripts
// foldPhoneText understands (fullwidth, Arabic-Indic, Devanagari digits, unicode dashes,
// non-breaking spaces). Used by tests/fictional-numbers.test.js (every one must be reserved
// for fiction) and tests/providers.test.js (every one must be refused as a live
// destination). Offenders are reported masked, so a failure can't republish a real number.
const fs = require('fs');
const path = require('path');
const { foldPhoneText } = require('../../src/mask');

const ROOT = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage']);
const TEXT_FILE = /\.(?:js|jsx|mjs|json|md|html|svg|sh|txt|example)$|^\.[a-z]+rc$/;
// package-lock.json holds version strings and hashes, never contact data; .env holds the
// operator's real values and is never committed (only .env.example is); the range table
// itself is regex source (number prefixes followed by \d{3}), not numbers.
const isSkippedFile = (name) =>
  name === 'package-lock.json' ||
  name === 'fictional-numbers.js' ||
  (name.startsWith('.env') && name !== '.env.example');

const SEP = '[ \\t().\\-/]{0,3}';
const CANDIDATES = [
  // "+", optionally followed by a space or a bracket ("+ 44", "+(44)").
  new RegExp(`(?<![\\w+])\\+ ?\\(?[1-9](?:${SEP}\\d){6,14}(?!\\d)`, 'g'),
  // An "00"/"011" international prefix, shaped the way src/mask.js reads one: only where it
  // starts a token (never inside a decimal like 68.0081 or an IBAN), an optional "(0)",
  // then a NANP number after 1, or a country code starting 2-9 and 7-13 more digits — so a
  // GTIN or a zero-padded id is not mistaken for a phone number.
  new RegExp(
    `(?<![\\w.,])(?<!\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){0,7} ?)(?:00|011)[ .-]?(?:\\(0\\)[ .-]?)?` +
      `(?:1(?:${SEP}\\d){10}|[2-9](?:${SEP}\\d){7,13})(?!\\d)`,
    'g'
  )
];

function findNumbers(text) {
  const folded = foldPhoneText(text);
  return CANDIDATES.flatMap((re) => [...folded.matchAll(re)].map((m) => m[0]));
}

function textFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : textFiles(full);
    }
    return TEXT_FILE.test(entry.name) && !isSkippedFile(entry.name) ? [full] : [];
  });
}

// [{ where: 'path:line', number }] for every candidate in the app.
function scan() {
  const found = [];
  for (const file of textFiles(ROOT)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const number of findNumbers(line)) {
        found.push({ where: `${path.relative(ROOT, file)}:${i + 1}`, number });
      }
    });
  }
  return found;
}

module.exports = { scan, findNumbers, textFiles, ROOT };
