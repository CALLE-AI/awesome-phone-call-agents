import { callStructuredResultSchema, type CallStructuredResult } from "./types";

export type NormalizedCallResult = CallStructuredResult & {
  normalizationNotes: string[];
};

export function normalizeStructuredResult(raw: unknown): NormalizedCallResult | null {
  const notes: string[] = [];
  const parsed = callStructuredResultSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const result = { ...parsed.data };

  if (result.reached && result.availability === "unavailable") {
    result.availability = "unknown";
    notes.push("Contradictory availability; set to unknown.");
  }

  if (!result.reached && result.summaryCode === "ok_routine") {
    result.summaryCode = "no_answer";
    notes.push("Unreachable but ok_routine; coerced to no_answer.");
  }

  if (result.appointmentConfirmed === null && result.summaryCode === "needs_callback") {
    notes.push("Appointment unknown during callback need.");
  }

  if (result.nextAction === "urgent_review" && result.safetyEscalation === "none") {
    result.safetyEscalation = "contact_chw_today";
    notes.push("Urgent review mapped to CHW escalation.");
  }

  return { ...result, normalizationNotes: notes };
}
