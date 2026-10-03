import type { SyncQueueItem } from "@/lib/sync-queue";

export type SyncObservabilitySummary = {
  queued: number;
  retrying: number;
  synced: number;
  exhausted: number;
  latestAttemptAt: string | null;
};

export function summarizeSyncQueue(items: SyncQueueItem[], maxAttempts = 5): SyncObservabilitySummary {
  const summary: SyncObservabilitySummary = {
    queued: 0,
    retrying: 0,
    synced: 0,
    exhausted: 0,
    latestAttemptAt: null,
  };
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const ms = Date.parse(item.updatedAt);
    if (!Number.isNaN(ms) && ms >= latestMs) {
      latestMs = ms;
      summary.latestAttemptAt = item.updatedAt;
    }

    if (item.status === "synced") {
      summary.synced += 1;
      continue;
    }
    if (item.attempts >= maxAttempts) {
      summary.exhausted += 1;
      continue;
    }
    if (item.status === "queued") summary.queued += 1;
    else if (item.status === "retrying") summary.retrying += 1;
  }

  return summary;
}
