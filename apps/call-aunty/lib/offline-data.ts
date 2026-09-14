import { clearOfflineCheckInProgress } from "@/lib/offline-checkin";
import { clearTransferProgress } from "@/lib/sync-transfer";
import { saveSyncQueue } from "@/lib/sync-queue";
import { saveOfflineCareSnapshot } from "@/lib/offline-care-snapshot";

export async function clearOfflineData(): Promise<boolean> {
  try {
    const checkInCleared = await clearOfflineCheckInProgress();
    const transferCleared = await clearTransferProgress();
    await saveSyncQueue([]);
    return checkInCleared && transferCleared;
  } catch {
    return false;
  }
}

export async function refreshOfflineCareMetadata(language: Parameters<typeof saveOfflineCareSnapshot>[0]): Promise<boolean> {
  return (await saveOfflineCareSnapshot(language)) !== null;
}
