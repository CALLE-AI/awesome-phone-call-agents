import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecipientBindings,
  verifyCallBinding,
  type CallSnapshot,
  type ExpectedCallBinding,
} from "../lib/live-call-binding.ts";

const secret = "correct-horse-battery-staple";
const expected: ExpectedCallBinding = {
  callId: "call_readyline_123",
  eventId: "north-hall-product-summit",
  stage: "readiness",
  operationId: "b7d680d1-5540-4bfd-a0be-7bd6fc7a5e71",
};

async function completedCall(): Promise<CallSnapshot> {
  const recipientBindings = await buildRecipientBindings(
    [
      { vendorId: "northstar-av", phone: "+442079460123" },
      { vendorId: "field-and-fork", phone: "+442079460456" },
    ],
    secret,
  );
  return {
    id: expected.callId,
    status: "completed",
    taskCompleted: true,
    metadata: {
      product: "readyline",
      event_id: expected.eventId,
      stage: expected.stage,
      operation_id: expected.operationId,
      recipient_bindings: recipientBindings,
    },
    recipients: [
      {
        phones: ["+442079460456"],
        status: "completed",
        structuredResult: { readiness: "ready", evidence: "Catering confirmed." },
        summary: "Catering reached",
      },
      {
        phones: ["+442079460123"],
        status: "completed",
        structuredResult: { readiness: "conditional", evidence: "AV needs coordination." },
        summary: "AV reached",
      },
    ],
  };
}

test("maps shuffled CALL-E recipients by signed phone binding, never array index", async () => {
  const result = await verifyCallBinding(await completedCall(), expected, secret);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.recipients.map((recipient) => recipient.vendorId),
    ["field-and-fork", "northstar-av"],
  );
});

test("rejects mismatched event, stage, and operation metadata", async () => {
  const call = await completedCall();
  for (const mismatch of [
    { ...expected, eventId: "different-event" },
    { ...expected, stage: "resolution" as const },
    { ...expected, operationId: "different-operation-123" },
  ]) {
    assert.deepEqual(await verifyCallBinding(call, mismatch, secret), {
      ok: false,
      error: "call_metadata_mismatch",
    });
  }
});

test("rejects a different CALL-E call ID", async () => {
  const call = await completedCall();
  call.id = "call_readyline_other";
  assert.deepEqual(await verifyCallBinding(call, expected, secret), {
    ok: false,
    error: "call_id_mismatch",
  });
});

test("rejects duplicate stored recipient bindings", async () => {
  const call = await completedCall();
  const bindings = call.metadata.recipient_bindings as Array<Record<string, string>>;
  call.metadata.recipient_bindings = [bindings[0], bindings[0]];
  assert.deepEqual(await verifyCallBinding(call, expected, secret), {
    ok: false,
    error: "recipient_binding_mismatch",
  });
});

test("rejects a completed CALL-E status without completed task evidence", async () => {
  const call = await completedCall();
  call.taskCompleted = false;
  assert.deepEqual(await verifyCallBinding(call, expected, secret), {
    ok: false,
    error: "call_task_not_completed",
  });
});

test("rejects any returned recipient that does not exactly match a signed binding", async () => {
  const call = await completedCall();
  call.recipients[0].phones = ["+442079460789"];
  assert.deepEqual(await verifyCallBinding(call, expected, secret), {
    ok: false,
    error: "recipient_phone_mismatch",
  });
});

test("rejects incomplete recipients on a completed call task", async () => {
  const call = await completedCall();
  call.recipients[0].status = "failed";
  assert.deepEqual(await verifyCallBinding(call, expected, secret), {
    ok: false,
    error: "recipient_not_completed",
  });
});
