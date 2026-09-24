import { describe, expect, it } from "vitest";
import {
  CHECK_IN_QUESTION_COUNT,
  CHECK_IN_QUESTIONS,
  EMPTY_CHECK_IN_ANSWERS,
  getAnswerLabels,
  getCheckInQuestionnaireCopy,
  isConcerningAnswer,
} from "../lib/check-in-questionnaire";
import { applyCheckInAnswer, getConcerningFindings, normalizeCheckInAnswers, previousCheckInQuestion } from "../lib/check-in-stepper";
import { classifyCheckIn } from "../lib/triage";
import { hasVisualForEveryQuestion } from "../lib/check-in-visuals";
import {
  createOfflineCheckInProgress,
  OFFLINE_CHECKIN_QUESTION_COUNT,
  OFFLINE_CHECKIN_VERSION,
  offlineCheckInDisplayQuestion,
  parseOfflineCheckInProgress,
} from "../lib/offline-checkin";

describe("check-in questionnaire", () => {
  it("keeps the bundled question pack aligned with triage answers and offline progress", () => {
    expect(CHECK_IN_QUESTION_COUNT).toBe(4);
    expect(CHECK_IN_QUESTION_COUNT).toBe(OFFLINE_CHECKIN_QUESTION_COUNT);
    expect(CHECK_IN_QUESTIONS.map((question) => question.id)).toEqual([
      "severeBleedingOrPain",
      "breathingDifficulty",
      "reducedBabyMovement",
      "needsHelpScheduling",
    ]);
    expect(Object.keys(EMPTY_CHECK_IN_ANSWERS)).toHaveLength(CHECK_IN_QUESTION_COUNT);
  });

  it("treats reduced baby movement as concerning when the woman answers no", () => {
    const movement = CHECK_IN_QUESTIONS.find((question) => question.id === "reducedBabyMovement");
    expect(movement).toBeDefined();
    expect(isConcerningAnswer(movement!, true)).toBe(false);
    expect(isConcerningAnswer(movement!, false)).toBe(true);
  });

  it("uses symptom-specific labels for urgent prompts and polarity-aware labels for softer ones", () => {
    const copy = getCheckInQuestionnaireCopy("en");
    expect(getAnswerLabels(CHECK_IN_QUESTIONS[0], copy)).toEqual({
      yesLabel: copy.symptomYes,
      noLabel: copy.symptomNo,
    });
    expect(getAnswerLabels(CHECK_IN_QUESTIONS[2], copy)).toEqual({
      yesLabel: copy.movementYes,
      noLabel: copy.movementNo,
    });
  });

  it("escalates red flags immediately and routes softer concerns to CHW contact", () => {
    const urgent = applyCheckInAnswer(0, EMPTY_CHECK_IN_ANSWERS, true);
    expect(urgent.status).toBe("escalated");
    expect(urgent.outcome).toBe("urgent_in_person_care");
    expect(urgent.applied).toBe(true);

    const afterSafeSymptoms = applyCheckInAnswer(
      2,
      applyCheckInAnswer(1, applyCheckInAnswer(0, EMPTY_CHECK_IN_ANSWERS, false).answers, false).answers,
      false,
    );
    expect(afterSafeSymptoms.status).toBe("started");
    expect(afterSafeSymptoms.answers.reducedBabyMovement).toBe(true);

    const finished = applyCheckInAnswer(3, afterSafeSymptoms.answers, false);
    expect(finished.status).toBe("attention");
    expect(finished.outcome).toBe("contact_chw_today");
    expect(getConcerningFindings(finished.answers)).toEqual(["reducedBabyMovement"]);

    expect(classifyCheckIn(EMPTY_CHECK_IN_ANSWERS)).toBe("routine");
  });

  it("lets the woman go back one question without wiping answers", () => {
    expect(previousCheckInQuestion(0)).toBe(0);
    expect(previousCheckInQuestion(2)).toBe(1);
    expect(previousCheckInQuestion(99)).toBe(2);
    expect(previousCheckInQuestion(Number.NaN)).toBe(0);
  });

  it("keeps an illustration spec for every question", () => {
    expect(hasVisualForEveryQuestion()).toBe(true);
  });

  it("ignores invalid question indexes instead of silently rewriting question 0", () => {
    const draft = { ...EMPTY_CHECK_IN_ANSWERS, breathingDifficulty: true };
    const invalid = applyCheckInAnswer(Number.NaN, draft, true);
    expect(invalid.applied).toBe(false);
    expect(invalid.answers).toEqual(draft);
    expect(invalid.question).toBe(0);

    const outOfRange = applyCheckInAnswer(99, draft, false);
    expect(outOfRange.applied).toBe(false);
    expect(outOfRange.answers.breathingDifficulty).toBe(true);
  });

  it("persists answers in the offline progress pack and normalizes legacy drafts", () => {
    const progress = createOfflineCheckInProgress(2, {
      ...EMPTY_CHECK_IN_ANSWERS,
      breathingDifficulty: true,
    });
    expect(progress.answers.breathingDifficulty).toBe(true);
    expect(offlineCheckInDisplayQuestion(progress)).toBe(3);
    expect(parseOfflineCheckInProgress(JSON.stringify({
      version: OFFLINE_CHECKIN_VERSION,
      questionCount: 4,
      completedQuestion: 1,
      savedAt: "2026-08-18T00:00:00.000Z",
    }))?.answers).toEqual(EMPTY_CHECK_IN_ANSWERS);
    expect(normalizeCheckInAnswers(null)).toEqual(EMPTY_CHECK_IN_ANSWERS);
    expect(normalizeCheckInAnswers({
      severeBleedingOrPain: true,
      breathingDifficulty: "yes",
    })).toEqual({
      ...EMPTY_CHECK_IN_ANSWERS,
      severeBleedingOrPain: true,
    });
  });

  it("localizes prompts, hints, findings, and image alt text across supported languages", () => {
    for (const language of ["en", "bn", "hi", "ur", "ta", "te"] as const) {
      const copy = getCheckInQuestionnaireCopy(language);
      expect(copy.questions.severeBleedingOrPain.length).toBeGreaterThan(10);
      expect(copy.hints.breathingDifficulty.length).toBeGreaterThan(10);
      expect(copy.findings.needsHelpScheduling.length).toBeGreaterThan(3);
      expect(copy.imageAlt.reducedBabyMovement.length).toBeGreaterThan(10);
      expect(copy.findingsTitle.length).toBeGreaterThan(3);
      expect(copy.savedOnDevice.length).toBeGreaterThan(3);
      expect(copy.previousQuestion.length).toBeGreaterThan(3);
      expect(copy.imageAlt.reducedBabyMovement.length).toBeGreaterThan(8);
    }
    expect(getCheckInQuestionnaireCopy("en").hints.reducedBabyMovement).not.toBe(
      getCheckInQuestionnaireCopy("bn").hints.reducedBabyMovement,
    );
  });
});
