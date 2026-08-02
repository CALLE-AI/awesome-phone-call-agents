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
  /**
   * Whether CALL-E gave a completion time this app could read at all. Recorded
   * next to the verdict, so a line can never claim the window was checked
   * against a time nobody could read.
   */
  completionTimeUsable: boolean;
}

/** The instant CALL-E says the call finished, or null when it gave nothing usable. */
export function completionInstant(completedAt: unknown): number | null {
  if (typeof completedAt !== "string" || completedAt.trim().length === 0) {
    return null;
  }
  const finished = Date.parse(completedAt);
  return Number.isFinite(finished) ? finished : null;
}

/**
 * Could this answer still be acted on, and if not, why not.
 *
 * The provider's completion time is checked first, before either clock. A
 * missing, empty, unparseable or wrongly typed one is refused as
 * `completion_time_unknown` rather than waved through, because otherwise a
 * replayed idempotency key with no usable timestamp would satisfy any window it
 * was measured against. Then the window itself has to be computable and the
 * local clock has to still be inside it, which catches an answer that came back
 * after this round could act on it. Last, the completion time has to sit inside
 * the window, with a minute of skew at each end because it is somebody else's
 * clock.
 */
export function judgeWindow(check: WindowCheck): WindowVerdict {
  const finished = completionInstant(check.completedAt);
  if (finished === null) {
    return { within: false, reason: "completion_time_unknown", completionTimeUsable: false };
  }
  if (
    !Number.isFinite(check.windowStart) ||
    !Number.isFinite(check.deadline) ||
    !Number.isFinite(check.now)
  ) {
    return { within: false, reason: "no_window", completionTimeUsable: true };
  }
  if (check.now >= check.deadline) {
    return { within: false, reason: "late_result", completionTimeUsable: true };
  }
  if (finished < check.windowStart - CLOCK_SKEW_MS || finished > check.deadline + CLOCK_SKEW_MS) {
    return { within: false, reason: "outside_window", completionTimeUsable: true };
  }
  return { within: true, reason: null, completionTimeUsable: true };
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
 *
 * So it reads the transcript and nothing else. A call CALL-E reports as failed or
 * canceled can still hold the confirmation question and a yes after it, which is a
 * line that dropped after the person agreed. Reading a status as proof that nobody
 * committed is how a provider error code silently cancels a duty. That duty is the
 * whole reason this app exists. The yes still has to come after the
 * confirmation question, with no machine on the line, so what counts is something
 * the person answered rather than anything the caller said.
 */
export function saidYes(result: CommitResult): boolean {
  return (
    result.phase === "confirm" &&
    result.question_asked &&
    result.heard_answer === "confirm" &&
    !result.machine_answered
  );
}
