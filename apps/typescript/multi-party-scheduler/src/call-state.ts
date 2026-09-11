/**
 * What CALL-E says a call is doing, in one place.
 *
 * The coordinator, recovery and replay all have to agree on when a call is
 * finished and on what to record when this app cannot say what a call did. One
 * module they all import, so the three cannot drift apart.
 */

import type { CommitResult, GatherResult } from "./types.js";

/**
 * Statuses a call can no longer move out of.
 *
 * The API's `CallStatus` is `queued`, `in_progress`, `completed`, `failed` or
 * `canceled` (`@call-e/calle` 0.2.2, `dist/generated/schema.d.ts:125`), so
 * exactly three of them are terminal. A no answer, a busy line or a voicemail is
 * not a status of its own: it arrives as `failed` with a failure code or as a
 * completed call whose transcript is a machine, and both are read further down.
 */
export const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

/**
 * The status recorded when a call may exist and this app cannot say what it did.
 *
 * A create with no reply, a wait or a read that failed after the create got
 * through and a call CALL-E has not finished with all land here. It is not a
 * status the API ever sends: it is this app saying the call is nobody's answer
 * yet. It is deliberately not terminal, so recovery owns it and no phase result
 * is decided off it.
 */
export const UNRESOLVED_STATUS = "unresolved";

/**
 * The status recorded for a call that was never sent.
 *
 * The hour was outside the party's calling hours or the run was canceled before
 * the create went out. No key reached the provider and no id came back, so there is
 * nothing at CALL-E to account for and nothing for recovery to settle. Like
 * `unresolved` this is not a status the API sends.
 */
export const NOT_PLACED_STATUS = "not_placed";

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * A call is unsettled when the ledger cannot say what it did. No call id means
 * the create response was lost and the call may still have gone out. A call id
 * with a status that is not terminal means it was still running when this process
 * stopped. A call the coordinator declined to place is settled: it never happened.
 *
 * This lives here rather than in recovery because three places need the same
 * answer. Recovery decides what to reconcile with it, the release round decides
 * whether an earlier attempt may be retried and replay decides whether a history
 * accounts for every call it records. It reads the two fields a gather result and a
 * commit result share, so one rule covers every phase.
 */
export function unsettledCall(result: Pick<CommitResult | GatherResult, "call_id" | "call_status">): boolean {
  if (result.call_status === NOT_PLACED_STATUS) {
    return false;
  }
  if (result.call_id === null) {
    return true;
  }
  return !TERMINAL_STATUSES.has(result.call_status);
}
