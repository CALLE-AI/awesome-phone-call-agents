import { isReached, type Disposition } from "@caller-ai/core/dispositions";
import type { LinkedField } from "@caller-ai/core/evidence";

export type Severity = "critical" | "follow_up" | "safe" | "unaccounted";

export type TriageDecision = {
  severity: Severity;
  needs: string[];
  dispatch: boolean;
};

/**
 * Fail-closed: ambiguity and unsupported claims go to a person.
 * Unreached stays in Unaccounted — it is not a completed assessment.
 */
export function triageAttempt(input: {
  disposition: Disposition | null;
  result: Record<string, unknown>;
  linked: LinkedField[];
  confidence?: number | null;
}): TriageDecision {
  const { disposition, result, linked, confidence } = input;

  if (!disposition || !isReached(disposition) || disposition === "wrong_person" || disposition === "hung_up") {
    return {
      severity: "unaccounted",
      needs: [needFromDisposition(disposition)],
      dispatch: false,
    };
  }

  const needs: string[] = [];
  const emergency =
    result.safety_status === "medical_emergency" || result.evacuation === "trapped";
  const wantsHuman = result.needs_human === "yes";
  const unsupported = linked.filter((field) => !field.supported);
  const lowConfidence = confidence != null && confidence < 0.8;
  const assistance = result.safety_status === "needs_assistance";
  const meds = result.medication === "running_low" || result.medication === "out";

  if (emergency) needs.push(result.evacuation === "trapped" ? "rescue" : "medical");
  if (wantsHuman) needs.push("human");
  if (unsupported.length > 0) needs.push("review claims");
  if (assistance) needs.push("recontact");
  if (result.has_power === "no") needs.push("power");
  if (meds) needs.push("medication");

  const dispatch = emergency || wantsHuman || unsupported.length > 0 || lowConfidence;

  if (emergency) {
    return { severity: "critical", needs: unique(needs), dispatch: true };
  }
  if (dispatch || assistance || meds) {
    return { severity: "follow_up", needs: unique(needs), dispatch };
  }
  return { severity: "safe", needs: [], dispatch: false };
}

function needFromDisposition(disposition: Disposition | null): string {
  if (disposition === "voicemail_left" || disposition === "voicemail_no_message") return "no_contact";
  if (disposition === "wrong_person") return "wrong_number";
  if (disposition === "hung_up") return "hung_up";
  if (disposition === "invalid_number") return "invalid_number";
  if (disposition === "no_answer") return "no_contact";
  return "unreached";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
