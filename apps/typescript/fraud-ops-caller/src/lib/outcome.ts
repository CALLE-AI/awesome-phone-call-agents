import type { DialResult } from "./calle";
import { failClosed } from "./map-live-result";
import { followUpAtIso, slaFor } from "./nvc";
import type { FraudOpsCase, FraudOpsOutcome } from "./types";
import { assertValidOutcome } from "./validate";

export function composeOutcome(
  fraudCase: FraudOpsCase,
  dial: DialResult
): FraudOpsOutcome {
  const outcome: FraudOpsOutcome = {
    case_id: fraudCase.case_id,
    intent: fraudCase.intent,
    call_id: dial.callId,
    recording_id: dial.recordingId,
    disposition: dial.disposition,
    quotes: dial.quotes,
    next_action: dial.nextAction,
    fields: {
      contact_role: fraudCase.contact.role,
      nvc_state: "resolution_close",
    },
    transcript_snippet: dial.transcriptSnippet,
    ended_at: dial.endedAt,
  };

  if (dial.ptpDate) outcome.fields.ptp_date = dial.ptpDate;
  if (dial.missingDocs) outcome.fields.missing_docs = dial.missingDocs;
  if (dial.callbackAt) outcome.fields.callback_at = dial.callbackAt;
  if (dial.handoffReason) outcome.fields.handoff_reason = dial.handoffReason;

  if (dial.toolInvoked) outcome.fields.tool_invoked = dial.toolInvoked;
  else if (dial.disposition === "handoff" || dial.disposition === "unsafe_escalate") {
    outcome.fields.tool_invoked = "assign_human_spoc";
  } else {
    outcome.fields.tool_invoked = "none";
  }
  outcome.fields.hostility_strikes = dial.hostilityStrikes ?? 0;
  outcome.fields.deescalation_override = dial.deescalationOverride ?? false;
  if (dial.nvcState) outcome.fields.nvc_state = dial.nvcState;
  if (dial.unsafeFlag || dial.disposition === "unsafe_escalate") {
    outcome.fields.unsafe_flag = true;
  }

  const sla = slaFor(fraudCase.intent, dial.disposition);
  if (sla) {
    outcome.fields.follow_up_at = followUpAtIso(dial.endedAt, sla.followUpHours);
    outcome.fields.sentiment_check_sent = sla.sentimentCheck;
    if (sla.advocateOnHandoff) {
      outcome.fields.advocate_assigned = true;
    }
  } else {
    outcome.fields.sentiment_check_sent = false;
  }

  if (
    dial.disposition === "handoff" ||
    dial.disposition === "unsafe_escalate"
  ) {
    outcome.fields.advocate_assigned = true;
  }

  return assertValidOutcome(outcome);
}

/** After live has been invoked: validate failure becomes handoff / outcome_unknown. */
export function composeOutcomeOrUnknown(
  fraudCase: FraudOpsCase,
  dial: DialResult
): FraudOpsOutcome {
  try {
    return composeOutcome(fraudCase, dial);
  } catch {
    return composeOutcome(fraudCase, failClosed(fraudCase, "outcome_unknown"));
  }
}
