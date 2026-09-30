// Tests for mapResult: the narrowing of CALL-E's opaque structuredResult
// (snake_case JsonObject) into our CollectionsResult. No network, no calls.

import test from "node:test";
import assert from "node:assert/strict";

import { mapResult, buildTask } from "./calle.js";
import type { OverdueAccount } from "./types.js";

const account: OverdueAccount = {
  accountId: "T-1",
  customerName: "Ada Lovelace",
  phone: "+12025550143",
  region: "US",
  timezone: "America/New_York",
  amountDueCents: 24999,
  currency: "USD",
  dueDate: "2026-07-15",
  daysPastDue: 25,
  consentToContact: true,
  consentTimestamp: "2026-06-01T10:00:00Z",
};

test("buildTask verifies right-party BEFORE disclosing any debt amount/date", () => {
  const task = buildTask(account);
  const verifyAt = task.indexOf("RIGHT-PARTY VERIFICATION");
  const amountAt = task.indexOf("$249.99");
  assert.ok(verifyAt >= 0, "task must include a right-party verification step");
  assert.ok(amountAt >= 0, "task must eventually state the amount");
  assert.ok(verifyAt < amountAt, "verification must come before the amount is disclosed");
  // The due date is a debt detail and must also follow verification.
  assert.ok(task.indexOf(account.dueDate) > verifyAt, "due date must follow verification");
  assert.match(task, /do NOT reveal any debt/i);
});

test("mapResult returns undefined for a missing result", () => {
  assert.equal(mapResult(undefined), undefined);
  assert.equal(mapResult(null), undefined);
});

test("mapResult maps snake_case fields to camelCase", () => {
  const result = mapResult({
    outcome: "promise-to-pay",
    promise_to_pay_date: "2026-08-20",
    callback_at: "2026-08-15T14:00:00Z",
    notes: "Customer will pay Friday.",
  });
  assert.deepEqual(result, {
    outcome: "promise-to-pay",
    promiseToPayDate: "2026-08-20",
    callbackAt: "2026-08-15T14:00:00Z",
    notes: "Customer will pay Friday.",
  });
});

test("mapResult defaults a missing outcome to 'unknown'", () => {
  const result = mapResult({ notes: "call dropped" });
  assert.equal(result?.outcome, "unknown");
  assert.equal(result?.notes, "call dropped");
});

test("mapResult leaves optional fields undefined when absent", () => {
  const result = mapResult({ outcome: "refused" });
  assert.deepEqual(result, {
    outcome: "refused",
    promiseToPayDate: undefined,
    callbackAt: undefined,
    notes: undefined,
  });
});

test("mapResult masks phone-bearing fields and rejects arbitrary outcome text", () => {
  const result = mapResult({
    outcome: "callback +12025550143",
    promise_to_pay_date: "+1 (202) 555-0143",
    callback_at: "+12025550143",
    notes: "Please call +1 202 555 0143.",
  });
  assert.equal(result?.outcome, "unknown");
  assert.equal(result?.promiseToPayDate, "+*********43");
  assert.equal(result?.callbackAt, "+*********43");
  assert.equal(result?.notes, "Please call +*********43.");
});
