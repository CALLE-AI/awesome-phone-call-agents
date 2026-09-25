import { describe, expect, it } from "vitest";
import { classifySyncConflicts, resolveSyncConflict } from "../lib/sync-conflicts";
import type { SyncQueueItem } from "../lib/sync-queue";
import type { ServerFollowUp } from "../lib/sync-reconciliation";

const local = (updatedAt: string, status: SyncQueueItem["status"] = "queued"): SyncQueueItem => ({ id: "follow-1", kind: "follow_up", payload: { womanId: "woman-1", contactMethod: "phone", outcome: "reached", note: "local", nextAction: "none", status: "completed" }, status, attempts: 0, createdAt: updatedAt, updatedAt });
const server = (clientUpdatedAt: string, dedupeKey = "follow-1"): ServerFollowUp => ({ dedupeKey, womanId: "woman-1", contactMethod: "phone", outcome: "reached", note: "server", nextAction: "none", status: "completed", clientUpdatedAt });

describe("sync conflict classification", () => {
  it("classifies a newer local edit without exposing its payload", () => {
    expect(classifySyncConflicts([local("2026-08-18T00:00:03.000Z")], [server("2026-08-18T00:00:02.000Z")])).toMatchObject({ localNewer: 1, acknowledged: 0 });
  });

  it("classifies newer or equal server timestamps as acknowledged", () => {
    expect(classifySyncConflicts([local("2026-08-18T00:00:01.000Z")], [server("2026-08-18T00:00:02.000Z")])).toMatchObject({ acknowledged: 1, serverNewer: 1 });
  });

  it("counts server-only records separately", () => {
    expect(classifySyncConflicts([], [server("2026-08-18T00:00:02.000Z")])).toMatchObject({ serverOnly: 1 });
  });
});

describe("sync conflict decisions", () => {
  it("keeps local records unchanged when requested", () => {
    const items = [local("2026-08-18T00:00:03.000Z")];
    expect(resolveSyncConflict(items, [server("2026-08-18T00:00:02.000Z")], "keep_local")).toEqual(items);
  });

  it("accepts server records and marks the local item synced", () => {
    const resolved = resolveSyncConflict([local("2026-08-18T00:00:03.000Z")], [server("2026-08-18T00:00:02.000Z")], "accept_server");
    expect(resolved[0]?.status).toBe("synced");
    expect(resolved[0]?.updatedAt).toBe("2026-08-18T00:00:02.000Z");
  });

  it("does not drop server-only records when accepting the server copy", () => {
    const resolved = resolveSyncConflict([], [server("2026-08-18T00:00:02.000Z", "server-only")], "accept_server");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe("server-only");
  });
});
