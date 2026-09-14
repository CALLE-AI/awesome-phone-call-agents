import assert from "node:assert/strict";
import test from "node:test";
import {
  createRateLimiter,
  hasDuplicatePhones,
  hasLiveCallConfiguration,
  isReservedDemoPhone,
  isValidOperationId,
  isValidPhone,
  parseAllowedNumbers,
  secureEqual,
} from "../lib/live-security.ts";

test("accepts only E.164 allowlist entries", () => {
  assert.equal(isValidPhone("+442079460123"), true);
  assert.equal(isValidPhone("020 7946 0123"), false);
  assert.deepEqual([...parseAllowedNumbers(" +442079460123,bad,+442079460456 ")], ["+442079460123", "+442079460456"]);
});

test("reserved fictional NANP numbers cannot make a live call", () => {
  assert.equal(isReservedDemoPhone("+12025550123"), true);
  assert.equal(isReservedDemoPhone("+442079460123"), false);
});

test("live readiness requires an explicit switch, credentials, access key, and real allowlist", () => {
  const environment = {
    TINYSLOT_LIVE_ENABLED: "true",
    CALLE_API_KEY: "test-key",
    TINYSLOT_OPERATOR_KEY: "correct-horse-battery-staple",
    CALLE_ALLOWED_NUMBERS: "+442079460123",
  };
  assert.equal(hasLiveCallConfiguration(environment), true);
  assert.equal(hasLiveCallConfiguration({ ...environment, TINYSLOT_LIVE_ENABLED: "false" }), false);
  assert.equal(hasLiveCallConfiguration({ ...environment, CALLE_ALLOWED_NUMBERS: "+12025550123" }), false);
});

test("enforces stable operation IDs and unique destinations", () => {
  assert.equal(isValidOperationId("c2f3e602-1025-4bdd-b001-c3fb2218b662"), true);
  assert.equal(isValidOperationId("short"), false);
  assert.equal(hasDuplicatePhones(["+442079460123", " +442079460123 "]), true);
});

test("compares operator keys and rate-limits call starts", async () => {
  assert.equal(await secureEqual("correct-horse-battery-staple", "correct-horse-battery-staple"), true);
  assert.equal(await secureEqual("correct-horse-battery-staple", "wrong-horse-battery-staple"), false);
  const check = createRateLimiter(1, 1000);
  assert.equal(check("client", 1000).allowed, true);
  assert.deepEqual(check("client", 1100), { allowed: false, retryAfterSeconds: 1 });
  assert.equal(check("client", 2000).allowed, true);
});
