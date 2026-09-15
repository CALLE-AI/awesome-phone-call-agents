/**
 * A phone number inside free text: an optional "+", then at least nine digits
 * that may be split by spaces, dots, dashes or brackets. Word boundaries keep
 * ids such as "call_123456789" whole.
 */
const PHONE_IN_TEXT = /(?<![\w+])\+?\(?\d[\d ().-]{7,}\d(?![\w])/g;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Masks every phone number in text that came from a provider or a person:
 * transcripts, error messages, log lines. "+14155550123" and
 * "(415) 555-0123" become "+141****0123" and "415****0123".
 */
export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_IN_TEXT, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 9 || DATE.test(match.trim())) return match;
    return `${match.startsWith("+") ? "+" : ""}${digits.slice(0, 3)}****${digits.slice(-4)}`;
  });
}

/** Masks phone numbers in every string of a JSON-like value, for saved artifacts. */
export function maskPhonesDeep<T>(value: T): T {
  if (typeof value === "string") return maskPhonesInText(value) as T;
  if (Array.isArray(value)) return value.map((item) => maskPhonesDeep(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskPhonesDeep(item)])) as T;
  }
  return value;
}
