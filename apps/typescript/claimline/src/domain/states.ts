import type { IntentState } from "./types.js";

/**
 * Allowed transitions for the application-owned intent state machine. Any
 * transition not listed here is rejected, so the workflow can be reconstructed
 * from durable state after a crash and never skips a verification step.
 */
const TRANSITIONS: Record<IntentState, readonly IntentState[]> = {
  reserved: ["submission_unknown", "accepted", "needs_human", "canceled"],
  submission_unknown: ["accepted", "needs_human"],
  accepted: ["terminal_unverified", "needs_human"],
  terminal_unverified: ["terminal_verified", "needs_human"],
  terminal_verified: ["applied", "needs_human"],
  needs_human: ["applied"],
  applied: [],
  canceled: [],
};

export function canTransition(from: IntentState, to: IntentState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throw unless the transition is allowed. */
export function assertTransition(from: IntentState, to: IntentState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal intent transition: ${from} -> ${to}`);
  }
}

export function isTerminalState(state: IntentState): boolean {
  return state === "applied" || state === "canceled";
}

export const ALL_STATES: readonly IntentState[] = [
  "reserved",
  "submission_unknown",
  "accepted",
  "terminal_unverified",
  "terminal_verified",
  "needs_human",
  "applied",
  "canceled",
];
