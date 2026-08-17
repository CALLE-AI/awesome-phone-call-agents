import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/app";
import { FakeCaller } from "../src/core/calle";
import type { Candidate, SearchSpec } from "../src/core/types";
import { MemoryStore } from "../src/store/memory";

const SPEC: SearchSpec = {
  plan: "Aetna PPO",
  modality: "either",
  location: "Philadelphia, PA",
  need: "adult ADHD evaluation",
  specialty: "psychiatry",
};

function cand(id: string, name = `Practice ${id}`): Candidate {
  return {
    id,
    name,
    phoneE164: `+121555501${id}`,
    phoneDisplay: `(215) 555-01${id}`,
    provenance: { kind: "paste", source: "test" },
  };
}

describe("end-to-end watch lifecycle (fake caller, memory store)", () => {
  it("creates a watch, runs it, records ghosts, and completes on target", async () => {
    const store = new MemoryStore();
    const candidates = [cand("0", "Dead Line"), cand("1", "Busy Practice"), cand("2", "Open One")];
    const caller = new FakeCaller([
      { candidateId: "0", result: { line_outcome: "disconnected", accepts_plan: "unknown", accepting_new_patients: "unknown", soonest_appointment_stated: "", wait_estimate_days: -1, modality: "unknown", evidence_quote: "number disconnected" } },
      { candidateId: "1", result: { line_outcome: "reached_staff", accepts_plan: "yes", accepting_new_patients: "no", soonest_appointment_stated: "", wait_estimate_days: -1, modality: "unknown", evidence_quote: "not accepting new patients" } },
      { candidateId: "2", result: { line_outcome: "reached_staff", accepts_plan: "yes", accepting_new_patients: "yes", soonest_appointment_stated: "this week", wait_estimate_days: 3, modality: "both", evidence_quote: "we can see you this week" } },
    ]);
    const app = createApp({ store, caller });

    const watch = app.startWatch({ spec: SPEC, candidates, targetOpen: 1, maxCallsPerRun: 5 });
    expect(watch.status).toBe("active");

    const dispatch = await app.runWatch(watch.id, 1);
    expect(dispatch.reason).toBe("target_reached");
    expect(dispatch.openFound).toBe(1);

    // The ghost listing becomes a verifiable fact.
    const facts = app.listFacts();
    expect(facts.some((f) => f.factType === "line_dead" && f.practiceId === "0")).toBe(true);

    // Completed watch is not run again by the scheduler path.
    expect(app.getWatch(watch.id)!.status).toBe("completed");

    // Opt-out is enforced: a fresh watch over the opted-out candidate blocks it.
    const watch2 = app.startWatch({ spec: SPEC, candidates: [cand("2", "Opted Out Practice")], targetOpen: 1, maxCallsPerRun: 5 });
    store.recordOptOut("+1215555012");
    const second = await app.runWatch(watch2.id, 1);
    expect(second.results[0]!.verdict).toBe("blocked");
  });

  it("stops a watch on request and refuses to run a stopped watch", async () => {
    const store = new MemoryStore();
    const app = createApp({ store, caller: new FakeCaller([]) });
    const watch = app.startWatch({ spec: SPEC, candidates: [cand("0")], targetOpen: 1, maxCallsPerRun: 5 });
    expect(app.stopWatch(watch.id)).toBe(true);

    await expect(app.runWatch(watch.id, 1)).rejects.toThrow("watch_not_active");
    expect(app.stopWatch("missing")).toBe(false);
  });

  it("gives every watch a unique idempotency prefix, even for the same location", async () => {
    const store = new MemoryStore();
    const app = createApp({ store, caller: new FakeCaller([]) });
    const w1 = app.startWatch({ spec: SPEC, candidates: [cand("0")], targetOpen: 1, maxCallsPerRun: 5 });
    const w2 = app.startWatch({ spec: SPEC, candidates: [cand("0")], targetOpen: 1, maxCallsPerRun: 5 });
    // Without this, CALL-E would deduplicate the second watch's calls against
    // the first watch's idempotency keys and return stale results instead of
    // placing fresh calls.
    expect(w1.idempotencyPrefix).not.toBe(w2.idempotencyPrefix);
    expect(w1.id).not.toBe(w2.id);
  });
});
