import { describe, expect, it } from "vitest";
import { FakeCaller } from "../src/core/calle";
import { dispatchRun } from "../src/core/dispatch";
import type { Candidate, CallStructuredResult, SearchSpec } from "../src/core/types";

const SPEC: SearchSpec = {
  plan: "Aetna PPO",
  modality: "either",
  location: "Philadelphia, PA",
  need: "adult ADHD evaluation",
  specialty: "psychiatry",
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

describe("dispatchRun", () => {
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

    const result = await dispatchRun({
      caller,
      candidates,
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 2,
      runKey: "r1",
    });

    expect(result.reason).toBe("target_reached");
    expect(result.openFound).toBe(2);
    // Sequential: 0 and 1 are not accepting, 2 and 3 are open → stop at 4.
    expect(result.results.map((r) => r.candidateId)).toEqual(["0", "1", "2", "3"]);
  });

  it("exhausts all candidates when the target is never reached", async () => {
    const caller = new FakeCaller(
      candidates.map((c) => ({
        candidateId: c.id,
        result: { ...staffed(), accepts_plan: "no", accepting_new_patients: "no" },
      })),
    );
    const result = await dispatchRun({
      caller,
      candidates,
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
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
    const result = await dispatchRun({
      caller,
      candidates: candidates.slice(0, 3),
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
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
    const result = await dispatchRun({
      caller,
      candidates: candidates.slice(0, 2),
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 1,
      runKey: "r1",
      isOptedOut: (phone) => phone === "+1215555010",
    });
    expect(result.results.find((r) => r.candidateId === "0")?.verdict).toBe("blocked");
    expect(result.results.find((r) => r.candidateId === "1")?.verdict).toBe("unreachable");
  });

  it("stops at the per-run call cap without dialing the remaining candidates", async () => {
    const caller = new FakeCaller([]); // all voicemail → unreachable, target never met
    const result = await dispatchRun({
      caller,
      candidates,
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 5,
      maxCalls: 3,
      runKey: "r1",
    });
    expect(result.reason).toBe("call_cap_reached");
    expect(result.results).toHaveLength(3);
    expect(result.openFound).toBe(0);
  });

  it("does not count gate-blocked candidates against the call cap", async () => {
    const caller = new FakeCaller([]);
    const result = await dispatchRun({
      caller,
      candidates: candidates.slice(0, 4),
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 5,
      maxCalls: 2,
      runKey: "r1",
      isOptedOut: (phone) => phone === "+1215555011",
    });
    // Wave 1 dials 0 and 1 (1 blocked) → 1 call placed; wave 2 dials 2 → 2
    // placed; candidate 3 is never reached.
    expect(result.reason).toBe("call_cap_reached");
    expect(result.results).toHaveLength(3);
    expect(result.results.find((r) => r.candidateId === "1")?.verdict).toBe("blocked");
  });

  it("records call failures as an error verdict and stops the run", async () => {
    const failing: typeof FakeCaller = class extends FakeCaller {
      override async placeCall(): Promise<never> {
        throw new Error("boom");
      }
    } as unknown as typeof FakeCaller;

    const result = await dispatchRun({
      caller: new failing(),
      candidates: candidates.slice(0, 3),
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 1,
      runKey: "r1",
    });
    expect(result.reason).toBe("error");
    expect(result.error).toBe("boom");
    expect(result.results[0]!.verdict).toBe("error");
  });

  it("stops before later calls when cancellation is signalled mid-run", async () => {
    const dialed: string[] = [];
    const caller = new FakeCaller([]);
    const counting = {
      placeCall(input: Parameters<FakeCaller["placeCall"]>[0]) {
        dialed.push(input.candidate.id);
        return caller.placeCall(input);
      },
    };

    // Cancel after the first call completes.
    let calls = 0;
    const result = await dispatchRun({
      caller: counting,
      candidates: candidates.slice(0, 6),
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 5,
      maxCalls: 6,
      runKey: "r1",
      isCancelled: () => {
        calls += 1;
        return dialed.length >= 1;
      },
    });

    expect(result.reason).toBe("cancelled");
    expect(dialed).toHaveLength(1);
  });

  it("treats a live unverified result as fail-closed error, never verified open", async () => {
    // A live-looking caller that claims success but is not provider-verified.
    const unverifiedLive = {
      async placeCall() {
        return {
          callId: "call_live_1",
          result: staffed(),
          evidence: [staffed().evidence_quote],
          completed: true,
          simulated: false,
          verified: false,
          calleStatus: "completed",
        };
      },
    };

    const result = await dispatchRun({
      caller: unverifiedLive,
      candidates: candidates.slice(0, 2),
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 1,
      runKey: "r1",
    });
    expect(result.reason).toBe("error");
    expect(result.results.every((r) => r.verdict === "error")).toBe(true);
    expect(result.openFound).toBe(0);
  });

  it("treats a live non-terminal status as fail-closed error", async () => {
    const inProgress = {
      async placeCall() {
        return {
          callId: "call_live_2",
          result: staffed(),
          evidence: [],
          completed: false,
          simulated: false,
          verified: true,
          calleStatus: "in_progress",
        };
      },
    };

    const result = await dispatchRun({
      caller: inProgress,
      candidates: candidates.slice(0, 2),
      spec: SPEC,
      idempotencyPrefix: "watch",
      watchId: "watch-test",
      targetOpen: 1,
      runKey: "r1",
    });
    expect(result.reason).toBe("error");
    expect(result.results[0]!.verdict).toBe("error");
    expect(result.results[0]!.summary).toContain("not_terminal");
  });
});
