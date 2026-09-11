import assert from "node:assert/strict";
import test from "node:test";

import { parseCalleCallSnapshot } from "../lib/calle/status";
import { composePostCallSummary, InMemoryPostCallStore, PostCallFinalizer } from "../lib/post-call/finalizer";
import type { AuthorizedSmsRequest } from "../lib/tools/sms-service";

const completedCall = parseCalleCallSnapshot({
  id: "call_post123",
  status: "completed",
  task_completed: true,
  summary: "The recipient confirmed the library visit.",
  recipients: [],
});
const callContext = {
  callSessionId: "30000000-0000-4000-8000-000000000001",
  seniorId: "20000000-0000-4000-8000-000000000001",
};

test("post-call summary contains only terminal evidence and explicit action states", () => {
  const result = composePostCallSummary({
    ...callContext,
    call: completedCall,
    actions: [
      { label: "Library reminder saved", status: "completed" },
      { label: "Information message", status: "pending" },
      { label: "Venue callback", status: "failed" },
    ],
  });
  assert.match(result.summary, /^Call outcome: completed\./);
  assert.match(result.summary, /Completed action: Library reminder saved\./);
  assert.match(result.summary, /Pending action: Information message\./);
  assert.match(result.summary, /Failed action: Venue callback\./);
  assert.ok(result.smsMessage.length <= 480);
});

test("pending calls cannot finalize and incomplete calls remain honest", () => {
  assert.throws(() => composePostCallSummary({
    ...callContext,
    call: parseCalleCallSnapshot({ id: "call_pending", status: "in_progress", recipients: [] }),
    actions: [],
  }), /not terminal/);
  const incomplete = composePostCallSummary({
    ...callContext,
    call: parseCalleCallSnapshot({ id: "call_incomplete", status: "completed", task_completed: false, recipients: [] }),
    actions: [],
  });
  assert.match(incomplete.summary, /Call outcome: incomplete/);
  assert.match(incomplete.summary, /No reliable conversation summary/);
});

test("repeated finalization and opted-in SMS delivery are deduplicated", async () => {
  let sends = 0;
  const store = new InMemoryPostCallStore();
  const finalizer = new PostCallFinalizer(store, {
    async dispatch() { sends += 1; return { status: "queued" }; },
  }, () => Date.parse("2026-09-11T02:00:00.000Z"));
  const input = { ...callContext, call: completedCall, actions: [{ label: "Reminder saved", status: "completed" as const }] };
  const first = await finalizer.finalize(input);
  const duplicate = await finalizer.finalize(input);
  assert.equal(duplicate.id, first.id);

  const sms: AuthorizedSmsRequest = {
    authorizationId: "authorization-post-call",
    principalId: "family-1",
    seniorId: "senior-1",
    correlationId: "11111111-1111-4111-8111-111111111111",
    destinationE164: "+12025550123",
    idempotencyKey: "sms:post-call:one",
    message: first.smsMessage,
    purpose: "Send the opted-in post-call summary",
  };
  await assert.rejects(finalizer.sendOptedInFollowup(first, false, sms), /opt-in/);
  const sent = await finalizer.sendOptedInFollowup(first, true, sms);
  await finalizer.sendOptedInFollowup(sent, true, sms);
  assert.equal(sent.smsStatus, "queued");
  assert.equal(sends, 1);
});

test("concurrent call-end workers reserve one SMS dispatch", async () => {
  let sends = 0;
  const store = new InMemoryPostCallStore();
  const finalizer = new PostCallFinalizer(store, {
    async dispatch() { sends += 1; return { status: "sent" }; },
  });
  const record = await finalizer.finalize({ ...callContext, call: completedCall, actions: [] });
  const sms: AuthorizedSmsRequest = {
    authorizationId: "authorization-post-call-race",
    principalId: "family-1",
    seniorId: callContext.seniorId,
    correlationId: "33333333-3333-4333-8333-333333333333",
    destinationE164: "+12025550123",
    idempotencyKey: "sms:post-call:race",
    message: record.smsMessage,
    purpose: "Send the opted-in post-call summary",
  };
  await Promise.all([
    finalizer.sendOptedInFollowup(record, true, sms),
    finalizer.sendOptedInFollowup(record, true, sms),
  ]);
  assert.equal(sends, 1);
});

test("changed finalization and changed SMS content fail closed", async () => {
  const store = new InMemoryPostCallStore();
  const finalizer = new PostCallFinalizer(store, { async dispatch() { return { status: "sent" }; } });
  const record = await finalizer.finalize({ ...callContext, call: completedCall, actions: [] });
  await assert.rejects(finalizer.finalize({
    ...callContext,
    call: completedCall,
    actions: [{ label: "New action", status: "pending" }],
  }), /changed after reservation/);
  await assert.rejects(finalizer.sendOptedInFollowup(record, true, {
    authorizationId: "authorization-post-call",
    principalId: "family-1",
    seniorId: "senior-1",
    correlationId: "11111111-1111-4111-8111-111111111111",
    destinationE164: "+12025550123",
    idempotencyKey: "sms:post-call:one",
    message: "Changed summary",
    purpose: "Send the opted-in post-call summary",
  }), /content changed/);
});

test("failed SMS dispatch is recorded as unknown without claiming delivery", async () => {
  const store = new InMemoryPostCallStore();
  const finalizer = new PostCallFinalizer(store, { async dispatch() { throw new Error("provider unavailable"); } });
  const record = await finalizer.finalize({ ...callContext, call: completedCall, actions: [] });
  const result = await finalizer.sendOptedInFollowup(record, true, {
    authorizationId: "authorization-post-call-failure",
    principalId: "family-1",
    seniorId: callContext.seniorId,
    correlationId: "22222222-2222-4222-8222-222222222222",
    destinationE164: "+12025550123",
    idempotencyKey: "sms:post-call:failure",
    message: record.smsMessage,
    purpose: "Send the opted-in post-call summary",
  });
  assert.equal(result.smsStatus, "unknown");
});
