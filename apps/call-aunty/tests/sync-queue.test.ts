import { describe, expect, it } from "vitest";
import { formatLastSync, getPendingSyncCount, getQueueStatusLabel, getQueueSummary, isValidSyncQueueItem, parseSyncQueueRaw, type SyncQueueItem } from "../lib/sync-queue";

const item = (status: SyncQueueItem["status"], attempts = 0): SyncQueueItem => ({ id: `id-${status}-${attempts}`, kind: "follow_up", status, attempts, createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", payload: { womanId: "Aisha", contactMethod: "phone", outcome: "reached", note: "Reached", nextAction: "clinic_visit", status: "completed" } });

describe("sync queue", () => {
  it("counts queued and retrying items but not synced items", () => {
    expect(getPendingSyncCount([item("queued"), item("retrying", 2), item("synced")])).toBe(2);
  });
  it("allows retry attempts to remain represented as pending work", () => {
    expect(getPendingSyncCount([item("retrying", 3)])).toBe(1);
  });

  it("provides stable labels for each queue state", () => {
    expect(getQueueStatusLabel("queued")).toBe("Queued for sync");
    expect(getQueueStatusLabel("retrying")).toBe("Retrying");
    expect(getQueueStatusLabel("synced")).toBe("Synced");
  });

  it("rejects malformed or incomplete persisted records safely", () => {
    expect(isValidSyncQueueItem(null)).toBe(false);
    expect(isValidSyncQueueItem({ id: "x", kind: "follow_up", status: "queued", payload: { status: "draft" } })).toBe(false);
    expect(isValidSyncQueueItem(item("retrying", 2))).toBe(true);
  });

  it("recovers from corrupt or non-array queue payloads without throwing", () => {
    expect(parseSyncQueueRaw(null)).toEqual([]);
    expect(parseSyncQueueRaw("{not-json")).toEqual([]);
    expect(parseSyncQueueRaw('"string"')).toEqual([]);
    expect(parseSyncQueueRaw(JSON.stringify([{ id: "bad" }, item("queued")]))).toEqual([item("queued")]);
  });

  it("summarizes queue states and handles missing sync metadata", () => {
    expect(getQueueSummary([item("queued"), item("retrying"), item("synced")])).toEqual({ queued: 1, retrying: 1, synced: 1 });
    expect(formatLastSync(null)).toBe("Not synced yet");
    expect(formatLastSync("not-a-date")).toBe("Sync time unavailable");
  });
});
