// The other half of tests/fictional-numbers.test.js. That scan reads internationally written
// numbers ("+", "00", "011"); this one reads every digit run that src/mask.js would hide as a
// phone number in free text — national spellings included, which is how a real number got
// into this repository once. Each run must either read as a number reserved for fiction, or
// be listed in tests/fixtures/non-phone-digit-runs.json with the reason it is not a phone
// number (a purchase-order fixture, a documentation IBAN). Offenders are reported masked.
const fs = require('fs');
const path = require('path');
const { findPhoneLikeRuns, maskPhone } = require('../src/mask');
const { isFictionalNumber } = require('../src/fictional-numbers');
const { textFiles, ROOT } = require('./helpers/repo-numbers');
const allowed = require('./fixtures/non-phone-digit-runs.json');

const MIN_DIGITS = 7;
const digitsOf = (run) => run.replace(/\D/g, '');

// Read as written, as NANP without the +1, as a UK national number (trunk 0 -> +44), or
// with a + in front.
function readsAsFictional(digits) {
  return [`+${digits}`, `+1${digits}`, digits.startsWith('0') ? `+44${digits.slice(1)}` : null, `+44${digits}`]
    .filter(Boolean)
    .some(isFictionalNumber);
}

// A run can hold a reserved number next to a few other digits ("USD 1250 (0161 496 0123)").
// It passes if some stretch of it is reserved and what's left is too short to be a phone.
function holdsOnlyFictional(digits) {
  for (let from = 0; from < digits.length; from += 1) {
    for (let to = from + MIN_DIGITS; to <= digits.length; to += 1) {
      if (digits.length - (to - from) < MIN_DIGITS && readsAsFictional(digits.slice(from, to))) {
        return true;
      }
    }
  }
  return false;
}

// SVGs are generated diagrams full of coordinates, not text anyone reads for numbers.
const files = textFiles(ROOT).filter((file) => !file.endsWith('.svg'));

describe('every phone-like digit run in this app is fictional or a listed non-phone fixture', () => {
  const found = [];
  for (const file of files) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const run of findPhoneLikeRuns(line)) {
        found.push({ where: `${path.relative(ROOT, file)}:${i + 1}`, digits: digitsOf(run) });
      }
    });
  }

  test('the scan actually sees the app (not vacuously green)', () => {
    expect(found.length).toBeGreaterThan(50);
  });

  test('no unexplained digit run', () => {
    const offenders = found
      .filter(({ digits }) => !holdsOnlyFictional(digits) && !Object.hasOwn(allowed.runs, digits))
      .map(({ where, digits }) => `${where} ${maskPhone(digits)}`);
    expect(offenders).toEqual([]);
  });

  test('every allowlisted run says why it is not a phone number, and is still used', () => {
    const seen = new Set(found.map(({ digits }) => digits));
    for (const [digits, reason] of Object.entries(allowed.runs)) {
      expect({ digits: maskPhone(digits), reason: typeof reason === 'string' && reason.length > 10 }).toEqual({
        digits: maskPhone(digits),
        reason: true
      });
      expect(seen.has(digits) ? 'used' : `${maskPhone(digits)} is listed but no longer appears`).toBe('used');
    }
  });
});
