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

/**
 * Masks telephone numbers inside free text: summaries, transcripts, notes, callback preferences.
 *
 * Matching E.164 alone was not enough. Nobody says "plus one four one five" on the telephone; they
 * say "call me on 415-555-0100", and the agent writes it down that way into `preferred_callback`
 * or `notes`, from where it reached the dashboard and the report unmasked.
 *
 * The patterns below are deliberately conservative: they need either separators in the familiar
 * shape or a run of ten or more digits, so the hour counts, dollar figures and years that fill
 * these same sentences ("80 hours", "$580", "2027") are left alone.
 */
// One alternation, as a literal: E.164; the familiar separated shape; or a bare run of ten or more
// digits. Written as a regular expression literal rather than built from strings, because the two
// levels of escaping that needs are exactly how this was got wrong the first time.
const PHONE_IN_TEXT =
  /\+[1-9]\d{6,14}|(?<![\d-])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d-])|(?<!\d)\d{10,15}(?!\d)/g;

export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_IN_TEXT, (match) => {
    const digits = match.replace(/[^\d+]/g, "");
    return maskPhone(digits.startsWith("+") ? digits : `+${digits}`);
  });
}

/**
 * Masks the free-text fields of a structured result before anything downstream stores or shows it.
 *
 * `preferred_callback` and `notes` are written by the agent from what the person said, so they are
 * the two places a telephone number can enter the system without ever having been a phone column.
 */
export function maskResultText<T extends { preferred_callback: string; notes: string }>(result: T): T {
  return { ...result, preferred_callback: maskPhonesInText(result.preferred_callback), notes: maskPhonesInText(result.notes) };
}
