import { describe, expect, it } from "vitest";
import { appendReconciliationHistory, parseReconciliationHistory, type ReconciliationHistoryEntry } from "../lib/reconciliation-history";
import { formatReconciliationHistory } from "../lib/reconciliation-history-copy";

const entry = (index: number): ReconciliationHistoryEntry => ({ timestamp: `2026-08-18T00:00:0${index}.000Z`, serverAvailable: true, syncedCount: index, preservedCount: 0 });

describe("reconciliation history", () => {
  it("keeps the newest five metadata-only entries", () => {
    const history = Array.from({ length: 5 }, (_, index) => entry(index));
    const next = appendReconciliationHistory(history, entry(5));
    expect(next).toHaveLength(5);
    expect(next[0].syncedCount).toBe(5);
    expect(next[4].syncedCount).toBe(3);
  });

  it("rejects malformed persisted entries", () => {
    expect(parseReconciliationHistory(JSON.stringify([{ timestamp: "bad" }, { timestamp: "2026-08-18T00:00:00.000Z", serverAvailable: false, syncedCount: 0, preservedCount: 1 }]))).toHaveLength(1);
    expect(parseReconciliationHistory("{not-json")).toEqual([]);
    expect(parseReconciliationHistory(null)).toEqual([]);
  });

  it("formats the latest entry with localized status wording", () => {
    expect(formatReconciliationHistory(entry(1), "en", { label: "Last", server: "server checked", fallback: "local only" })).toContain("server checked");
  });
});
