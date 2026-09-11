import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { appointmentFixture, createInput, normalizeOutcome } from "../src/workflow.mjs";
import { handleWebhook } from "../src/webhook-handler.mjs";

let CalleClient;
try { ({ CalleClient } = await import(process.env.CALLE_SDK_TEST_MODULE || "@call-e/calle")); }
catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
const skip = CalleClient ? false : "Install dependencies to exercise the SDK against an in-memory transport.";

test("real SDK serializes our task and maps provider result without network", { skip }, async () => {
  const appointment = appointmentFixture();
  const input = createInput({ appointment, phone: "+12025550123", demoId: "sdk-contract-test" });
  let requests = 0;
  const client = new CalleClient({ apiKey: "local-test-only", baseUrl: "https://example.invalid",
    fetch: async (request) => {
      requests++;
      assert.equal(request.method, "POST");
      assert.equal(new URL(request.url).pathname, "/v1/calls");
      assert.equal(request.headers.get("Idempotency-Key"), "stable-test-id");
      const body = await request.json();
      assert.deepEqual(body.recipient_result_schema, input.recipientResultSchema);
      assert.deepEqual(body.recipients[0].phones, ["+12025550123"]);
      return Response.json({ id: "call_synthetic", object: "call_task", status: "completed", task: body.task,
        created_at: new Date().toISOString(), recipients: [{ id: "recipient_synthetic", phones: body.recipients[0].phones,
          status: "completed", attempts: [], structured_result: { outcome: "reschedule_requested", requested_slot: appointment.alternateSlots[0], needs_human: true } }] });
    },
  });
  const call = await client.calls.create(input, { idempotencyKey: "stable-test-id" });
  assert.equal(requests, 1);
  assert.equal(normalizeOutcome(call, appointment).outcome, "reschedule_requested");
});

test("real SDK accepts valid HMAC raw bytes and rejects altered body", { skip }, async () => {
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1_000));
  const rawBody = Buffer.from('{ "id": "evt_signed_test" }');
  const secret = "synthetic-test-secret-not-a-credential";
  const signature = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody])).digest("hex");
  let stored = 0;
  const input = { rawBody, secret, now, client: new CalleClient({ apiKey: "local-test-only" }),
    headers: { "call-e-timestamp": timestamp, "call-e-signature": `v1=${signature}` }, store: async () => { stored++; } };
  assert.equal((await handleWebhook(input)).status, 202);
  assert.equal((await handleWebhook({ ...input, rawBody: Buffer.from('{"id":"evt_signed_test"}') })).status, 401);
  assert.equal(stored, 1);
});
