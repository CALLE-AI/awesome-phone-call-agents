import AsyncStorage from "@react-native-async-storage/async-storage";

const TRANSFER_KEY = "call-aunty/sync-transfer";

export type SyncTransferProgress = {
  transferId: string;
  totalItems: number;
  completedItems: number;
  updatedAt: string;
  status: "active" | "paused";
};

export function createTransferProgress(totalItems: number, transferId = `transfer:${Date.now()}`): SyncTransferProgress {
  return { transferId, totalItems: Math.max(0, totalItems), completedItems: 0, updatedAt: new Date().toISOString(), status: "active" };
}

export function advanceTransferProgress(progress: SyncTransferProgress, completedItems: number): SyncTransferProgress {
  return { ...progress, completedItems: Math.min(progress.totalItems, Math.max(progress.completedItems, completedItems)), updatedAt: new Date().toISOString() };
}

export function isTransferComplete(progress: SyncTransferProgress): boolean {
  return progress.totalItems === 0 || progress.completedItems >= progress.totalItems;
}

export async function loadTransferProgress(): Promise<SyncTransferProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(TRANSFER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncTransferProgress>;
    if (typeof parsed.transferId !== "string" || typeof parsed.totalItems !== "number" || typeof parsed.completedItems !== "number") return null;
    return { transferId: parsed.transferId, totalItems: Math.max(0, parsed.totalItems), completedItems: Math.max(0, parsed.completedItems), updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(), status: parsed.status === "paused" ? "paused" : "active" };
  } catch {
    return null;
  }
}

export async function saveTransferProgress(progress: SyncTransferProgress): Promise<boolean> {
  try {
    await AsyncStorage.setItem(TRANSFER_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function pauseTransferProgress(progress: SyncTransferProgress): SyncTransferProgress {
  return { ...progress, status: "paused", updatedAt: new Date().toISOString() };
}

export function resumeTransferProgress(progress: SyncTransferProgress): SyncTransferProgress {
  return { ...progress, status: "active", updatedAt: new Date().toISOString() };
}

export function canContinueTransfer(progress: SyncTransferProgress): boolean {
  return progress.status === "active" && !isTransferComplete(progress);
}

export async function clearTransferProgress(): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(TRANSFER_KEY);
    return true;
  } catch {
    return false;
  }
}
