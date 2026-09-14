import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/decide.ts";
import type { CallOutcome, PassengerResult, Quote } from "../src/types.ts";

const quote: Quote = {
  pnr: "TEST01",
  changeCase: "voluntary",
  thresholdMinutes: 120,
  keep: { newDeparture: "2026-09-20T05:10:00.000Z", total: 0 },
  moves: [
    { id: "FREE", flightId: "FREE", label: "free flight", departure: "", seatsAvailable: 3, lines: [], total: 0 },
    { id: "PAID", flightId: "PAID", label: "paid flight", departure: "", seatsAvailable: 3, lines: [], total: 350_000 },
  ],
  refund: { gross: 1_000_000, lines: [{ party: "Airline", label: "keeps 50%", amount: -500_000 }], amount: 500_000 },
};

function outcome(result: Partial<PassengerResult>, extra: Partial<CallOutcome> = {}): CallOutcome {
  return {
    state: "completed",
    providerStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.9, label: "high" },
    result: { choice: "keep_delayed_flight", selected_flight: "none", fee_accepted: "not_applicable", human_requested: "no", reason: "", ...result },
    structured: null,
    summary: null,
    transcript: [],
    failureCode: null,
    failureMessage: null,
    ...extra,
  };
}

test("a clear keep is applied", () => {
  assert.deepEqual(decide(outcome({}), quote), { kind: "apply", action: { kind: "keep" } });
});

test("a paid move needs an explicit yes to the fee", () => {
  assert.equal(decide(outcome({ choice: "move_to_other_flight", selected_flight: "PAID", fee_accepted: "unknown" }), quote).kind, "review");
  assert.deepEqual(decide(outcome({ choice: "move_to_other_flight", selected_flight: "PAID", fee_accepted: "yes" }), quote), {
    kind: "apply",
    action: { kind: "move", optionId: "PAID" },
  });
  assert.equal(decide(outcome({ choice: "move_to_other_flight", selected_flight: "FREE", fee_accepted: "not_applicable" }), quote).kind, "apply");
});

test("a flight that was not offered is never booked", () => {
  assert.equal(decide(outcome({ choice: "move_to_other_flight", selected_flight: "OTHER", fee_accepted: "yes" }), quote).kind, "review");
});

test("a reduced refund needs the passenger to accept the amount", () => {
  assert.equal(decide(outcome({ choice: "refund", fee_accepted: "not_applicable" }), quote).kind, "review");
  assert.equal(decide(outcome({ choice: "refund", fee_accepted: "yes" }), quote).kind, "apply");
});

test("human requests, low confidence, and failed calls go to review", () => {
  assert.equal(decide(outcome({ human_requested: "yes" }), quote).kind, "review");
  assert.equal(decide(outcome({}, { confidence: { score: 0.5, label: "low" } }), quote).kind, "review");
  assert.equal(decide(outcome({}, { confidence: null }), quote).kind, "review");
  assert.equal(decide(outcome({}, { state: "failed", result: null, failureCode: "no_answer" }), quote).kind, "review");
  assert.equal(decide(outcome({}, { result: null }), quote).kind, "review");
});

test("keeping a cancelled flight is never applied", () => {
  const cancelledQuote: Quote = { ...quote, changeCase: "involuntary", keep: null };
  assert.equal(decide(outcome({ choice: "keep_delayed_flight" }), cancelledQuote).kind, "review");
});
