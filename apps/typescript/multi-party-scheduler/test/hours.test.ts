/**
 * Calling hours. The window is always read in its own zone: a party in Chicago is
 * not callable at 6am because the coordinator happens to run in London.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  clockOf,
  HoursError,
  localMinutes,
  parseClock,
  resolveCallingHours,
  withinCallingHours,
} from "../src/hours.js";

const ZONE = "America/Los_Angeles";
const NINE_AM_PACIFIC = Date.parse("2026-08-06T16:00:00Z");
const EIGHT_PM_PACIFIC = Date.parse("2026-08-07T03:00:00Z");

test("a clock time is read, never guessed", () => {
  assert.equal(parseClock("09:00", "calling_hours.start"), 540);
  assert.equal(parseClock("23:59", "calling_hours.end"), 1439);
  assert.throws(() => parseClock("9:00", "calling_hours.start"), HoursError);
  assert.throws(() => parseClock("24:00", "calling_hours.start"), HoursError);
  assert.throws(() => parseClock("evening", "calling_hours.start"), HoursError);
});

test("the window is read in its own zone, not the host zone", () => {
  const hours = resolveCallingHours({ start: "09:00", end: "20:00", timezone: ZONE }, "UTC", "party");
  assert.equal(localMinutes(NINE_AM_PACIFIC, ZONE), 540);
  assert.equal(withinCallingHours(hours, NINE_AM_PACIFIC), true);
  assert.equal(withinCallingHours(hours, NINE_AM_PACIFIC - 60_000), false);
  assert.equal(withinCallingHours(hours, EIGHT_PM_PACIFIC), false);
  assert.equal(clockOf(EIGHT_PM_PACIFIC, ZONE), "20:00");
});

test("a window that wraps past midnight is refused rather than guessed", () => {
  assert.throws(() => resolveCallingHours({ start: "21:00", end: "07:00" }, ZONE, "party"), HoursError);
  assert.throws(() => resolveCallingHours({ start: "09:00", end: "09:00" }, ZONE, "party"), HoursError);
});

test("a party who declares nothing gets a daytime window in the meeting zone", () => {
  const hours = resolveCallingHours(undefined, "Asia/Kolkata", "party");
  assert.deepEqual([hours.start, hours.end, hours.timezone], ["09:00", "20:00", "Asia/Kolkata"]);
  // 09:30 in Kolkata is 04:00 UTC, and it is inside the window there.
  assert.equal(withinCallingHours(hours, Date.parse("2026-08-06T04:00:00Z")), true);
  assert.equal(withinCallingHours(hours, Date.parse("2026-08-06T00:30:00Z")), false);
});
