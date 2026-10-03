import type { CallStructuredResult } from "./types";
import type { TriageState } from "./types";

export type EscalationRoute =
  | "none"
  | "human_callback"
  | "chw_follow_up_today"
  | "clinic_contact"
  | "urgent_in_person";

export function classifyEscalation(result: CallStructuredResult): EscalationRoute {
  if (result.safetyEscalation === "urgent_in_person_care" || result.summaryCode === "urgent_care") {
    return "urgent_in_person";
  }
  if (result.nextAction === "urgent_review") {
    return "urgent_in_person";
  }
  if (result.safetyEscalation === "contact_chw_today" || result.needsHumanFollowUp) {
    return "chw_follow_up_today";
  }
  if (result.nextAction === "clinic_visit" || result.summaryCode === "needs_callback") {
    return result.nextAction === "clinic_visit" ? "clinic_contact" : "human_callback";
  }
  return "none";
}

export function escalationToTriage(route: EscalationRoute): TriageState | null {
  if (route === "urgent_in_person") return "urgent_in_person_care";
  if (route === "chw_follow_up_today" || route === "human_callback" || route === "clinic_contact") {
    return "contact_chw_today";
  }
  return null;
}
