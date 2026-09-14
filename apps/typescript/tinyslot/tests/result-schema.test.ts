import assert from "node:assert/strict";
import test from "node:test";
import { fixtureResults } from "../lib/fixtures.ts";
import { parseCenterResult, parseTourResult } from "../lib/result-schema.ts";

function providerShape() {
  const result = fixtureResults["willow-room"];
  return {
    line_outcome: result.lineOutcome,
    business_confirmed: result.businessConfirmed,
    age_band_accepted: result.ageBandAccepted,
    vacancy_status: result.vacancyStatus,
    earliest_start_date: result.earliestStartDate,
    available_weekdays: result.availableWeekdays,
    opening_time: result.openingTime,
    closing_time: result.closingTime,
    monthly_tuition_minor: result.monthlyTuitionMinor,
    registration_fee_minor: result.registrationFeeMinor,
    subsidy_status: result.subsidyStatus,
    tour_status: result.tourStatus,
    tour_windows: result.tourWindows,
    availability_evidence: result.availabilityEvidence,
    schedule_evidence: result.scheduleEvidence,
    fee_evidence: result.feeEvidence,
  };
}

test("maps a strict CALL-E center result to the domain shape", () => {
  const parsed = parseCenterResult(providerShape());
  assert.equal(parsed?.vacancyStatus, "available");
  assert.equal(parsed?.monthlyTuitionMinor, 142000);
});

test("rejects unknown fields and invalid enum values", () => {
  assert.equal(parseCenterResult({ ...providerShape(), invented: true }), null);
  assert.equal(parseCenterResult({ ...providerShape(), vacancy_status: "probably" }), null);
});

test("requires separate schema-valid evidence for a tour outcome", () => {
  assert.deepEqual(parseTourResult({
    outcome: "confirmed",
    confirmed_window: "Thursday at 10:00",
    next_step: "Ask for Maya.",
    reference: "Tour with Maya",
    evidence: "I have you down for Thursday at ten.",
  }), {
    outcome: "confirmed",
    confirmedWindow: "Thursday at 10:00",
    nextStep: "Ask for Maya.",
    reference: "Tour with Maya",
    evidence: "I have you down for Thursday at ten.",
  });
  assert.equal(parseTourResult({ outcome: "confirmed" }), null);
});
