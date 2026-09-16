import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCheck } from "../src/assert.js";
import type { CheckConfig } from "../src/config.js";
import type { CallSnapshot } from "../src/types.js";

function check(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return {
    id: "hours",
    line: "main-office",
    task: "Ask for Saturday hours.",
    resultSchema: { type: "object", additionalProperties: false },
    assert: [{ path: "answered", equals: true }],
    ...overrides,
  };
}

function snapshot(overrides: Partial<CallSnapshot> = {}): CallSnapshot {
  return {
    id: "call_1",
    status: "completed",
    task: "Ask for Saturday hours.",
    recipients: [
      {
        id: "rcp_1",
        phones: ["+15550100"],
        status: "completed",
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: "att_1",
            phone: "+15550100",
            status: "completed",
            startedAt: null,
            completedAt: null,
            transcriptTurns: [
              { offsetSeconds: 0, speaker: "bot", text: "Automated test call." },
              { offsetSeconds: 5, speaker: "user", text: "Front desk." },
            ],
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: { answered: true, hours: { saturday: "9-12" }, greeting: "Thanks for calling ACME" },
    summary: null,
    taskCompleted: true,
    completionConfidence: { score: 0.9, label: "high" },
    evidence: [],
    metadata: {},
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-08-02T10:00:00Z",
    completedAt: "2026-08-02T10:01:00Z",
    ...overrides,
  };
}

test("passing check: assertions, timing and confidence all in bounds", () => {
  const outcome = evaluateCheck(
    check({
      assert: [
        { path: "answered", equals: true },
        { path: "hours.saturday", contains: "9" },
        { path: "greeting", matches: "acme" },
        { path: "hours.saturday", oneOf: ["9-12", "closed"] },
        { path: "hours.sunday", exists: false },
      ],
      timing: { maxSecondsToAnswer: 10 },
      minConfidence: 0.5,
    }),
    "main-office",
    snapshot(),
  );
  assert.equal(outcome.status, "pass");
  assert.equal(outcome.assertions.length, 5);
  assert.ok(outcome.assertions.every((entry) => entry.pass));
  assert.deepEqual(outcome.timingViolations, []);
  assert.equal(outcome.confidenceViolation, null);
  assert.equal(outcome.timing.secondsToAnswer, 5);
  assert.equal(outcome.confidence, 0.9);
});

test("failed assertion turns the check into fail with the actual value in detail", () => {
  const outcome = evaluateCheck(check({ assert: [{ path: "answered", equals: false }] }), "main-office", snapshot());
  assert.equal(outcome.status, "fail");
  assert.equal(outcome.assertions[0].pass, false);
  assert.equal(outcome.assertions[0].actual, true);
});

test("contains and matches on a non-string actual fail with detail instead of throwing", () => {
  const outcome = evaluateCheck(
    check({ assert: [{ path: "answered", contains: "yes" }, { path: "hours", matches: "x" }] }),
    "main-office",
    snapshot(),
  );
  assert.equal(outcome.status, "fail");
  assert.equal(outcome.assertions[0].pass, false);
  assert.match(outcome.assertions[0].detail, /not a string/);
  assert.equal(outcome.assertions[1].pass, false);
});

test("missing path fails equals but passes exists:false", () => {
  const outcome = evaluateCheck(
    check({ assert: [{ path: "ghost.deep", equals: 1 }, { path: "ghost.deep", exists: false }] }),
    "main-office",
    snapshot(),
  );
  assert.equal(outcome.assertions[0].pass, false);
  assert.equal(outcome.assertions[1].pass, true);
});

test("timing violation fails the check even when assertions pass", () => {
  const outcome = evaluateCheck(
    check({ timing: { maxSecondsToAnswer: 3 } }),
    "main-office",
    snapshot(),
  );
  assert.equal(outcome.status, "fail");
  assert.equal(outcome.timingViolations.length, 1);
  assert.match(outcome.timingViolations[0], /secondsToAnswer 5 > 3/);
});

test("timing bound with no measurable metric is a violation, not a silent pass", () => {
  const bare = snapshot();
  bare.recipients[0].attempts[0].transcriptTurns = [{ offsetSeconds: 0, speaker: "bot", text: "…" }];
  const outcome = evaluateCheck(check({ timing: { maxSecondsToAnswer: 10 } }), "main-office", bare);
  assert.equal(outcome.status, "fail");
  assert.match(outcome.timingViolations[0], /no user turn/);
});

test("confidence below the floor fails the check", () => {
  const outcome = evaluateCheck(
    check({ minConfidence: 0.95 }),
    "main-office",
    snapshot(),
  );
  assert.equal(outcome.status, "fail");
  assert.match(outcome.confidenceViolation ?? "", /0.9 < 0.95/);
});

test("non-completed call is an error outcome carrying the failure code", () => {
  const outcome = evaluateCheck(check(), "main-office", snapshot({ status: "failed", failureCode: "no_answer", structuredResult: null }));
  assert.equal(outcome.status, "error");
  assert.equal(outcome.failureCode, "no_answer");
});

test("completed call without a structured result is an error (result_validation_failed)", () => {
  const outcome = evaluateCheck(check(), "main-office", snapshot({ structuredResult: null }));
  assert.equal(outcome.status, "error");
  assert.equal(outcome.failureCode, "result_validation_failed");
});
