import type { SyncQueueItem } from "@/lib/sync-queue";
import type { SyncObservabilitySummary } from "@/lib/sync-observability";

export type OfflineReadinessState = "ready" | "queued" | "retrying" | "online" | "unknown";

export type OfflineReadinessSummary = {
  state: OfflineReadinessState;
  pending: number;
  queued: number;
  retrying: number;
  exhausted: number;
  oldestPendingAt: string | null;
  nextAction: "continue_offline" | "retry_when_connected" | "review_failed" | "none";
};

export function getOfflineReadinessSummary(
  isInternetReachable: boolean | null | undefined,
  items: SyncQueueItem[],
  counts?: SyncObservabilitySummary,
): OfflineReadinessSummary {
  const summary = counts ?? {
    queued: items.filter((item) => item.status === "queued" && item.attempts < 5).length,
    retrying: items.filter((item) => item.status === "retrying" && item.attempts < 5).length,
    synced: items.filter((item) => item.status === "synced").length,
    exhausted: items.filter((item) => item.status !== "synced" && item.attempts >= 5).length,
    latestAttemptAt: null,
  };
  const pendingItems = items.filter((item) => item.status !== "synced");
  const oldestPendingAt = pendingItems.map((item) => item.createdAt).filter((value) => !Number.isNaN(Date.parse(value))).sort()[0] ?? null;
  const pending = summary.queued + summary.retrying + summary.exhausted;
  const state: OfflineReadinessState = summary.exhausted > 0 ? "retrying" : pending > 0 ? (isInternetReachable === true ? "online" : "queued") : isInternetReachable === false ? "ready" : isInternetReachable === true ? "online" : "unknown";
  const nextAction = summary.exhausted > 0 ? "review_failed" : pending > 0 && isInternetReachable !== true ? "retry_when_connected" : pending > 0 ? "retry_when_connected" : "continue_offline";
  return { state, pending, queued: summary.queued, retrying: summary.retrying, exhausted: summary.exhausted, oldestPendingAt, nextAction };
}

export function formatOfflineAge(timestamp: string | null, now = Date.now()): string | null {
  if (!timestamp) return null;
  const createdAt = Date.parse(timestamp);
  if (Number.isNaN(createdAt)) return null;
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60000));
  if (minutes < 1) return "less_than_minute";
  if (minutes < 60) return "minutes";
  return "hours";
}
