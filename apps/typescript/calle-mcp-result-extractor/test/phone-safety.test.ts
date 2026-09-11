import assert from "node:assert/strict";
import { test } from "node:test";
import { assertE164, isE164, maskPhoneNumbersInText } from "../src/phone-safety.js";

test("isE164 accepts valid E.164 numbers", () => {
  assert.equal(isE164("+15555550123"), true);
  assert.equal(isE164("+442071838750"), true);
});

test("isE164 rejects malformed numbers", () => {
  assert.equal(isE164("5555550123"), false); // missing +
  assert.equal(isE164("+0123456789"), false); // leading 0 after +
  assert.equal(isE164("+1 555 555 0123"), false); // spaces
  assert.equal(isE164("not-a-phone"), false);
});

test("assertE164 throws with a clear, local-only message on a bad number", () => {
  assert.throws(() => assertE164("555-0123", "--to"), /--to must be an E\.164 phone number/);
});

test("assertE164's error message never echoes the rejected value back", () => {
  const distinctiveBadValue = "555-0199-not-e164";
  try {
    assertE164(distinctiveBadValue, "--to");
    assert.fail("expected assertE164 to throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.doesNotMatch(
      message,
      new RegExp(distinctiveBadValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the invalid input must never be echoed back, even partially — it may still be a real, " +
        "just malformed, phone number, and it wouldn't reliably match the phone mask either",
    );
  }
});

test("assertE164 does not throw on a valid number", () => {
  assert.doesNotThrow(() => assertE164("+15555550123", "--to"));
});

test("maskPhoneNumbersInText masks every E.164 substring and keeps the rest of the text intact", () => {
  const raw = JSON.stringify({
    run_id: "run_abc123",
    result: {
      summary: "Confirmed. Callback number given as +15555550199 if needed.",
      to_phones: ["+15555550123"],
    },
  });

  const masked = maskPhoneNumbersInText(raw);

  assert.doesNotMatch(masked, /\+15555550199/);
  assert.doesNotMatch(masked, /\+15555550123/);
  assert.match(masked, /run_abc123/); // non-phone content untouched
  // Start and end digits stay visible for correlation, middle is masked.
  assert.match(masked, /\+155•+99/);
  assert.match(masked, /\+155•+23/);
});

test("maskPhoneNumbersInText leaves text with no phone numbers unchanged", () => {
  const text = JSON.stringify({ plan_id: "plan_xyz", ready_to_run: true });
  assert.equal(maskPhoneNumbersInText(text), text);
});
