import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AppLanguage } from "@/lib/language";

const SNAPSHOT_KEY = "call-aunty/offline-care-snapshot";
export const OFFLINE_CARE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineCareSnapshot = {
  language: AppLanguage;
  savedAt: string;
  version: string;
};

export type OfflineCareFreshness = "available" | "stale" | "missing";

export function parseOfflineCareSnapshot(value: string | null): OfflineCareSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OfflineCareSnapshot>;
    if (typeof parsed.language !== "string" || typeof parsed.savedAt !== "string" || typeof parsed.version !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.savedAt))) return null;
    return { language: parsed.language as AppLanguage, savedAt: parsed.savedAt, version: parsed.version };
  } catch {
    return null;
  }
}

export function getOfflineCareFreshness(snapshot: OfflineCareSnapshot | null, now = Date.now()): OfflineCareFreshness {
  if (!snapshot) return "missing";
  const age = now - Date.parse(snapshot.savedAt);
  return age <= OFFLINE_CARE_SNAPSHOT_MAX_AGE_MS ? "available" : "stale";
}

export async function loadOfflineCareSnapshot(): Promise<OfflineCareSnapshot | null> {
  try {
    return parseOfflineCareSnapshot(await AsyncStorage.getItem(SNAPSHOT_KEY));
  } catch {
    return null;
  }
}

export async function saveOfflineCareSnapshot(language: AppLanguage, version = "2026.08"): Promise<OfflineCareSnapshot | null> {
  const snapshot: OfflineCareSnapshot = { language, version, savedAt: new Date().toISOString() };
  try {
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
  }
}
