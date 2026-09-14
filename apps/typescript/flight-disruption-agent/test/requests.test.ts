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
