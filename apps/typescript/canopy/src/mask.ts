// Phone numbers are real-world identifiers. They are validated as E.164 once, on load,
// and masked everywhere they are displayed, logged, or written into a report.

export const E164_RE = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string): boolean {
  return E164_RE.test(value);
}

/** "+14155550123" -> "+14*******23". Keeps the country prefix and the last two digits. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) {
    return "+**";
  }
  const head = phone.slice(0, 3);
  const tail = phone.slice(-2);
  return `${head}${"*".repeat(Math.max(1, phone.length - 5))}${tail}`;
}

/** Masks every E.164-looking number inside free text (summaries, transcripts, error messages). */
export function maskPhonesInText(text: string): string {
  return text.replace(/\+[1-9]\d{6,14}/g, (match) => maskPhone(match));
}
