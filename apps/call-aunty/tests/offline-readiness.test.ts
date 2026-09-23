import { describe, expect, it } from "vitest";
import { formatOfflineAge, getOfflineReadinessSummary } from "../lib/offline-readiness";
import type { SyncQueueItem } from "../lib/sync-queue";

const baseItem = (overrides: Partial<SyncQueueItem> = {}): SyncQueueItem => ({
  id: "follow-up:w1",
  kind: "follow_up",
  payload: { womanId: "w1", contactMethod: "phone", outcome: "reached", note: "local", nextAction: "none", status: "completed" },
  status: "queued",
  attempts: 0,
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T10:00:00.000Z",
  ...overrides,
});

describe("offline readiness", () => {
  it("treats an empty queue without internet as ready for continued offline work", () => {
    expect(getOfflineReadinessSummary(false, [])).toMatchObject({ state: "ready", pending: 0, nextAction: "continue_offline", oldestPendingAt: null });
  });

  it("summarizes queued work without exposing its payload", () => {
    expect(getOfflineReadinessSummary(false, [baseItem(), baseItem({ id: "follow-up:w2", createdAt: "2026-08-18T09:00:00.000Z" })])).toMatchObject({ state: "queued", pending: 2, queued: 2, nextAction: "retry_when_connected", oldestPendingAt: "2026-08-18T09:00:00.000Z" });
  });

  it("prioritizes review guidance when retry attempts are exhausted", () => {
    expect(getOfflineReadinessSummary(true, [baseItem({ attempts: 5 })])).toMatchObject({ state: "retrying", exhausted: 1, nextAction: "review_failed" });
  });

  it("formats bounded offline age categories deterministically", () => {
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    expect(formatOfflineAge("2026-08-18T11:59:30.000Z", now)).toBe("less_than_minute");
    expect(formatOfflineAge("2026-08-18T11:30:00.000Z", now)).toBe("minutes");
    expect(formatOfflineAge("2026-08-18T08:00:00.000Z", now)).toBe("hours");
    expect(formatOfflineAge("bad", now)).toBeNull();
  });
});
