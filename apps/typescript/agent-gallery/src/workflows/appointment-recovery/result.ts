import type { CalleRunResult } from "../../calle";
import { readAgreement } from "./agreement";
import { classifyOutcome } from "./outcome";
import { NEXT_ACTIONS } from "./types";
import type { RecoveryRequest, RecoveryResult } from "./types";

/**
 * Build the operator-facing result from a terminal call run.
 *
 * This runs where the original request is available, because the agreement
 * reader needs the offered windows to tell which one was agreed. Classifying
 * without them silently downgrades every successful reschedule to `uncertain`.
 */
export function buildRecoveryResult(input: {
  request: RecoveryRequest;
  status: string;
  calle: CalleRunResult | null;
  runId: string;
}): RecoveryResult {
  const calle = input.calle ?? {};
  const reading = readAgreement({
    summary: calle.summary ?? null,
    transcript: calle.transcript ?? null,
    windows: input.request.replacement_windows,
    timezone: input.request.business.timezone,
    originalTime: input.request.appointment.original_time,
  });

  const outcome = classifyOutcome({
    status: input.status,
    agreement: reading.agreement,
    calleOutcome: calle.outcome ?? undefined,
  });

  const agreedWindow =
    outcome === "rescheduled" && reading.matchedWindowIndex !== null
      ? input.request.replacement_windows[reading.matchedWindowIndex]
      : null;

  // A confirmed call agreed to the slot the customer already had.
  const confirmedTime = agreedWindow
    ? agreedWindow.start
    : outcome === "confirmed"
      ? input.request.appointment.original_time
      : null;

  return {
    outcome,
    confirmed_time: confirmedTime,
    customer_intent: reading.agreement ?? "unclear",
    follow_up_required: outcome !== "confirmed" && outcome !== "rescheduled",
    next_action: NEXT_ACTIONS[outcome],
    notes: calle.post_summary ?? calle.summary ?? "",
    call_id: calle.call_id ?? input.runId,
    // Kept separate from call_id, which is CALL-E's identifier for the call
    // itself. The run id is the one that can be polled afterwards, and losing
    // it left a finished call impossible to look up.
    run_id: input.runId,
  };
}
