// Tests for mapResult: the narrowing of CALL-E's opaque structuredResult
// (snake_case JsonObject) into our CollectionsResult. No network, no calls.

import test from "node:test";
import assert from "node:assert/strict";

import { mapResult } from "./calle.js";

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
