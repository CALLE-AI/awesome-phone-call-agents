import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLiveOperatorRole,
  assertResultsOperatorRole,
  hasLiveOperatorRole,
  LiveAccessError,
} from "../lib/auth/live-policy";

test("ordinary signups have no live entitlement", () => {
  assert.equal(hasLiveOperatorRole("business_user"), false);
  assert.throws(
    () => assertLiveOperatorRole("business_user", "live"),
    LiveAccessError,
  );
});

test("only the exact operator role enables live mode", () => {
  assert.equal(hasLiveOperatorRole("live_operator"), true);
  assert.doesNotThrow(() => assertLiveOperatorRole("live_operator", "live"));
  assert.doesNotThrow(() => assertLiveOperatorRole("business_user", "fake"));
  assert.throws(() => assertLiveOperatorRole("admin", "live"), LiveAccessError);
  assert.throws(() => assertResultsOperatorRole("business_user"), LiveAccessError);
  assert.doesNotThrow(() => assertResultsOperatorRole("live_operator"));
});
