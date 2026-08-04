import { classifyDelivery, isTerminalStatus, normalizeStatus } from "../../calle";
import type { CalleRunOutcome, Delivery } from "../../calle";
import type { Outcome } from "./types";

/**
 * Turns a delivered call into an appointment-recovery outcome.
 *
 * The generic half — which statuses are terminal, and whether a call was
 * answered at all — lives in `src/calle/status.ts` and is shared by any
 * workflow. Only the mapping from a delivery to a business meaning is here.
 */

export { isTerminalStatus, normalizeStatus };

/**
 * Conversational agreement read back from an answered call.
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

/** Below this confidence an answered call is routed to human review. */
export const CONFIDENCE_THRESHOLD = 0.6;

/** Kept for callers holding a raw status string. */
export function isTerminal(raw: string): boolean {
  return isTerminalStatus(raw);
}

/**
 * Map a terminal status to an outcome, or return null when the call was
 * answered and the outcome depends on what was said.
 */
export function outcomeFromStatus(raw: string): Outcome | null {
  return outcomeFromDelivery(classifyDelivery(raw));
}

export function outcomeFromDelivery(delivery: Delivery): Outcome | null {
  switch (delivery) {
    case "answered":
      return null;
    case "unreachable":
      return "unreachable";
    case "failed":
      return "failed";
    case "timed_out":
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
  calleOutcome?: CalleRunOutcome;
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
