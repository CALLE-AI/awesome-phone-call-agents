// NOTE: Matches international formats (+CC with flexible separators) and domestic NANP (10-digit).
// Does not attempt every international format (e.g., parentheses in country code). Trade-off:
// short non-phone digit runs (e.g., 'offset 42 seconds') survive unmasked; leaked numbers do not.
const PHONE_RE = /\+\d[\d\s.\-()]*\d(?!\d)|(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}|(?<!\d)\d{10}(?!\d)/g;
const SECRET_KEYS = new Set(['apikey', 'api_key', 'authorization']);

export function maskPhone(value) {
  if (typeof value !== 'string') return value;
  return value.replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, '');
    const isInternational = match.startsWith('+');

    // Validate digit count: international 4-20, domestic exactly 10.
    if (isInternational) {
      if (digits.length < 4 || digits.length > 20) return match;
    } else {
      if (digits.length !== 10) return match;
    }

    // Apply masking rules.
    if (isInternational) {
      if (digits.length <= 5) return `+${digits[0]}${'*'.repeat(digits.length - 1)}`;
      const first = digits[0];
      const last4 = digits.slice(-4);
      const stars = '*'.repeat(digits.length - 5);
      return `+${first}${stars}${last4}`;
    } else {
      const last4 = digits.slice(-4);
      const stars = '*'.repeat(digits.length - 4);
      return `${stars}${last4}`;
    }
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
