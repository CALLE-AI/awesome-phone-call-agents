export type TriageOutcome = "routine" | "contact_chw_today" | "urgent_in_person_care";

export type CheckInAnswers = {
  severeBleedingOrPain: boolean;
  breathingDifficulty: boolean;
  reducedBabyMovement: boolean;
  needsHelpScheduling: boolean;
};

/**
 * Conservative UI-state classifier for the local demo flow.
 * Production clinical rules must be versioned and server-authoritative.
 */
export function classifyCheckIn(answers: CheckInAnswers): TriageOutcome {
  if (answers.severeBleedingOrPain || answers.breathingDifficulty) return "urgent_in_person_care";
  if (answers.reducedBabyMovement || answers.needsHelpScheduling) return "contact_chw_today";
  return "routine";
}
