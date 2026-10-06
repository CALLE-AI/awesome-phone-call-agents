import { describe, expect, it } from "vitest";

import { screenForEmergency } from "./safety";

describe("screenForEmergency", () => {
  it.each([
    "There is a strong gas odor in the kitchen",
    "Smoke is filling the hallway",
    "A tenant is trapped in the elevator",
    "There are exposed live wires sparking",
    "The ceiling is collapsing right now",
    "Someone needs a medical emergency response",
  ])("refuses life-safety issue: %s", (issue) => {
    const result = screenForEmergency(issue);

    expect(result.safe).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.message).toContain("emergency");
  });

  it("allows a specific non-emergency maintenance issue", () => {
    expect(
      screenForEmergency(
        "The bathroom sink is draining slowly and the tenant has another working sink.",
      ),
    ).toEqual({ safe: true, matches: [], message: null });
  });
});

