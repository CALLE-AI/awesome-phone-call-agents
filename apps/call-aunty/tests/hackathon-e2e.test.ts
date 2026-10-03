/**
 * Hackathon hero journey — deterministic end-to-end evidence (V5 final directive).
 */
import { describe, expect, it, beforeEach } from "vitest";

import { resetCallEventStore } from "../server/calle/call-events";
import { resetCorrelationStore } from "../server/calle/correlation";
import { createCalleService } from "../server/calle/service";

const demoConfig = {
  apiKey: "",
  liveCallsEnabled: false,
  killSwitch: false,
  configured: false,
  demoMode: true,
  mode: "demo" as const,
};

describe("Hackathon hero journey (synthetic)", () => {
  beforeEach(() => {
    resetCallEventStore();
    resetCorrelationStore();
  });

  it("runs prepare → confirm → outcome → events for demo beneficiary", async () => {
    const service = createCalleService({
      config: demoConfig,
      store: new Map(),
      idempotency: new Map(),
    });

    const hero = await service.runHeroDemo(99);
    expect(hero.ok).toBe(true);
    if (!hero.ok) return;

    expect(hero.confirmed.ok).toBe(true);
    if (!hero.confirmed.ok) return;

    expect(hero.confirmed.outcome?.confidenceGate).toBeTruthy();
    expect(hero.confirmed.followUp?.contactMethod).toBe("phone");

    const workflowId = hero.prepared.workflow.id;
    const detail = await service.getCallDetail(workflowId, 99);
    expect(detail?.correlation?.correlationId).toBeTruthy();
    expect(detail?.events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toMatch(/"apiKey"\s*:\s*"[^"]{8,}"/);
    expect(serialized).not.toMatch(/sk_[a-zA-Z0-9]{16,}/);
    expect(detail?.events.every((e) => !e.summary.includes("+1555555"))).toBe(true);
  });

  it("validateConfig passes in default safe demo env", () => {
    const service = createCalleService({ config: demoConfig });
    expect(service.validateConfig().ok).toBe(true);
  });
});
