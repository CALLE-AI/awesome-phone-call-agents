import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog } from "../src/data.ts";
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
