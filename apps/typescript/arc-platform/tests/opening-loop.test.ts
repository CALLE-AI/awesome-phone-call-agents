import { describe, it, expect } from "vitest";
import { buildTask, buildStandaloneTask } from "@/lib/calle-media";

/**
 * One call asked "have I reached the ad sales desk?"
 * thirteen times while the recipient answered "yes" nine times, then restarted
 * its introduction at turn 52. It reached the rate question at turn 66 of 120 -
 * two minutes of a six-minute call spent on a question already answered.
 */
const tasks = () => [
  buildTask({ advertiser: "Test", market: "Karachi" }, { name: "FM 100", type: "station" }),
  buildStandaloneTask({ name: "FM 100", type: "station" }),
];

describe("there is no qualifying question to loop on", () => {
  it("forbids asking who answered at all", () => {
    /* Naming the affirmatives did not hold: another call ran
       under a prompt containing every one of those rules and still re-read its
       whole introduction ten times. The gate goes instead of the wording. */
    for (const t of tasks()) {
      expect(t).toContain("Do NOT ask whether you have reached the right person");
      expect(t.toLowerCase()).toContain("there is no qualifying question");
    }
  });

  it("goes straight to the first question instead of waiting to be engaged", () => {
    // "Only once they have engaged" made every later question conditional on a
    // check that a noisy line can never satisfy.
    for (const t of tasks()) {
      expect(t).toContain("do not wait for permission to begin");
      expect(t).not.toContain("Only once they have engaged");
    }
  });

  it("treats an unintelligible reply as a bad line, not a refusal", () => {
    for (const t of tasks()) {
      expect(t).toContain("that is a bad line and not a refusal");
      expect(t).toContain("ask your CURRENT question again in fewer words, never an earlier one");
    }
  });

  it("forbids repeating the introduction or restarting the call", () => {
    for (const t of tasks()) {
      expect(t).toContain("Never repeat your introduction");
      expect(t.toLowerCase()).toContain("never start the call again from the beginning");
    }
  });

  it("still keeps the AI disclosure, which is not optional", () => {
    for (const t of tasks()) {
      expect(t).toContain("an AI assistant calling on behalf of");
      expect(t).toContain("Never claim or imply that you are a person");
    }
  });

  it("still lets a wrong desk be handled without ending the call", () => {
    for (const t of tasks()) {
      expect(t).toContain("put through to whoever handles advertising rates");
    }
  });
});

describe("two asks is the hard ceiling, except for money", () => {
  it("states the limit as absolute and applies it to the opening", () => {
    for (const t of tasks()) {
      expect(t.toLowerCase()).toContain("at most twice");
      expect(t.toLowerCase()).toContain("this limit is absolute");
      expect(t.toLowerCase()).toContain("includes the opening question");
    }
  });

  it("exempts rate confirmation, which is the gate and not a repetition", () => {
    // Turns 100-104 of that same call are the reason: 1253 -> "You said 1 2 5
    // 3, please confirm" -> yes -> rate_confirmed true. That loop must survive.
    for (const t of tasks()) {
      expect(t.toLowerCase()).toContain("the one exception is confirming a rate");
      expect(t).toContain("Do NOT record a rate you have not read back and had confirmed");
    }
  });
});
