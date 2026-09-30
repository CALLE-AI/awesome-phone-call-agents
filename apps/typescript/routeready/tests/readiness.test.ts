import { describe, expect, it } from "vitest";
import { clockToMinutes, planFromAnswer } from "../src/core/readiness.js";

describe("planFromAnswer", () => {
  // Customer was told minute 40; the answer arrived at minute 30.
  it.each([
    ["ready_now", { kind: "earliest", at: 30 }],
    ["within_15_min", { kind: "earliest", at: 55 }],
    ["15_to_45_min", { kind: "earliest", at: 85 }],
    ["later_today", { kind: "revisit", at: null }],
    ["not_today", { kind: "remove" }],
    ["unknown", { kind: "no_change" }],
  ] as const)("%s", (readiness, plan) => {
    expect(planFromAnswer(readiness, 40, 30)).toEqual(plan);
  });

  it("uses a clock time the customer named", () => {
    expect(planFromAnswer("later_today", 40, 30, 180)).toEqual({ kind: "revisit", at: 180 });
    expect(planFromAnswer("within_15_min", 40, 30, 50)).toEqual({ kind: "earliest", at: 50 });
  });
});

describe("clockToMinutes", () => {
  it.each([
    ["13:00", 180],
    ["10:40", 40],
    ["9:30", null],
    ["25:00", null],
    ["1 PM", null],
    ["", null],
  ] as const)("%s after a 10:00 start", (clock, minutes) => {
    expect(clockToMinutes(clock, "10:00")).toBe(minutes);
  });
});
