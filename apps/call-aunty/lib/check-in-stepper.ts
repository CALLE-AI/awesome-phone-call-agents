import {
  CHECK_IN_QUESTION_COUNT,
  CHECK_IN_QUESTIONS,
  EMPTY_CHECK_IN_ANSWERS,
  isConcerningAnswer,
  type CheckInQuestionId,
} from "./check-in-questionnaire";
import { classifyCheckIn, type CheckInAnswers, type TriageOutcome } from "./triage";

export type CheckInStepResult = {
  answers: CheckInAnswers;
  question: number;
  status: "started" | "escalated" | "attention" | "safe";
  outcome: TriageOutcome | null;
  /** False when the question index was invalid and no answer was applied. */
  applied: boolean;
};

function clampQuestionIndex(questionIndex: number): number {
  if (!Number.isFinite(questionIndex)) return 0;
  return Math.max(0, Math.min(CHECK_IN_QUESTION_COUNT - 1, Math.trunc(questionIndex)));
}

/** Move one question back without changing saved answers. */
export function previousCheckInQuestion(questionIndex: number): number {
  return Math.max(0, clampQuestionIndex(questionIndex) - 1);
}

/** Apply one yes/no tap and return the next questionnaire state. */
export function applyCheckInAnswer(
  questionIndex: number,
  answers: CheckInAnswers,
  choseYes: boolean,
): CheckInStepResult {
  if (
    !Number.isInteger(questionIndex) ||
    questionIndex < 0 ||
    questionIndex >= CHECK_IN_QUESTION_COUNT
  ) {
    return {
      answers: normalizeCheckInAnswers(answers),
      question: clampQuestionIndex(questionIndex),
      status: "started",
      outcome: null,
      applied: false,
    };
  }

  const current = CHECK_IN_QUESTIONS[questionIndex];
  const concerning = isConcerningAnswer(current, choseYes);
  const nextAnswers: CheckInAnswers = { ...normalizeCheckInAnswers(answers), [current.id]: concerning };

  if (concerning && current.urgency === "urgent") {
    return {
      answers: nextAnswers,
      question: questionIndex,
      status: "escalated",
      outcome: "urgent_in_person_care",
      applied: true,
    };
  }

  if (questionIndex < CHECK_IN_QUESTION_COUNT - 1) {
    return {
      answers: nextAnswers,
      question: questionIndex + 1,
      status: "started",
      outcome: null,
      applied: true,
    };
  }

  const outcome = classifyCheckIn(nextAnswers);
  if (outcome === "urgent_in_person_care") {
    return { answers: nextAnswers, question: questionIndex, status: "escalated", outcome, applied: true };
  }
  if (outcome === "contact_chw_today") {
    return { answers: nextAnswers, question: questionIndex, status: "attention", outcome, applied: true };
  }
  return { answers: nextAnswers, question: questionIndex, status: "safe", outcome, applied: true };
}

export function isCheckInAnswers(value: unknown): value is CheckInAnswers {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CheckInAnswers>;
  return (
    typeof candidate.severeBleedingOrPain === "boolean" &&
    typeof candidate.breathingDifficulty === "boolean" &&
    typeof candidate.reducedBabyMovement === "boolean" &&
    typeof candidate.needsHelpScheduling === "boolean"
  );
}

/** Coalesce missing/invalid fields instead of wiping a partial draft. */
export function normalizeCheckInAnswers(value: unknown): CheckInAnswers {
  if (!value || typeof value !== "object") return { ...EMPTY_CHECK_IN_ANSWERS };
  const candidate = value as Partial<CheckInAnswers>;
  return {
    severeBleedingOrPain:
      typeof candidate.severeBleedingOrPain === "boolean"
        ? candidate.severeBleedingOrPain
        : EMPTY_CHECK_IN_ANSWERS.severeBleedingOrPain,
    breathingDifficulty:
      typeof candidate.breathingDifficulty === "boolean"
        ? candidate.breathingDifficulty
        : EMPTY_CHECK_IN_ANSWERS.breathingDifficulty,
    reducedBabyMovement:
      typeof candidate.reducedBabyMovement === "boolean"
        ? candidate.reducedBabyMovement
        : EMPTY_CHECK_IN_ANSWERS.reducedBabyMovement,
    needsHelpScheduling:
      typeof candidate.needsHelpScheduling === "boolean"
        ? candidate.needsHelpScheduling
        : EMPTY_CHECK_IN_ANSWERS.needsHelpScheduling,
  };
}

/** IDs marked concerning in the completed answer set, in questionnaire order. */
export function getConcerningFindings(answers: CheckInAnswers): CheckInQuestionId[] {
  return CHECK_IN_QUESTIONS.filter((question) => answers[question.id]).map((question) => question.id);
}
