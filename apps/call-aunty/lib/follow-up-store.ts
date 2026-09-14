import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FollowUpDraft } from "@/lib/follow-up";

const DRAFT_PREFIX = "call-aunty/follow-up-draft/";
const COMPLETED_KEY = "call-aunty/follow-ups/completed";

export async function saveFollowUpDraft(draft: FollowUpDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(`${DRAFT_PREFIX}${draft.womanId}`, JSON.stringify(draft));
  } catch (error) {
    throw error instanceof Error ? error : new Error("Failed to save follow-up draft");
  }
}

export async function loadFollowUpDraft(womanId: string): Promise<FollowUpDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(`${DRAFT_PREFIX}${womanId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FollowUpDraft;
    return parsed?.womanId === womanId && parsed.status === "draft" ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearFollowUpDraft(womanId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${DRAFT_PREFIX}${womanId}`);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Failed to clear follow-up draft");
  }
}

export async function saveCompletedFollowUp(followUp: FollowUpDraft): Promise<void> {
  try {
    const current = await loadCompletedFollowUps();
    const next = [followUp, ...current.filter((item) => item.womanId !== followUp.womanId)];
    await AsyncStorage.setItem(COMPLETED_KEY, JSON.stringify(next));
  } catch (error) {
    throw error instanceof Error ? error : new Error("Failed to save completed follow-up");
  }
}

export async function loadCompletedFollowUps(): Promise<FollowUpDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(COMPLETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FollowUpDraft[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.womanId === "string" && item.status === "completed") : [];
  } catch {
    return [];
  }
}
