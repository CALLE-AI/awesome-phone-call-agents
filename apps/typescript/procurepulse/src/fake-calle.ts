import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A loopback stand-in for the CALL-E Developer API, used by `demo` and the tests. It answers
 * in the documented OpenAPI 0.7.0 shapes and applies the same pre-dial checks the live API
 * does, in the same order: unknown request fields (422), an unsupported or reserved
 * `recipient_result_schema` (400), then non-E.164 phones (400). Nothing is ever dialed.
 */
export const FAKE_KEY = "iams_fake_procurepulse_not_a_real_key";

export interface Outcome {
  result: Record<string, string>;
  summary: string;
  transcript: Array<{ speaker: "bot" | "user"; text: string }>;
  confidence: { score: number; label: string };
}

type Json = Record<string, any>;
const ALLOWED = new Set(["task", "recipients", "result_schema", "recipient_result_schema", "metadata", "webhook_url"]);
const RESERVED = new Set(["summary", "status", "transcript", "call_id", "started_at", "completed_at", "duration"]);
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
let counter = 0;
const rid = (prefix: string) => `${prefix}_fake${Date.now().toString(36)}${(counter++).toString(36).padStart(4, "0")}`;

export class FakeCalle {
  readonly calls = new Map<string, Json>();
  readonly requests: Json[] = [];
  #byKey = new Map<string, string>();
  #server: http.Server | null = null;
  #outcomes: Record<string, Outcome>;
  baseUrl = "";

  /** `outcomes` is keyed by `<vendor_id>:<purpose>` (purpose: supplier_quote or hold_request). */
  constructor(outcomes: Record<string, Outcome> = {}) {
    this.#outcomes = outcomes;
  }

  async start(): Promise<string> {
    this.#server = http.createServer((req, res) => this.#handle(req, res));
    await new Promise<void>((resolve) => this.#server!.listen(0, "127.0.0.1", resolve));
    this.baseUrl = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this.baseUrl;
  }

  /** Forget every call, request and idempotency key (between tests). */
  reset(): void {
    this.calls.clear();
    this.requests.length = 0;
    this.#byKey.clear();
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()));
  }

  #handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const fail = (status: number, code: string, message: string, details: Json = {}) => send(status, { error: { code, message, details } });
    if (req.headers.authorization !== `Bearer ${FAKE_KEY}`) return fail(401, "unauthorized", "Invalid or missing API key.");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/v1/goals") return send(200, { object: "list", data: [], next_cursor: null });
      if (req.method === "GET" && url.pathname.startsWith("/v1/calls/")) {
        const call = this.calls.get(url.pathname.slice("/v1/calls/".length));
        return call ? send(200, call) : fail(404, "not_found", "Call not found.");
      }
      if (req.method !== "POST" || url.pathname !== "/v1/calls") return fail(404, "not_found", "Unknown route.");

      const body = JSON.parse(raw || "{}") as Json;
      const extra = Object.keys(body).filter((k) => !ALLOWED.has(k));
      if (extra.length)
        return fail(422, "invalid_request", "Request validation failed.", {
          validation_errors: extra.map((k) => ({ type: "extra_forbidden", loc: [k], msg: "Extra inputs are not permitted" })),
        });
      const schema = body.recipient_result_schema as Json | undefined;
      for (const field of Object.keys(schema?.properties ?? {}))
        if (RESERVED.has(field))
          return fail(400, "recipient_result_schema_invalid", `recipient_result_schema contains reserved field: ${field}`, { field });
      for (const r of body.recipients ?? [])
        for (const phone of r.phones ?? [])
          if (!/^\+[1-9]\d{6,14}$/.test(phone)) return fail(400, "invalid_phone", "phone must be an E.164 number.", { phone });

      const key = String(req.headers["idempotency-key"] ?? "");
      this.requests.push({ idempotencyKey: key, metadata: body.metadata, webhookUrl: body.webhook_url ?? null });
      if (key && this.#byKey.has(key)) return send(201, this.calls.get(this.#byKey.get(key)!));
      const call: Json = {
        id: rid("call"), object: "call_task", status: "queued", task: body.task,
        recipients: (body.recipients ?? []).map((r: Json) => ({
          id: rid("rcp"), phones: r.phones, locale: r.locale ?? null, region: r.region ?? null,
          status: "pending", structured_result: null, summary: null, attempts: [],
        })),
        structured_result: null, summary: null, task_completed: null, completion_confidence: null, evidence: [],
        metadata: body.metadata ?? {}, failure_code: null, failure_message: null, created_at: iso(), completed_at: null,
      };
      this.calls.set(call.id, call);
      if (key) this.#byKey.set(key, call.id);
      send(201, call);
    });
  }

  callFor(vendorId: string, purpose: "supplier_quote" | "hold_request"): Json {
    const call = [...this.calls.values()].find((c) => c.metadata?.vendor_id === vendorId && c.metadata?.purpose === purpose);
    if (!call) throw new Error(`No fake call for ${vendorId} ${purpose}`);
    return call;
  }

  /** queued -> ringing -> on the call -> completed with the scripted outcome (or no answer). */
  advance(call: Json): string {
    const rcp = call.recipients[0];
    const attempt = rcp.attempts[0];
    if (call.status === "queued") {
      Object.assign(call, { status: "in_progress" });
      rcp.status = "in_progress";
      rcp.attempts = [{
        id: rid("att"), phone: rcp.phones[0], status: "dialing", started_at: iso(), completed_at: null, summary: null,
        transcript_turns: [], provider_call_id: rid("provider"), failure_code: null, failure_message: null,
      }];
    } else if (attempt?.status === "dialing") {
      attempt.status = "in_progress";
    } else if (attempt?.status === "in_progress") {
      const outcome = this.#outcomes[`${call.metadata.vendor_id}:${call.metadata.purpose}`];
      if (!outcome) {
        Object.assign(attempt, { status: "failed", completed_at: iso(), failure_code: "no_answer", failure_message: "The call was not answered." });
        Object.assign(call, { status: "failed", failure_code: "no_answer", failure_message: "The call was not answered.", completed_at: iso() });
        rcp.status = "failed";
      } else {
        Object.assign(attempt, {
          status: "completed", completed_at: iso(), summary: outcome.summary,
          transcript_turns: outcome.transcript.map((t, i) => ({ offset_seconds: i * 4, speaker: t.speaker, text: t.text })),
        });
        Object.assign(rcp, { status: "completed", structured_result: outcome.result, summary: outcome.summary });
        Object.assign(call, {
          status: "completed", summary: outcome.summary, task_completed: true, completion_confidence: outcome.confidence,
          evidence: [outcome.summary], completed_at: iso(),
        });
      }
    }
    return call.status === "in_progress" ? attempt?.status ?? "dialing" : call.status;
  }

  /** A terminal webhook payload as CALL-E sends it: event id at the top, the call under `data`. */
  webhookFor(call: Json): { headers: Record<string, string>; body: string } {
    const id = rid("evt");
    return {
      headers: { "calle-event-id": id },
      body: JSON.stringify({ id, type: `call.${call.status}`, created_at: iso(), data: call }),
    };
  }
}
