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

  return {
    outcome,
    confirmed_time: agreedWindow ? agreedWindow.start : null,
    customer_intent: reading.agreement ?? "unclear",
    follow_up_required: outcome !== "confirmed" && outcome !== "rescheduled",
    next_action: NEXT_ACTIONS[outcome],
    notes: calle.post_summary ?? calle.summary ?? "",
    call_id: calle.call_id ?? input.runId,
  };
}
