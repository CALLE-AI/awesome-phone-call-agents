/**
 * The last thing every live response goes through.
 *
 * The routes already send an allowlisted projection of a call rather than the
 * payload. This is the second layer: walk whatever is about to leave, all the
 * way down, and mask anything phone-shaped, whatever field it turned up in. A
 * structured result can quote a number back, an error message can echo one,
 * and nobody should have to remember every place that might happen.
 *
 * Timestamps, scores and ids are left alone. A number is only treated as a phone
 * number when it stands on its own (not inside an id or a token), carries seven
 * to fifteen digits, and is not a date or a plain decimal.
 */

const PHONE_KEY = /phone|msisdn|e164|caller|callee|destination/i;

const CANDIDATE = /(?<![A-Za-z0-9])\+?\d[\d\s().-]{5,}\d(?![A-Za-z0-9])/g;

function looksLikePhone(match: string): boolean {
  const trimmed = match.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return false;
  if (/^\d+\.\d+$/.test(trimmed)) return false;
  return true;
}

/** Enough to recognise, never enough to dial. */
export function maskNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 5) return "*".repeat(digits.length);
  const lead = value.trim().startsWith("+") ? "+" : "";
  return `${lead}${digits.slice(0, 2)}${"*".repeat(digits.length - 4)}${digits.slice(-2)}`;
}

export function maskText(text: string): string {
  return text.replace(CANDIDATE, (m) => (looksLikePhone(m) ? maskNumber(m) : m));
}

const MAX_DEPTH = 32;

export function deepMask(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[too deep]";
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map((v) => deepMask(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (PHONE_KEY.test(key)) {
        // A field named for a number is masked whole, whatever shape it has.
        out[key] = typeof v === "string" ? maskNumber(v) : v === null ? null : "[masked]";
        continue;
      }
      out[key] = deepMask(v, depth + 1);
    }
    return out;
  }
  return value;
}
