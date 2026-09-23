// Masks phone numbers before any task/quote/activity-log data reaches an HTTP response.
// A supplier's real number is operational data the app needs to dial with — it is never
// something a browser tab or activity-log consumer needs to read back in full.

// Rewrites the characters a phone number may be spelled with into ASCII, one UTF-16 unit
// for one: fullwidth, Arabic-Indic, extended Arabic-Indic and Devanagari digits; the
// fullwidth plus; unicode and fullwidth dashes; non-breaking, thin and ideographic spaces;
// and the invisible characters (soft hyphen, zero-width space/joiners, word joiner, BOM)
// that render as nothing but split a number. Same length in, same length out, which is what
// lets a match found in the folded copy be replaced in the original by index.
const DIGIT_BLOCKS = [0xff10, 0x0660, 0x06f0, 0x0966];
const FOLDED = /[\uFF10-\uFF19\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\uFF0B\uFF0D\u2010-\u2015\u2212\u00A0\u2002-\u2009\u202F\u3000\u00AD\u200B-\u200D\u2060\uFEFF]/g;
function foldPhoneText(text) {
  return text.replace(FOLDED, (c) => {
    const code = c.charCodeAt(0);
    const block = DIGIT_BLOCKS.find((base) => code >= base && code <= base + 9);
    if (block !== undefined) {
      return String.fromCharCode(48 + code - block);
    }
    if (code === 0xff0b) {
      return '+';
    }
    if (code === 0xff0d || (code >= 0x2010 && code <= 0x2015) || code === 0x2212) {
      return '-';
    }
    return ' ';
  });
}

const countDigits = (folded) => (folded.match(/\d/g) || []).length;

function maskPhone(phone) {
  if (typeof phone !== 'string') {
    return phone;
  }
  const folded = foldPhoneText(phone);
  const digits = folded.replace(/[^0-9]/g, '');
  if (digits.length < 4) {
    return '•'.repeat(phone.length);
  }
  const prefix = folded.trimStart().startsWith('+') ? '+' : '';
  return `${prefix}•••••${digits.slice(-2)}`;
}

// A phone number has at least 7 digits; E.164 caps it at 15.
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;
const DATE_PREFIX = /^(?:\d{4}-\d{2}-\d{2}|(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$)/;

function phoneDigits(value) {
  const folded = foldPhoneText(String(value));
  if (DATE_PREFIX.test(folded.trim())) {
    return null;
  }
  const digits = folded.replace(/[^0-9]/g, '');
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS ? digits : null;
}

// A timestamp or id about a phone (phoneVerifiedAt, phone_id) is machinery, not a number.
const isPhoneKey = (key) =>
  /phone|mobile|^tel$|^fax$|whatsapp|contact_?number/i.test(key) && !/At$|_at$|(^|_)id$|Id$/.test(key);

// Every value under a phone-named key, at any depth — the definite set of real numbers
// this specific payload actually carries.
function collectKnownPhones(value, into, underPhoneKey = false) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKnownPhones(v, into, underPhoneKey));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      collectKnownPhones(val, into, underPhoneKey || isPhoneKey(key));
    }
    return;
  }
  if (underPhoneKey && (typeof value === 'string' || typeof value === 'number')) {
    const digits = phoneDigits(value);
    if (digits) {
      into.add(digits);
    }
  }
}

// Inside a phone-named field: a flat string is a phone number and is always masked; deeper
// down (a {label, number} list, say) only leaves that carry digits are, so labels survive.
function maskPhoneField(val, top = true) {
  if (typeof val === 'string') {
    return top || countDigits(foldPhoneText(val)) >= 4 ? maskPhone(val) : val;
  }
  if (typeof val === 'number') {
    return String(Math.abs(val)).length >= MIN_PHONE_DIGITS ? maskPhone(String(val)) : val;
  }
  if (Array.isArray(val)) {
    return val.map((v) => maskPhoneField(v, top && typeof v === 'string'));
  }
  if (val && typeof val === 'object') {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, maskPhoneField(v, false)]));
  }
  return val;
}

// Runs a global `pattern` over the folded copy of `text` and splices replacements into the
// original. `decide(match, index, folded)` returns the replacement, or null to keep that
// text; the search then carries on after it, so every character is looked at once.
function replaceMatches(text, folded, pattern, decide) {
  pattern.lastIndex = 0;
  let out = '';
  let last = 0;
  let m;
  while ((m = pattern.exec(folded)) !== null) {
    const replacement = decide(m[0], m.index, folded);
    if (replacement !== null) {
      out += text.slice(last, m.index) + replacement;
      last = m.index + m[0].length;
    }
  }
  return last === 0 ? text : out + text.slice(last);
}

const always = (match) => maskPhone(match);

// --- Known numbers -------------------------------------------------------------------------

const KNOWN_GAP = '[\\s().\\/\\u00B7-]{0,6}';
const digitRun = (digits) => digits.split('').join(KNOWN_GAP);

// Every way one known number is likely to be written: with an international prefix (00 or
// 011), in full with its country code (optionally with a UK-style "(0)" after it), without
// the country code, with a national trunk "0" in its place, and — for NANP — as the bare
// 7-digit local number. The country code's length isn't known from digits alone, so each
// 1-3 digit split is tried; a split that is wrong only ever produces a longer-than-real
// suffix of the same number.
function knownPhone(digits) {
  const variants = new Set([`(?:00|011)${KNOWN_GAP}${digitRun(digits)}`, `\\+?${digitRun(digits)}`]);
  const forms = new Set([digits]);
  for (let cc = 1; cc <= 3; cc += 1) {
    const national = digits.slice(cc);
    if (national.length < MIN_PHONE_DIGITS) {
      continue;
    }
    variants.add(`\\+?${digitRun(digits.slice(0, cc))}(?:${KNOWN_GAP}\\(0\\))?${KNOWN_GAP}${digitRun(national)}`);
    variants.add(`\\(?${digitRun(national)}`);
    variants.add(`\\(?${digitRun(`0${national}`)}`);
    forms.add(national);
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    variants.add(digitRun(digits.slice(4)));
    forms.add(digits.slice(4));
  }
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  return {
    // The shortest digit sequence any spelling of this number must contain; a string whose
    // digits don't contain one of these can't hold the number, and is never scanned for it.
    forms: [...forms],
    pattern: new RegExp(`(?<!\\d)(?:${ordered.join('|')})(?!\\d)`, 'g')
  };
}

function knownPatternsFor(folded, known) {
  const digits = folded.replace(/\D/g, '');
  return known.filter(({ forms }) => forms.some((f) => digits.includes(f))).map(({ pattern }) => pattern);
}

// --- Phone numbers nobody declared -----------------------------------------------------------
// Every pattern here is linear on hostile input: digits and separators are disjoint classes,
// repeats are bounded or captured atomically, and each match is judged by looking at a
// fixed-size window around it.

// "+" and 7-15 digits, or a bracketed area code and 6+ more digits: almost never anything
// but a phone number.
const PLUS_FORM = /(?<![\w+])\+ ?\(?\d(?:[\s()./\u00B7-]{0,3}\d){6,14}(?!\d)/g;
const PAREN_FORM = /(?<!\w)\(\d{2,5}\)[\s.-]{0,3}\d(?:[\s()./\u00B7-]{0,3}\d){5,12}(?!\d)/g;

// Free text — a call summary, a transcript, a note, an error message — is judged by shape,
// not by the words around it: two review rounds showed that any rule reading nearby words
// ("call", "order", "x 12", "Accounts:") can be talked into leaking a number. Every maximal
// run of digits joined by short separators is masked when it holds 7 or more digits, unless
// it is one of a few things with an exact shape of their own (below). There is deliberately
// no upper limit: two numbers joined by a space are masked together. The gap between two
// digits runs up to 12 separator characters — wide enough that padding a number with extra
// spaces (a third review round found 4+ spaces split one run into sub-7-digit fragments, each
// too short to mask alone) can't dodge the 7-digit threshold by fragmenting it.
// The run is captured atomically (a lookahead capture replayed by a backreference), so the
// engine never backtracks into it.
//
// The leading lookbehind refuses to start a run right after a letter, digit or underscore:
// a digit run glued to a word with no space at all ("task_1234567", "SKU1234567") reads as
// part of that word's own identifier, not a free-standing number \u2014 the same presumption the
// "ids" test above relies on. This is a known, accepted limitation, not an oversight: it
// also means a currency word glued with zero space ("Rs2025550147") isn't caught by the
// CURRENCY_BEFORE/AMOUNT check below, because the run never starts matching there in the
// first place. Closing it would mean guessing which glued-on word is "a real identifier"
// versus "a currency abbreviation" from the word's spelling \u2014 exactly the nearby-word
// heuristic this rule exists to avoid.
const RUN = /(?<![\w]|\d[.,])(?=(\+ ?\(?\d(?:[\s()./\u00B7-]{1,12}\d|\d)*|\(?\d(?:[\s()./\u00B7-]{1,12}\d|\d)*))\1/g;

const CURRENCY_BEFORE = /(?:[$€£¥₹]|\b(?:usd|eur|gbp|inr|sgd|aud|cad|nzd|jpy|cny|rmb|hkd|aed|idr|myr|thb|php|krw|chf|sek|nok|dkk|zar|brl|mxn|rs|rp)\.?)\s*$/i;
// A phone word right before a run means it is a phone number whatever else it looks like;
// it can only add masks (it switches off the identifier and money exclusions), never
// remove one.
const PHONE_WORD_BEFORE = /\b(?:tel|telephone|phone|ph|mob|mobile|cell|fax|whatsapp|call|ring|dial|contact|reach)[\s.:#-]{0,3}$/i;
// An identifier prefix ("SKU-", "Q-", "PO-", "WO12-") is written in caps by convention; an
// ordinary lowercase word ending in a hyphen ("direct-", "backup-") is not one, and letting
// it through was a confirmed leak (adversarial review: "Their direct-2025550147 line").
const IDENTIFIER_HYPHEN_BEFORE = /\b[A-Z][A-Z0-9]*-$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IBAN_BEFORE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){0,7} ?$/;

const COMPACT_DATE = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/;
const TIME_RANGE = /^(?:[01]\d|2[0-3])[0-5]\d ?- ?(?:[01]\d|2[0-3])[0-5]\d$/;
const between = (n, lo, hi) => n >= lo && n <= hi;
// Day and month in either order (15/09 and 09/15 are both dates).
const dayMonth = (a, b) => (between(a, 1, 31) && between(b, 1, 12)) || (between(a, 1, 12) && between(b, 1, 31));

function isDateToken(token) {
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(token);
  if (m) {
    return between(+m[2], 1, 12) && between(+m[3], 1, 31);
  }
  m = /^(\d{1,2})[-./](\d{1,2})(?:[-./](?:\d{2}|\d{4}))?$/.exec(token);
  if (m) {
    return dayMonth(+m[1], +m[2]);
  }
  return COMPACT_DATE.test(token) || TIME_RANGE.test(token);
}

// A date, a date range, a clock-time range, or a date followed by the hour of a clock time
// (an ISO date, a space, and an hour, when ":MM" comes next). A bare number is never read
// as an hour.
function isDateOrTime(run, after) {
  const whole = run.trim();
  if (COMPACT_DATE.test(whole) || TIME_RANGE.test(whole)) {
    return true;
  }
  const spaced = /^(\d{1,2}) (\d{1,2}) (\d{4})$/.exec(whole);
  if (spaced && dayMonth(+spaced[1], +spaced[2])) {
    return true;
  }
  const groups = whole.split(/\s+/).filter((g) => g !== '-');
  return groups.every(
    (g, i) =>
      isDateToken(g) ||
      (i > 0 && i === groups.length - 1 && /^\d{1,2}$/.test(g) && +g <= 23 && /^:[0-5]\d/.test(after))
  );
}

// An amount of money: plain (capped at 7 digits — a price with no thousands separator
// doesn't need more, and RESULT_SCHEMA now asks CALL-E for one past that; an uncapped plain
// branch let a full phone number through as "an amount" right after a currency sign, a
// confirmed leak from adversarial review: "Total due is $2025550147"), with at most 2
// decimals, with space or dot thousands (uncapped — a separator already breaks it out of
// RUN's own digit-run grouping), or a "/" list of such amounts.
const AMOUNT = /^(?:\d{1,7}(?:\.\d{1,2})?|\d{1,3}(?:[ .]\d{3})+(?:,\d{1,2})?)(?:\s*\/\s*\d{1,7}(?:\.\d{1,2})?)*$/;
// Quantity tiers written as a "/" list of short numbers: 100/500/1000, 100 / 250 / 500.
const QUANTITY_LIST = /^\d{1,4}(?:\s*\/\s*\d{1,4})+$/;
const DECIMAL = /^\d+\.\d{1,3}$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function insideUuid(folded, index, length) {
  const start = Math.max(0, index - 36);
  const window = folded.slice(start, index + length + 36);
  UUID.lastIndex = 0;
  let m;
  while ((m = UUID.exec(window)) !== null) {
    const from = start + m.index;
    if (from < index + length && from + m[0].length > index) {
      return true;
    }
  }
  return false;
}

function decideRun(match, index, folded) {
  if (countDigits(match) < MIN_PHONE_DIGITS) {
    return null;
  }
  if (match.startsWith('+')) {
    return maskPhone(match);
  }
  const before = folded.slice(Math.max(0, index - 40), index);
  const after = folded.slice(index + match.length, index + match.length + 24);
  // Judged without a bracket the run happens to start or end on: "(2026-09-08)".
  const core = match.replace(/^\(+/, '').replace(/\)+$/, '').trim();
  if (isDateOrTime(core, after) || DECIMAL.test(core) || QUANTITY_LIST.test(core) || IPV4.test(core)) {
    return null;
  }
  if (insideUuid(folded, index, match.length)) {
    return null;
  }
  if (!PHONE_WORD_BEFORE.test(before)) {
    // A letter right after the run used to also read as "an identifier continuing"
    // (unless it was an extension marker) — too broad: it let a phone number through
    // whenever the next character just happened to be a letter ("2025550147pm",
    // "…147am"), a confirmed leak from adversarial review. An extension ("x 12", "ext. 5")
    // is part of the call and is masked with the number regardless (falls through below);
    // anything else after the run no longer exempts it. Only an actual identifier shape is
    // kept: a capitalized prefix ("Q-", "SKU-") right before the run, or a UUID around it.
    const singleToken = !/[\s()]/.test(match);
    if (singleToken && IDENTIFIER_HYPHEN_BEFORE.test(before)) {
      return null;
    }
    if (CURRENCY_BEFORE.test(before) && AMOUNT.test(core)) {
      return null;
    }
  }
  return maskPhone(match);
}

// An international call prefix: 00 or 011, then a NANP number after 1, or else a country
// code and a national number that can't start with 0 (a leading 0 there is an IBAN or a
// zero-padded id). Used on plan text, which doesn't get the RUN rule.
const INTL_PREFIX = /(?<![\w+]|\d[.,])(?:00|011)[ .-]?(?:\(0\)[ .-]?)?(?:1[ .-]?[2-9]\d{2}[ .-]?[2-9]\d{2}[ .-]?\d{4}|[2-9]\d{0,2}[ .-]?(?:\(0\)[ .-]?)?[1-9](?:[ ./-]?\d){7,11})(?!\d)/g;
const decideIntl = (match, index, folded) => {
  const before = folded.slice(Math.max(0, index - 40), index);
  return IBAN_BEFORE.test(before) || CURRENCY_BEFORE.test(before) ? null : maskPhone(match);
};

// --- Which scrub a value gets, by the key it sits under ------------------------------------

// Plan text is shown to the owner, edited, and saved back through update_task, and the
// dashboard builds new plans from a task's sku. Those get only the unmistakable shapes ("+",
// bracketed area code, and for plans a 00/011 prefix), so hyphenated quantity tiers or a
// part number survive the round trip; invoke.js refuses a plan that carries a mask back in.
const PLAN_KEYS = new Set(['goal', 'script_points', 'success_criteria', 'fallback']);

const PASSES = {
  free: [PLUS_FORM, always, PAREN_FORM, always, RUN, decideRun],
  plan: [PLUS_FORM, always, PAREN_FORM, always, INTL_PREFIX, decideIntl],
  sku: [PLUS_FORM, always, PAREN_FORM, always]
};

function scrubString(text, ctx, tier) {
  let out = text;
  let folded = foldPhoneText(out);
  if (countDigits(folded) < MIN_PHONE_DIGITS) {
    return out;
  }
  const passes = PASSES[tier];
  const steps = knownPatternsFor(folded, ctx.known).map((p) => [p, always]);
  for (let i = 0; i < passes.length; i += 2) {
    steps.push([passes[i], passes[i + 1]]);
  }
  for (const [pattern, decide] of steps) {
    const next = replaceMatches(out, folded, pattern, decide);
    if (next !== out) {
      out = next;
      folded = foldPhoneText(out);
    }
  }
  return out;
}

function tierFor(key, inherited) {
  if (key === 'sku') {
    return 'sku';
  }
  return PLAN_KEYS.has(key) ? 'plan' : inherited;
}

function maskValue(value, ctx, tier) {
  if (Array.isArray(value)) {
    return value.map((v) => maskValue(v, ctx, tier));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isPhoneKey(key) ? maskPhoneField(val) : maskValue(val, ctx, tierFor(key, tier));
    }
    return out;
  }
  if (typeof value === 'string') {
    return scrubString(value, ctx, tier);
  }
  return value;
}

// Recursively masks every phone-named field, scrubs the numbers those fields carry
// wherever they reappear, and masks every other phone-length digit run in free text —
// tasks, quotes, activity-log entries, and error responses all share this one pass rather
// than each route hand-rolling its own field list.
function maskDeep(value) {
  const known = new Set();
  collectKnownPhones(value, known);
  const ctx = { known: [...known].map(knownPhone) };
  return maskValue(value, ctx, 'free');
}

// The digit runs maskDeep would hide in free text. The repo guard
// (tests/non-phone-digit-runs.test.js) holds every digit run in this app's own files to
// this same definition of "looks like a phone number".
function findPhoneLikeRuns(text) {
  const folded = foldPhoneText(text);
  const found = new Map();
  for (const [pattern, decide] of [[PLUS_FORM, always], [PAREN_FORM, always], [RUN, decideRun]]) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(folded)) !== null) {
      if (!found.has(m.index) && decide(m[0], m.index, folded) !== null) {
        found.set(m.index, m[0]);
      }
    }
  }
  return [...found.values()];
}

// The mark maskPhone leaves behind. Text carrying it has been through a masked response,
// and saving it back would store the mask in place of whatever it hid.
const MASK_SIGNATURE = /•{5}\d{2}/;

module.exports = { maskPhone, maskDeep, foldPhoneText, findPhoneLikeRuns, MASK_SIGNATURE };
