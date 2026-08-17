/**
 * Local stand-in for the CALL-E Developer API.
 *
 * Speaks the documented wire contract — snake_case payloads, 201 on create,
 * `Idempotency-Key` semantics, `{ error: { code, message, details } }`
 * envelopes — so tests and the demo drive the real `@call-e/calle` client
 * against it. No credentials, no network beyond loopback, no phone calls.
 *
 * Scenarios are keyed by recipient phone. Transcript turns are given
 * explicitly per scenario because LineCanary asserts on their timing offsets;
 * the fake never invents timings.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeScenarioTurn {
  speaker: "bot" | "user";
  text: string;
  offsetSeconds: number | null;
}

export interface FakeScenario {
  phone: string;
  status?: "completed" | "failed" | "canceled";
  structuredResult?: Record<string, unknown> | null;
  confidence?: { score: number; label: string } | null;
  turns?: FakeScenarioTurn[];
  failureCode?: string | null;
  taskCompleted?: boolean;
  /** GET polls before the snapshot turns terminal. Default 1. */
  pollsBeforeTerminal?: number;
  /**
   * Error served instead of a normal reply. `times` caps how many creates it
   * applies to; `afterCreate` stores the call before failing the reply, which
   * is what a lost response looks like from the caller's side.
   */
  apiError?: { status: number; code: string; times?: number; afterCreate?: boolean };
}

export interface CreatedCall {
  id: string;
  idempotencyKey: string | null;
  task: string;
  phones: string[];
  metadata: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
}

export interface FakeCalle {
  baseUrl: string;
  created: CreatedCall[];
  /** Swap the scenario for a phone between runs, e.g. to inject a regression. */
  setScenario(scenario: FakeScenario): void;
  close(): Promise<void>;
}

interface StoredCall {
  id: string;
  phone: string;
  task: string;
  metadata: Record<string, unknown>;
  polls: number;
  bodyKey: string;
  createdAtMs: number;
}

function errorEnvelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message, details: {} } });
}

function wireTurns(turns: FakeScenarioTurn[]): unknown[] {
  return turns.map((turn) => ({ offset_seconds: turn.offsetSeconds, speaker: turn.speaker, text: turn.text }));
}

function snapshot(call: StoredCall, scenario: FakeScenario, terminal: boolean): string {
  const terminalStatus = scenario.status ?? "completed";
  const status = terminal ? terminalStatus : call.polls === 0 ? "queued" : "in_progress";
  const startedAt = new Date(call.createdAtMs + 2_000).toISOString();
  const completedAt = new Date(call.createdAtMs + 45_000).toISOString();
  const structured = terminal ? scenario.structuredResult ?? null : null;
  const failureCode = terminal ? scenario.failureCode ?? null : null;
  const suffix = call.id.slice("call_".length);
  return JSON.stringify({
    id: call.id,
    object: "call_task",
    status,
    task: call.task,
    recipients: [
      {
        id: `rcp_${suffix}`,
        phones: [call.phone],
        locale: "en-US",
        region: "US",
        status: terminal ? terminalStatus : "in_progress",
        structured_result: structured,
        summary: terminal ? "Fake call finished." : null,
        attempts: [
          {
            id: `att_${suffix}`,
            phone: call.phone,
            status: terminal ? terminalStatus : "dialing",
            started_at: startedAt,
            completed_at: terminal ? completedAt : null,
            summary: null,
            transcript_turns: terminal ? wireTurns(scenario.turns ?? []) : [],
            provider_call_id: `prov_${suffix}`,
            failure_code: failureCode,
            failure_message: null,
          },
        ],
      },
    ],
    structured_result: structured,
    summary: terminal ? "Fake call finished." : null,
    task_completed: terminal ? scenario.taskCompleted ?? (terminalStatus === "completed") : null,
    completion_confidence: terminal ? scenario.confidence ?? { score: 0.9, label: "high" } : null,
    evidence: terminal ? ["Recorded by the fake server."] : [],
    metadata: call.metadata,
    failure_code: failureCode,
    failure_message: null,
    created_at: new Date(call.createdAtMs).toISOString(),
    completed_at: terminal ? completedAt : null,
  });
}

export async function startFakeCalle(initialScenarios: FakeScenario[]): Promise<FakeCalle> {
  const scenarios = new Map<string, FakeScenario>();
  for (const scenario of initialScenarios) {
    scenarios.set(scenario.phone, scenario);
  }
  const created: CreatedCall[] = [];
  const calls = new Map<string, StoredCall>();
  const idempotency = new Map<string, { id: string; bodyKey: string }>();
  const apiErrorsSent = new Map<string, number>();
  let counter = 0;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(request.url ?? "/", "http://localhost");
      response.setHeader("content-type", "application/json");

      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("Bearer ")) {
        response.statusCode = 401;
        response.end(errorEnvelope("unauthorized", "Invalid or missing API key."));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/calls") {
        const body = JSON.parse(raw) as {
          task: string;
          recipients?: { phones?: string[] }[];
          metadata?: Record<string, unknown>;
          result_schema?: Record<string, unknown>;
        };
        const phone = body.recipients?.[0]?.phones?.[0];
        const scenario = phone === undefined ? undefined : scenarios.get(phone);
        if (phone === undefined || scenario === undefined) {
          response.statusCode = 400;
          response.end(errorEnvelope("invalid_recipient", `No fake scenario for ${String(phone)}.`));
          return;
        }

        const key = (request.headers["idempotency-key"] as string | undefined) ?? null;
        const bodyKey = JSON.stringify(body);
        if (key !== null) {
          const seen = idempotency.get(key);
          if (seen !== undefined) {
            if (seen.bodyKey !== bodyKey) {
              response.statusCode = 409;
              response.end(errorEnvelope("idempotency_conflict", "Idempotency key reused with a different body."));
              return;
            }
            const existing = calls.get(seen.id)!;
            response.statusCode = 201;
            response.end(snapshot(existing, scenario, false));
            return;
          }
        }

        const failure = scenario.apiError;
        const sent = apiErrorsSent.get(phone) ?? 0;
        const failing = failure !== undefined && sent < (failure.times ?? Number.POSITIVE_INFINITY);
        if (failing && failure.afterCreate !== true) {
          apiErrorsSent.set(phone, sent + 1);
          response.statusCode = failure.status;
          response.end(errorEnvelope(failure.code, "Fake server refused the create."));
          return;
        }

        counter += 1;
        const id = `call_fake${counter}`;
        const stored: StoredCall = {
          id,
          phone,
          task: body.task,
          metadata: body.metadata ?? {},
          polls: 0,
          bodyKey,
          createdAtMs: Date.now(),
        };
        calls.set(id, stored);
        if (key !== null) {
          idempotency.set(key, { id, bodyKey });
        }
        created.push({
          id,
          idempotencyKey: key,
          task: body.task,
          phones: [phone],
          metadata: body.metadata ?? {},
          resultSchema: body.result_schema,
        });

        if (failing) {
          apiErrorsSent.set(phone, sent + 1);
          response.statusCode = failure.status;
          response.end(errorEnvelope(failure.code, "Fake server lost the reply."));
          return;
        }
        response.statusCode = 201;
        response.end(snapshot(stored, scenario, false));
        return;
      }

      const eventsMatch = /^\/v1\/calls\/([^/]+)\/events$/.exec(url.pathname);
      if (request.method === "GET" && eventsMatch !== null) {
        const call = calls.get(eventsMatch[1]);
        if (call === undefined) {
          response.statusCode = 404;
          response.end(errorEnvelope("not_found", "Unknown call."));
          return;
        }
        const scenario = scenarios.get(call.phone)!;
        response.statusCode = 200;
        response.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: `evt_${call.id.slice("call_".length)}`,
                type: `call.${scenario.status ?? "completed"}`,
                call_id: call.id,
                created_at: new Date(call.createdAtMs + 45_000).toISOString(),
                level: "info",
                status: scenario.status ?? "completed",
                message: "Call reached a terminal state.",
                details: {},
              },
            ],
            next_cursor: null,
          }),
        );
        return;
      }

      const callMatch = /^\/v1\/calls\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && callMatch !== null) {
        const call = calls.get(callMatch[1]);
        if (call === undefined) {
          response.statusCode = 404;
          response.end(errorEnvelope("not_found", "Unknown call."));
          return;
        }
        const scenario = scenarios.get(call.phone)!;
        call.polls += 1;
        const needed = scenario.pollsBeforeTerminal ?? 1;
        response.statusCode = 200;
        response.end(snapshot(call, scenario, call.polls >= needed));
        return;
      }

      response.statusCode = 404;
      response.end(errorEnvelope("not_found", "Unknown route."));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    created,
    setScenario(scenario: FakeScenario): void {
      scenarios.set(scenario.phone, scenario);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
