import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTask,
  isSupportedRegion,
  isValidPhone,
  maskPhone,
  normalizePhone,
} from "../src/workflow.js";

test("normalizes and masks phone numbers", () => {
  const phone = normalizePhone("+60 10-000 0000");
  assert.equal(phone, "+60100000000");
  assert.equal(maskPhone(phone), "+601******000");
});

test("validates region-specific E.164 shapes", () => {
  assert.equal(isSupportedRegion("MY"), true);
  assert.equal(isSupportedRegion("TW"), false);
  assert.equal(isValidPhone("+60100000000", "MY"), true);
  assert.equal(isValidPhone("+6512345678", "MY"), false);
});

test("task discloses automation and limits sensitive collection", () => {
  const task = buildTask("Example Founder", "Test a product sprint");
  assert.match(task, /automated AI call from VibeHub/i);
  assert.match(task, /under one minute/i);
  assert.match(task, /sensitive information/i);
});
