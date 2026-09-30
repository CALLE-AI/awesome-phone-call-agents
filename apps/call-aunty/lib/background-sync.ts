import * as BackgroundTask from "expo-background-task";
import * as Network from "expo-network";
import * as TaskManager from "expo-task-manager";

import { createTRPCClient } from "@/lib/trpc";
import { getNextAutomaticItem } from "@/lib/sync-recovery";
import { loadSyncQueueStrict, markQueueSynced, saveLastSyncAt } from "@/lib/sync-queue";

export const BACKGROUND_SYNC_TASK = "call-aunty-background-sync";

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const networkState = await Network.getNetworkStateAsync();
    if (networkState.isInternetReachable === false) return BackgroundTask.BackgroundTaskResult.Failed;

    const nextItem = getNextAutomaticItem(await loadSyncQueueStrict());
    if (!nextItem) return BackgroundTask.BackgroundTaskResult.Success;

    const client = createTRPCClient();
    await client.sync.followUp.mutate({
      dedupeKey: nextItem.id,
      womanId: nextItem.payload.womanId,
      contactMethod: nextItem.payload.contactMethod,
      outcome: nextItem.payload.outcome,
      note: nextItem.payload.note,
      nextAction: nextItem.payload.nextAction,
      status: "completed",
      clientUpdatedAt: nextItem.updatedAt,
    });

    await markQueueSynced(nextItem.id);
    await saveLastSyncAt(new Date().toISOString());
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<boolean> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!registered) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 * 60 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function unregisterBackgroundSync(): Promise<boolean> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (registered) await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    return true;
  } catch {
    return false;
  }
}
