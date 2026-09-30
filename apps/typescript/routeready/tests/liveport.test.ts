import { CalleClient } from "@call-e/calle";
import { describe, expect, it } from "vitest";
import { READINESS_SCHEMA } from "../src/calle/task.js";
import { LivePort, type CallRequest } from "../src/calle/ports.js";

// Drives the real @call-e/calle SDK against an in-memory fake of the CALL-E API:
// no network, no credentials, no calls.

const PHONE = "+15555550102";
const ANSWER = {
  reached_recipient: "yes",
  readiness: "within_15_min",
  ready_clock_time: "",
  handoff: "in_person",
  cod_cash_ready: "yes",
  landmark: "Opposite the pharmacy",
  customer_quote: "I need fifteen more minutes.",
  quote_in_english: "I need fifteen more minutes.",
};

function apiCall(status: "queued" | "in_progress" | "completed") {
  const done = status === "completed";
  return {
    id: "call_test",
    object: "call_task",
    status,
    task: "test",
    recipients: [
      {
        id: "rcp_1",
        phones: [PHONE],
        locale: "en-US",
        region: "US",
        status: done ? "completed" : "in_progress",
        structured_result: done ? ANSWER : null,
        summary: null,
        attempts: [],
      },
    ],
    structured_result: null,
    summary: null,
    task_completed: done,
    completion_confidence: done ? { score: 0.9, label: "high" } : null,
    evidence: [],
    metadata: {},
    failure_code: null,
    failure_message: null,
    created_at: "2026-09-12T04:00:00Z",
    completed_at: done ? "2026-09-12T04:02:00Z" : null,
  };
}

function event(id: number, message: string) {
  return { id: `evt_${id}`, type: "call.updated", call_id: "call_test", created_at: "2026-09-12T04:01:00Z", level: "info", status: "in_progress", message, details: {} };
}

function fakeApi() {
  const posts: { headers: Headers; body: Record<string, unknown> }[] = [];
  let eventRequests = 0;
  let gets = 0;
  const messages = [
    "botlab create bot.",
    "Call connected.",
    "Bot is speaking: Hello,",
    "Bot is speaking: I'm an AI assistant calling about your delivery.",
    "Callee said: I need fifteen",
    "Callee said: I need fifteen more minutes.",
  ];
  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (request.method === "POST" && url.pathname === "/v1/calls") {
      posts.push({ headers: request.headers, body: await request.json() });
      return json(201, apiCall("queued"));
    }
    if (url.pathname === "/v1/calls/call_test/events") {
      eventRequests++;
      // Like a live call: a cursor comes back even though no newer events exist yet.
      const data = url.searchParams.has("cursor") ? [] : messages.map((message, i) => event(i, message));
      return json(200, { object: "list", data, next_cursor: "tail" });
    }
    if (url.pathname === "/v1/calls/call_test") {
      gets++;
      return json(200, apiCall(gets > 1 ? "completed" : "in_progress"));
    }
    return json(404, { error: { code: "not_found", message: "Not found" } });
  };
  return { fetch, posts, eventRequests: () => eventRequests };
}

const request: CallRequest = {
  stopId: "s2",
  phone: PHONE,
  region: "US",
  task: "Call about a delivery.",
  etaMinutes: 33,
  idempotencyKey: "routeready:test:s2",
  metadata: { run_id: "test", stop_id: "s2" },
};

describe("LivePort with the real CALL-E SDK", () => {
  it("creates the call with the readiness schema and an idempotency key", async () => {
    const api = fakeApi();
    const port = new LivePort(new CalleClient({ apiKey: "test-key", fetch: api.fetch }), 0);
    const { callId } = await port.start(request);
    expect(callId).toBe("call_test");
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].headers.get("idempotency-key")).toBe("routeready:test:s2");
    expect(api.posts[0].body.recipient_result_schema).toEqual(READINESS_SCHEMA);
    expect(JSON.stringify(api.posts[0].body)).toContain(PHONE);
  });

  it("streams transcript lines without stalling on a live cursor, then returns the final call", async () => {
    const api = fakeApi();
    const port = new LivePort(new CalleClient({ apiKey: "test-key", fetch: api.fetch }), 0);
    await port.start(request);

    const first = await port.poll("call_test", 10);
    expect(api.eventRequests()).toBe(1);
    expect(first.final).toBeNull();
    expect(first.lines.map(({ speaker, text, merge }) => ({ speaker, text, merge }))).toEqual([
      { speaker: "system", text: "Call connected.", merge: undefined },
      { speaker: "bot", text: "Hello,", merge: undefined },
      { speaker: "bot", text: "I'm an AI assistant calling about your delivery.", merge: "append" },
      { speaker: "customer", text: "I need fifteen", merge: undefined },
      { speaker: "customer", text: "I need fifteen more minutes.", merge: "replace" },
    ]);

    const second = await port.poll("call_test", 11);
    expect(second.lines).toEqual([]);
    expect(second.final?.status).toBe("completed");
    expect(second.final?.recipients[0].structuredResult).toEqual(ANSWER);
  });
});
