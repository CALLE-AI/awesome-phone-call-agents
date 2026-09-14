import type { FollowUpDraft } from "@/lib/follow-up";
import type { SyncQueueItem } from "@/lib/sync-queue";

export type ServerFollowUp = {
  dedupeKey: string;
  womanId: string;
  contactMethod: FollowUpDraft["contactMethod"];
  outcome: FollowUpDraft["outcome"];
  note: string;
  nextAction: FollowUpDraft["nextAction"];
  status: "completed";
  clientUpdatedAt: string | Date;
};

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

export function mergeQueueWithServer(localItems: SyncQueueItem[], serverItems: ServerFollowUp[], now = new Date().toISOString()) {
  const serverByKey = new Map(serverItems.map((item) => [item.dedupeKey, item]));
  const merged = localItems.map((local) => {
    const server = serverByKey.get(local.id);
    if (!server) return local;
    const serverUpdatedAt = iso(server.clientUpdatedAt);
    if (local.status !== "synced" && Date.parse(serverUpdatedAt) < Date.parse(local.updatedAt)) return local;
    return { ...local, status: "synced" as const, updatedAt: serverUpdatedAt };
  });

  const localKeys = new Set(localItems.map((item) => item.id));
  for (const server of serverItems) {
    if (localKeys.has(server.dedupeKey)) continue;
    const timestamp = iso(server.clientUpdatedAt);
    merged.push({
      id: server.dedupeKey,
      kind: "follow_up",
      payload: {
        womanId: server.womanId,
        contactMethod: server.contactMethod,
        outcome: server.outcome,
        note: server.note,
        nextAction: server.nextAction,
        status: "completed",
      },
      status: "synced",
      attempts: 0,
      createdAt: timestamp || now,
      updatedAt: timestamp || now,
    });
  }

  return merged;
}
