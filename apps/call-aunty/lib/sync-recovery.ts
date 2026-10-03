import type { SyncQueueItem } from "@/lib/sync-queue";

export const MAX_AUTOMATIC_RETRIES = 5;

const RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 60_000, 5 * 60_000] as const;

export function getRetryDelayMs(attempts: number) {
  const index = Math.max(0, Math.min(attempts, RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[index];
}

export function shouldAutoRetry(item: Pick<SyncQueueItem, "status" | "attempts" | "updatedAt">, now = Date.now()) {
  if (item.status === "synced" || item.attempts >= MAX_AUTOMATIC_RETRIES) return false;
  const updatedAt = Date.parse(item.updatedAt);
  if (Number.isNaN(updatedAt)) return true;
  return now - updatedAt >= getRetryDelayMs(item.attempts);
}

export function getNextAutomaticItem(items: SyncQueueItem[], now = Date.now()) {
  return items.find((item) => shouldAutoRetry(item, now)) ?? null;
}
