import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/app";
import { FakeCaller, type PlaceCallInput, type PlaceCallOutput } from "../src/core/calle";
import { cadenceForRun, statsFromResults } from "../src/core/watch";
import type { Candidate, CallStructuredResult, SearchSpec } from "../src/core/types";
import { MemoryStore } from "../src/store/memory";

const SPEC: SearchSpec = {
  plan: "Aetna PPO",
  modality: "either",
  location: "Philadelphia, PA",
  need: "adult ADHD evaluation",
  specialty: "psychiatry",
};

function cand(id: string, phone = `+121555501${id}`): Candidate {
  return {
    id,
    name: `Practice ${id}`,
    phoneE164: phone,
    phoneDisplay: `(215) 555-01${id}`,
    provenance: { kind: "paste", source: "test" },
  };
}

function voicemail(): CallStructuredResult {
  return {
    line_outcome: "voicemail",
    accepts_plan: "unknown",
    accepting_new_patients: "unknown",
    soonest_appointment_stated: "",
    wait_estimate_days: -1,
    modality: "unknown",
    evidence_quote: "voicemail; no answer.",
  };
}

function open(): CallStructuredResult {
  return {
    line_outcome: "reached_staff",
    accepts_plan: "yes",
    accepting_new_patients: "yes",
    soonest_appointment_stated: "this week",
    wait_estimate_days: 3,
    modality: "both",
    evidence_quote: "we can see them this week.",
  };
}

/** FakeCaller that records exactly which candidates were dialed. */
class CountingCaller extends FakeCaller {
  calls: string[] = [];

  constructor(seeds: Array<{ candidateId: string; result: CallStructuredResult }> = []) {
    super(seeds);
  }

  override async placeCall(input: PlaceCallInput): Promise<PlaceCallOutput> {
    this.calls.push(input.candidate.id);
    return super.placeCall(input);
  }
}

describe("watch run lifecycle (app.runWatch)", () => {
  it("marks the watch completed when the target number of openings is confirmed", async () => {
    const store = new MemoryStore();
    const caller = new CountingCaller([
      { candidateId: "0", result: voicemail() },
      { candidateId: "1", result: open() },
    ]);
    const app = createApp({ store, caller });

    const watch = app.startWatch({ spec: SPEC, candidates: [cand("0"), cand("1")], targetOpen: 1, maxCallsPerRun: 10 });
    const dispatch = await app.runWatch(watch.id, 1);

    expect(dispatch.reason).toBe("target_reached");
    expect(app.getWatch(watch.id)!.status).toBe("completed");
    expect(caller.calls).toEqual(["0", "1"]);
  });

  it("respects opt-outs: a blocked practice is never dialed and consumes no call budget", async () => {
    const store = new MemoryStore();
    const caller = new CountingCaller();
    const app = createApp({ store, caller });
    // Candidate "2" is opted out; every call returns voicemail so the target is
    // never reached. The cap of 3 must allow 3 real dials despite the blocked
    // candidate sitting inside the budget window.
    store.recordOptOut("+1215555012");

    const candidates = [cand("0"), cand("1"), cand("2"), cand("3")];
    const watch = app.startWatch({ spec: SPEC, candidates, targetOpen: 1, maxCallsPerRun: 3 });
    const dispatch = await app.runWatch(watch.id, 1);

    expect(dispatch.reason).toBe("exhausted");
    expect(caller.calls).toEqual(["0", "1", "3"]);
    expect(dispatch.results.find((r) => r.candidateId === "2")?.verdict).toBe("blocked");
    expect(dispatch.results.find((r) => r.candidateId === "2")?.evidence).toBe("practice_opted_out");
  });

  it("respects the cooldown window and does not re-dial a recently-called number", async () => {
    const store = new MemoryStore();
    const caller = new CountingCaller();
    const app = createApp({ store, caller });
    const watch = app.startWatch({ spec: SPEC, candidates: [cand("0")], targetOpen: 1, maxCallsPerRun: 10 });

    const first = await app.runWatch(watch.id, 1);
    expect(first.results[0]!.verdict).toBe("unreachable");
    expect(caller.calls).toEqual(["0"]);

    // A second run within the 24h cooldown must not dial again.
    const second = await app.runWatch(watch.id, 2);
    expect(second.results[0]!.verdict).toBe("blocked");
    expect(second.results[0]!.evidence).toBe("cooldown");
    expect(caller.calls).toEqual(["0"]);
  });

  it("stops at the per-run call cap and reports call_cap_reached", async () => {
    const store = new MemoryStore();
    const caller = new CountingCaller();
    const app = createApp({ store, caller });
    const candidates = Array.from({ length: 12 }, (_, i) => cand(String(i)));

    const watch = app.startWatch({ spec: SPEC, candidates, targetOpen: 1, maxCallsPerRun: 3 });
    const dispatch = await app.runWatch(watch.id, 1);

    expect(dispatch.reason).toBe("call_cap_reached");
    expect(caller.calls).toHaveLength(3);
    expect(dispatch.results).toHaveLength(3);
  });

  it("does not record a cooldown timestamp for a blocked candidate", async () => {
    const store = new MemoryStore();
    const caller = new CountingCaller();
    const app = createApp({ store, caller });
    store.recordOptOut("+1215555010");

    const watch = app.startWatch({ spec: SPEC, candidates: [cand("0")], targetOpen: 1, maxCallsPerRun: 5 });
    await app.runWatch(watch.id, 1);
    expect(store.lastCalledAt("+1215555010")).toBeNull();
  });
});

describe("cadenceForRun", () => {
  it("uses the decaying cadence for later runs", () => {
    expect(cadenceForRun(1)).toBe(1);
    expect(cadenceForRun(2)).toBe(3);
    expect(cadenceForRun(5)).toBe(24);
    expect(cadenceForRun(6)).toBe(48);
    expect(cadenceForRun(99)).toBe(168);
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
