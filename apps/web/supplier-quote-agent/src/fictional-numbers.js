const { foldPhoneText } = require('./mask');

// Number ranges regulators reserve for fiction — never allocated to a real line. One table,
// used twice: CallEProvider refuses to dial anything in it (a sample number is never a live
// destination), and tests/fictional-numbers.test.js requires every "+"- or "00"-prefixed
// number in this app's own files to be in it (no real contact data in samples, tests, or
// docs). Sharing the table is what keeps "fictional in the repo" and "refused live" from
// drifting apart.
//
// Patterns match a normalized E.164 string (a "+" and digits only).
const FICTIONAL_RANGES = Object.freeze([
  // NANP: 555-0100 through 555-0199 are reserved for fictional use in every geographic area
  // code. Toll-free codes (800, 822, 833, 844, 855, 866, 877, 88x) are excluded: 555 is not
  // reserved there, so 1-800-555-01xx can be a real line.
  { label: 'NANP 555-01xx (geographic area codes)', pattern: /^\+1(?!8(?:00|22|33|44|55|66|77|8\d))[2-9]\d{2}55501\d{2}$/ },
  // The same block written without an area code — the short form this app's own seed data
  // uses (+1-555-0100 normalizes to +15550100).
  { label: 'NANP 555-01xx (no area code)', pattern: /^\+155501\d{2}$/ },
  // Ofcom's numbers reserved for TV and radio drama (UK).
  { label: 'Ofcom drama: London 020 7946 0xxx', pattern: /^\+442079460\d{3}$/ },
  { label: 'Ofcom drama: 0113-0118 496 0xxx', pattern: /^\+4411[3-8]4960\d{3}$/ },
  { label: 'Ofcom drama: 0121/0131/0141/0151/0161 496 0xxx', pattern: /^\+441[2-6]14960\d{3}$/ },
  { label: 'Ofcom drama: Tyneside 0191 498 0xxx', pattern: /^\+441914980\d{3}$/ },
  { label: 'Ofcom drama: Belfast 028 9649 6xxx', pattern: /^\+442896496\d{3}$/ },
  { label: 'Ofcom drama: Cardiff 029 2018 0xxx', pattern: /^\+442920180\d{3}$/ },
  { label: 'Ofcom drama: 01632 960xxx', pattern: /^\+441632960\d{3}$/ },
  { label: 'Ofcom drama: mobile 07700 900xxx', pattern: /^\+447700900\d{3}$/ },
  { label: 'Ofcom drama: freephone 08081 570xxx', pattern: /^\+448081570\d{3}$/ },
  { label: 'Ofcom drama: premium 0909 8790xxx', pattern: /^\+449098790\d{3}$/ },
  { label: 'Ofcom drama: UK-wide 03069 990xxx', pattern: /^\+443069990\d{3}$/ }
]);

// One number, however it was typed, as "+" and digits: unicode digits/plus/dashes folded
// to ASCII, a UK-style "(0)" trunk marker dropped, separators removed, and a "00" or "011"
// international prefix read as "+".
function normalizePhoneDigits(raw) {
  return foldPhoneText(String(raw))
    .replace(/\(0\)/g, '')
    .replace(/[\s().\-/]/g, '')
    .replace(/^(?:00|011)(?=[1-9])/, '+');
}

// Also tries the number with a national trunk "0" left in after the country code
// ("+44 020 7946 0958"), which is not valid E.164 but is how people write it.
function isFictionalNumber(raw) {
  const normalized = normalizePhoneDigits(raw);
  const candidates = [normalized];
  for (let cc = 1; cc <= 3; cc += 1) {
    if (normalized[1 + cc] === '0') {
      candidates.push(normalized.slice(0, 1 + cc) + normalized.slice(2 + cc));
    }
  }
  return candidates.some((n) => FICTIONAL_RANGES.some(({ pattern }) => pattern.test(n)));
}

module.exports = { FICTIONAL_RANGES, isFictionalNumber, normalizePhoneDigits };
