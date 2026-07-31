/**
 * What CALL-E says a call is doing, in one place.
 *
 * The coordinator, recovery and replay all have to agree on when a call is
 * finished and on what to record when this app cannot say what a call did. One
 * module they all import, so the three cannot drift apart.
 */

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

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
