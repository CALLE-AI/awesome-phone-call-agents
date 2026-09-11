/**
 * The fake must speak the documented wire contract faithfully enough that the
 * real `@call-e/calle` SDK can be pointed at it in every other test. These
 * tests pin the wire level itself: snake_case bodies, status codes, error
 * envelopes and idempotency semantics.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeCalle, type FakeCalle } from "../fake/calle-server.js";

const AUTH = { authorization: "Bearer calle_test_fake", "content-type": "application/json" };

function createBody(phone: string, task = "Say hello."): string {
  return JSON.stringify({
    task,
    recipients: [{ phones: [phone], region: "US", locale: "en-US" }],
    result_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    metadata: { source: "test" },
  });
}

async function withFake(scenarios: Parameters<typeof startFakeCalle>[0], run: (fake: FakeCalle) => Promise<void>): Promise<void> {
  const fake = await startFakeCalle(scenarios);
  try {
    await run(fake);
  } finally {
    await fake.close();
  }
}

test("refuses requests without a bearer token", async () => {
  await withFake([{ phone: "+15550100" }], async (fake) => {
    const response = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", body: createBody("+15550100") });
    assert.equal(response.status, 401);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "unauthorized");
  });
});

test("creates a call and returns a queued snake_case snapshot", async () => {
  await withFake([{ phone: "+15550100" }], async (fake) => {
    const response = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15550100") });
    assert.equal(response.status, 201);
    const call = (await response.json()) as Record<string, unknown>;
    assert.equal(call.object, "call_task");
    assert.equal(call.status, "queued");
    assert.equal(call.structured_result, null);
    assert.equal(call.completion_confidence, null);
    const recipients = call.recipients as { phones: string[]; attempts: unknown[] }[];
    assert.deepEqual(recipients[0].phones, ["+15550100"]);
    assert.equal(fake.created.length, 1);
    assert.equal(fake.created[0].phones[0], "+15550100");
    assert.ok(fake.created[0].resultSchema);
  });
});

test("unknown phone is refused with invalid_recipient", async () => {
  await withFake([{ phone: "+15550100" }], async (fake) => {
    const response = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15559999") });
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "invalid_recipient");
  });
});

test("idempotency key replays the same call and conflicts on a different body", async () => {
  await withFake([{ phone: "+15550100" }], async (fake) => {
    const headers = { ...AUTH, "idempotency-key": "key-1" };
    const first = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers, body: createBody("+15550100") });
    const firstCall = (await first.json()) as { id: string };
    const replay = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers, body: createBody("+15550100") });
    assert.equal(replay.status, 201);
    const replayCall = (await replay.json()) as { id: string };
    assert.equal(replayCall.id, firstCall.id);
    assert.equal(fake.created.length, 1);

    const conflict = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers, body: createBody("+15550100", "A different task.") });
    assert.equal(conflict.status, 409);
    const payload = (await conflict.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "idempotency_conflict");
  });
});

test("polling reaches a terminal snapshot with results, transcript and confidence", async () => {
  const scenario = {
    phone: "+15550100",
    pollsBeforeTerminal: 2,
    structuredResult: { ok: true },
    confidence: { score: 0.92, label: "high" },
    taskCompleted: true,
    turns: [
      { speaker: "bot" as const, text: "This is an automated test call.", offsetSeconds: 0 },
      { speaker: "user" as const, text: "Front desk, how can I help?", offsetSeconds: 6 },
    ],
  };
  await withFake([scenario], async (fake) => {
    const created = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15550100") });
    const { id } = (await created.json()) as { id: string };

    const midway = await fetch(`${fake.baseUrl}/v1/calls/${id}`, { headers: AUTH });
    const midwayCall = (await midway.json()) as { status: string; structured_result: unknown };
    assert.equal(midwayCall.status, "in_progress");
    assert.equal(midwayCall.structured_result, null);

    const done = await fetch(`${fake.baseUrl}/v1/calls/${id}`, { headers: AUTH });
    const doneCall = (await done.json()) as {
      status: string;
      structured_result: { ok: boolean };
      task_completed: boolean;
      completion_confidence: { score: number };
      recipients: { attempts: { transcript_turns: { offset_seconds: number; speaker: string; text: string }[] }[] }[];
    };
    assert.equal(doneCall.status, "completed");
    assert.deepEqual(doneCall.structured_result, { ok: true });
    assert.equal(doneCall.task_completed, true);
    assert.equal(doneCall.completion_confidence.score, 0.92);
    const turns = doneCall.recipients[0].attempts[0].transcript_turns;
    assert.equal(turns.length, 2);
    assert.equal(turns[0].speaker, "bot");
    assert.equal(turns[1].offset_seconds, 6);
  });
});

test("failure scenario reports failed status with a failure code", async () => {
  await withFake([{ phone: "+15550100", status: "failed", failureCode: "no_answer" }], async (fake) => {
    const created = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15550100") });
    const { id } = (await created.json()) as { id: string };
    const done = await fetch(`${fake.baseUrl}/v1/calls/${id}`, { headers: AUTH });
    const call = (await done.json()) as { status: string; failure_code: string };
    assert.equal(call.status, "failed");
    assert.equal(call.failure_code, "no_answer");
  });
});

test("apiError scenario refuses the create with the configured envelope", async () => {
  await withFake([{ phone: "+15550100", apiError: { status: 429, code: "rate_limited", times: 1 } }], async (fake) => {
    const refused = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15550100") });
    assert.equal(refused.status, 429);
    const payload = (await refused.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "rate_limited");
    assert.equal(fake.created.length, 0);

    const retry = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15550100") });
    assert.equal(retry.status, 201);
  });
});

test("apiError with afterCreate loses the reply but keeps the call", async () => {
  await withFake([{ phone: "+15550100", apiError: { status: 500, code: "internal_error", times: 1, afterCreate: true } }], async (fake) => {
    const lost = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15550100") });
    assert.equal(lost.status, 500);
    assert.equal(fake.created.length, 1);
  });
});

test("events endpoint lists a terminal event", async () => {
  await withFake([{ phone: "+15550100" }], async (fake) => {
    const created = await fetch(`${fake.baseUrl}/v1/calls`, { method: "POST", headers: AUTH, body: createBody("+15550100") });
    const { id } = (await created.json()) as { id: string };
    const events = await fetch(`${fake.baseUrl}/v1/calls/${id}/events`, { headers: AUTH });
    assert.equal(events.status, 200);
    const list = (await events.json()) as { object: string; data: { call_id: string }[]; next_cursor: null };
    assert.equal(list.object, "list");
    assert.equal(list.data[0].call_id, id);
  });
});
