import type { Outcome } from "../types";

/**
 * Conversational agreement read back from a completed call.
 *
 * CALL-E exposes no custom extraction schema, so these values come from reading
 * the call's own summary and transcript. `null` means the reading was not
 * conclusive, which is a real answer rather than a missing one.
 */
export type Agreement =
  | "confirmed_original"
  | "accepted_window"
  | "refused"
  | "no_valid_window"
  | null;

export interface CallEOutcome {
  task_completed?: boolean;
  completion_confidence?: { score: number; label: string };
}

/** Below this confidence a completed call is routed to human review. */
export const CONFIDENCE_THRESHOLD = 0.6;

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
  "VOICEMAIL",
  "BUSY",
  "EXPIRED",
]);

/** CALL-E reports some statuses with a space, for example "NO ANSWER". */
export function normalizeStatus(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "_");
}

export function isTerminal(raw: string): boolean {
  return TERMINAL_STATUSES.has(normalizeStatus(raw));
}

/**
 * Map a terminal CALL-E status to an outcome, or return null when the call
 * connected and the outcome depends on what was said.
 *
 * DECLINED is a rejected incoming call, not a customer refusing the offer, so
 * it resolves to `unreachable`: nobody had the conversation.
 */
export function outcomeFromStatus(raw: string): Outcome | null {
  switch (normalizeStatus(raw)) {
    case "COMPLETED":
      return null;
    case "NO_ANSWER":
    case "VOICEMAIL":
    case "BUSY":
    case "DECLINED":
      return "unreachable";
    case "FAILED":
    case "CANCELED":
    case "CANCELLED":
      return "failed";
    case "EXPIRED":
      return "timed_out";
    default:
      return "uncertain";
  }
}

/**
 * Classify a terminal call run.
 *
 * `outcome.task_completed` is deliberately never consulted. CALL-E sets it when
 * the call reaches a clear end state, which includes calls that recovered
 * nothing, so treating it as business success reports rebookings that did not
 * happen. See docs/agent-gallery/calle-api-observations.md.
 */
export function classifyOutcome(input: {
  status: string;
  agreement: Agreement;
  calleOutcome?: CallEOutcome;
}): Outcome {
  const fromStatus = outcomeFromStatus(input.status);
  if (fromStatus !== null) return fromStatus;

  const score = input.calleOutcome?.completion_confidence?.score;
  if (typeof score === "number" && score < CONFIDENCE_THRESHOLD) {
    return "uncertain";
  }

  switch (input.agreement) {
    case "confirmed_original":
      return "confirmed";
    case "accepted_window":
      return "rescheduled";
    case "refused":
      return "declined";
    case "no_valid_window":
      return "no_agreement";
    default:
      return "uncertain";
  }
}
