/**
 * The coordination window, checked on the result.
 *
 * The window is fixed when a run starts and it bounds how long this coordination
 * may keep asking people to commit to a time. Checking it before a call is not
 * enough. A call placed with a minute of window left can answer an hour later,
 * and a replayed idempotency key hands back a final answer from a window that
 * closed long ago. Both are late and neither is a confirmation.
 *
 * Two clocks, because they catch different things. The local clock catches a
 * result that came back after this round could still act on it. The call's own
 * completion time catches a call that finished outside this window at all, which
 * is what a replayed key returns. The provider timestamp is allowed a minute of
 * skew at each end, because it is somebody else's clock.
 */

import type { CommitResult, WindowRefusal } from "./types.js";

/** How far outside the window a provider timestamp may sit and still count. */
export const CLOCK_SKEW_MS = 60_000;

export interface WindowSpan {
  /** When this coordination's window opened, which is when the run started. */
  windowStart: number;
  /** `windowStart` plus `policy.window_minutes`. */
  deadline: number;
  /** The local clock when the result came back. */
  now: number;
}

export interface WindowCheck extends WindowSpan {
  /**
   * What CALL-E said about when the call finished. Typed as unknown because it
   * is somebody else's field: it arrives missing, null, empty or as a number
   * often enough that this has to be checked rather than trusted.
   */
  completedAt: unknown;
}

export interface WindowVerdict {
  /** True only when the answer landed in time and this run may act on it. */
  within: boolean;
  /** Why it was refused, so a ledger entry says which check said no. */
  reason: WindowRefusal | null;
}

/**
 * Could this answer still be acted on, and if not, why not.
 *
 * Both clocks have to agree and both have to be readable. A window this app
 * cannot compute, a result that came back late and a completion time the
 * provider did not give are all refusals: a confirmation is worth acting on
 * because it landed in time, so an answer that cannot be placed in time is not
 * one. That matters most for a replayed idempotency key, which hands back a
 * final yes from a round that closed long ago and can arrive with no usable
 * timestamp at all.
 */
export function judgeWindow(check: WindowCheck): WindowVerdict {
  if (
    !Number.isFinite(check.windowStart) ||
    !Number.isFinite(check.deadline) ||
    !Number.isFinite(check.now)
  ) {
    return { within: false, reason: "no_window" };
  }
  if (check.now >= check.deadline) {
    return { within: false, reason: "late_result" };
  }
  if (typeof check.completedAt !== "string" || check.completedAt.trim().length === 0) {
    return { within: false, reason: "no_completion_time" };
  }
  const finished = Date.parse(check.completedAt);
  if (!Number.isFinite(finished)) {
    return { within: false, reason: "no_completion_time" };
  }
  if (finished < check.windowStart - CLOCK_SKEW_MS || finished > check.deadline + CLOCK_SKEW_MS) {
    return { within: false, reason: "outside_window" };
  }
  return { within: true, reason: null };
}

export function decidedInWindow(check: WindowCheck): boolean {
  return judgeWindow(check).within;
}

/**
 * Did this party put the phone down believing the time is on.
 *
 * A person who said yes is owed the call that says it is off. That is true
 * whether or not the run acted on the yes. A yes this window refuses, a yes below
 * the confidence floor and a yes the extracted result contradicts are all still a
 * person who agreed to keep an afternoon free. The window decides what can be
 * confirmed. This decides who has to be told.
 */
export function saidYes(result: CommitResult): boolean {
  return result.phase === "confirm" && result.reached_person && result.heard_answer === "confirm";
}
