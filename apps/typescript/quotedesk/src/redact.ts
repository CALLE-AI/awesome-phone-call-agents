// Display-only masking. Free text that came off a call or the provider
// (transcript spans, part numbers, error messages) can carry phone numbers
// or email addresses. Console output, the dashboard and the customer draft
// pass through redact(); the ledger and data/rows-*.json keep the raw
// private evidence untouched.

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// A digit run of 8+ digits, optionally broken by spaces, dots, dashes or
// parentheses, and not glued to an identifier (RFQ-2026-0914). Prices
// (<= 7 digits, or comma-grouped) and dates stay readable.
const PHONE_LIKE = /(?<![\w-])\+?\d[\d\s().-]{6,}\d/g;
const DATE = /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/;

export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email redacted]')
    .replace(PHONE_LIKE, (m) => (m.replace(/\D/g, '').length >= 8 && !DATE.test(m) ? '[number redacted]' : m));
}
