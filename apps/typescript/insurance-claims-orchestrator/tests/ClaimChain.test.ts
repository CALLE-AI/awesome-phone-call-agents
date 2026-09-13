// tests/ClaimChain.test.ts
// Unit tests for ClaimChain orchestrator logic using Node.js built-in test runner.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClaimChain } from "../src/ClaimChain.js";
import type { CallOutcome } from "../src/ClaimChain.js";

function makeCaller(outcomes: Array<{ outcome: CallOutcome; result: object | null }>) {
  let idx = 0;
  return async (
    _phone: string,
    _task: string,
    _schema: object
  ): Promise<{ callId: string; outcome: CallOutcome; structured_result: object | null }> => {
    const entry = outcomes[idx++] ?? { outcome: "unclear" as CallOutcome, result: null };
    return { callId: `mock-${idx}`, outcome: entry.outcome, structured_result: entry.result };
  };
}

const LOSS_RESULT = {
  outcome: "completed",
  incident_description: "Rear-ended at a red light.",
  incident_date: "2026-09-10",
  estimated_damage: 4200,
  policy_number_confirmed: "POL-TEST-7890",
};

const COVERAGE_RESULT = {
  outcome: "completed",
  policy_active: true,
  coverage_verified: "yes",
  prior_claims_12mo: false,
  adjuster_notified: true,
  claimant_questions: null,
};

describe("ClaimChain — happy path", () => {
  it("completes both steps and returns completed: true", async () => {
    const chain = new ClaimChain()
      .addStep({ id: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "loss task" })
      .addStep({ id: "coverage_verify", dependsOn: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "coverage task" });

    const caller = makeCaller([
      { outcome: "completed", result: LOSS_RESULT },
      { outcome: "completed", result: COVERAGE_RESULT },
    ]);

    const result = await chain.execute("+15550001234", caller, false);
    assert.equal(result.completed, true);
    assert.equal(result.humanReviewRequired, false);
    assert.equal(result.steps["loss_report"].outcome, "completed");
    assert.equal(result.steps["coverage_verify"].outcome, "completed");
  });
});

describe("ClaimChain — dependency blocking", () => {
  it("blocks coverage_verify when loss_report returns voicemail", async () => {
    const chain = new ClaimChain()
      .addStep({ id: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "loss task" })
      .addStep({ id: "coverage_verify", dependsOn: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "coverage task" });

    const caller = makeCaller([{ outcome: "voicemail", result: null }]);
    const result = await chain.execute("+15550001234", caller, false);

    assert.equal(result.completed, false);
    assert.equal(result.humanReviewRequired, true);
    assert.ok(result.humanReviewReason?.includes("loss_report"));
    assert.equal(result.steps["coverage_verify"], undefined);
  });

  it("blocks coverage_verify when loss_report returns refused", async () => {
    const chain = new ClaimChain()
      .addStep({ id: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "loss task" })
      .addStep({ id: "coverage_verify", dependsOn: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "coverage task" });

    const caller = makeCaller([{ outcome: "refused", result: null }]);
    const result = await chain.execute("+15550001234", caller, false);
    assert.equal(result.completed, false);
    assert.equal(result.humanReviewRequired, true);
  });
});

describe("ClaimChain — retry logic", () => {
  it("retries no_answer once when retryOnOutcome includes no_answer", async () => {
    const chain = new ClaimChain()
      .addStep({ id: "loss_report", maxRetries: 2, retryOnOutcome: ["no_answer"], resultSchema: {}, taskText: () => "loss task" });

    const caller = makeCaller([
      { outcome: "no_answer", result: null },
      { outcome: "completed", result: LOSS_RESULT },
    ]);

    const result = await chain.execute("+15550001234", caller, false);
    assert.equal(result.completed, true);
    assert.equal(result.steps["loss_report"].attempts, 2);
  });

  it("does not retry when outcome is not in retryOnOutcome", async () => {
    const chain = new ClaimChain()
      .addStep({ id: "loss_report", maxRetries: 3, retryOnOutcome: ["no_answer"], resultSchema: {}, taskText: () => "loss task" });

    const caller = makeCaller([{ outcome: "refused", result: null }]);
    const result = await chain.execute("+15550001234", caller, false);
    assert.equal(result.steps["loss_report"].attempts, 1);
    assert.equal(result.steps["loss_report"].outcome, "refused");
  });
});

describe("ClaimChain — dry-run mode", () => {
  it("dry-run returns completed without invoking the caller function", async () => {
    let callerCallCount = 0;
    const chain = new ClaimChain()
      .addStep({ id: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "loss task" })
      .addStep({ id: "coverage_verify", dependsOn: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "coverage task" });

    const caller = async (): Promise<{ callId: string; outcome: CallOutcome; structured_result: object | null }> => {
      callerCallCount++;
      return { callId: "should-not-be-called", outcome: "completed", structured_result: null };
    };

    const result = await chain.execute("+15550001234", caller, true);
    assert.equal(callerCallCount, 0);
    assert.equal(result.completed, true);
    assert.ok(result.steps["loss_report"].callId.startsWith("dry-run-"));
  });
});

describe("ClaimChain — context injection", () => {
  it("passes loss_report result into coverage_verify task text", async () => {
    let capturedTask = "";

    const chain = new ClaimChain()
      .addStep({ id: "loss_report", maxRetries: 1, resultSchema: {}, taskText: () => "loss task" })
      .addStep({
        id: "coverage_verify",
        dependsOn: "loss_report",
        maxRetries: 1,
        resultSchema: {},
        taskText: (ctx) => {
          const r = ctx.results["loss_report"] as typeof LOSS_RESULT;
          capturedTask = `policy: ${r.policy_number_confirmed}`;
          return capturedTask;
        },
      });

    const caller = makeCaller([
      { outcome: "completed", result: LOSS_RESULT },
      { outcome: "completed", result: COVERAGE_RESULT },
    ]);

    await chain.execute("+15550001234", caller, false);
    assert.equal(capturedTask, "policy: POL-TEST-7890");
  });
});
