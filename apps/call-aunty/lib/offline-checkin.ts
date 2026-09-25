import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHECK_IN_QUESTION_COUNT, EMPTY_CHECK_IN_ANSWERS } from "./check-in-questionnaire";
import { normalizeCheckInAnswers } from "./check-in-stepper";
import type { CheckInAnswers } from "./triage";

const OFFLINE_CHECKIN_KEY = "call-aunty/offline-checkin-pack";
export const OFFLINE_CHECKIN_VERSION = "2026.08";
export const OFFLINE_CHECKIN_QUESTION_COUNT = CHECK_IN_QUESTION_COUNT;

export type OfflineCheckInProgress = {
  version: string;
  questionCount: number;
  completedQuestion: number;
  savedAt: string;
  answers: CheckInAnswers;
};

function clampCompletedQuestion(value: number): number {
  return Math.max(0, Math.min(OFFLINE_CHECKIN_QUESTION_COUNT, value));
}

export function createOfflineCheckInProgress(
  completedQuestion = 0,
  answers: CheckInAnswers = EMPTY_CHECK_IN_ANSWERS,
): OfflineCheckInProgress {
  return {
    version: OFFLINE_CHECKIN_VERSION,
    questionCount: OFFLINE_CHECKIN_QUESTION_COUNT,
    completedQuestion: clampCompletedQuestion(completedQuestion),
    savedAt: new Date().toISOString(),
    answers: normalizeCheckInAnswers(answers),
  };
}

export function parseOfflineCheckInProgress(value: string | null): OfflineCheckInProgress | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OfflineCheckInProgress>;
    if (parsed.version !== OFFLINE_CHECKIN_VERSION) return null;
    if (parsed.questionCount !== OFFLINE_CHECKIN_QUESTION_COUNT) return null;
    if (
      typeof parsed.completedQuestion !== "number" ||
      !Number.isInteger(parsed.completedQuestion) ||
      !Number.isFinite(parsed.completedQuestion)
    ) {
      return null;
    }
    if (typeof parsed.savedAt !== "string" || Number.isNaN(Date.parse(parsed.savedAt))) return null;
    return {
      version: OFFLINE_CHECKIN_VERSION,
      questionCount: OFFLINE_CHECKIN_QUESTION_COUNT,
      completedQuestion: clampCompletedQuestion(parsed.completedQuestion),
      savedAt: parsed.savedAt,
      answers: normalizeCheckInAnswers(parsed.answers),
    };
  } catch {
    return null;
  }
}

export async function saveOfflineCheckInProgress(progress: OfflineCheckInProgress): Promise<boolean> {
  try {
    await AsyncStorage.setItem(OFFLINE_CHECKIN_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export async function loadOfflineCheckInProgress(): Promise<OfflineCheckInProgress | null> {
  try {
    return parseOfflineCheckInProgress(await AsyncStorage.getItem(OFFLINE_CHECKIN_KEY));
  } catch {
    return null;
  }
}

export async function clearOfflineCheckInProgress(): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(OFFLINE_CHECKIN_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 1-based question number for resume copy (never reports 0 of N). */
export function offlineCheckInDisplayQuestion(progress: OfflineCheckInProgress): number {
  return Math.min(progress.completedQuestion + 1, progress.questionCount);
}
