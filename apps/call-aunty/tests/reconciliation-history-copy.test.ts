import { describe, expect, it } from "vitest";
import { formatReconciliationHistory } from "../lib/reconciliation-history-copy";

const copy = { label: "Last reconciliation", server: "server checked", fallback: "local-only fallback", decisionKept: "kept local", decisionAccepted: "accepted server copy" };

describe("reconciliation history decision labels", () => {
  it("includes a kept-local decision without exposing payload data", () => {
    const text = formatReconciliationHistory({ timestamp: "2026-08-18T10:00:00.000Z", serverAvailable: true, syncedCount: 0, preservedCount: 2, decision: "kept_local" }, "en", copy);
    expect(text).toContain("kept local");
    expect(text).toContain("2026");
    expect(text).not.toContain("woman");
  });

  it("includes an accepted-server decision", () => {
    const text = formatReconciliationHistory({ timestamp: "2026-08-18T10:00:00.000Z", serverAvailable: true, syncedCount: 2, preservedCount: 0, decision: "accepted_server" }, "en", copy);
    expect(text).toContain("accepted server copy");
    expect(text).toContain("2026");
  });
});
