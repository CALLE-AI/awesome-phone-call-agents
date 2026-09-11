/**
 * Scripted CALL-E stand-in. Implements the two endpoints Roll Call uses
 * (`POST /v1/calls`, `GET /v1/calls/{id}`) over the same JSON contract as the
 * real API, driven by a fixture keyed on the dialled phone number.
 *
 * It never opens a socket by itself: `fakeFetch()` returns a `fetch`-shaped
 * function you hand to the SDK. `fake/calle-server.ts` wraps the same store in
 * a local HTTP server for manual poking.
 */
import { readFileSync } from "node:fs";

export interface ScriptedOutcome {
  status: "completed" | "failed";
  structured_result: Record<string, string> | null;
  summary: string | null;
  transcript_turns: { offset_seconds: number; speaker: "bot" | "user" | "unknown"; text: string }[];
  failure_code?: string | null;
  failure_message?: string | null;
}

export type OutcomeFixture = Record<string, ScriptedOutcome>;

export function loadFixture(path: string): OutcomeFixture {
  return JSON.parse(readFileSync(path, "utf8")) as OutcomeFixture;
}

interface StoredCall {
  id: string;
  body: Record<string, unknown>;
  phone: string;
  idempotencyKey: string | null;
  polls: number;
}

export class FakeCalleStore {
  private readonly calls = new Map<string, StoredCall>();
  private readonly byKey = new Map<string, string>();
  private seq = 0;
  /** Every request the fake ever received, for assertions. */
  readonly requests: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];

  constructor(
    private readonly fixture: OutcomeFixture,
    private readonly options: { pollsUntilTerminal?: number } = {},
  ) {}

  private terminalFor(phone: string): ScriptedOutcome {
    const scripted = this.fixture[phone];
    if (scripted) return scripted;
    return {
      status: "failed",
      structured_result: null,
      summary: null,
      transcript_turns: [],
      failure_code: "fixture_missing",
      failure_message: `no scripted outcome for ${phone}`,
    };
  }

  private render(call: StoredCall): Record<string, unknown> {
    const pollsNeeded = this.options.pollsUntilTerminal ?? 1;
    const terminal = call.polls >= pollsNeeded;
    const scripted = this.terminalFor(call.phone);
    const status = terminal ? scripted.status : "in_progress";
    return {
      id: call.id,
      object: "call_task",
      status,
      task: call.body.task,
      recipients: [
        {
          id: `rcp_${call.id}`,
          phones: [call.phone],
          locale: null,
          region: null,
          status,
          structured_result: null,
          summary: terminal ? scripted.summary : null,
          attempts: terminal
            ? [
                {
                  id: `att_${call.id}`,
                  phone: call.phone,
                  status: scripted.status,
                  started_at: "2026-09-14T08:05:00Z",
                  completed_at: "2026-09-14T08:06:30Z",
                  summary: null,
                  transcript_turns: scripted.transcript_turns,
                  provider_call_id: `prov_${call.id}`,
                  failure_code: scripted.failure_code ?? null,
                  failure_message: scripted.failure_message ?? null,
                },
              ]
            : [],
        },
      ],
      structured_result: terminal ? scripted.structured_result : null,
      summary: terminal ? scripted.summary : null,
      task_completed: terminal && scripted.status === "completed",
      completion_confidence: terminal ? { score: 0.9, label: "high" } : null,
      evidence: [],
      metadata: call.body.metadata ?? {},
      failure_code: terminal ? (scripted.failure_code ?? null) : null,
      failure_message: terminal ? (scripted.failure_message ?? null) : null,
      created_at: "2026-09-14T08:05:00Z",
      completed_at: terminal ? "2026-09-14T08:06:30Z" : null,
    };
  }

  handle(method: string, path: string, headers: Record<string, string>, rawBody: string | null): { status: number; body: unknown } {
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    this.requests.push({ method, path, body, headers });
    const auth = headers["authorization"] ?? "";
    if (!auth.startsWith("Bearer ")) {
      return { status: 401, body: { error: { code: "unauthorized", message: "missing bearer token", details: {} } } };
    }
    if (method === "POST" && path === "/v1/calls") {
      if (!body || typeof body.task !== "string") {
        return { status: 400, body: { error: { code: "invalid_request", message: "task is required", details: {} } } };
      }
      const recipients = body.recipients as { phones: string[] }[] | undefined;
      const phone = recipients?.[0]?.phones?.[0];
      if (!phone) {
        return { status: 400, body: { error: { code: "no_recipients", message: "no recipients", details: {} } } };
      }
      const key = headers["idempotency-key"] ?? null;
      if (key && this.byKey.has(key)) {
        const existing = this.calls.get(this.byKey.get(key)!)!;
        if (JSON.stringify(existing.body) !== JSON.stringify(body)) {
          return { status: 409, body: { error: { code: "idempotency_conflict", message: "key reused with different body", details: {} } } };
        }
        return { status: 200, body: this.render(existing) };
      }
      const id = `call_fake_${String(++this.seq).padStart(3, "0")}`;
      const call: StoredCall = { id, body, phone, idempotencyKey: key, polls: 0 };
      this.calls.set(id, call);
      if (key) this.byKey.set(key, id);
      return { status: 201, body: this.render(call) };
    }
    const get = /^\/v1\/calls\/([^/]+)$/.exec(path);
    if (method === "GET" && get) {
      const call = this.calls.get(get[1]);
      if (!call) return { status: 404, body: { error: { code: "not_found", message: "no such call", details: {} } } };
      call.polls += 1;
      return { status: 200, body: this.render(call) };
    }
    return { status: 404, body: { error: { code: "not_found", message: `no route ${method} ${path}`, details: {} } } };
  }
}

/** A `fetch` the SDK can use; nothing leaves the process. */
export function fakeFetch(store: FakeCalleStore): (input: Request) => Promise<Response> {
  return async (input: Request) => {
    const url = new URL(input.url);
    const headers: Record<string, string> = {};
    input.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const raw = input.method === "GET" ? null : await input.text();
    const result = store.handle(input.method, url.pathname, headers, raw || null);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  };
}
