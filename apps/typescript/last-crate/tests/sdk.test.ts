import { test } from "node:test";
import assert from "node:assert/strict";
import { CalleClient } from "@call-e/calle";
import { donorSchema, verifyDonor } from "../workflow.ts";
test("official SDK emits the Calls API contract and maps human transcript turns", async () => {
  const speech =
    "Yes, all 48 loaves are ready at 17:30, collect before 18:30. I will set them aside.";
  let captured: any;
  const client = new CalleClient({
    apiKey: "fixture-key-never-sent",
    fetch: async (request) => {
      captured = {
        url: request.url,
        key: request.headers.get("Idempotency-Key"),
        body: await request.json(),
      };
      return Response.json({
        id: "call_offline_contract",
        object: "call_task",
        status: "completed",
        task: captured.body.task,
        created_at: new Date().toISOString(),
        recipients: [
          {
            id: "r1",
            phones: ["+12025550101"],
            status: "completed",
            attempts: [
              {
                id: "a1",
                phone: "+12025550101",
                status: "completed",
                transcript_turns: [
                  { offset_seconds: 12, speaker: "user", text: speech },
                ],
              },
            ],
          },
        ],
        structured_result: {
          answer: "confirmed",
          quantity: 48,
          ready: "17:30",
          cutoff: "18:30",
          breadOnly: "yes",
          release: "yes",
          evidence: speech,
        },
      });
    },
  });
  const call = await client.calls.create(
    {
      task: "Offline contract test",
      resultSchema: donorSchema,
      recipients: [{ phones: ["+12025550101"], region: "US", locale: "en-US" }],
    },
    { idempotencyKey: "saved-operation-key" },
  );
  assert.equal(captured.url, "https://api.heycall-e.com/v1/calls");
  assert.equal(captured.key, "saved-operation-key");
  assert.deepEqual(captured.body.result_schema, donorSchema);
  assert.equal(call.id, "call_offline_contract");
  assert.equal(verifyDonor(call).ok, true);
});
test("official SDK exposes call_not_ready without manufacturing a call ID", async () => {
  const client = new CalleClient({
    apiKey: "fixture-key-never-sent",
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "call_not_ready",
            message: "Unsupported destination/language combination.",
            details: {},
          },
        },
        { status: 422 },
      ),
  });
  await assert.rejects(
    () => client.calls.create({ task: "Offline rejected request" }),
    (e) => (e as any).code === "call_not_ready",
  );
});
