import AsyncStorage from "@react-native-async-storage/async-storage";

const HISTORY_KEY = "call-aunty/reconciliation-history";
const MAX_HISTORY_ENTRIES = 5;

export type ReconciliationHistoryEntry = {
  timestamp: string;
  serverAvailable: boolean;
  syncedCount: number;
  preservedCount: number;
  decision?: "kept_local" | "accepted_server";
};

export function appendReconciliationHistory(entries: ReconciliationHistoryEntry[], entry: ReconciliationHistoryEntry) {
  return [entry, ...entries].slice(0, MAX_HISTORY_ENTRIES);
}

export function parseReconciliationHistory(raw: string | null): ReconciliationHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ReconciliationHistoryEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.timestamp === "string" && typeof entry?.serverAvailable === "boolean" && Number.isFinite(entry?.syncedCount) && Number.isFinite(entry?.preservedCount) && (entry?.decision === undefined || entry.decision === "kept_local" || entry.decision === "accepted_server")).slice(0, MAX_HISTORY_ENTRIES) : [];
  } catch {
    return [];
  }
}

export async function loadReconciliationHistory() {
  try {
    return parseReconciliationHistory(await AsyncStorage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

export async function saveReconciliationHistory(entries: ReconciliationHistoryEntry[]): Promise<boolean> {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)));
    return true;
  } catch {
    return false;
  }
}

export async function recordReconciliationHistory(entry: ReconciliationHistoryEntry) {
  const next = appendReconciliationHistory(await loadReconciliationHistory(), entry);
  const saved = await saveReconciliationHistory(next);
  if (!saved) throw new Error("Failed to save reconciliation history");
  return next;
}
