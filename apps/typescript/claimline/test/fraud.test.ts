import { afterEach, describe, expect, it } from "vitest";
import type { CaseView } from "../src/app.js";
import type { ClaimLineApp } from "../src/app.js";
import { assessFraud } from "../src/services/fraud.js";
import { makeApp } from "./helpers.js";

let app: ClaimLineApp;

afterEach(() => {
  try {
    app?.close();
  } catch {
    // already closed
  }
  app = undefined as unknown as ClaimLineApp;
});

type Row = {
  callType: string;
  state: string;
  disposition: string;
  structuredResult: Record<string, unknown> | null;
};

/** Build a minimal CaseView carrying only the fields assessFraud reads. */
function caseWith(rows: Row[]): CaseView {
  return {
    claim: { id: "c1", reference: "CLM-1", incidentType: "auto_collision" },
    contacts: rows.map((r, i) => ({
      contact: { id: `k${i}`, role: "other", name: `P${i}` },
      defaultCallType: r.callType,
      intent: { callType: r.callType, state: r.state },
      result: r.structuredResult
        ? { disposition: r.disposition, structuredResult: r.structuredResult }
        : { disposition: r.disposition, structuredResult: null },
    })),
    otherCalls: [],
    totals: { billedTotal: null, currency: null, incomplete: false },
    claimDecision: null,
  } as unknown as CaseView;
}

const ok = (callType: string, structuredResult: Record<string, unknown>): Row => ({
  callType,
  state: "terminal_verified",
  disposition: "auto_ok",
  structuredResult,
});

describe("fraud / consistency assessment", () => {
  it("returns LOW risk with no flags for a consistent case", () => {
    const view = caseWith([
      ok("fnol_intake", { injuries: "yes", incident_datetime: "2026-08-30" }),
      ok("medical_report", { accident_consistent: "yes", injuries_summary: "fractured wrist" }),
      ok("bill_verification", { total_amount: 2000, service_from_date: "2026-08-31" }),
    ]);
    const r = assessFraud(view, { coverageLimit: 25000 });
    expect(r.level).toBe("low");
    expect(r.flags).toHaveLength(0);
  });

  it("flags HIGH risk when the doctor says injuries are not consistent", () => {
    const view = caseWith([
      ok("fnol_intake", { injuries: "yes" }),
      ok("medical_report", { accident_consistent: "no", injuries_summary: "old injury" }),
    ]);
    const r = assessFraud(view);
    expect(r.level).toBe("high");
    expect(r.flags.some((f) => /not consistent/i.test(f.message))).toBe(true);
  });

  it("flags a billed service date before the incident date", () => {
    const view = caseWith([
      ok("fnol_intake", { injuries: "no", incident_datetime: "2026-08-30" }),
      ok("bill_verification", { total_amount: 500, service_from_date: "2026-08-20" }),
    ]);
    const r = assessFraud(view);
    expect(r.flags.some((f) => /before the incident/i.test(f.message))).toBe(true);
    expect(r.level).toBe("high");
  });

  it("flags a billed total that exceeds the coverage limit", () => {
    const view = caseWith([
      ok("bill_verification", { total_amount: 90000, service_from_date: "2026-09-01" }),
    ]);
    const r = assessFraud(view, { coverageLimit: 25000 });
    expect(r.flags.some((f) => /exceeds the policy coverage/i.test(f.message))).toBe(true);
    expect(r.level).toBe("medium");
  });

  it("flags a no-injury claim that nonetheless has a medical report", () => {
    const view = caseWith([
      ok("fnol_intake", { injuries: "no" }),
      ok("medical_report", { accident_consistent: "unknown", injuries_summary: "broken arm" }),
    ]);
    const r = assessFraud(view);
    expect(r.flags.some((f) => /reported no injuries/i.test(f.message))).toBe(true);
  });
});

describe("analytics", () => {
  it("aggregates impact numbers across claims", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = app.store.listClaims().find((c) => c.incidentType === "injury")!.id;
    await app.runAutopilot(claimId, { placedBy: "fixture" });
    app.sanctionClaim(claimId, {
      decidedBy: "Priya",
      decision: "approved",
      sanctionedAmount: 2450,
      currency: "USD",
    });
    await app.payoutClaim(claimId);

    const a = app.analytics();
    expect(a.claims).toBeGreaterThanOrEqual(3);
    expect(a.approved).toBeGreaterThanOrEqual(1);
    expect(a.callsCompleted).toBeGreaterThanOrEqual(1);
    expect(a.hoursSaved).toBeGreaterThan(0);
    expect(a.paidOut.find((p) => p.currency === "USD")?.amount).toBe(2450);
    expect(a.incidentBreakdown.length).toBeGreaterThan(0);
  });
});
