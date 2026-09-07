/** Small, dependency-free utilities. */

/** Loose E.164 check: leading +, 8-15 digits. Good enough to fail-closed on junk. */
export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Mask a phone number for display/logging: keep country prefix hint and last 2
 * digits, redact the middle. "+14155550123" -> "+1********23".
 */
export function maskPhone(phone: string): string {
  if (!phone) return "";
  const cleaned = phone.trim();
  if (cleaned.length <= 4) return "*".repeat(cleaned.length);
  const head = cleaned.slice(0, 2);
  const tail = cleaned.slice(-2);
  return `${head}${"*".repeat(Math.max(0, cleaned.length - 4))}${tail}`;
}

/** Redact any E.164-looking substrings inside free text (e.g. transcripts). */
export function redactPhonesInText(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => maskPhone(m.replace(/[^\d+]/g, "")));
}
