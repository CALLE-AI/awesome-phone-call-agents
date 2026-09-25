import { describe, expect, it } from "vitest";
import { formatReconciliationFeedback } from "../lib/reconciliation-feedback";

const copy = { synced: "synced", preserved: "preserved", fallback: "fallback" };

describe("reconciliation feedback", () => {
  it("reports mixed server confirmation and preserved local work", () => {
    expect(formatReconciliationFeedback({ syncedCount: 2, preservedCount: 1, serverAvailable: true, copy })).toBe("2 synced · 1 preserved");
  });

  it("reports a safe local fallback when the server is unavailable", () => {
    expect(formatReconciliationFeedback({ syncedCount: 0, preservedCount: 2, serverAvailable: false, copy })).toBe("fallback");
  });

  it("reports a successful no-change refresh", () => {
    expect(formatReconciliationFeedback({ syncedCount: 0, preservedCount: 0, serverAvailable: true, copy })).toBe("synced");
  });
});
