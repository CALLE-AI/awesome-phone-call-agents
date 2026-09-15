import assert from "node:assert/strict";
import test from "node:test";

import { scheduledCallDispatchDecision, validateScheduledFor } from "../lib/calle/schedule-types";

const now = new Date("2026-09-11T00:00:00.000Z");

test("scheduled calls accept an explicit future UTC instant", () => {
  assert.equal(validateScheduledFor("2026-09-11T00:05:00.000Z", now), "2026-09-11T00:05:00.000Z");
});

test("scheduled calls run only inside a fifteen-minute late window", () => {
  assert.equal(scheduledCallDispatchDecision("2026-09-11T00:01:00.000Z", now), "not_due");
  assert.equal(scheduledCallDispatchDecision("2026-09-10T23:50:00.000Z", now), "due");
  assert.equal(scheduledCallDispatchDecision("2026-09-10T23:44:59.999Z", now), "expired");
});

test("scheduled calls reject malformed, immediate, past, and excessively distant times", () => {
  assert.throws(() => validateScheduledFor("tomorrow", now));
  assert.throws(() => validateScheduledFor("2026-09-11T00:00:04.999Z", now));
  assert.throws(() => validateScheduledFor("2026-09-10T23:59:59.000Z", now));
  assert.throws(() => validateScheduledFor("2028-01-01T00:00:00.000Z", now));
});
