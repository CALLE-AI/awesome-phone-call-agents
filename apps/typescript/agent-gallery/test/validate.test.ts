import assert from "node:assert/strict";
import test from "node:test";
import { isE164, isIanaTimezone, validateRequest } from "../src/workflows/appointment-recovery/validate";
import type { RecoveryRequest } from "../src/workflows/appointment-recovery/types";

const NOW = new Date("2026-08-04T12:00:00+08:00");

function validRequest(): RecoveryRequest {
  return {
    request_key: "6f2c8a1e-0000-0000-0000-000000000000",
    business: {
      name: "Glow & Co. Hair Studio",
      timezone: "Asia/Singapore",
      callback_number_e164: "+6560000000",
    },
    customer: {
      given_name: "Mei",
      phone_e164: "+6580000000",
      consent_confirmed: true,
    },
    appointment: {
      service: "Cut and color",
      original_time: "2026-08-03T14:00:00+08:00",
      status: "missed",
    },
    replacement_windows: [
      { start: "2026-08-07T10:00:00+08:00", end: "2026-08-07T12:00:00+08:00" },
    ],
  };
}

test("accepts a complete valid request", () => {
  assert.deepEqual(validateRequest(validRequest(), NOW), []);
});

test("E.164 validation rejects local formats and accepts international ones", () => {
  assert.ok(isE164("+6580000000"));
  assert.ok(isE164("+14155550123"));
  assert.ok(!isE164("80000000"));
  assert.ok(!isE164("+0123456"));
  assert.ok(!isE164("+65 8000 0000"));
});

test("timezone validation requires a real IANA name", () => {
  assert.ok(isIanaTimezone("Asia/Singapore"));
  assert.ok(!isIanaTimezone("Singapore Standard Time"));
});

test("rejects missing consent", () => {
  const request = validRequest();
  request.customer.consent_confirmed = false;
  const errors = validateRequest(request, NOW);
  assert.ok(errors.some((error) => error.includes("authority")));
});

test("rejects windows in the past and inverted windows", () => {
  const request = validRequest();
  request.replacement_windows = [
    { start: "2026-08-01T10:00:00+08:00", end: "2026-08-01T12:00:00+08:00" },
    { start: "2026-08-07T12:00:00+08:00", end: "2026-08-07T10:00:00+08:00" },
  ];
  const errors = validateRequest(request, NOW);
  assert.ok(errors.some((error) => error.includes("future")));
  assert.ok(errors.some((error) => error.includes("end after it starts")));
});

test("rejects more than three replacement windows", () => {
  const request = validRequest();
  const window = { start: "2026-08-07T10:00:00+08:00", end: "2026-08-07T12:00:00+08:00" };
  request.replacement_windows = [window, window, window, window];
  const errors = validateRequest(request, NOW);
  assert.ok(errors.some((error) => error.includes("at most 3")));
});

test("rejects an empty window list", () => {
  const request = validRequest();
  request.replacement_windows = [];
  const errors = validateRequest(request, NOW);
  assert.ok(errors.some((error) => error.includes("At least one")));
});
