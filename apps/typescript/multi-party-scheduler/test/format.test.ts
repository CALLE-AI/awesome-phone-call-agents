/**
 * Output. Anything that leaves the process masks the numbers, JSON included, and
 * nothing claims a booking exists.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { redactRequest, renderPlan, renderResult } from "../src/format.js";
import type { RunResult } from "../src/types.js";
import { coordinationRequest, PLUMBER } from "./fixtures.js";

test("json output masks phone numbers and leaves the request alone", () => {
  const request = coordinationRequest();
  const json = JSON.stringify(redactRequest(request), null, 2);
  assert.equal(json.includes(PLUMBER), false, "plan --json must not print a full number");
  assert.match(json, /\+14\*+01/);
  assert.equal(request.parties[0]!.phone, PLUMBER, "the request itself is untouched");
});

test("the plan shows the calling window and the consent it will enforce", () => {
  const plan = renderPlan(coordinationRequest());
  assert.match(plan, /callable 00:00 to 23:59 UTC, consent recorded/);
  assert.equal(plan.includes(PLUMBER), false);
});

test("a confirmed run is printed as a verbal confirmation, not a booking", () => {
  const result: RunResult = {
    request_id: "ash-lane-3b-leak",
    outcome: "verbally_confirmed",
    slot_id: "thu-14",
    slot_spoken: "option 2, Thursday, August 6 at 2:00 PM",
    confirmed_with: ["plumber", "tenant", "superintendent"],
    unreleased: [],
    calls_placed: 6,
    calls_saved: 2,
    note: "every party confirmed the time by voice, 3 of 3",
    ledger_path: null,
  };
  const text = renderResult(result);
  assert.match(text, /Outcome {6}verbally_confirmed/);
  assert.match(text, /Agreed {7}option 2, Thursday, August 6 at 2:00 PM/);
  assert.match(text, /Nothing is booked in any system\./);
  assert.equal(/\bBooked\b/.test(text), false);
});
