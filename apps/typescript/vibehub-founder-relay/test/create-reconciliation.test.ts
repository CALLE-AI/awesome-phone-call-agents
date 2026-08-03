import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATE_OUTCOME_UNRESOLVED,
  CreateOutcomeUnresolvedError,
  isAcceptanceAmbiguousCreateError,
  isAcceptanceAmbiguousHttpStatus,
  reconcileCreateWithOriginalKey,
} from "../src/create-reconciliation.js";

function apiError(status: number) {
  return Object.assign(new Error("test"), { name: "CalleAPIError", status });
}

function namedError(name: string) {
  return Object.assign(new Error("test"), { name });
}

test("classifies every acceptance-ambiguous HTTP outcome", () => {
  for (const status of [408, 409, 429, 500, 502, 503, 599]) {
    assert.equal(isAcceptanceAmbiguousHttpStatus(status), true, String(status));
    assert.equal(isAcceptanceAmbiguousCreateError(apiError(status)), true, String(status));
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isAcceptanceAmbiguousHttpStatus(status), false, String(status));
    assert.equal(isAcceptanceAmbiguousCreateError(apiError(status)), false, String(status));
  }
  assert.equal(isAcceptanceAmbiguousCreateError(namedError("CalleConnectionError")), true);
  assert.equal(isAcceptanceAmbiguousCreateError(new TypeError("fetch failed")), true);
});

test("reconciles ambiguous creates only with the original content-bound key", async () => {
  const keys: string[] = [];
  let attempts = 0;
  const result = await reconcileCreateWithOriginalKey(
    async (key) => {
      keys.push(key);
      attempts += 1;
      if (attempts < 3) throw apiError(attempts === 1 ? 408 : 503);
      return { id: "call_test" };
    },
    "vibehub-founder-relay-content-bound-key",
    { sleep: async () => undefined },
  );

  assert.deepEqual(keys, [
    "vibehub-founder-relay-content-bound-key",
    "vibehub-founder-relay-content-bound-key",
    "vibehub-founder-relay-content-bound-key",
  ]);
  assert.deepEqual(result, { id: "call_test" });
});

test("marks a still-ambiguous create as unresolved", async () => {
  await assert.rejects(
    reconcileCreateWithOriginalKey(
      async () => {
        throw apiError(429);
      },
      "vibehub-founder-relay-content-bound-key",
      { sleep: async () => undefined },
    ),
    (error: unknown) => {
      assert.equal(error instanceof CreateOutcomeUnresolvedError, true);
      assert.equal((error as CreateOutcomeUnresolvedError).code, CREATE_OUTCOME_UNRESOLVED);
      assert.equal((error as CreateOutcomeUnresolvedError).attempts, 3);
      return true;
    },
  );
});

test("does not retry an unambiguous client rejection", async () => {
  let attempts = 0;
  await assert.rejects(
    reconcileCreateWithOriginalKey(
      async () => {
        attempts += 1;
        throw apiError(422);
      },
      "vibehub-founder-relay-content-bound-key",
      { sleep: async () => undefined },
    ),
    (error: unknown) => error instanceof Error && (error as Error & { status?: number }).status === 422,
  );
  assert.equal(attempts, 1);
});
