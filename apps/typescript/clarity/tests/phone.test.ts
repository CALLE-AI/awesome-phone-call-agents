import { test } from "node:test";
import assert from "node:assert/strict";
import { destination, isE164, maskPhone } from "../lib/phone";

test("E.164 accepts only a complete ASCII value without normalization", () => {
  assert.ok(isE164("+12025550100"));
  for (const input of [undefined, null, 12025550100, "2025550100", "+02025550100", "+12025550100\n", "+12025550100\r\n", " +12025550100", "+1 2025550100", "+1(202)555-0100", "+12025550100 ext 1", "+１２０２５５５０１００", "＋12025550100", "+12025550100\u200b", "+1234567890123456"]) {
    assert.equal(isE164(input), false, String(input));
  }
});

test("international routing comes from the canonical destination, with English language", () => {
  assert.deepEqual(destination("+12025550100"), { phone: "+12025550100", region: "US", locale: "en" });
  assert.deepEqual(destination("+442079460100"), { phone: "+442079460100", region: "GB", locale: "en" });
  assert.deepEqual(destination("+61255500100"), { phone: "+61255500100", region: "AU", locale: "en" });
});

test("unassigned, ambiguous and national-only destinations are rejected", () => {
  for (const phone of ["+15555550100", "+99912345678", "2079460100", "+80012345678"]) assert.throws(() => destination(phone));
  assert.equal(maskPhone("+442079460100"), "***0100");
});
