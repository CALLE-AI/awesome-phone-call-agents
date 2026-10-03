import type { CallStructuredResult } from "./types";

export type FollowUpMapping = {
  contactMethod: "phone";
  outcome: "reached" | "no_answer" | "needs_clinician";
  nextAction: "call_again" | "clinic_visit" | "urgent_review" | "none";
  note: string;
  status: "completed";
};

/** Map privacy-minimized CALL-E results into existing follow-up enums. */
export function mapStructuredResultToFollowUp(result: CallStructuredResult): FollowUpMapping {
  if (result.safetyEscalation === "urgent_in_person_care" || result.summaryCode === "urgent_care") {
    return {
      contactMethod: "phone",
      outcome: "needs_clinician",
      nextAction: "urgent_review",
      note: "Phone follow-up flagged urgent in-person care. Human escalation required.",
      status: "completed",
    };
  }

  if (result.nextAction === "urgent_review") {
    return {
      contactMethod: "phone",
      outcome: "needs_clinician",
      nextAction: "urgent_review",
      note: "Phone follow-up requested urgent clinical review.",
      status: "completed",
    };
  }

  if (!result.reached || result.summaryCode === "no_answer" || result.availability === "unavailable") {
    return {
      contactMethod: "phone",
      outcome: "no_answer",
      nextAction: "call_again",
      note: "Phone follow-up: no answer or unreachable.",
      status: "completed",
    };
  }

  if (
    result.needsHumanFollowUp ||
    result.safetyEscalation === "contact_chw_today" ||
    result.summaryCode === "needs_chw" ||
    result.summaryCode === "needs_callback"
  ) {
    return {
      contactMethod: "phone",
      outcome: "reached",
      nextAction: result.nextAction === "clinic_visit" ? "clinic_visit" : "call_again",
      note: "Phone follow-up: human CHW callback needed.",
      status: "completed",
    };
  }

  return {
    contactMethod: "phone",
    outcome: "reached",
    nextAction: result.nextAction,
    note: result.appointmentConfirmed
      ? "Phone follow-up: visit coordination confirmed."
      : "Phone follow-up completed without escalation.",
    status: "completed",
  };
}
