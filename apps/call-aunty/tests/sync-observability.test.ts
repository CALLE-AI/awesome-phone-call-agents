import { describe, expect, it } from "vitest";
import { summarizeSyncQueue } from "../lib/sync-observability";
import type { SyncQueueItem } from "../lib/sync-queue";

const makeItem = (id: string, status: SyncQueueItem["status"], attempts: number, updatedAt: string): SyncQueueItem => ({
  id,
  kind: "follow_up",
  payload: { womanId: id, contactMethod: "phone", outcome: "reached", note: "Reached", nextAction: "none", status: "completed" },
  status,
  attempts,
  createdAt: updatedAt,
  updatedAt,
});

describe("sync observability", () => {
  it("counts active, synced, and exhausted records without inspecting payload contents", () => {
    const summary = summarizeSyncQueue([
      makeItem("queued", "queued", 0, "2026-08-18T00:00:01.000Z"),
      makeItem("retrying", "retrying", 2, "2026-08-18T00:00:03.000Z"),
      makeItem("synced", "synced", 1, "2026-08-18T00:00:02.000Z"),
      makeItem("exhausted", "retrying", 5, "2026-08-18T00:00:04.000Z"),
    ]);

    expect(summary).toEqual({ queued: 1, retrying: 1, synced: 1, exhausted: 1, latestAttemptAt: "2026-08-18T00:00:04.000Z" });
  });

  it("returns a null latest timestamp for an empty queue", () => {
    expect(summarizeSyncQueue([]).latestAttemptAt).toBeNull();
  });
});
