import { describe, expect, it } from "vitest";

import {
  buildOperatorDashboard,
  getOperatorDashboardFixture,
  OPERATOR_DASHBOARD_FIXTURES,
  OPERATOR_DASHBOARD_SNAPSHOT,
  operatorDashboardReplayIds,
  summarizeOperatorCalls,
} from "../lib/operator-dashboard";
import { DEMO_COMMAND_CENTER } from "../lib/demo-fallback";
import { getReplayFixture } from "../lib/mock-calls";

describe("operator dashboard fixtures", () => {
  it("covers every command-center bucket with synthetic identities only", () => {
    const buckets = new Set(OPERATOR_DASHBOARD_FIXTURES.map((fixture) => fixture.call.bucket));
    expect([...buckets].sort()).toEqual(
      ["active", "blocked", "completed", "failed", "needs_review", "pending"].sort(),
    );
    for (const fixture of OPERATOR_DASHBOARD_FIXTURES) {
      expect(fixture.synthetic).toBe(true);
      expect(fixture.call.womanId.startsWith("demo-")).toBe(true);
      expect(fixture.call.recipientMasked).toContain("•");
      expect(fixture.call.recipientMasked).not.toMatch(/\d{7,}/);
      expect(fixture.call.dryRun).toBe(true);
    }
  });

  it("keeps snapshot summary counts equal to the row buckets", () => {
    const snapshot = buildOperatorDashboard();
    expect(snapshot.summary).toEqual(summarizeOperatorCalls(snapshot.calls));
    expect(snapshot.calls).toHaveLength(OPERATOR_DASHBOARD_FIXTURES.length);
    expect(snapshot.providerHealth.map((row) => row.id)).toEqual([
      "call-e",
      "backup-phone-api",
      "tertiary-phone-api",
    ]);
    expect(snapshot.incidents.some((incident) => incident.kind === "failover")).toBe(true);
    expect(snapshot.incidents.some((incident) => incident.kind === "consent_block")).toBe(true);
  });

  it("points replay-linked rows at real end-to-end fixtures", () => {
    for (const replayId of operatorDashboardReplayIds()) {
      expect(() => getReplayFixture(replayId)).not.toThrow();
    }
    expect(getOperatorDashboardFixture("dash-blocked-consent").replayId).toBe("replay-e2e-refusal");
    expect(getOperatorDashboardFixture("dash-active-in-progress").call.phoneProviderId).toBe(
      "backup-phone-api",
    );
  });

  it("feeds the demo command center from the same snapshot", () => {
    expect(DEMO_COMMAND_CENTER.summary).toEqual(OPERATOR_DASHBOARD_SNAPSHOT.summary);
    expect(DEMO_COMMAND_CENTER.calls.map((call) => call.id)).toEqual(
      OPERATOR_DASHBOARD_SNAPSHOT.calls.map((call) => call.id),
    );
    expect(DEMO_COMMAND_CENTER.providerHealth).toHaveLength(3);
  });

  it("looks up fixtures by id", () => {
    expect(() => getOperatorDashboardFixture("dash-missing")).toThrow(/Unknown operator dashboard fixture/);
  });
});
