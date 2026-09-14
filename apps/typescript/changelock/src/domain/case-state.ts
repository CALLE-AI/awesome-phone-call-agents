import type { CaseState } from "./types";

export type { CaseState };

const NEXT: Record<CaseState, readonly CaseState[]> = {
  needs_review: ["preview_ready"],
  preview_ready: ["dispatch_reserved", "needs_review"],
  dispatch_reserved: ["call_active", "submission_unknown", "needs_review"],
  submission_unknown: ["call_active", "terminal_unverified", "needs_human"],
  call_active: ["terminal_unverified", "needs_human"],
  terminal_unverified: ["verification_confirmed", "verification_denied", "needs_human"],
  verification_confirmed: [],
  verification_denied: [],
  needs_human: [],
};

const TERMINAL: ReadonlySet<CaseState> = new Set([
  "verification_confirmed",
  "verification_denied",
  "needs_human",
]);

export const CASE_STATES = Object.fromEntries(
  (Object.keys(NEXT) as CaseState[]).map((s) => [s, { terminal: TERMINAL.has(s) }]),
) as Record<CaseState, { terminal: boolean }>;

export function canTransition(from: CaseState, to: CaseState): boolean {
  return NEXT[from].includes(to);
}

export function assertTransition(from: CaseState, to: CaseState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal case transition: ${from} -> ${to}`);
  }
}
