import { describe, expect, it } from "vitest";
import { classifyResult } from "../src/core/classify";
import type { CallStructuredResult } from "../src/core/types";

function base(overrides: Partial<CallStructuredResult> = {}): CallStructuredResult {
  return {
    line_outcome: "reached_staff",
    accepts_plan: "unknown",
    accepting_new_patients: "unknown",
    soonest_appointment_stated: "",
    wait_estimate_days: -1,
    modality: "unknown",
    evidence_quote: "",
    ...overrides,
  };
}

describe("classifyResult", () => {
  it("marks a reachable practice that accepts the plan and new patients as open", () => {
    expect(
      classifyResult(base({ accepts_plan: "yes", accepting_new_patients: "yes" })),
    ).toBe("open");
  });

  it("marks a waitlist as waitlist", () => {
    expect(
      classifyResult(base({ accepts_plan: "yes", accepting_new_patients: "waitlist_only" })),
    ).toBe("waitlist");
  });

  it("marks plan-out-of-network as not_accepting", () => {
    expect(
      classifyResult(base({ accepts_plan: "out_of_network_only" })),
    ).toBe("not_accepting");
  });

  it("marks accepting but unknown new-patient status as waitlist, never open", () => {
    expect(classifyResult(base({ accepts_plan: "yes" }))).toBe("waitlist");
  });

  it("marks a reached person with no plan answer as inconclusive, never open or unreachable", () => {
    // reached_staff + accepts_plan unknown (accepting_new_patients unknown)
    expect(classifyResult(base({}))).toBe("inconclusive");
    // reached_staff + accepts_plan unknown, but they are not accepting new patients
    expect(classifyResult(base({ accepting_new_patients: "no" }))).toBe("not_accepting");
    // reached_staff + accepts_plan unknown, new patients yes but plan still unknown
    const r = classifyResult(base({ accepting_new_patients: "yes" }));
    expect(r).toBe("inconclusive");
    expect(r).not.toBe("open");
  });

  it("treats voicemail as unreachable, never as a verdict", () => {
    expect(classifyResult(base({ line_outcome: "voicemail" }))).toBe("unreachable");
    expect(classifyResult(base({ line_outcome: "ivr_dead_end" }))).toBe("unreachable");
  });

  it("treats a disconnected line as a ghost", () => {
    expect(classifyResult(base({ line_outcome: "disconnected" }))).toBe("ghost");
  });

  it("treats a wrong-entity number as a ghost", () => {
    expect(classifyResult(base({ line_outcome: "wrong_entity" }))).toBe("ghost");
  });

  it("marks a staff refusal as declined", () => {
    expect(classifyResult(base({ line_outcome: "declined" }))).toBe("declined");
  });

  it("treats an unknown outcome as unreachable", () => {
    expect(classifyResult(base({ line_outcome: "unknown" }))).toBe("unreachable");
  });

  it("never upgrades unknown line outcome to open even with yes answers", () => {
    expect(
      classifyResult(base({ line_outcome: "unknown", accepts_plan: "yes", accepting_new_patients: "yes" })),
    ).toBe("unreachable");
  });
});
