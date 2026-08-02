const PHONE_RE = /\+\d{4,20}/g;
const SECRET_KEYS = new Set(['apikey', 'api_key', 'authorization', 'idempotency-key']);

export function maskPhone(value) {
  if (typeof value !== 'string') return value;
  return value.replace(PHONE_RE, (match) => {
    const digits = match.slice(1);
    if (digits.length <= 5) return `+${digits[0]}${'*'.repeat(digits.length - 1)}`;
    const country = digits.slice(0, 1);
    const tail = digits.slice(-4);
    const hidden = '*'.repeat(digits.length - 5);
    return `+${country}${hidden}${tail}`;
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
