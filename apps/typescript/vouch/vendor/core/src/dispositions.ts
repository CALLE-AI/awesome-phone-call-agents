/**
 * Canonical call outcomes. Never collapse these into a boolean.
 * "Didn't answer" and "answered no" are different facts.
 *
 * Source: docs/build-plan.md §2.1, docs/calle-platform.md §3.
 */

export type Disposition =
  | "answered_confirmed"
  | "answered_declined"
  | "answered_unknown"
  | "wrong_person"
  | "gatekeeper_refused"
  | "voicemail_left"
  | "voicemail_no_message"
  | "ivr_dead_end"
  | "hung_up"
  | "no_answer"
  | "invalid_number"
  | "cancelled";

export const DISPOSITIONS: readonly Disposition[] = [
  "answered_confirmed",
  "answered_declined",
  "answered_unknown",
  "wrong_person",
  "gatekeeper_refused",
  "voicemail_left",
  "voicemail_no_message",
  "ivr_dead_end",
  "hung_up",
  "no_answer",
  "invalid_number",
  "cancelled",
] as const;

/** Wave 2 candidates. Voicemail is retryable and is not a reach. */
export const RETRYABLE: ReadonlySet<Disposition> = new Set([
  "no_answer",
  "voicemail_left",
  "voicemail_no_message",
  "ivr_dead_end",
]);

/**
 * The honest numerator. `voicemail_left` is not reached — that one line
 * is the denominator-honesty argument.
 */
export const REACHED: ReadonlySet<Disposition> = new Set([
  "answered_confirmed",
  "answered_declined",
  "answered_unknown",
  "wrong_person",
  "gatekeeper_refused",
  "hung_up",
]);

export function isDisposition(value: string): value is Disposition {
  return (DISPOSITIONS as readonly string[]).includes(value);
}

export function isRetryable(disposition: Disposition): boolean {
  return RETRYABLE.has(disposition);
}

export function isReached(disposition: Disposition): boolean {
  return REACHED.has(disposition);
}
