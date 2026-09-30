import type { CallOutcome } from "./types.ts";

/**
 * Eight or more digits, optionally led by "+", with spaces, dashes, or parentheses between
 * them. That covers phone numbers as CALL-E writes or transcribes them (and ticket numbers),
 * but not rupiah amounts, which use commas and stay under eight digits in this demo.
 */
// Not attached to letters or digits, so flight ids like NA729-2026-09-20 stay intact.
const PHONE_LIKE = /(?<![A-Za-z0-9])\+?\d(?:[\s\-()]*\d){7,}/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Masks phone-like numbers in provider text, keeping the last four digits. */
export function redactText(text: string): string;
export function redactText(text: string | null): string | null;
export function redactText(text: string | null | undefined): string | null | undefined;
export function redactText(text: string | null | undefined): string | null | undefined {
  if (typeof text !== "string") return text;
  return text.replace(PHONE_LIKE, (match) => {
    if (ISO_DATE.test(match)) return match;
    const digits = match.replace(/\D/g, "");
    return `••• ${digits.slice(-4)}`;
  });
}

/** Structured fields that hold identifiers the desk acts on, not free text. */
const IDENTIFIER_FIELDS = new Set(["new_booking_code", "new_ticket_number", "selected_flight"]);

/**
 * Applied to every provider outcome before it is stored, persisted, or returned by the API.
 * Summaries, transcripts, failure text, and free-text result fields are masked.
 */
export function redactOutcome(outcome: CallOutcome): CallOutcome {
  const structured = outcome.structured
    ? Object.fromEntries(
        Object.entries(outcome.structured).map(([key, value]) => [
          key,
          typeof value === "string" && !IDENTIFIER_FIELDS.has(key) ? redactText(value) : value,
        ]),
      )
    : null;
  return {
    ...outcome,
    summary: redactText(outcome.summary),
    transcript: outcome.transcript.map((turn) => ({ ...turn, text: redactText(turn.text) })),
    failureMessage: redactText(outcome.failureMessage),
    hint: outcome.hint === undefined ? undefined : redactText(outcome.hint),
    result: outcome.result ? { ...outcome.result, reason: redactText(outcome.result.reason) } : null,
    structured,
  };
}
