/**
 * CALL-E run status semantics. No workflow domain concepts belong in this file.
 */

/**
 * How a call was delivered, independent of what any workflow wanted from it.
 *
 * `answered` means a conversation happened and the workflow must decide what it
 * amounted to; the other values mean no conversation took place, so no workflow
 * can claim a conversational result.
 */
export type Delivery = "answered" | "unreachable" | "failed" | "timed_out" | "unknown";

export const TERMINAL_STATUSES = [
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
  "VOICEMAIL",
  "BUSY",
  "EXPIRED",
] as const;

const TERMINAL = new Set<string>(TERMINAL_STATUSES);

/** CALL-E reports some statuses with a space, for example "NO ANSWER". */
export function normalizeStatus(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "_");
}

export function isTerminalStatus(raw: string): boolean {
  return TERMINAL.has(normalizeStatus(raw));
}

/**
 * Classify a run status as a delivery result.
 *
 * `DECLINED` is a rejected incoming call, not a person refusing whatever the
 * call asked for. Conflating the two lets a workflow report a refusal that was
 * never spoken, so it is grouped with the other unreached cases.
 *
 * An unrecognized status is `unknown` rather than a guess: CALL-E may add
 * statuses, and inventing a meaning for one is worse than admitting ignorance.
 */
export function classifyDelivery(raw: string): Delivery {
  switch (normalizeStatus(raw)) {
    case "COMPLETED":
      return "answered";
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
      return "unknown";
  }
}
