import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPublishedUsPhone, maskPhone, normalizeUsPhone } from "../src/privacy.js";

test("normalizes and masks U.S. phone numbers", () => {
  assert.equal(normalizeUsPhone("(833) 555-0108"), "+18335550108");
  assert.equal(maskPhone("+18335550108"), "••• ••• 0108");
});

test("extracts only a callable published number", () => {
  assert.equal(extractPublishedUsPhone("Call 833.555.0108 weekdays"), "+18335550108");
  assert.equal(extractPublishedUsPhone("Email only: recall@example.invalid"), null);
});

test("rejects impossible North American numbers", () => {
  assert.equal(extractPublishedUsPhone("Call 123-555-0108"), null);
  assert.equal(normalizeUsPhone("555"), null);
});
