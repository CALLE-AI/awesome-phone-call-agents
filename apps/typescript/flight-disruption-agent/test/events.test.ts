import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunGateway } from "../src/calle.ts";
import { loadCatalog } from "../src/data.ts";
import { Desk } from "../src/desk.ts";
import { OpsEventError, parseOpsEvent, signPayload, verifySignature } from "../src/events.ts";

const catalog = loadCatalog();
const NOW = Date.parse("2026-09-19T08:00:00+07:00");

test("a correctly signed body within the time window is accepted", () => {
  const body = '{"id":"evt_1"}';
  const header = signPayload("s3cret", body, NOW / 1000);
  assert.deepEqual(verifySignature("s3cret", body, header, NOW), { ok: true });
});

test("wrong secret, tampered body, stale timestamp, and missing header are refused", () => {
  const body = '{"id":"evt_1"}';
  const header = signPayload("s3cret", body, NOW / 1000);
  assert.equal(verifySignature("other", body, header, NOW).ok, false);
  assert.equal(verifySignature("s3cret", '{"id":"evt_2"}', header, NOW).ok, false);
  assert.match(JSON.stringify(verifySignature("s3cret", body, header, NOW + 301_000)), /outside the allowed window/);
  assert.equal(verifySignature("s3cret", body, undefined, NOW).ok, false);
  assert.equal(verifySignature("s3cret", body, "t=abc,v1=zz", NOW).ok, false);
  assert.equal(verifySignature("s3cret", body, `t=${NOW / 1000},v1=not-hex`, NOW).ok, false);
});

test("events resolve the flight by id or by airline code and scheduled departure", () => {
  const byCode = parseOpsEvent(catalog, {
    id: "ops-001",
    type: "flight.cancelled",
    occurred_at: "2026-09-20T05:00:00+07:00",
    flight: { code: "na721", scheduled_departure: "2026-09-20T01:10:00Z" },
    cause: "force_majeure",
    reason: "volcanic ash on the route",
  });
  assert.equal(byCode.flightId, "NA721-2026-09-20");
  assert.equal(byCode.kind, "cancellation");
  assert.equal(byCode.cause, "force_majeure");
  const byId = parseOpsEvent(catalog, { id: "ops-002", type: "flight.delayed", occurred_at: "2026-09-20T05:00:00Z", flight: { id: "NA812-2026-09-20" }, delay_minutes: 150 });
  assert.equal(byId.delayMinutes, 150);
  assert.equal(byId.cause, "operational");
});

test("malformed events are refused with a reason", () => {
  const ok = { id: "ops-003", type: "flight.delayed", occurred_at: "2026-09-20T05:00:00Z", flight: { id: "NA721-2026-09-20" }, delay_minutes: 90 };
  assert.throws(() => parseOpsEvent(catalog, { ...ok, id: "bad id!" }), OpsEventError);
  assert.throws(() => parseOpsEvent(catalog, { ...ok, type: "flight.diverted" }), /type/);
  assert.throws(() => parseOpsEvent(catalog, { ...ok, flight: { id: "XX1" } }), /not in the schedule/);
  assert.throws(() => parseOpsEvent(catalog, { ...ok, delay_minutes: "soon" }), /delay_minutes/);
  assert.throws(() => parseOpsEvent(catalog, { ...ok, cause: "strike" }), /cause/);
  assert.throws(() => parseOpsEvent(catalog, [ok]), /JSON object/);
});

function dryDesk() {
  return new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now: () => NOW });
}

const cancelEvent = () =>
  parseOpsEvent(catalog, {
    id: "ops-100",
    type: "flight.cancelled",
    occurred_at: "2026-09-19T07:55:00+07:00",
    flight: { id: "NA721-2026-09-20" },
    cause: "force_majeure",
    reason: "volcanic ash on the route",
  });

test("an ops event records a disruption once, and a retried delivery changes nothing", () => {
  const desk = dryDesk();
  const first = desk.receiveOpsEvent(cancelEvent());
  assert.equal(first.duplicate, false);
  assert.equal(first.record.status, "created");
  assert.equal(first.record.disruptionId, "evt_NA721-2026-09-20_fm_cancelled");
  const retry = desk.receiveOpsEvent(cancelEvent());
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.record, first.record);
  const snap = desk.snapshot();
  assert.equal(snap.disruptions.length, 1);
  assert.deepEqual(snap.disruptions[0]?.source, { kind: "airline_webhook", eventId: "ops-100", receivedAt: new Date(NOW).toISOString() });
  assert.equal(snap.opsEvents.length, 1);
  assert.equal(snap.disruptions[0]?.bookings.every((b) => b.entry === null), true, "events never start calls");
});

test("a cancellation event for a delayed flight escalates it; a milder event is flagged", () => {
  const desk = dryDesk();
  desk.reportDelay("NA721-2026-09-20", 240, "a late inbound aircraft");
  const { record } = desk.receiveOpsEvent(cancelEvent());
  assert.equal(record.status, "escalated");
  assert.equal(record.disruptionId, "evt_NA721-2026-09-20_fm_cancelled");
  assert.match(record.message, /replacing evt_NA721-2026-09-20_240/);
  assert.equal(desk.snapshot().flights.find((f) => f.id === "NA721-2026-09-20")?.disruption?.kind, "cancellation");

  const milder = parseOpsEvent(catalog, { id: "ops-200", type: "flight.delayed", occurred_at: "2026-09-19T07:58:00Z", flight: { id: "NA721-2026-09-20" }, delay_minutes: 60 });
  const flagged = desk.receiveOpsEvent(milder).record;
  assert.equal(flagged.status, "conflict");
  assert.match(flagged.message, /does not make it worse/);
});

test("an event the desk cannot record is kept as rejected with the reason", () => {
  const desk = dryDesk();
  const tooShort = parseOpsEvent(catalog, { id: "ops-101", type: "flight.delayed", occurred_at: "2026-09-19T07:55:00Z", flight: { id: "NA721-2026-09-20" }, delay_minutes: 5 });
  const { record } = desk.receiveOpsEvent(tooShort);
  assert.equal(record.status, "rejected");
  assert.match(record.message, /between 15 and 1440/);
  const noPax = parseOpsEvent(catalog, { id: "ops-102", type: "flight.cancelled", occurred_at: "2026-09-19T07:55:00Z", flight: { id: "NA816-2026-09-20" } });
  assert.match(desk.receiveOpsEvent(noPax).record.message, /no bookings/);
});

test("live modes never accept the published dry-run webhook secret", async () => {
  const { webhookSecretFromEnv } = await import("../src/config.ts");
  assert.deepEqual(webhookSecretFromEnv(false, {}), { secret: "dry-run-webhook-secret", demo: true });
  assert.deepEqual(webhookSecretFromEnv(true, {}), { secret: null, demo: false });
  assert.deepEqual(webhookSecretFromEnv(true, { AIRLINE_WEBHOOK_SECRET: "dry-run-webhook-secret" }), { secret: null, demo: false });
  assert.deepEqual(webhookSecretFromEnv(true, { AIRLINE_WEBHOOK_SECRET: "real" }), { secret: "real", demo: false });
});
