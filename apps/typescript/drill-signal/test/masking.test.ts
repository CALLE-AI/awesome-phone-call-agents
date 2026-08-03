import assert from "node:assert/strict";
import test from "node:test";
import { maskPhone, isValidE164, redactEvidenceLine } from "../src/masking.js";

test("masks E.164 phones for display", () => {
  assert.equal(maskPhone("+15550100001"), "+*******0001");
});

test("validates fictional reserved E.164 numbers", () => {
  assert.equal(isValidE164("+15550100001"), true);
  assert.equal(isValidE164("5550100001"), false);
});

test("redacts phone numbers from evidence lines", () => {
  const line = redactEvidenceLine("user confirmed callback at +15550100001");
  assert.match(line, /\*/);
  assert.doesNotMatch(line, /\+15550100001/);
});
