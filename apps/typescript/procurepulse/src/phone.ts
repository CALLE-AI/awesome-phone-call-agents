/** Phone numbers are real-world side effects: strict E.164, masked in output, allowlisted to dial. */
export const E164 = /^\+[1-9]\d{6,14}$/;

export class DestinationError extends Error {}

export function assertE164(phone: string, label = "phone"): string {
  const value = phone.trim();
  if (!E164.test(value)) throw new DestinationError(`${label} must be an E.164 number such as +14155550123`);
  return value;
}

/** +14155550142 -> +1•••••••42. Summaries, logs and previews only ever show this form. */
export function mask(phone: string): string {
  const value = phone.trim();
  if (value.length < 6) return "+•••";
  return `${value.slice(0, 2)}${"•".repeat(value.length - 4)}${value.slice(-2)}`;
}

/** An empty allowlist means nothing can be dialed. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => assertE164(n, "allowlist entry")),
  );
}

export function assertAllowlisted(phone: string, allowlist: Set<string>): string {
  const value = assertE164(phone);
  if (!allowlist.has(value)) throw new DestinationError(`${mask(value)} is not in PROCUREPULSE_DIAL_ALLOWLIST`);
  return value;
}

/** CALL-E expects a country code (`US`); accept older `US-CA` style records. */
export function countryCode(region: string): string {
  const code = region.trim().slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "US";
}
