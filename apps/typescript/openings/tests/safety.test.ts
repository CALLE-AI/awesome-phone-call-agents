import { describe, expect, it } from "vitest";
import { checkCrisis, containsPhi, mayCall } from "../src/core/safety";
import type { Candidate } from "../src/core/types";

const cand: Candidate = {
  id: "c1",
  name: "Test Practice",
  phoneE164: "+12155550100",
  phoneDisplay: "(215) 555-0100",
  provenance: { kind: "paste", source: "test" },
};

describe("checkCrisis", () => {
  it("passes benign need statements", () => {
    expect(checkCrisis("adult ADHD evaluation").isCrisis).toBe(false);
    expect(checkCrisis("  ").isCrisis).toBe(false);
  });

  it("flags crisis language", () => {
    expect(checkCrisis("I need help now, thinking of suicide").isCrisis).toBe(true);
    expect(checkCrisis("they want to end everything").isCrisis).toBe(true);
    expect(checkCrisis("self-harm").isCrisis).toBe(true);
  });
});

describe("containsPhi", () => {
  it("rejects PHI-laden needs", () => {
    expect(containsPhi("my diagnosis is depression")).toBe(true);
    expect(containsPhi("refill my medication")).toBe(true);
  });

  it("passes PHI-free needs", () => {
    expect(containsPhi("adult ADHD evaluation")).toBe(false);
    expect(containsPhi("")).toBe(false);
  });
});

describe("mayCall", () => {
  it("allows a never-called, non-opted-out candidate", () => {
    expect(mayCall(cand, null, false, new Date()).allow).toBe(true);
  });

  it("blocks an opted-out practice permanently", () => {
    const r = mayCall(cand, null, true, new Date());
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("practice_opted_out");
  });

  it("blocks a call inside the cooldown window", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const last = new Date("2026-01-01T00:00:00Z");
    const r = mayCall(cand, last, false, now);
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("cooldown");
  });

  it("allows a call after the cooldown has elapsed", () => {
    const now = new Date("2026-01-03T12:00:00Z");
    const last = new Date("2026-01-01T00:00:00Z");
    expect(mayCall(cand, last, false, now).allow).toBe(true);
  });
});
