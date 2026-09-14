import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAirlineResultSchema, buildAirlineTask, decideAirline } from "../src/airline.ts";
import { DryRunGateway } from "../src/calle.ts";
import { findBooking, loadCatalog } from "../src/data.ts";
import { voluntaryQuoteFor } from "../src/rules.ts";
import type { CallOutcome } from "../src/types.ts";

const catalog = loadCatalog();

function outcome(structured: Record<string, unknown> | null, extra: Partial<CallOutcome> = {}): CallOutcome {
  return {
    state: "completed",
    providerStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.9, label: "high" },
    result: null,
    structured,
    summary: null,
    transcript: [],
    failureCode: null,
    failureMessage: null,
    ...extra,
  };
}

const reissued = {
  outcome: "reissued",
  new_booking_code: "q7 m2 xa",
  new_ticket_number: "000 2419 000 111",
  airline_reference: "NA-DESK-5521",
  extra_charge_requested: "no",
  reason: "Agent said: I've reissued it to NA 729.",
};

test("a confirmed reissue with a clean booking code and ticket number is applied", () => {
  assert.deepEqual(decideAirline(outcome(reissued)), {
    kind: "reissued",
    newPnr: "Q7M2XA",
    ticket: "000-2419000111",
    reference: "NA-DESK-5521",
  });
});

test("refusals, call-backs, extra charges, bad codes, and failed calls go to review", () => {
  assert.equal(decideAirline(outcome({ ...reissued, outcome: "refused" })).kind, "review");
  assert.equal(decideAirline(outcome({ ...reissued, outcome: "callback_later" })).kind, "review");
  assert.equal(decideAirline(outcome({ ...reissued, extra_charge_requested: "yes" })).kind, "review");
  assert.equal(decideAirline(outcome({ ...reissued, new_ticket_number: "12345" })).kind, "review");
  assert.equal(decideAirline(outcome({ ...reissued, new_booking_code: "none" })).kind, "review");
  assert.equal(decideAirline(outcome(reissued, { confidence: { score: 0.4, label: "low" } })).kind, "review");
  assert.equal(decideAirline(outcome(null)).kind, "review");
  assert.equal(decideAirline(outcome(null, { state: "failed", failureCode: "no_answer" })).kind, "review");
});

test("the airline task discloses the AI, caps the charge, and never shares payment details", () => {
  const booking = findBooking(catalog, "P3X9GA");
  const option = voluntaryQuoteFor(catalog, booking).moves.find((m) => m.flightId === "NA729-2026-09-20");
  assert.ok(option);
  const task = buildAirlineTask(catalog, { booking, option, rejectionCode: "REISSUE_NOT_PERMITTED", rejectionMessage: "" });
  assert.match(task, /AI assistant calling the Nusantara Air travel agent service desk on behalf of TripKita/);
  assert.match(task, /Do not agree to any Nusantara Air charge above 350,000 rupiah/);
  assert.match(task, /Never give card numbers/);
  const schema = buildAirlineResultSchema() as { required: string[] };
  assert.ok(schema.required.includes("new_ticket_number"));
});

test("dry run scripts the airline desk from the booking fixture", async () => {
  const booking = findBooking(catalog, "P3X9GA");
  const option = voluntaryQuoteFor(catalog, booking).moves[0];
  assert.ok(option);
  const gateway = new DryRunGateway(0);
  const expectations: [string, string][] = [
    ["P3X9GA", "reissued"],
    ["C5V8EJ", "review"],
    ["L6F2KM", "review"],
  ];
  for (const [pnr, kind] of expectations) {
    const b = findBooking(catalog, pnr);
    const started = await gateway.start({
      task: "",
      phone: "+15550100900",
      region: "US",
      locale: "en-US",
      resultSchema: buildAirlineResultSchema(),
      metadata: {},
      idempotencyKey: pnr,
      simulation: { kind: "airline_desk", booking: b, option },
    });
    assert.equal(started.kind, "started");
    const decision = decideAirline(await gateway.get(started.kind === "started" ? started.callId : ""));
    assert.equal(decision.kind, kind, pnr);
  }
});
