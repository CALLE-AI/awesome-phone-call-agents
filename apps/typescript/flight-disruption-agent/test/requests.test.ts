import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunGateway } from "../src/calle.ts";
import { loadCatalog } from "../src/data.ts";
import { Desk } from "../src/desk.ts";

const DAY_BEFORE = new Date("2026-09-19T08:00:00+07:00").getTime();

function dryDesk() {
  return new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now: () => DAY_BEFORE });
}

/** Step 2: CALL-E calls the passenger and records the choice. */
async function agreeOnCall(desk: Desk, pnr: string, kind: "reschedule" | "refund" | "change", target: string | null = null) {
  const entry = desk.submitRequest(pnr, kind, target, "chat");
  assert.equal(entry.status, "awaiting_call");
  await desk.callPassengerForRequest(entry.request.id);
  return desk.refreshPassengerCall(entry.request.id);
}

test("a request is priced but nothing is agreed until CALL-E calls the passenger", () => {
  const desk = dryDesk();
  const entry = desk.submitRequest("L6F2KM", "change", null, "web_form");
  assert.equal(entry.status, "awaiting_call");
  assert.equal(entry.action, null);
  assert.equal(entry.amount, null);
  assert.ok(entry.quote.moves.length > 0);
  const preview = desk.previewPassengerCall(entry.request.id);
  assert.match(preview.task, /contacted TripKita through our web form/);
  assert.match(preview.task, /NA 729 at 19:45: costs 30,000 rupiah/);
});

test("customer -> CALL-E -> airline desk: an agreed move is reissued by the airline desk", async () => {
  const desk = dryDesk();
  const agreed = await agreeOnCall(desk, "L6F2KM", "reschedule", "NA729-2026-09-20");
  assert.equal(agreed.status, "confirmed_on_call");
  assert.equal(agreed.amount, 30_000, "flex fares only pay the TripKita admin fee");
  assert.equal(agreed.confirmedBy?.kind, "call");
  assert.equal(agreed.applied, null, "nothing changes until the airline desk confirms");

  const id = agreed.request.id;
  assert.equal(desk.previewAirlineCall(id).airline, "Nusantara Air");
  assert.match(desk.previewAirlineCall(id).task, /already agreed to the change and its cost/);
  const calling = await desk.callAirlineDesk(id);
  assert.equal(calling.status, "airline_call_in_progress");
  await assert.rejects(desk.callAirlineDesk(id), /at most once/);
  const done = await desk.refreshRequest(id);
  assert.equal(done.status, "completed");
  assert.match(done.applied ?? "", /Rebooked to NA 729 at 19:45: booking code Q6F2KZ, ticket 000-2419000108.*reference NA-DESK-0108/);
});

test("the airline desk is never called before the passenger agrees on the call", async () => {
  const desk = dryDesk();
  const entry = desk.submitRequest("L6F2KM", "reschedule", "NA729-2026-09-20", "chat");
  await assert.rejects(desk.callAirlineDesk(entry.request.id), /only after the passenger agreed/);
  await desk.callPassengerForRequest(entry.request.id);
  await assert.rejects(desk.callPassengerForRequest(entry.request.id), /at most once/);
});

test("a passenger who keeps the booking or asks for a person changes nothing", async () => {
  const desk = dryDesk();
  const kept = await agreeOnCall(desk, "K7Q2XA", "change");
  assert.equal(kept.status, "declined");
  assert.equal(desk.snapshot().bookings.find((b) => b.pnr === "K7Q2XA")?.state?.status, "ticketed");
  const person = await agreeOnCall(desk, "B9H4ZN", "change");
  assert.equal(person.status, "needs_review");
  assert.match(person.reviewReasons.join(), /human agent/);
  await assert.rejects(desk.callAirlineDesk(person.request.id), /only after the passenger agreed/);
  assert.equal(desk.resolveRequest(person.request.id, false, "Called the passenger").status, "resolved_by_human");
});

test("ineligible requests are recorded but never called, and open requests are not duplicated", async () => {
  const desk = dryDesk();
  const wrong = desk.submitRequest("L6F2KM", "reschedule", "NA816-2026-09-20", "chat");
  assert.equal(wrong.status, "ineligible");
  await assert.rejects(desk.callPassengerForRequest(wrong.request.id), /ineligible/);
  desk.submitRequest("L6F2KM", "refund", null, "chat");
  assert.throws(() => desk.submitRequest("L6F2KM", "change", null, "chat"), /open request/);
});

test("a booking on a disrupted flight is handled by the disruption call, not a request", () => {
  const desk = dryDesk();
  desk.reportDelay("NA721-2026-09-20", 240, "weather");
  assert.equal(desk.submitRequest("K7Q2XA", "refund", null, "chat").status, "ineligible");
});

test("an airline desk refusal goes to a person, who can close it or apply a manual reissue", async () => {
  const desk = dryDesk();
  const agreed = await agreeOnCall(desk, "C5V8EJ", "reschedule", "NA729-2026-09-20");
  const id = agreed.request.id;
  await desk.callAirlineDesk(id);
  const review = await desk.refreshRequest(id);
  assert.equal(review.status, "needs_review");
  assert.match(review.reviewReasons.join(), /refused/);
  assert.throws(() => desk.resolveRequest(id, true, "", { pnr: "bad", ticket: "1" }), /Booking code/);
  const resolved = desk.resolveRequest(id, true, "Desk supervisor approved by email", { pnr: "ZX12CV", ticket: "000-2419999999" });
  assert.equal(resolved.status, "resolved_by_human");
  assert.match(resolved.applied ?? "", /ZX12CV/);
});

test("an accepted refund is approved by the airline desk and then recorded", async () => {
  const desk = dryDesk();
  const agreed = await agreeOnCall(desk, "W4N7QS", "refund");
  assert.equal(agreed.status, "confirmed_on_call");
  assert.equal(agreed.amount, 1_912_000);
  const preview = desk.previewAirlineCall(agreed.request.id);
  assert.equal(preview.purpose, "airline_forced_refund");
  assert.match(preview.task, /approve the refund of 1,962,000 rupiah/);
  await desk.callAirlineDesk(agreed.request.id);
  const done = await desk.refreshRequest(agreed.request.id);
  assert.equal(done.status, "completed");
  assert.match(done.applied ?? "", /Refund of IDR 1,912,000 recorded.*reference NA-RF-0107/);
  assert.equal(desk.snapshot().bookings.find((b) => b.pnr === "W4N7QS")?.state?.status, "refunded");
});

test("the passenger can be called back once with the final result, which changes nothing", async () => {
  const desk = dryDesk();
  const agreed = await agreeOnCall(desk, "L6F2KM", "reschedule", "NA729-2026-09-20");
  const id = agreed.request.id;
  await assert.rejects(desk.callPassengerWithResult(id), /only after the request is finished/);
  await desk.callAirlineDesk(id);
  await desk.refreshRequest(id);
  const preview = desk.previewCallback(id);
  assert.match(preview.task, /New booking code: Q 6 F 2 K Z/);
  assert.match(preview.task, /only reports a result/);
  await desk.callPassengerWithResult(id);
  await assert.rejects(desk.callPassengerWithResult(id), /already called back/);
  const entry = await desk.refreshCallback(id);
  assert.deepEqual(entry.callbackVerdict, { kind: "delivered" });
  assert.equal(entry.status, "completed");
});

test("a callback that did not reach the passenger asks for written follow-up", async () => {
  const { decideCallback } = await import("../src/callback.ts");
  const base = { state: "completed" as const, providerStatus: "completed", taskCompleted: true, confidence: null, result: null, summary: null, transcript: [], failureCode: null, failureMessage: null };
  assert.equal(decideCallback({ ...base, structured: { reached_passenger: "no", acknowledged: "unknown", follow_up_requested: "unknown", reason: "" } }).kind, "follow_up");
  assert.equal(decideCallback({ ...base, structured: { reached_passenger: "yes", acknowledged: "yes", follow_up_requested: "yes", reason: "wants a person" } }).kind, "follow_up");
  assert.equal(decideCallback({ ...base, state: "failed", structured: null, failureCode: "no_answer" }).kind, "follow_up");
});
