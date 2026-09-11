import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LiveCalleGateway } from "../src/calle/live.js";

/**
 * Verifies the live CALL-E integration end-to-end WITHOUT placing a real call,
 * by pointing the SDK at a local fake CALL-E HTTP server. This exercises the
 * exact request the gateway sends (task, recipient, result schema, idempotency
 * key) and the mapping of the terminal snake_case response back into our
 * CallSnapshot.
 */

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

interface Captured {
  idempotencyKey?: string;
  authorization?: string;
  body?: Record<string, unknown>;
}

async function startFakeServer(captured: Captured): Promise<string> {
  server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && req.url === "/v1/calls") {
      captured.idempotencyKey = req.headers["idempotency-key"] as string;
      captured.authorization = req.headers["authorization"] as string;
      captured.body = JSON.parse((await readBody(req)) || "{}");
      res.end(
        JSON.stringify({
          id: "call_live_1",
          object: "call_task",
          status: "queued",
          task: captured.body?.task ?? "",
          recipients: [],
          structured_result: null,
          summary: null,
          task_completed: null,
          completion_confidence: null,
          evidence: [],
          metadata: captured.body?.metadata ?? {},
          failure_code: null,
          failure_message: null,
          created_at: new Date().toISOString(),
          completed_at: null,
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/v1/calls/call_live_1") {
      res.end(
        JSON.stringify({
          id: "call_live_1",
          object: "call_task",
          status: "completed",
          task: "…",
          structured_result: { injuries_summary: "wrist fracture", accident_consistent: "yes" },
          summary: "Doctor confirmed a wrist fracture consistent with a bike accident.",
          task_completed: true,
          completion_confidence: { score: 0.9, label: "high" },
          evidence: ["Doctor said the injury is consistent with a bike accident."],
          metadata: {},
          failure_code: null,
          failure_message: null,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          recipients: [
            {
              id: "r1",
              phones: ["+12025550109"],
              locale: null,
              region: null,
              status: "completed",
              structured_result: { injuries_summary: "wrist fracture", accident_consistent: "yes" },
              summary: "Doctor confirmed a wrist fracture.",
              attempts: [
                {
                  id: "a1",
                  phone: "+12025550109",
                  status: "completed",
                  started_at: null,
                  completed_at: null,
                  summary: "Doctor confirmed a wrist fracture.",
                  transcript_turns: [
                    { offset_seconds: 0, speaker: "bot", text: "Hello, calling about a claim." },
                    { offset_seconds: 4, speaker: "user", text: "Yes, a wrist fracture." },
                  ],
                  provider_call_id: null,
                  failure_code: null,
                  failure_message: null,
                },
              ],
            },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: "not_found", message: "no", details: {} } }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

describe("LiveCalleGateway (local fake CALL-E server, no real calls)", () => {
  it("sends task + result schema + idempotency key, and maps the created call", async () => {
    const captured: Captured = {};
    const baseUrl = await startFakeServer(captured);
    const gateway = new LiveCalleGateway({ apiKey: "test_key_123", baseUrl });

    const handle = await gateway.startCall({
      idempotencyKey: "claimline_medical_report_abc",
      task: "Call the doctor about the injuries.",
      resultSchema: { type: "object", required: ["injuries_summary"] },
      recipient: { phone: "+12025550109", region: "US", locale: "en-US" },
      metadata: { claimReference: "CLM-2101", callType: "medical_report" },
    });

    expect(handle.callId).toBe("call_live_1");
    expect(handle.status).toBe("queued");
    expect(captured.idempotencyKey).toBe("claimline_medical_report_abc");
    expect(captured.authorization).toContain("test_key_123");
    expect(captured.body?.task).toContain("Call the doctor");
    // SDK reshapes recipient -> recipients:[{ phones:[...] }] and resultSchema -> result_schema.
    const recipients = captured.body?.recipients as { phones?: string[] }[] | undefined;
    expect(recipients?.[0]?.phones?.[0]).toBe("+12025550109");
    expect(captured.body?.result_schema).toMatchObject({ type: "object" });
  });

  it("maps the terminal snake_case response into a CallSnapshot", async () => {
    const baseUrl = await startFakeServer({});
    const gateway = new LiveCalleGateway({ apiKey: "test_key_123", baseUrl });

    const snapshot = await gateway.getCall("call_live_1");
    expect(snapshot.status).toBe("completed");
    expect(snapshot.taskCompleted).toBe(true);
    expect(snapshot.completionConfidence).toEqual({ score: 0.9, label: "high" });
    expect(snapshot.structuredResult?.accident_consistent).toBe("yes");
    expect(snapshot.evidence.length).toBe(1);
    expect(snapshot.transcript.length).toBe(2);
    expect(snapshot.transcript[0]?.speaker).toBe("bot");
  });
});
