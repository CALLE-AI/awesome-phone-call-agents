import { describe, expect, it } from "vitest";
import { getNextAutomaticItem, getRetryDelayMs, MAX_AUTOMATIC_RETRIES, shouldAutoRetry } from "../lib/sync-recovery";
import type { SyncQueueItem } from "../lib/sync-queue";

const item = (status: SyncQueueItem["status"], attempts: number, updatedAt: string): SyncQueueItem => ({
  id: "follow-up:Aisha",
  kind: "follow_up",
  payload: { womanId: "Aisha", contactMethod: "phone", outcome: "reached", note: "Reached", nextAction: "clinic_visit", status: "completed" },
  status,
  attempts,
  createdAt: updatedAt,
  updatedAt,
});

describe("automatic sync recovery", () => {
  it("uses bounded exponential retry delays", () => {
    expect(getRetryDelayMs(0)).toBe(2_000);
    expect(getRetryDelayMs(2)).toBe(30_000);
    expect(getRetryDelayMs(MAX_AUTOMATIC_RETRIES + 2)).toBe(5 * 60_000);
  });

  it("does not retry synced or exhausted items", () => {
    const now = Date.parse("2026-08-18T00:10:00.000Z");
    expect(shouldAutoRetry(item("synced", 0, "2026-08-18T00:00:00.000Z"), now)).toBe(false);
    expect(shouldAutoRetry(item("retrying", MAX_AUTOMATIC_RETRIES, "2026-08-18T00:00:00.000Z"), now)).toBe(false);
  });

  it("selects the first pending item whose backoff has elapsed", () => {
    const now = Date.parse("2026-08-18T00:00:20.000Z");
    const waiting = item("retrying", 2, "2026-08-18T00:00:00.000Z");
    const ready = item("queued", 0, "2026-08-18T00:00:00.000Z");
    expect(getNextAutomaticItem([waiting, ready], now)?.status).toBe("queued");
  });
});
