/**
 * Call governor. Hard caps, quiet hours, blocklist, kill switch,
 * and a dry-run accountant. Twenty free calls is the binding constraint.
 *
 * Source: docs/build-plan.md §2.5. Implementation lands Friday AM.
 */

export type BudgetDecision =
  | { ok: true; remaining: number }
  | { ok: false; reason: string; remaining: number };

export type BudgetState = {
  projectCap: number;
  used: number;
  killed: boolean;
  blocklist: readonly string[];
};

export const DEFAULT_PROJECT_CAP = 20;

export function remainingCalls(state: BudgetState): number {
  return Math.max(0, state.projectCap - state.used);
}

export function canDial(
  state: BudgetState,
  phoneE164: string,
): BudgetDecision {
  const remaining = remainingCalls(state);
  if (state.killed) {
    return { ok: false, reason: "kill_switch", remaining };
  }
  if (state.blocklist.includes(phoneE164)) {
    return { ok: false, reason: "blocklist", remaining };
  }
  if (remaining <= 0) {
    return { ok: false, reason: "project_cap", remaining };
  }
  return { ok: true, remaining };
}

export function accountWave(state: BudgetState, plannedDials: number): {
  wouldDial: number;
  wouldRemain: number;
  blocked: number;
} {
  const remaining = remainingCalls(state);
  const wouldDial = Math.min(plannedDials, remaining);
  return {
    wouldDial,
    wouldRemain: remaining - wouldDial,
    blocked: plannedDials - wouldDial,
  };
}
