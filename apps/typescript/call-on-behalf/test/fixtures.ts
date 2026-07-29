/**
 * Shared fixtures. The clinic number is from the reserved 555-01xx range, so
 * nothing here can ring a real handset.
 */

import { parseRequest } from "../src/config.js";
import type { ErrandRequest, ErrandRequestInput } from "../src/types.js";

export const CLINIC = "+14155550122";

export function errandInput(overrides: Partial<ErrandRequestInput> = {}): ErrandRequestInput {
  return {
    errand_id: "bayview-checkup-aug",
    on_behalf_of: {
      name: "Fatima Haddad",
      reason_for_delegation: "she is deaf and this clinic takes bookings by phone only",
    },
    callee: {
      name: "Bayview Family Clinic",
      phone: CLINIC,
      published_source: "https://example.com/bayview-family-clinic/contact",
      region: "US",
    },
    goal: {
      summary: "book a routine check-up for Fatima Haddad, who is a new patient",
      commitment: "slot_within_windows",
    },
    disclosure: [
      { key: "full_name", label: "the caller's full name", value: "Fatima Haddad" },
      { key: "date_of_birth", label: "date of birth", value: "12 April 1990" },
      { key: "insurance_plan", label: "insurance plan name", value: "Blue Shield PPO" },
    ],
    questions: [
      { id: "earliest", text: "What is the earliest appointment you have for a routine check-up?", answer: "datetime" },
      { id: "accepts_plan", text: "Do you take Blue Shield PPO?", answer: "yes_no" },
      { id: "bring", text: "What should she bring to a first appointment?", answer: "text" },
    ],
    authorized_windows: [
      { from: "2026-08-12T09:00:00-07:00", to: "2026-08-12T17:00:00-07:00" },
      { from: "2026-08-13T09:00:00-07:00", to: "2026-08-13T17:00:00-07:00" },
    ],
    policy: { per_call_timeout_seconds: 300, language: "en-US", leave_voicemail: false },
    ...overrides,
  };
}

export function errandRequest(overrides: Partial<ErrandRequestInput> = {}): ErrandRequest {
  return parseRequest(errandInput(overrides));
}

/** A structured result that answers everything and accepts a slot inside a window. */
export function goodResult(datetime = "2026-08-13T09:40:00-07:00"): Record<string, unknown> {
  return {
    answer_earliest: "Thursday the thirteenth at nine forty in the morning",
    answer_accepts_plan: "yes",
    answer_bring: "photo identification and the insurance card",
    commitment_made: "accepted",
    offered_datetime: datetime,
    confirmation_code: "4471",
    callee_declined_automated: "no",
    notes: "",
  };
}
