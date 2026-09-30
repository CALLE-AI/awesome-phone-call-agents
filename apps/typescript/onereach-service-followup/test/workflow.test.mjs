import test from "node:test";
import assert from "node:assert/strict";
import { appointmentFixture, createInput, normalizeOutcome, syntheticCall } from "../src/workflow.mjs";
import { handleWebhook } from "../src/webhook-handler.mjs";

const fixture = appointmentFixture(new Date("2026-09-08T00:00:00Z"));
test("rescheduling creates human action, never a claimed calendar booking", () => {
  const result = normalizeOutcome(syntheticCall(fixture), fixture);
  assert.equal(result.outcome, "reschedule_requested");
  assert.equal(result.requestedSlot, fixture.alternateSlots[0]);
  assert.equal(result.calendarUpdated, false);
  assert.equal(result.needsHuman, true);
});
test("unapproved alternate time fails to human review", () => {
  const call = syntheticCall(fixture);
  call.recipients[0].structuredResult.requested_slot = "invented-slot";
  assert.equal(normalizeOutcome(call, fixture).outcome, "needs_human");
});
test("opt out suppresses follow-up; pending calls do not encourage replacement", () => {
  const call = syntheticCall(fixture);
  call.recipients[0].structuredResult = { outcome: "opt_out", requested_slot: null, needs_human: false };
  assert.equal(normalizeOutcome(call, fixture).suppressFurtherContact, true);
  assert.equal(normalizeOutcome({ status: "in_progress" }, fixture).state, "pending");
});
test("invalid and ambiguous provider results require review", () => {
  for (const call of [{ status: "failed" }, { status: "completed", recipients: [] },
    { status: "completed", recipients: [{ structuredResult: { outcome: "confirmed" } }] }]) {
    assert.equal(normalizeOutcome(call, fixture).outcome, "needs_human");
  }
});
test("input preserves locale/schema and rejects invalid number or insecure webhook", () => {
  const args = { appointment: fixture, phone: "+12025550123", demoId: "synthetic-example" };
  const input = createInput(args);
  assert.equal(input.recipients[0].locale, "en-MY");
  assert.equal(input.metadata.synthetic, true);
  assert.equal(input.recipientResultSchema.additionalProperties, false);
  assert.throws(() => createInput({ ...args, phone: "not-a-number" }));
  assert.throws(() => createInput({ ...args, webhookUrl: "http://localhost" }));
});
test("webhook authenticates exact raw body before storage and deduplicates", async () => {
  const rawBody = Buffer.from('{ "id": "evt_example" }');
  const now = Date.now();
  const headers = { "call-e-timestamp": String(Math.floor(now / 1_000)) };
  let writes = 0;
  const input = { rawBody, headers, secret: "test-only", now,
    client: { webhooks: { unwrap: (request) => { assert.equal(request.rawBody, rawBody); return { id: "evt_example" }; } } },
    store: async () => { if (writes++) throw Object.assign(new Error("duplicate"), { code: "EEXIST" }); },
  };
  assert.equal((await handleWebhook(input)).status, 202);
  assert.equal((await handleWebhook(input)).body.duplicate, true);
  const invalid = { ...input, client: { webhooks: { unwrap: () => { throw new Error("invalid"); } } } };
  assert.equal((await handleWebhook(invalid)).status, 401);
  assert.equal(writes, 2);
  assert.equal((await handleWebhook({ ...input, now: now + 600_000 })).status, 401);
  assert.equal((await handleWebhook({ ...input, store: async () => { throw new Error("disk full"); } })).status, 503);
});
