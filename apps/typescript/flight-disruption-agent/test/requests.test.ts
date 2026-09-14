import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunGateway } from "../src/calle.ts";
import { loadCatalog } from "../src/data.ts";
import { Desk } from "../src/desk.ts";

const DAY_BEFORE = new Date("2026-09-19T08:00:00+07:00").getTime();

function dryDesk() {
  return new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now: () => DAY_BEFORE });
}

test("a confirmed reschedule the portal accepts rebooks the passenger", () => {
  const desk = dryDesk();
  const entry = desk.submitRequest("L6F2KM", "reschedule", "NA729-2026-09-20", "chat");
  assert.equal(entry.status, "quoted");
  assert.equal(entry.amount, 30_000, "flex fares only pay the TripKita admin fee");
  const done = desk.confirmRequest(entry.request.id, 30_000);
  assert.equal(done.status, "completed");
  assert.match(done.applied ?? "", /Rebooked to NA 729/);
});

test("the passenger must confirm exactly the quoted amount", () => {
  const desk = dryDesk();
  const entry = desk.submitRequest("C5V8EJ", "refund", null, "web_form");
  assert.equal(entry.amount, 0);
  assert.deepEqual(entry.eligibility.warnings, ["This fare is non-refundable: the refund is IDR 0."]);
  const paid = desk.submitRequest("P3X9GA", "reschedule", "NA729-2026-09-20", "phone");
  assert.equal(paid.amount, 350_000 + 35_000 + 30_000);
  assert.throws(() => desk.confirmRequest(paid.request.id, 350_000), /quoted amount of IDR 415,000/);
  assert.equal(desk.declineRequest(paid.request.id).status, "declined");
  assert.throws(() => desk.confirmRequest(paid.request.id, 415_000), /declined/);
});

test("a rejected reissue waits for the airline desk call and nothing changes yet", () => {
  const desk = dryDesk();
  const entry = desk.submitRequest("P3X9GA", "reschedule", "NA729-2026-09-20", "chat");
  const after = desk.confirmRequest(entry.request.id, 415_000);
  assert.equal(after.status, "portal_rejected");
  assert.equal(after.portal?.kind, "rejected");
  assert.equal(after.applied, null);
});

test("ineligible requests are recorded but never quoted, and open requests are not duplicated", () => {
  const desk = dryDesk();
  const wrong = desk.submitRequest("L6F2KM", "reschedule", "NA816-2026-09-20", "chat");
  assert.equal(wrong.status, "ineligible");
  assert.equal(wrong.action, null);
  desk.submitRequest("L6F2KM", "refund", null, "chat");
  assert.throws(() => desk.submitRequest("L6F2KM", "refund", null, "chat"), /open request/);
});

test("a booking on a disrupted flight is handled by the disruption call, not a request", () => {
  const desk = dryDesk();
  desk.reportDelay("NA721-2026-09-20", 240, "weather");
  assert.equal(desk.submitRequest("K7Q2XA", "refund", null, "chat").status, "ineligible");
});

async function rejectedReissue(desk: Desk, pnr: string, amount: number) {
  const entry = desk.submitRequest(pnr, "reschedule", "NA729-2026-09-20", "chat");
  desk.confirmRequest(entry.request.id, amount);
  return entry.request.id;
}

test("when the portal refuses, the airline desk call reissues the ticket with its own codes", async () => {
  const desk = dryDesk();
  const id = await rejectedReissue(desk, "P3X9GA", 415_000);
  assert.equal(desk.previewAirlineCall(id).airline, "Nusantara Air");
  const calling = await desk.callAirlineDesk(id);
  assert.equal(calling.status, "airline_call_in_progress");
  await assert.rejects(desk.callAirlineDesk(id), /at most once/);
  const done = await desk.refreshRequest(id);
  assert.equal(done.status, "completed");
  assert.match(done.applied ?? "", /booking code Q3X9GZ, ticket 000-2419000109.*reference NA-DESK-0109/);
});

test("an airline desk refusal goes to a person, who can close it or apply a manual reissue", async () => {
  const desk = dryDesk();
  const id = await rejectedReissue(desk, "C5V8EJ", 500_000 + 50_000 + 30_000);
  await desk.callAirlineDesk(id);
  const review = await desk.refreshRequest(id);
  assert.equal(review.status, "needs_review");
  assert.match(review.reviewReasons.join(), /refused/);
  assert.throws(() => desk.resolveRequest(id, true, "", { pnr: "bad", ticket: "1" }), /Booking code/);
  const resolved = desk.resolveRequest(id, true, "Desk supervisor approved by email", { pnr: "ZX12CV", ticket: "000-2419999999" });
  assert.equal(resolved.status, "resolved_by_human");
  assert.match(resolved.applied ?? "", /ZX12CV/);
});

test("the airline desk is only called for a change the portal refused", async () => {
  const desk = dryDesk();
  const entry = desk.submitRequest("L6F2KM", "reschedule", "NA729-2026-09-20", "chat");
  desk.confirmRequest(entry.request.id, 30_000);
  await assert.rejects(desk.callAirlineDesk(entry.request.id), /Only a change the portal refused/);
});

test("the passenger can be called back once with the final result, which changes nothing", async () => {
  const desk = dryDesk();
  const id = await rejectedReissue(desk, "P3X9GA", 415_000);
  await assert.rejects(desk.callPassengerWithResult(id), /only after the request is finished/);
  await desk.callAirlineDesk(id);
  await desk.refreshRequest(id);
  const preview = desk.previewCallback(id);
  assert.match(preview.task, /New booking code: Q 3 X 9 G Z/);
  assert.match(preview.task, /Amount charged for the change: 415,000 rupiah/);
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

test("a refund the portal refuses is approved by the airline desk and then recorded", async () => {
  const desk = dryDesk();
  const entry = desk.submitRequest("W4N7QS", "refund", null, "web_form");
  assert.equal(entry.amount, 1_912_000);
  const rejected = desk.confirmRequest(entry.request.id, 1_912_000);
  assert.equal(rejected.status, "portal_rejected");
  assert.equal(rejected.portal?.kind === "rejected" && rejected.portal.code, "REFUND_NOT_PERMITTED");

  const preview = desk.previewAirlineCall(entry.request.id);
  assert.equal(preview.purpose, "airline_forced_refund");
  assert.match(preview.task, /approve the refund of 1,962,000 rupiah/);
  await desk.callAirlineDesk(entry.request.id);
  const done = await desk.refreshRequest(entry.request.id);
  assert.equal(done.status, "completed");
  assert.match(done.applied ?? "", /Refund of IDR 1,912,000 recorded.*Refund approved by the airline desk, reference NA-RF-0107/);
  assert.equal(desk.snapshot().bookings.find((b) => b.pnr === "W4N7QS")?.state?.status, "refunded");
});
