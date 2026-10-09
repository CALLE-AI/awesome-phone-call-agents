import { CHECK_IN_QUESTIONS, type CheckInQuestionId } from "./check-in-questionnaire";

export type CheckInVisualTone = "coral" | "primary" | "mint" | "amber";

export const CHECK_IN_VISUAL_ICONS = [
  "heart.fill",
  "drop.fill",
  "lungs.fill",
  "waveform",
  "figure.and.child.holdinghands",
  "calendar",
  "phone.fill",
] as const;

export type CheckInVisualIcon = (typeof CHECK_IN_VISUAL_ICONS)[number];

export type CheckInVisualSpec = {
  icon: CheckInVisualIcon;
  secondaryIcon: CheckInVisualIcon;
  tone: CheckInVisualTone;
};

export const CHECK_IN_VISUALS: Record<CheckInQuestionId, CheckInVisualSpec> = {
  severeBleedingOrPain: {
    icon: "heart.fill",
    secondaryIcon: "drop.fill",
    tone: "coral",
  },
  breathingDifficulty: {
    icon: "lungs.fill",
    secondaryIcon: "waveform",
    tone: "primary",
  },
  reducedBabyMovement: {
    icon: "figure.and.child.holdinghands",
    secondaryIcon: "heart.fill",
    tone: "mint",
  },
  needsHelpScheduling: {
    icon: "calendar",
    secondaryIcon: "phone.fill",
    tone: "amber",
  },
};

export function getCheckInVisual(questionId: CheckInQuestionId): CheckInVisualSpec {
  return CHECK_IN_VISUALS[questionId];
}

export function hasVisualForEveryQuestion(): boolean {
  return CHECK_IN_QUESTIONS.every((question) => Boolean(CHECK_IN_VISUALS[question.id]));
}
