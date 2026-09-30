import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHECK_IN_QUESTION_COUNT } from "./check-in-questionnaire";
import { normalizeCheckInAnswers } from "./check-in-stepper";
import type { CheckInAnswers } from "./triage";

const CHECK_IN_KEY = "call-aunty/check-in-state";

export type SavedCheckIn = {
  status: "idle" | "started" | "safe" | "attention" | "escalated";
  question: number;
  savedAt: string;
  answers: CheckInAnswers;
};

export async function saveCheckInState(state: SavedCheckIn): Promise<boolean> {
  try {
    await AsyncStorage.setItem(CHECK_IN_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function isSavedCheckIn(value: unknown): value is SavedCheckIn {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedCheckIn>;
  return (
    (candidate.status === "idle" ||
      candidate.status === "started" ||
      candidate.status === "safe" ||
      candidate.status === "attention" ||
      candidate.status === "escalated") &&
    typeof candidate.question === "number" &&
    Number.isInteger(candidate.question) &&
    Number.isFinite(candidate.question) &&
    candidate.question >= 0 &&
    candidate.question < CHECK_IN_QUESTION_COUNT &&
    typeof candidate.savedAt === "string" &&
    candidate.savedAt.length > 0 &&
    !Number.isNaN(Date.parse(candidate.savedAt))
  );
}

export async function loadCheckInState(): Promise<SavedCheckIn | null> {
  try {
    const raw = await AsyncStorage.getItem(CHECK_IN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSavedCheckIn(parsed)) return null;
    return {
      status: parsed.status,
      question: parsed.question,
      savedAt: parsed.savedAt,
      answers: normalizeCheckInAnswers((parsed as Partial<SavedCheckIn>).answers),
    };
  } catch {
    return null;
  }
}

export async function clearCheckInState(): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(CHECK_IN_KEY);
    return true;
  } catch {
    return false;
  }
}
