import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
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

test("history is capped at the configured limit, dropping the oldest", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-store-")), "baselines");
  const store = openStore(dir, 50);
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

test("a corrupt history file is quarantined loudly, never silently reset", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-store-")), "baselines");
  const store = openStore(dir);
  store.append(outcome({ callId: "call_1" }));
  const file = join(dir, "hours.history.json");
  writeFileSync(file, "{ this is not json");

  assert.deepEqual(store.history("hours"), []);
  assert.equal(existsSync(file), false, "the corrupt file must be moved aside");
  assert.ok(
    readdirSync(dir).some((name) => name.startsWith("hours.history.json.corrupt-")),
    "the corrupt file must survive under a quarantine name",
  );
});

test("pending attempts round-trip and clear", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-store-")), "baselines");
  const store = openStore(dir);
  assert.equal(store.pending("hours"), null);
  store.recordPending({ checkId: "hours", idempotencyKey: "linecanary:hours:+15550100:2026-08-06T18:00", callId: null, at: "2026-08-06T18:00:00Z" });
  assert.equal(store.pending("hours")?.callId, null);
  store.recordPending({ checkId: "hours", idempotencyKey: "linecanary:hours:+15550100:2026-08-06T18:00", callId: "call_9", at: "2026-08-06T18:00:00Z" });
  assert.equal(openStore(dir).pending("hours")?.callId, "call_9");
  store.clearPending("hours");
  assert.equal(store.pending("hours"), null);
  store.clearPending("hours"); // idempotent
});
