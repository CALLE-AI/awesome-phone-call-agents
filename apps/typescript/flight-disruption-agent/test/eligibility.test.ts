import assert from "node:assert/strict";
import { test } from "node:test";
import { findBooking, loadCatalog } from "../src/data.ts";
import { checkEligibility, type EligibilityInput } from "../src/eligibility.ts";
import { voluntaryQuoteFor } from "../src/rules.ts";
import type { BookingState } from "../src/types.ts";

const catalog = loadCatalog();
const DAY_BEFORE = new Date("2026-09-19T08:00:00+07:00").getTime();

function input(pnr: string, overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  const booking = findBooking(catalog, pnr);
  const state: BookingState = {
    pnr,
    status: "ticketed",
    flightId: booking.flightId,
    currentPnr: pnr,
    ticket: booking.ticket,
    charges: [],
    refundAmount: null,
    notes: [],
  };
  return {
    catalog,
    booking,
    state,
    request: { kind: "reschedule", targetFlightId: "NA729-2026-09-20" },
    quote: voluntaryQuoteFor(catalog, booking),
    disrupted: false,
    now: DAY_BEFORE,
    ...overrides,
  };
}

test("a ticketed booking can move to a later flight with seats, and a cost is flagged", () => {
  const result = checkEligibility(input("T5W1LC"));
  assert.equal(result.eligible, true);
  assert.deepEqual(result.warnings, ["The change has a cost the passenger must accept."]);
});

test("a named flight that cannot be offered is refused; no flight means the passenger picks on the call", () => {
  assert.equal(checkEligibility(input("T5W1LC", { request: { kind: "reschedule", targetFlightId: "NA816-2026-09-20" } })).eligible, false);
  assert.equal(checkEligibility(input("T5W1LC", { request: { kind: "reschedule", targetFlightId: null } })).eligible, true);
  assert.equal(checkEligibility(input("T5W1LC", { request: { kind: "change", targetFlightId: null } })).eligible, true);
});

test("already changed, disrupted, departed, or inside the cutoff is refused", () => {
  const base = input("K7Q2XA");
  assert.match(checkEligibility({ ...base, state: { ...base.state!, status: "refunded" } }).reasons.join(), /already changed/);
  assert.match(checkEligibility({ ...base, disrupted: true }).reasons.join(), /disruption call/);
  assert.match(checkEligibility({ ...base, now: new Date("2026-09-20T09:00:00+07:00").getTime() }).reasons.join(), /departed/);
  assert.match(checkEligibility({ ...base, now: new Date("2026-09-20T07:30:00+07:00").getTime() }).reasons.join(), /cutoff/);
});

test("a non-refundable refund is eligible but warns that the refund is zero", () => {
  const result = checkEligibility(input("T5W1LC", { request: { kind: "refund", targetFlightId: null } }));
  assert.equal(result.eligible, true);
  assert.deepEqual(result.warnings, ["This fare is non-refundable: the refund is IDR 0."]);
});
