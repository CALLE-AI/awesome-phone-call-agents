import { describe, it, expect } from "vitest";
import { verifyOutcome } from "../src/core/verify";
import { runVerifiedGoal } from "../src/core/runGoal";
import { FakeCalle } from "../src/core/fakecalle";
import { pharmacyReadyScenario, noAnswerScenario, DEMO_PHARMACY } from "../src/core/fixtures";
import type { CalleCallResult } from "../src/core/types";

const KEYS = ["refill_ready", "pickup_by", "closing_time"];

describe("verifyOutcome — honest, fail-closed grounding", () => {
  it("marks answers verified only when the callee's own words support them", () => {
    const out = verifyOutcome(pharmacyReadyScenario, KEYS);
    expect(out.overall).toBe("verified");
    for (const field of out.fields) {
      expect(field.status).toBe("verified");
      expect(field.quotes.length).toBeGreaterThan(0);
      // Proof must come from the callee, never the agent's own words.
      expect(field.quotes.every((q) => q.speaker !== "bot")).toBe(true);
    }
  });

  it("fails closed when the office cannot be reached", () => {
    const out = verifyOutcome(noAnswerScenario, KEYS);
    expect(out.overall).toBe("unverified");
    expect(out.unreachable).toBe(true);
    expect(out.advice).toMatch(/call yourself/i);
    expect(out.fields.every((f) => f.status === "unverified")).toBe(true);
  });

  it("refuses to verify below the confidence threshold, even with grounding", () => {
    const lowConf: CalleCallResult = {
      ...pharmacyReadyScenario,
      completionConfidence: { score: 0.4, label: "low" },
    };
    const out = verifyOutcome(lowConf, KEYS, { threshold: 0.7 });
    expect(out.overall).toBe("unverified");
    expect(out.fields.every((f) => /confidence/.test(f.reason ?? ""))).toBe(true);
  });

  it("does not let the agent's own words self-ground an answer", () => {
    const botOnly: CalleCallResult = {
      ...pharmacyReadyScenario,
      evidence: [],
      transcriptTurns: [
        { offsetSeconds: 0, speaker: "bot", text: "Yes, the refill is ready and you can pick it up before 5:00 PM." },
      ],
    };
    const out = verifyOutcome(botOnly, KEYS);
    expect(out.overall).toBe("unverified");
    expect(out.fields.every((f) => f.quotes.length === 0)).toBe(true);
  });

  it("fails closed when the agent could not complete the task", () => {
    const notDone: CalleCallResult = { ...pharmacyReadyScenario, taskCompleted: false };
    const out = verifyOutcome(notDone, KEYS);
    expect(out.overall).toBe("unverified");
    expect(out.unreachable).toBe(false);
  });

  it("reports partial when only some fields are grounded", () => {
    const partial: CalleCallResult = {
      ...pharmacyReadyScenario,
      evidence: [],
      structuredResult: { refill_ready: "yes", pickup_by: "11:30 AM" },
    };
    const out = verifyOutcome(partial, ["refill_ready", "pickup_by"]);
    expect(out.overall).toBe("partial");
    expect(out.fields.find((f) => f.key === "refill_ready")?.status).toBe("verified");
    expect(out.fields.find((f) => f.key === "pickup_by")?.status).toBe("unverified");
  });
});

describe("runVerifiedGoal — validate → call → verify", () => {
  it("places one call to the given E.164 number and verifies the result", async () => {
    const client = new FakeCalle(pharmacyReadyScenario);
    const out = await runVerifiedGoal(client, {
      task: "Ask if the metformin refill is ready and when they close.",
      phone: DEMO_PHARMACY,
      requestedKeys: KEYS,
      idempotencyKey: "goal-abc-1",
    });
    expect(out.overall).toBe("verified");
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.phone).toBe(DEMO_PHARMACY);
    expect(client.requests[0]?.idempotencyKey).toBe("goal-abc-1");
  });

  it("never dials an invalid number", async () => {
    const client = new FakeCalle(pharmacyReadyScenario);
    await expect(
      runVerifiedGoal(client, {
        task: "x",
        phone: "2025550142", // missing +, not E.164
        requestedKeys: KEYS,
      }),
    ).rejects.toThrow(/E\.164/);
    expect(client.requests).toHaveLength(0);
  });
});
