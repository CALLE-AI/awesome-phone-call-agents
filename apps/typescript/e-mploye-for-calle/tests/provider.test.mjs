import { describe, expect, it, vi } from "vitest";
import { CalleApiProvider } from "../server/calle-api-provider.mjs";
import { OFFICIAL_CALLE_ORIGIN } from "../server/calle-origin.mjs";
import { FakeCallProvider } from "../server/fake-call-provider.mjs";

describe("CALL-E API provider", () => {
  it("returns the same fake call for a repeated idempotency key", () => {
    let now = 1000;
    const provider = new FakeCallProvider({ clock: () => now, queuedMs: 0, inProgressMs: 5000 });
    const request = { idempotencyKey: "job-1", body: { metadata: { fake_outcome: "confirmed" } } };
    const first = provider.createCall(request);
    const second = provider.createCall(request);
    expect(second.id).toBe(first.id);
    now = 4500;
    expect(provider.getCall(first.id).status).toBe("in_progress");
  });

  it("constructs an authenticated idempotent create request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: "call_123", object: "call_task", status: "queued", task: "Call <E164_PHONE>", recipients: [], structured_result: null,
      summary: null, task_completed: null, completion_confidence: null, evidence: [], metadata: {}, failure_code: null,
      failure_message: null, created_at: "2026-09-04T00:00:00.000Z", completed_at: null,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const provider = new CalleApiProvider({ apiKey: "test-key", baseUrl: OFFICIAL_CALLE_ORIGIN, liveEnabled: true, fetchImpl });
    await provider.createCall({ idempotencyKey: "employe_job_1", body: { task: "Call <E164_PHONE>" } });
    const [request] = fetchImpl.mock.calls[0];
    expect(request.url).toBe(`${OFFICIAL_CALLE_ORIGIN}/v1/calls`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer test-key");
    expect(request.headers.get("idempotency-key")).toBe("employe_job_1");
    expect(await request.clone().json()).toEqual({ task: "Call <E164_PHONE>" });
  });

  it("reads a 200 SDK response and maps structured result and transcript fields", async () => {
    const fetchImpl = vi.fn(async (request) => {
      expect(request.url).toBe(`${OFFICIAL_CALLE_ORIGIN}/v1/calls/call_123`);
      return new Response(JSON.stringify({
        id: "call_123", object: "call_task", status: "completed", task: "Confirm the appointment.",
        recipients: [{ id: "recipient_1", phones: ["+15550101001"], locale: "en-US", region: "US", status: "completed", structured_result: { outcome: "confirmed", phone: "+15550101001" }, summary: "Confirmed.", attempts: [{ id: "attempt_1", phone: "+15550101001", status: "completed", started_at: null, completed_at: null, summary: "Confirmed.", transcript_turns: [{ speaker: "user", text: "Yes, call +15550101001." }], provider_call_id: null, failure_code: null, failure_message: null }] }],
        structured_result: { outcome: "confirmed", phone: "+15550101001" }, summary: "Confirmed.", task_completed: true, completion_confidence: { score: 0.96, label: "high" }, evidence: ["Yes, call +15550101001."], metadata: { phone: "+15550101001" }, failure_code: null, failure_message: null,
        created_at: "2026-09-04T00:00:00.000Z", completed_at: "2026-09-04T00:01:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new CalleApiProvider({ apiKey: "test-key", baseUrl: OFFICIAL_CALLE_ORIGIN, liveEnabled: true, fetchImpl });
    const result = await provider.getCall("call_123");
    expect(result).toMatchObject({ id: "call_123", status: "completed", structured_result: { outcome: "confirmed" }, task_completed: true });
    expect(result.recipients[0].attempts[0].transcript_turns[0].text).not.toContain("+15550101001");
    expect(result.recipients[0].phones[0]).not.toContain("+15550101001");
    expect(result.structured_result.phone).not.toContain("+15550101001");
    expect(result.evidence[0]).not.toContain("+15550101001");
  });

  it("reads a 200 developer-event list through the SDK", async () => {
    const fetchImpl = vi.fn(async (request) => {
      expect(request.url).toBe(`${OFFICIAL_CALLE_ORIGIN}/v1/calls/call_123/events`);
      return new Response(JSON.stringify({
        object: "list",
        data: [{ id: "event_1", type: "call.completed", call_id: "call_123", created_at: "2026-09-04T00:01:00.000Z", level: "info", status: "completed", message: "Call completed.", details: { outcome: "confirmed" } }],
        next_cursor: null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new CalleApiProvider({ apiKey: "test-key", baseUrl: OFFICIAL_CALLE_ORIGIN, liveEnabled: true, fetchImpl });
    const result = await provider.getEvents("call_123");
    expect(result).toMatchObject({ object: "list", next_cursor: null });
    expect(result.data[0]).toMatchObject({ id: "event_1", type: "call.completed", status: "completed" });
  });

  it("refuses live calls when live mode is disabled", async () => {
    const provider = new CalleApiProvider({ apiKey: "test-key", baseUrl: OFFICIAL_CALLE_ORIGIN, liveEnabled: false, fetchImpl: vi.fn() });
    await expect(provider.createCall({ idempotencyKey: "job-1", body: {} })).rejects.toThrow("disabled");
  });

  it("preserves structured provider errors instead of rendering object text", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "unsupported_region", message: "Unsupported destination" } }), { status: 422, headers: { "content-type": "application/json" } }));
    const provider = new CalleApiProvider({ apiKey: "test-key", baseUrl: OFFICIAL_CALLE_ORIGIN, liveEnabled: true, fetchImpl });
    await expect(provider.createCall({ idempotencyKey: "job-1", body: {} })).rejects.toThrow("unsupported_region");
  });

  it("rejects an untrusted base URL before a bearer request can be sent", () => {
    const fetchImpl = vi.fn();
    expect(() => new CalleApiProvider({ apiKey: "test-key", baseUrl: "https://attacker.example", liveEnabled: true, fetchImpl })).toThrow(/official HTTPS CALL-E origin/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an HTTP CALL-E base URL", () => {
    expect(() => new CalleApiProvider({ apiKey: "test-key", baseUrl: "http://api.heycall-e.com", liveEnabled: true, fetchImpl: vi.fn() })).toThrow(/official HTTPS CALL-E origin/);
  });
});
