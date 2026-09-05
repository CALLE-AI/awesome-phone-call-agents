import assert from "node:assert/strict";
import test from "node:test";
import {
  isCompletedRecoveryOption,
  parseArrivalMinutes,
  resolveRecipientConfiguration,
} from "../lib/recovery-rules.js";

test("maps supported Oman, UAE, and US test destinations", () => {
  assert.deepEqual(resolveRecipientConfiguration("+96890000000"), { region: "OM", locale: "en-OM" });
  assert.deepEqual(resolveRecipientConfiguration("+971501234567"), { region: "AE", locale: "en-AE" });
  assert.deepEqual(resolveRecipientConfiguration("+14155550100"), { region: "US", locale: "en-US" });
});

test("parses 24-hour and 12-hour arrival times", () => {
  assert.equal(parseArrivalMinutes("07:50"), 470);
  assert.equal(parseArrivalMinutes("7:50 AM"), 470);
  assert.equal(parseArrivalMinutes("10:30"), 630);
  assert.equal(parseArrivalMinutes("not returned"), null);
});

test("accepts only a complete option before the deadline and within budget", () => {
  const valid = {
    viable: true,
    provider_name: "Northstar Airlines",
    arrival_time: "07:50",
    extra_cost: 286,
    confirmation_reference: "PLAN-B-4821",
  };
  assert.equal(isCompletedRecoveryOption(valid, 400, 540), true);
  assert.equal(isCompletedRecoveryOption({ ...valid, arrival_time: "10:30" }, 400, 540), false);
  assert.equal(isCompletedRecoveryOption({ ...valid, extra_cost: 401 }, 400, 540), false);
  assert.equal(isCompletedRecoveryOption({ ...valid, confirmation_reference: "" }, 400, 540), false);
});
