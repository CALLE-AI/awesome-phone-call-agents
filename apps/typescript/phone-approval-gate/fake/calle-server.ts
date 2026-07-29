/**
 * Local stand-in for the CALL-E Developer API.
 *
 * It speaks the documented wire contract (snake_case payloads, 201 on create,
 * `Idempotency-Key` handling, error envelopes) so the tests drive the real
 * `@call-e/calle` client against it. Nothing here needs credentials, a network
 * or a phone line.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeScenario {
  phone: string;
  status?: "completed" | "failed" | "canceled";
  attemptStatus?: string;
  recipientStatus?: string;
  botLines?: string[];
  userLines?: string[];
  transcript?: boolean;
  structuredResult?: Record<string, unknown> | null;
  confidence?: { score: number; label: string } | null;
  failureCode?: string | null;
  apiError?: { status: number; code: string };
  stall?: boolean;
  pollsBeforeTerminal?: number;
}

export interface CreatedCall {
  id: string;
  idempotencyKey: string | null;
  task: string;
  phones: string[];
  metadata: Record<string, unknown>;
  resultSchema: Record<string, unknown> | undefined;
}

export interface FakeCalle {
  baseUrl: string;
  created: CreatedCall[];
  close: () => Promise<void>;
}

interface StoredCall {
  id: string;
  scenario: FakeScenario;
  task: string;
  phones: string[];
  metadata: Record<string, unknown>;
  polls: number;
  bodyKey: string;
}

function errorEnvelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message, details: {} } });
}

function transcriptTurns(scenario: FakeScenario): unknown[] {
  if (scenario.transcript === false) {
    return [];
  }
  const bot = scenario.botLines ?? ["This is an automated approval call."];
  const user = scenario.userLines ?? [];
  const turns: unknown[] = [];
  let offset = 0;
  const rounds = Math.max(bot.length, user.length);
  for (let index = 0; index < rounds; index += 1) {
    if (bot[index] !== undefined) {
      turns.push({ offset_seconds: offset, speaker: "bot", text: bot[index] });
      offset += 4;
    }
    if (user[index] !== undefined) {
      turns.push({ offset_seconds: offset, speaker: "user", text: user[index] });
      offset += 4;
    }
  }
  return turns;
}

function snapshot(call: StoredCall, terminal: boolean): string {
  const scenario = call.scenario;
  const status = terminal ? scenario.status ?? "completed" : call.polls === 0 ? "queued" : "in_progress";
  const isTerminal = terminal;
  const attempt = {
    id: `att_${call.id.slice(5)}`,
    phone: call.phones[0],
    status: isTerminal ? scenario.attemptStatus ?? scenario.status ?? "completed" : "dialing",
    started_at: "2026-07-29T10:00:05Z",
    completed_at: isTerminal ? "2026-07-29T10:01:10Z" : null,
    summary: null,
    transcript_turns: isTerminal ? transcriptTurns(scenario) : [],
    provider_call_id: `provider_${call.id.slice(5)}`,
    failure_code: isTerminal ? scenario.failureCode ?? null : null,
    failure_message: null,
  };
  const structured = isTerminal ? scenario.structuredResult ?? null : null;
  return JSON.stringify({
    id: call.id,
    object: "call_task",
    status,
    task: call.task,
    recipients: [
      {
        id: `rcp_${call.id.slice(5)}`,
        phones: call.phones,
        locale: "en-US",
        region: "US",
        status: isTerminal ? scenario.recipientStatus ?? scenario.status ?? "completed" : "in_progress",
        structured_result: structured,
        summary: isTerminal ? "Approval call finished." : null,
        attempts: [attempt],
      },
    ],
    structured_result: structured,
    summary: isTerminal ? "Approval call finished." : null,
    task_completed: isTerminal ? true : null,
    completion_confidence: isTerminal ? scenario.confidence ?? { score: 0.9, label: "high" } : null,
    evidence: isTerminal ? ["Recorded from the fake server."] : [],
    metadata: call.metadata,
    failure_code: isTerminal ? scenario.failureCode ?? null : null,
    failure_message: null,
    created_at: "2026-07-29T10:00:00Z",
    completed_at: isTerminal ? "2026-07-29T10:01:10Z" : null,
  });
}

export async function startFakeCalle(scenarios: FakeScenario[]): Promise<FakeCalle> {
  const created: CreatedCall[] = [];
  const calls = new Map<string, StoredCall>();
  const idempotency = new Map<string, { id: string; bodyKey: string }>();
  let counter = 0;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(request.url ?? "/", "http://localhost");
      const authorization = request.headers.authorization ?? "";
      response.setHeader("content-type", "application/json");

      if (!authorization.startsWith("Bearer ")) {
        response.statusCode = 401;
        response.end(errorEnvelope("unauthorized", "Invalid or missing API key."));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/calls") {
        const body = JSON.parse(raw) as {
          task: string;
          recipients?: { phones: string[] }[];
          metadata?: Record<string, unknown>;
          result_schema?: Record<string, unknown>;
        };
        const phones = body.recipients?.[0]?.phones ?? [];
        const scenario = scenarios.find((candidate) => candidate.phone === phones[0]);
        if (scenario === undefined) {
          response.statusCode = 400;
          response.end(errorEnvelope("invalid_recipient", `No fake scenario for ${String(phones[0])}.`));
          return;
        }
        const key = (request.headers["idempotency-key"] as string | undefined) ?? null;
        const bodyKey = JSON.stringify(body);
        if (key !== null) {
          const seen = idempotency.get(key);
          if (seen !== undefined) {
            if (seen.bodyKey !== bodyKey) {
              response.statusCode = 409;
              response.end(errorEnvelope("idempotency_conflict", "Key reused with a different body."));
              return;
            }
            const existing = calls.get(seen.id);
            response.statusCode = 201;
            response.end(snapshot(existing!, false));
            return;
          }
        }
        if (scenario.apiError !== undefined) {
          response.statusCode = scenario.apiError.status;
          response.end(errorEnvelope(scenario.apiError.code, "Fake server refused the call."));
          return;
        }
        counter += 1;
        const id = `call_fake${counter}`;
        const stored: StoredCall = {
          id,
          scenario,
          task: body.task,
          phones,
          metadata: body.metadata ?? {},
          polls: 0,
          bodyKey,
        };
        calls.set(id, stored);
        if (key !== null) {
          idempotency.set(key, { id, bodyKey });
        }
        created.push({
          id,
          idempotencyKey: key,
          task: body.task,
          phones,
          metadata: body.metadata ?? {},
          resultSchema: body.result_schema,
        });
        response.statusCode = 201;
        response.end(snapshot(stored, false));
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
        response.statusCode = 200;
        response.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: `evt_${call.id.slice(5)}`,
                type: "call.completed",
                call_id: call.id,
                created_at: "2026-07-29T10:01:10Z",
                level: "info",
                status: call.scenario.status ?? "completed",
                message: "Call completed.",
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
        call.polls += 1;
        const needed = call.scenario.pollsBeforeTerminal ?? 1;
        const terminal = call.scenario.stall === true ? false : call.polls >= needed;
        response.statusCode = 200;
        response.end(snapshot(call, terminal));
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
