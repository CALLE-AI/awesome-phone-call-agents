import assert from "node:assert/strict";
import test from "node:test";

import { resolveReminderTime } from "../lib/tools/reminder-time";

test("reminder time resolves a future weekday in the senior timezone", () => {
  assert.deepEqual(resolveReminderTime(
    "Friday at 10:30 am",
    "Australia/Sydney",
    new Date("2026-09-10T00:00:00.000Z"),
  ), {
    scheduledFor: "2026-09-11T00:30:00.000Z",
    status: "ready",
    timezone: "Australia/Sydney",
  });
});

test("ambiguous meridiem and past dates require clarification", () => {
  assert.match(resolveReminderTime("Friday at 10", "Australia/Sydney").status, /needs_clarification/);
  assert.match(resolveReminderTime("Friday at 10:30", "Australia/Sydney").status, /needs_clarification/);
  const past = resolveReminderTime("2026-09-09 at 10:00", "Australia/Sydney", new Date("2026-09-10T00:00:00Z"));
  assert.equal(past.status, "needs_clarification");
});

test("DST gaps and overlaps require clarification", () => {
  const gap = resolveReminderTime("2026-10-04 at 2:30 am", "Australia/Sydney", new Date("2026-09-01T00:00:00Z"));
  assert.equal(gap.status, "needs_clarification");
  if (gap.status === "needs_clarification") assert.match(gap.message, /does not exist/);

  const overlap = resolveReminderTime("2027-04-04 at 2:30 am", "Australia/Sydney", new Date("2027-03-01T00:00:00Z"));
  assert.equal(overlap.status, "needs_clarification");
  if (overlap.status === "needs_clarification") assert.match(overlap.message, /occurs twice/);
});
