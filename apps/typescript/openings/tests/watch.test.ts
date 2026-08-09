import { describe, expect, it } from "vitest";
import { FakeCaller } from "../src/core/calle";
import { makeWatchService, statsFromResults } from "../src/core/watch";
import type { Candidate, SearchSpec, Watch } from "../src/core/types";

const SPEC: SearchSpec = {
  plan: "Aetna PPO",
  modality: "either",
  location: "Philadelphia, PA",
  need: "adult ADHD evaluation",
  radiusMiles: 10,
};

const candidates: Candidate[] = Array.from({ length: 6 }, (_, i) => ({
  id: String(i),
  name: `Practice ${i}`,
  phoneE164: `+121555501${i}`,
  phoneDisplay: `(215) 555-01${i}`,
  provenance: { kind: "paste", source: "test" },
}));

function watch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    spec: SPEC,
    candidates,
    targetOpen: 2,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    idempotencyPrefix: "watch-w1",
    ...overrides,
  };
}

describe("makeWatchService", () => {
  it("reports a next run when the target is not reached", async () => {
    const caller = new FakeCaller([]); // all voicemail → unreachable
    const service = makeWatchService({ caller, now: () => new Date("2026-01-01T00:00:00Z") });
    const report = await service.run(watch(), 1);
    expect(report.dispatch.reason).toBe("exhausted");
    expect(report.nextRunAt).toBe("2026-01-01T01:00:00.000Z"); // +1h
  });

  it("reports no next run when the target is reached", async () => {
    const caller = new FakeCaller(
      candidates.slice(0, 2).map((c) => ({
        candidateId: c.id,
        result: {
          line_outcome: "reached_staff",
          accepts_plan: "yes",
          accepting_new_patients: "yes",
          soonest_appointment_stated: "this week",
          wait_estimate_days: 3,
          modality: "both",
          evidence_quote: "available",
        },
      })),
    );
    const service = makeWatchService({ caller });
    const report = await service.run(watch(), 1);
    expect(report.dispatch.reason).toBe("target_reached");
    expect(report.nextRunAt).toBeUndefined();
  });

  it("uses the decaying cadence for later runs", () => {
    const service = makeWatchService({ caller: new FakeCaller([]) });
    expect(service.cadenceHours(1)).toBe(1);
    expect(service.cadenceHours(2)).toBe(3);
    expect(service.cadenceHours(5)).toBe(24);
    expect(service.cadenceHours(6)).toBe(48);
    expect(service.cadenceHours(99)).toBe(168);
  });
});

describe("statsFromResults", () => {
  it("counts verdicts without double counting", () => {
    const stats = statsFromResults([
      { candidateId: "0", verdict: "open", evidence: "", raw: null, completedAt: "" },
      { candidateId: "1", verdict: "ghost", evidence: "", raw: null, completedAt: "" },
      { candidateId: "2", verdict: "blocked", evidence: "", raw: null, completedAt: "" },
      { candidateId: "3", verdict: "unreachable", evidence: "", raw: null, completedAt: "" },
    ]);
    expect(stats).toMatchObject({
      called: 3,
      reached: 1,
      open: 1,
      ghost: 1,
      blocked: 1,
      unreachable: 1,
    });
  });
});
