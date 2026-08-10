import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalleClient } from "@call-e/calle";
import { CalleCallProvider } from "../src/providers.js";

const phone = "+18335550109";
const key = "stable-request-key";

function validPayload() {
  return {
    id: "call_test_1", object: "call_task" as const, status: "completed" as const,
    task: "Synthetic recall check",
    recipients: [{
      id: "recipient_1", phones: [phone], locale: "en-US", region: "US",
      status: "completed" as const, structuredResult: null,
      summary: "Synthetic completion", attempts: [],
    }],
    structuredResult: {
      eligibility: "confirmed", remedy: "repair",
      required_proof: "Photo of the model label",
      next_step: "Request the free repair kit", deadline: null,
      needs_human: false, case_reference: null, confidence: 0.91,
    },
    summary: "Synthetic completion", taskCompleted: true,
    completionConfidence: { score: 0.9, label: "high" },
    evidence: ["The fictional representative matched the supplied model."],
    metadata: {}, failureCode: null, failureMessage: null,
    createdAt: "2026-08-10T00:00:00Z", completedAt: "2026-08-10T00:01:00Z",
  };
}

test("live provider binds the approved recipient and SDK idempotency option", async () => {
  let capturedInput: unknown;
  let capturedOptions: unknown;
  const client = { calls: { createAndWait: async (input: unknown, options: unknown) => {
    capturedInput = input;
    capturedOptions = options;
    return validPayload();
  } } } as unknown as CalleClient;
  const provider = new CalleCallProvider("test-key", client);
  await provider.run(phone, "Synthetic recall check", key);
  assert.deepEqual((capturedInput as { recipient: unknown }).recipient, {
    phones: [phone], region: "US", locale: "en-US",
  });
  assert.equal((capturedInput as { task: string }).task, "Synthetic recall check");
  assert.equal((capturedInput as { task: string }).task.includes(phone), false);
  assert.deepEqual(capturedOptions, { idempotencyKey: key });
});
test("live provider rejects failed, incomplete, unbound, and invalid results", async () => {
  const cases = [
    { name: "failed status", patch: { status: "failed" } },
    { name: "incomplete task", patch: { taskCompleted: false } },
    { name: "wrong recipient", patch: { recipients: [{ ...validPayload().recipients[0], phones: ["+18335550110"] }] } },
    { name: "recipient failed", patch: { recipients: [{ ...validPayload().recipients[0], status: "failed" }] } },
    { name: "multiple recipients", patch: { recipients: [...validPayload().recipients, ...validPayload().recipients] } },
    { name: "invalid eligibility", patch: { structuredResult: { ...validPayload().structuredResult, eligibility: "maybe" } } },
    { name: "missing evidence", patch: { evidence: [] } },
    { name: "invalid confidence", patch: { structuredResult: { ...validPayload().structuredResult, confidence: 4 } } },
    { name: "invalid completion confidence", patch: { completionConfidence: { score: -1, label: "invalid" } } },
  ];
  for (const item of cases) {
    const client = { calls: { createAndWait: async () => ({ ...validPayload(), ...item.patch }) } } as unknown as CalleClient;
    const provider = new CalleCallProvider("test-key", client);
    await assert.rejects(() => provider.run(phone, "Synthetic recall check", key), /CALL-E result rejected/, item.name);
  }
});
