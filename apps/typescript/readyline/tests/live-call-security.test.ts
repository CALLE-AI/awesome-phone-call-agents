import assert from "node:assert/strict";
import test from "node:test";
import {
  createRateLimiter,
  hasDuplicateNormalizedPhones,
  hasLiveCallConfiguration,
  isValidOperationId,
  isValidPhone,
  isReservedDemoPhone,
  isValidReadinessVenue,
  parseAllowedNumbers,
  secureEqual,
} from "../lib/live-call-security.ts";

test("accepts only valid E.164 allowlist entries", () => {
  assert.equal(isValidPhone("+442079460123"), true);
  assert.equal(isValidPhone("020 7123 4567"), false);
  assert.deepEqual(
    [...parseAllowedNumbers(" +442079460123,invalid,+442079460456 ")],
    ["+442079460123", "+442079460456"],
  );
});

test("recognizes reserved fictional NANP demo numbers", () => {
  assert.equal(isReservedDemoPhone("+12025550123"), true);
  assert.equal(isReservedDemoPhone("+442079460123"), false);
});

test("rejects duplicate E.164 recipients after normalization", () => {
  assert.equal(
    hasDuplicateNormalizedPhones(["+442079460123", " +442079460123 "]),
    true,
  );
  assert.equal(
    hasDuplicateNormalizedPhones(["+442079460123", "+442079460456"]),
    false,
  );
});

test("reports live readiness only with complete, non-fictional configuration", () => {
  const configured = {
    CALLE_API_KEY: "test-api-key",
    CALLE_ALLOWED_NUMBERS: "+442079460123",
    READYLINE_LIVE_ENABLED: "true",
    READYLINE_OPERATOR_KEY: "correct-horse-battery-staple",
  };

  assert.equal(hasLiveCallConfiguration(configured), true);
  assert.equal(hasLiveCallConfiguration({ ...configured, READYLINE_LIVE_ENABLED: "false" }), false);
  assert.equal(hasLiveCallConfiguration({ ...configured, CALLE_API_KEY: "" }), false);
  assert.equal(
    hasLiveCallConfiguration({ ...configured, CALLE_ALLOWED_NUMBERS: "+12025550123" }),
    false,
  );
});

test("requires a bounded idempotency operation identifier", () => {
  assert.equal(isValidOperationId("b7d680d1-5540-4bfd-a0be-7bd6fc7a5e71"), true);
  assert.equal(isValidOperationId("short"), false);
  assert.equal(isValidOperationId("contains spaces and punctuation!"), false);
});

test("accepts only complete, bounded readiness venue constraints", () => {
  assert.equal(
    isValidReadinessVenue({ accessStart: "09:30", readyBy: "11:00", availablePowerAmps: 32 }),
    true,
  );
  assert.equal(
    isValidReadinessVenue({ accessStart: "9:30", readyBy: "11:00", availablePowerAmps: 32 }),
    false,
  );
  assert.equal(
    isValidReadinessVenue({ accessStart: "09:30", readyBy: "11:00", availablePowerAmps: 0 }),
    false,
  );
  assert.equal(
    isValidReadinessVenue({ accessStart: "09:30", readyBy: "11:00", availablePowerAmps: 32.5 }),
    false,
  );
});

test("compares operator keys without early string exits", async () => {
  assert.equal(await secureEqual("correct-horse-battery-staple", "correct-horse-battery-staple"), true);
  assert.equal(await secureEqual("correct-horse-battery-staple", "wrong-horse-battery-staple"), false);
});

test("limits starts per client and resets after the window", () => {
  const check = createRateLimiter(2, 1_000);
  assert.equal(check("client", 10_000).allowed, true);
  assert.equal(check("client", 10_100).allowed, true);
  assert.deepEqual(check("client", 10_200), { allowed: false, retryAfterSeconds: 1 });
  assert.equal(check("client", 11_000).allowed, true);
});
