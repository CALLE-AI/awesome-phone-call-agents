import { describe, expect, it, vi } from "vitest";
import { FakeCaller } from "../src/core/calle";
import { dispatchWave } from "../src/core/dispatch";
import type { Candidate, CallStructuredResult, SearchSpec } from "../src/core/types";

const SPEC: SearchSpec = {
  plan: "Aetna PPO",
  modality: "either",
  location: "Philadelphia, PA",
  need: "adult ADHD evaluation",
  radiusMiles: 10,
};

function cand(id: string): Candidate {
  return {
    id,
    name: `Practice ${id}`,
    phoneE164: `+121555501${id}`,
    phoneDisplay: `(215) 555-01${id}`,
    provenance: { kind: "paste", source: "test" },
  };
}

function staffed(overrides: Partial<CallStructuredResult> = {}): CallStructuredResult {
  return {
    line_outcome: "reached_staff",
    accepts_plan: "yes",
    accepting_new_patients: "yes",
    soonest_appointment_stated: "next week",
    wait_estimate_days: 6,
    modality: "both",
    evidence_quote: "We can see them next week.",
    ...overrides,
  };
}

const candidates = Array.from({ length: 12 }, (_, i) => cand(String(i)));

describe("dispatchWave", () => {
  it("stops as soon as the target number of openings is confirmed", async () => {
    const openIds = new Set(["2", "3"]);
    const caller = new FakeCaller(
      candidates.map((c) => ({
        candidateId: c.id,
        result: openIds.has(c.id)
          ? staffed()
          : { ...staffed(), accepting_new_patients: "no", evidence_quote: "not accepting" },
      })),
    );

    const result = await dispatchWave({
      caller,
      candidates,
      spec: SPEC,
      idempotencyPrefix: "watch",
      targetOpen: 2,
      runKey: "r1",
      waveSize: 5,
    });

    expect(result.reason).toBe("target_reached");
    expect(result.openFound).toBe(2);
    // Waves of 5: after wave 1 (0 open) + wave 2 (2 open) → 10 results max.
    expect(result.results.length).toBeLessThanOrEqual(10);
    expect(result.results.length).toBeGreaterThan(2);
  });

  it("exhausts all candidates when the target is never reached", async () => {
    const caller = new FakeCaller(
      candidates.map((c) => ({
        candidateId: c.id,
        result: { ...staffed(), accepts_plan: "no", accepting_new_patients: "no" },
      })),
    );
    const result = await dispatchWave({
      caller,
      candidates,
      spec: SPEC,
      idempotencyPrefix: "watch",
      targetOpen: 5,
      runKey: "r1",
    });
    expect(result.reason).toBe("exhausted");
    expect(result.results).toHaveLength(candidates.length);
    expect(result.openFound).toBe(0);
  });

  it("classifies ghost numbers via the classifier, never as open", async () => {
    const caller = new FakeCaller([
      { candidateId: "0", result: { ...staffed(), line_outcome: "disconnected" } },
      { candidateId: "1", result: { ...staffed(), line_outcome: "wrong_entity" } },
      { candidateId: "2", result: staffed() },
    ]);
    const result = await dispatchWave({
      caller,
      candidates: candidates.slice(0, 3),
      spec: SPEC,
      idempotencyPrefix: "watch",
      targetOpen: 1,
      runKey: "r1",
    });
    expect(result.results.map((r) => [r.candidateId, r.verdict])).toEqual([
      ["0", "ghost"],
      ["1", "ghost"],
      ["2", "open"],
    ]);
  });

  it("respects opt-outs and never dials a blocked candidate", async () => {
    const caller = new FakeCaller([]);
    const result = await dispatchWave({
      caller,
      candidates: candidates.slice(0, 2),
      spec: SPEC,
      idempotencyPrefix: "watch",
      targetOpen: 1,
      runKey: "r1",
      isOptedOut: (phone) => phone === "+1215555010",
    });
    expect(result.results.find((r) => r.candidateId === "0")?.verdict).toBe("blocked");
    expect(result.results.find((r) => r.candidateId === "1")?.verdict).toBe("unreachable");
  });

  it("propagates call errors as blocked results and stops the run", async () => {
    const failing: typeof FakeCaller = class extends FakeCaller {
      override async placeCall(): Promise<never> {
        throw new Error("boom");
      }
    } as unknown as typeof FakeCaller;

    const result = await dispatchWave({
      caller: new failing(),
      candidates: candidates.slice(0, 3),
      spec: SPEC,
      idempotencyPrefix: "watch",
      targetOpen: 1,
      runKey: "r1",
    });
    expect(result.reason).toBe("error");
    expect(result.error).toBe("boom");
  });
});
