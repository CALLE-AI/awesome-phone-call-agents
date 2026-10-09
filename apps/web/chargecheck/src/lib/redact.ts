import { StationCheckState } from "./types";

/**
 * Redacts anything that looks like a phone number from free text before it
 * reaches the client — provider/SDK error messages, CALL-E's own evidence
 * strings, and any free-text field in a structured result (notes, price,
 * payment requirements, accessibility) can in principle echo back a dialed
 * or spoken number. Matches E.164-style numbers and common
 * loosely-formatted variants (spaces, dashes, parens), keeping only the
 * last 2 digits so the reader can still tell two redactions apart without
 * recovering the number.
 */
const PHONE_PATTERN = /(\(?\+?\d[\d\-.\s()]{6,}\d\)?)/g;

export function redactPhoneNumbers(text: string): string {
  return text.replace(PHONE_PATTERN, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7) return match; // too short to plausibly be a phone number
    return `[redacted phone ending ${digits.slice(-2)}]`;
  });
}

function redactMaybe(text: string | undefined | null): string | undefined {
  if (text === undefined || text === null) return text ?? undefined;
  return redactPhoneNumbers(text);
}

/**
 * Returns a copy of a StationCheckState with every free-text field passed
 * through redactPhoneNumbers. Applied server-side, right before any
 * check/check-array is sent to the client, in both /api/check/start and
 * /api/check/status — so a phone number can never leak via an error
 * message or a CALL-E-reported free-text field, regardless of which code
 * path produced it.
 */
export function redactCheckState(check: StationCheckState): StationCheckState {
  return {
    ...check,
    error: redactMaybe(check.error),
    evidence: check.evidence.map((e) => redactPhoneNumbers(e)),
    structuredResult: check.structuredResult
      ? {
          ...check.structuredResult,
          notes: redactPhoneNumbers(check.structuredResult.notes),
          price_per_kwh: redactPhoneNumbers(check.structuredResult.price_per_kwh),
          payment_requirements: redactPhoneNumbers(check.structuredResult.payment_requirements),
          accessibility: redactPhoneNumbers(check.structuredResult.accessibility),
        }
      : null,
  };
}
