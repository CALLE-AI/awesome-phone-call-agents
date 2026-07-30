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

import type { CommitResult } from "./types.js";

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
  /** When CALL-E says the call finished, if it says anything usable. */
  completedAt: string | null;
}

/**
 * Could this answer still be acted on.
 *
 * With no window to check against the answer to that is no. A confirmation is
 * only worth acting on because it landed in time, so a caller that cannot say
 * when it landed does not get to claim one.
 */
export function decidedInWindow(check: WindowCheck): boolean {
  if (!Number.isFinite(check.windowStart) || !Number.isFinite(check.deadline)) {
    return false;
  }
  if (check.now >= check.deadline) {
    return false;
  }
  const finished = check.completedAt === null ? Number.NaN : Date.parse(check.completedAt);
  if (Number.isNaN(finished)) {
    // No usable provider timestamp. The local clock has already said the result
    // arrived in time and there is nothing else to weigh it against.
    return true;
  }
  return (
    finished >= check.windowStart - CLOCK_SKEW_MS && finished <= check.deadline + CLOCK_SKEW_MS
  );
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
