import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/baseline.js";
import type { CheckOutcome } from "../src/assert.js";

export function outcome(overrides: Partial<CheckOutcome> = {}): CheckOutcome {
  return {
    checkId: "hours",
    lineId: "main-office",
    status: "pass",
    callStatus: "completed",
    assertions: [],
    timing: { secondsToAnswer: 5, secondsToFirstResponse: 5, turnCount: 4 },
    timingViolations: [],
    confidence: 0.9,
    confidenceViolation: null,
    failureCode: null,
    callId: "call_1",
    at: "2026-08-02T10:00:00Z",
    ...overrides,
  };
}

test("history round-trips through the filesystem in insertion order", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-store-")), "baselines");
  const store = openStore(dir);
  assert.deepEqual(store.history("hours"), []);
  store.append(outcome({ callId: "call_1" }));
  store.append(outcome({ callId: "call_2", status: "fail" }));

  const reopened = openStore(dir);
  const history = reopened.history("hours");
  assert.equal(history.length, 2);
  assert.equal(history[0].callId, "call_1");
  assert.equal(history[1].status, "fail");
  assert.deepEqual(reopened.history("other-check"), []);
});

test("history is capped at 50 entries, dropping the oldest", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-store-")), "baselines");
  const store = openStore(dir);
  for (let index = 0; index < 55; index += 1) {
    store.append(outcome({ callId: `call_${index}` }));
  }
  const history = store.history("hours");
  assert.equal(history.length, 50);
  assert.equal(history[0].callId, "call_5");
  assert.equal(history[49].callId, "call_54");
});

test("line verification round-trips and is null when absent", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-store-")), "baselines");
  const store = openStore(dir);
  assert.equal(store.verification("main-office"), null);
  store.recordVerification({
    lineId: "main-office",
    phone: "+15550100",
    method: "greeting_code",
    verifiedAt: "2026-08-02T09:00:00Z",
    callId: "call_v1",
  });
  const reopened = openStore(dir);
  assert.equal(reopened.verification("main-office")?.method, "greeting_code");
  assert.equal(reopened.verification("other-line"), null);
});
