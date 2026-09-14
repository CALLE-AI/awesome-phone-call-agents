import assert from "node:assert/strict";
import test from "node:test";
import { buildRecipientBindings, verifyCallBinding } from "../lib/live-binding.ts";

const secret = "correct-horse-battery-staple";

test("binds provider recipients to reviewed candidates without exposing phone metadata", async () => {
  const bindings = await buildRecipientBindings([
    { candidateId: "willow-room", phone: "+442079460123" },
    { candidateId: "alder-house", phone: "+442079460456" },
  ], secret);
  const result = await verifyCallBinding({
    id: "call-1",
    status: "completed",
    taskCompleted: true,
    metadata: { product: "tinyslot", campaign_id: "campaign-1", operation_id: "operation-123", stage: "search", recipient_bindings: bindings },
    recipients: [
      { phones: ["+442079460456"], status: "completed", structuredResult: {}, summary: null, attempts: [{ transcriptTurns: [{ offset_seconds: 3, speaker: "user", text: "We have an opening." }] }] },
      { phones: ["+442079460123"], status: "completed", structuredResult: {}, summary: null, attempts: [{ transcriptTurns: [{ offset_seconds: 1, speaker: "bot", text: "May I ask about availability?" }] }] },
    ],
  }, { callId: "call-1", campaignId: "campaign-1", operationId: "operation-123", stage: "search" }, secret);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.recipients.map((item) => item.candidateId), ["alder-house", "willow-room"]);
    assert.equal(result.recipients[0].transcriptTurns[0].speaker, "recipient");
    assert.equal(result.recipients[1].transcriptTurns[0].speaker, "agent");
  }
});

test("rejects a mismatched recipient and incomplete task", async () => {
  const bindings = await buildRecipientBindings([{ candidateId: "willow-room", phone: "+442079460123" }], secret);
  const base = {
    id: "call-1",
    status: "completed",
    taskCompleted: true,
    metadata: { product: "tinyslot", campaign_id: "campaign-1", operation_id: "operation-123", stage: "search", recipient_bindings: bindings },
    recipients: [{ phones: ["+442079460999"], status: "completed", structuredResult: {}, summary: null, attempts: [] }],
  };
  const mismatch = await verifyCallBinding(base, { callId: "call-1", campaignId: "campaign-1", operationId: "operation-123", stage: "search" }, secret);
  assert.deepEqual(mismatch, { ok: false, error: "recipient_phone_mismatch" });
  const incomplete = await verifyCallBinding({ ...base, taskCompleted: false, recipients: [{ ...base.recipients[0], phones: ["+442079460123"] }] }, { callId: "call-1", campaignId: "campaign-1", operationId: "operation-123", stage: "search" }, secret);
  assert.deepEqual(incomplete, { ok: false, error: "call_task_not_completed" });
});
