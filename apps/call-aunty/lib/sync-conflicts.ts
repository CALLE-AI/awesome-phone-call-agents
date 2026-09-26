import type { SyncQueueItem } from "./sync-queue";
import { mergeQueueWithServer, type ServerFollowUp } from "./sync-reconciliation";

export type SyncConflictDecision = "keep_local" | "accept_server";

export type SyncConflictSummary = {
  acknowledged: number;
  localNewer: number;
  serverNewer: number;
  serverOnly: number;
};

function timestamp(value: string | Date) {
  const parsed = Date.parse(value instanceof Date ? value.toISOString() : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveSyncConflict(localItems: SyncQueueItem[], serverItems: ServerFollowUp[], decision: SyncConflictDecision, now = new Date().toISOString()) {
  if (decision === "keep_local") return localItems;
  const merged = mergeQueueWithServer(localItems, serverItems, now);
  const serverByKey = new Map(serverItems.map((item) => [item.dedupeKey, item]));
  return merged.map((item) => {
    const server = serverByKey.get(item.id);
    if (!server) return item;
    const updatedAt = server.clientUpdatedAt instanceof Date ? server.clientUpdatedAt.toISOString() : server.clientUpdatedAt;
    return {
      ...item,
      payload: { ...item.payload, womanId: server.womanId, contactMethod: server.contactMethod, outcome: server.outcome, note: server.note, nextAction: server.nextAction, status: "completed" as const },
      status: "synced" as const,
      updatedAt,
    };
  });
}

export function classifySyncConflicts(localItems: SyncQueueItem[], serverItems: ServerFollowUp[]): SyncConflictSummary {
  const localByKey = new Map(localItems.map((item) => [item.id, item]));
  const summary: SyncConflictSummary = { acknowledged: 0, localNewer: 0, serverNewer: 0, serverOnly: 0 };
  for (const server of serverItems) {
    const local = localByKey.get(server.dedupeKey);
    if (!local) {
      summary.serverOnly += 1;
      continue;
    }
    const localTime = timestamp(local.updatedAt);
    const serverTime = timestamp(server.clientUpdatedAt);
    if (local.status === "synced" || serverTime >= localTime) summary.acknowledged += 1;
    else summary.localNewer += 1;
    if (serverTime > localTime && local.status !== "synced") summary.serverNewer += 1;
  }
  return summary;
}
