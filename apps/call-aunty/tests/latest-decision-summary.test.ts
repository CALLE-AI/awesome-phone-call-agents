import { describe, expect, it } from "vitest";
import { getAppCopy } from "../lib/app-copy";
import { formatReconciliationHistory } from "../lib/reconciliation-history-copy";

describe("latest reconciliation decision summary", () => {
  it("formats a latest accepted-server decision with date context", () => {
    const copy = getAppCopy("en");
    const text = formatReconciliationHistory({ timestamp: "2026-08-18T10:00:00.000Z", serverAvailable: true, syncedCount: 2, preservedCount: 0, decision: "accepted_server" }, "en", { label: "", server: "server checked", fallback: "local-only fallback", decisionKept: copy.reconciliationDecisionKept, decisionAccepted: copy.reconciliationDecisionAccepted });
    expect(text).toContain(copy.reconciliationDecisionAccepted);
    expect(text).toContain("2026");
  });

  it("provides localized empty fallback copy", () => {
    expect(getAppCopy("en").reconciliationLatestDecisionEmpty).toContain("No reconciliation");
    expect(getAppCopy("bn").reconciliationLatestDecisionEmpty.length).toBeGreaterThan(0);
  });
});
