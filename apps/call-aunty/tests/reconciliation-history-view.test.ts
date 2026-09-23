import { describe, expect, it } from "vitest";
import { appendReconciliationHistory, type ReconciliationHistoryEntry } from "../lib/reconciliation-history";

const entry = (index: number): ReconciliationHistoryEntry => ({ timestamp: `2026-08-18T00:00:0${index}.000Z`, serverAvailable: index % 2 === 0, syncedCount: index, preservedCount: 0 });

describe("reconciliation history view data", () => {
  it("exposes entries in newest-first order with a five-entry display limit", () => {
    const history = Array.from({ length: 5 }, (_, index) => entry(index));
    const next = appendReconciliationHistory(history, entry(5));
    expect(next.map((item) => item.syncedCount)).toEqual([5, 0, 1, 2, 3]);
    expect(next).toHaveLength(5);
  });
});
