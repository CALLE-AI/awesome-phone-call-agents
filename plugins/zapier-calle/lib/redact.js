// NOTE: Matches international formats (+CC with flexible separators) and domestic NANP (10-digit).
// Does not attempt every international format (e.g., parentheses in country code). Trade-off:
// short non-phone digit runs (e.g., 'offset 42 seconds') survive unmasked; leaked numbers do not.
// Bare domestic matching covers standalone runs of 10 to 15 digits via word-boundary checks: 10 is
// the floor because shorter runs are not phone numbers, 15 is the ceiling because E.164 allows at
// most 15 digits. The word-boundary guards keep identifiers intact (e.g., 'evt_1754091234567' is
// preceded by '_', a word character, so it is not touched) - the same trade-off means a standalone
// 10-to-15-digit non-phone value (a tracking or confirmation number, say) is still masked if
// nothing word-like is adjacent to it, since it is indistinguishable from a real number.
const PHONE_RE = /\+\d[\d\s.\-()]*\d(?!\w)|(?<!\w)(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}(?!\w)|(?<!\w)\d{10,15}(?!\w)/g;
const SECRET_KEYS = new Set(['apikey', 'api_key', 'authorization']);

// International masking: the fewer digits there are, the larger a share any fixed "show the
// last N" rule would reveal, so the visible portion shrinks (instead of staying at a fixed
// last-4) as the number gets shorter, so a majority of digits stay hidden at every length.
function maskInternational(digits) {
  const length = digits.length;
  if (length <= 3) return `+${'*'.repeat(length)}`;
  if (length <= 5) return `+${digits[0]}${'*'.repeat(length - 1)}`;
  if (length <= 10) return `+${'*'.repeat(length - 2)}${digits.slice(-2)}`;
  const first = digits[0];
  const last4 = digits.slice(-4);
  return `+${first}${'*'.repeat(length - 5)}${last4}`;
}

function maskDomestic(digits) {
  const last4 = digits.slice(-4);
  return `${'*'.repeat(digits.length - 4)}${last4}`;
}

export function maskPhone(value) {
  if (typeof value !== 'string') return value;
  return value.replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, '');
    const isInternational = match.startsWith('+');

    if (isInternational) {
      if (digits.length > 20) return match;
      return maskInternational(digits);
    }
    if (digits.length < 10 || digits.length > 15) return match;
    return maskDomestic(digits);
  });
}

export function redactDeep(value) {
  if (typeof value === 'string') return maskPhone(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? '[redacted]' : redactDeep(item);
    }
    return out;
  }
  return value;
}
