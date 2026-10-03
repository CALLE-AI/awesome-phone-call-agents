import { describe, expect, it } from "vitest";
import { mergeQueueWithServer } from "../lib/sync-reconciliation";
import type { SyncQueueItem } from "../lib/sync-queue";

const localItem = (updatedAt: string, status: SyncQueueItem["status"] = "queued"): SyncQueueItem => ({
  id: "follow-1",
  kind: "follow_up",
  payload: { womanId: "woman-1", contactMethod: "phone", outcome: "reached", note: "local", nextAction: "none", status: "completed" },
  status,
  attempts: 1,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt,
});

const serverItem = (clientUpdatedAt: string) => ({
  dedupeKey: "follow-1",
  womanId: "woman-1",
  contactMethod: "phone" as const,
  outcome: "reached" as const,
  note: "server",
  nextAction: "none" as const,
  status: "completed" as const,
  clientUpdatedAt,
});

describe("sync reconciliation", () => {
  it("marks a locally queued item synced when the server has an equal or newer copy", () => {
    const [merged] = mergeQueueWithServer([localItem("2026-08-18T00:00:01.000Z")], [serverItem("2026-08-18T00:00:02.000Z")]);
    expect(merged.status).toBe("synced");
    expect(merged.updatedAt).toBe("2026-08-18T00:00:02.000Z");
  });

  it("preserves a newer local unsynced edit", () => {
    const [merged] = mergeQueueWithServer([localItem("2026-08-18T00:00:03.000Z")], [serverItem("2026-08-18T00:00:02.000Z")]);
    expect(merged.status).toBe("queued");
    expect(merged.payload.note).toBe("local");
  });

  it("adds server-only records as synced queue items", () => {
    const [merged] = mergeQueueWithServer([], [serverItem("2026-08-18T00:00:02.000Z")]);
    expect(merged).toMatchObject({ id: "follow-1", status: "synced", payload: { note: "server" } });
  });
});
