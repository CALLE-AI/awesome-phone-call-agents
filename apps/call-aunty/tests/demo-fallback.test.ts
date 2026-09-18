import { describe, expect, it } from "vitest";
import {
  DEMO_BILLING_CATALOG,
  DEMO_CALLE_CAPABILITIES,
  DEMO_CALL_DETAIL,
  DEMO_COMMAND_CENTER,
  DEMO_ENTITLEMENTS,
  DEMO_HERO_RESULT,
  DEMO_USAGE,
  demoCallLanguageResolution,
} from "../lib/demo-fallback";

describe("demo fallback payloads", () => {
  it("exposes a purchasable catalog with free + paid plans", () => {
    expect(DEMO_BILLING_CATALOG.flags.indicator).toBe("DEMO");
    expect(DEMO_BILLING_CATALOG.plans.length).toBeGreaterThanOrEqual(2);
    expect(DEMO_BILLING_CATALOG.plans.some((p) => p.billable)).toBe(true);
    expect(DEMO_BILLING_CATALOG.plans.some((p) => !p.billable)).toBe(true);
    expect(DEMO_ENTITLEMENTS.planId).toBeTruthy();
    expect(DEMO_USAGE.callCreditsBalance).toBeGreaterThanOrEqual(0);
  });

  it("exposes command-center demo calls with synthetic numbers only", () => {
    expect(DEMO_COMMAND_CENTER.calls.length).toBeGreaterThan(0);
    expect(DEMO_COMMAND_CENTER.summary.pending + DEMO_COMMAND_CENTER.summary.active).toBeGreaterThan(0);
    expect(DEMO_COMMAND_CENTER.incidents?.some((incident) => incident.kind === "failover")).toBe(true);
    for (const call of DEMO_COMMAND_CENTER.calls) {
      expect(call.recipientMasked).toContain("•");
      expect(call.dryRun).toBe(true);
      expect(call.womanId.startsWith("demo-")).toBe(true);
    }
    expect(DEMO_CALLE_CAPABILITIES.publicConfig.indicator).toBe("DEMO");
  });

  it("keeps call-detail and hero payloads coherent", () => {
    expect(DEMO_CALL_DETAIL.workflow.id).toBeTruthy();
    expect(DEMO_CALL_DETAIL.callBrief.recommendations.length).toBeGreaterThan(0);
    expect(DEMO_HERO_RESULT.ok).toBe(true);
    expect(DEMO_HERO_RESULT.prepared.workflow.id).toMatch(/^demo-/);
  });

  it("resolves unsupported spoken languages honestly", () => {
    const bangla = demoCallLanguageResolution("bn");
    expect(bangla.supported).toBe(false);
    expect(bangla.effective).toBe("en");
    expect(bangla.preservePreference).toBe(true);

    const english = demoCallLanguageResolution("en");
    expect(english.supported).toBe(true);
    expect(english.effective).toBe("en");
  });
});
