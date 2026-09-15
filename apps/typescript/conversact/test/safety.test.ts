import assert from "node:assert/strict";
import test from "node:test";
import { assertE164, assertUsableConsent, maskPhone, providerIdempotencyKey, SafetyError } from "../src/safety.js";
import type { CallConsent } from "../src/types.js";

const consent: CallConsent = {
  sessionId: "cv_test_001",
  recipientPhone: "+14155550100",
  purpose: "conversational_checkout",
  authorizedAt: "2026-01-01T00:00:00.000Z",
};

test("strict E.164 is accepted and country codes are never inferred", () => {
  assert.equal(assertE164("+14155550100"), "+14155550100");
  for (const phone of ["0812345678", "555-0123", "+1 (415) 555-0100"]) {
    assert.throws(() => assertE164(phone), SafetyError);
  }
});

test("masking does not expose a full phone number", () => {
  const masked = maskPhone("+14155550100");
  assert.equal(masked, "+1••••••••00");
  assert.equal(masked.includes("4155550100"), false);
});

test("consent is purpose and recipient bound and cannot be reused", () => {
  assert.doesNotThrow(() => assertUsableConsent(consent, consent.recipientPhone));
  assert.throws(() => assertUsableConsent(consent, "+14155550101"), /recipient/);
  assert.throws(() => assertUsableConsent({ ...consent, consumedAt: "2026-01-02T00:00:00.000Z" }, consent.recipientPhone), /consumed/);
});

test("the same workflow derives the same provider identity", () => {
  assert.equal(providerIdempotencyKey("cv_test_001"), providerIdempotencyKey("cv_test_001"));
  assert.notEqual(providerIdempotencyKey("cv_test_001"), providerIdempotencyKey("cv_test_002"));
});
