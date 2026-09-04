import assert from "node:assert/strict";
import { CalleApiProvider } from "../server/calle-api-provider.mjs";

const requests = [];
const callId = "call_smoke_123";

const callPayload = {
  id: callId,
  object: "call_task",
  status: "queued",
  task: "Confirm the scheduled shift.",
  recipients: [],
  structured_result: null,
  summary: null,
  task_completed: null,
  completion_confidence: null,
  evidence: [],
  metadata: {},
  failure_code: null,
  failure_message: null,
  created_at: "2026-09-04T00:00:00.000Z",
  completed_at: null,
};

const completedCallPayload = {
  ...callPayload,
  status: "completed",
  recipients: [{
    id: "recipient_smoke_123",
    phones: ["+15551234567"],
    locale: "en-US",
    region: "US",
    status: "completed",
    structured_result: { outcome: "confirmed" },
    summary: "Confirmed.",
    attempts: [{
      id: "attempt_smoke_123",
      phone: "+15551234567",
      status: "completed",
      started_at: null,
      completed_at: null,
      summary: "Confirmed.",
      transcript_turns: [{ speaker: "user", text: "Yes, that works." }],
      provider_call_id: null,
      failure_code: null,
      failure_message: null,
    }],
  }],
  structured_result: { outcome: "confirmed" },
  summary: "Confirmed.",
  task_completed: true,
  completion_confidence: { score: 0.96, label: "high" },
  evidence: ["Yes, that works."],
  completed_at: "2026-09-04T00:01:00.000Z",
};

const eventsPayload = {
  object: "list",
  data: [{
    id: "event_smoke_123",
    type: "call.completed",
    call_id: callId,
    created_at: "2026-09-04T00:01:00.000Z",
    level: "info",
    status: "completed",
    message: "Call completed.",
    details: { outcome: "confirmed" },
  }],
  next_cursor: null,
};

const fetchImpl = async (request) => {
  const url = new URL(request.url);
  const path = url.pathname;
  requests.push({
    method: request.method,
    path,
    authorization: request.headers.get("authorization"),
    idempotencyKey: request.headers.get("idempotency-key"),
  });

  if (path === "/v1/calls" && request.method === "POST") {
    return new Response(JSON.stringify(callPayload), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }

  if (path === `/v1/calls/${callId}/events` && request.method === "GET") {
    return new Response(JSON.stringify(eventsPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (path === `/v1/calls/${callId}` && request.method === "GET") {
    return new Response(JSON.stringify(completedCallPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  throw new Error(`Unexpected SDK request: ${request.method} ${path}`);
};

const provider = new CalleApiProvider({
  apiKey: "smoke-test-key",
  baseUrl: "https://api.example.test",
  liveEnabled: true,
  fetchImpl,
});

const created = await provider.createCall({
  idempotencyKey: "e-mploye-sdk-smoke-1",
  body: {
    task: "Confirm the scheduled shift.",
    recipients: [{ phones: ["+15551234567"], region: "US", locale: "en-US" }],
    result_schema: { type: "object" },
  },
});
const completed = await provider.getCall(callId);
const events = await provider.getEvents(callId);

assert.equal(created.id, callId);
assert.equal(created.status, "queued");
assert.equal(completed.status, "completed");
assert.deepEqual(completed.structured_result, { outcome: "confirmed" });
assert.equal(completed.recipients[0].attempts[0].transcript_turns[0].text, "Yes, that works.");
assert.equal(events.data[0].type, "call.completed");
assert.deepEqual(requests.map(({ method, path }) => ({ method, path })), [
  { method: "POST", path: "/v1/calls" },
  { method: "GET", path: `/v1/calls/${callId}` },
  { method: "GET", path: `/v1/calls/${callId}/events` },
]);
assert.equal(requests[0].authorization, "Bearer smoke-test-key");
assert.equal(requests[0].idempotencyKey, "e-mploye-sdk-smoke-1");

console.log(JSON.stringify({
  ok: true,
  test: "CALL-E SDK contract smoke test",
  sdk: "@call-e/calle",
  realCallPlaced: false,
  responses: { create: 201, get: 200, events: 200 },
  requests: requests.map(({ method, path }) => ({ method, path })),
}));
