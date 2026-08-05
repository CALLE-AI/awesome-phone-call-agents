/**
 * Local stand-in for the CALL-E Developer API.
 *
 * It speaks the documented wire contract (snake_case payloads, 201 on create,
 * `Idempotency-Key` handling, error envelopes) so the tests and the demo drive the
 * real `@call-e/calle` client against it. Nothing here needs credentials, a network
 * or a phone line.
 *
 * One claim is one call, so a script is keyed by the number that gets dialled.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeScript {
  phone: string;
  status?: "completed" | "failed" | "canceled";
  botLines?: string[];
  calleeLines?: string[];
  /** False sends a completed call with no transcript at all. */
  transcript?: boolean;
  structuredResult?: Record<string, unknown> | null;
  confidence?: { score: number; label: string } | null;
  failureCode?: string | null;
  /**
   * Error returned instead of a normal reply. `times` limits how many creates it
   * applies to and `afterCreate` remembers the call before answering with the
   * error, which is how a lost reply looks from outside: the call exists and the
   * caller never heard about it.
   */
  apiError?: { status: number; code: string; times?: number; afterCreate?: boolean };
  /** Reading the call back fails, so a created call has no result to read. */
  pollError?: { status: number; code: string };
  /** The call never reaches a terminal status, so the wait times out. */
  stall?: boolean;
  pollsBeforeTerminal?: number;
  /** Overrides the completion time, including sending it as null. */
  completedAt?: string | null;
}

export interface CreatedCall {
  id: string;
  idempotencyKey: string | null;
  task: string;
  phones: string[];
  locale: string | undefined;
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
  script: FakeScript;
  task: string;
  phones: string[];
  metadata: Record<string, unknown>;
  polls: number;
  bodyKey: string;
  createdAtMs: number;
}

function envelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message, details: {} } });
}

function turns(script: FakeScript): unknown[] {
  if (script.transcript === false) {
    return [];
  }
  const bot = script.botLines ?? ["Hello, I am an automated assistant calling on behalf of somebody."];
  const callee = script.calleeLines ?? [];
  const output: unknown[] = [];
  let offset = 0;
  for (let index = 0; index < Math.max(bot.length, callee.length); index += 1) {
    if (bot[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "bot", text: bot[index] });
      offset += 6;
    }
    if (callee[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "user", text: callee[index] });
      offset += 7;
    }
  }
  return output;
}

function snapshot(call: StoredCall, terminal: boolean): string {
  const script = call.script;
  const status = terminal ? script.status ?? "completed" : call.polls === 0 ? "queued" : "in_progress";
  // Timestamps track the clock the caller runs on, the way the real API does, so a
  // window checked against them sees a live call.
  const startedAt = new Date(call.createdAtMs + 5_000).toISOString();
  const completedAt =
    script.completedAt === undefined ? new Date(call.createdAtMs + 10_000).toISOString() : script.completedAt;
  const structured = terminal ? script.structuredResult ?? null : null;
  const attempt = {
    id: `att_${call.id.slice(5)}`,
    phone: call.phones[0],
    status: terminal ? script.status ?? "completed" : "dialing",
    started_at: startedAt,
    completed_at: terminal ? completedAt : null,
    summary: null,
    transcript_turns: terminal ? turns(script) : [],
    provider_call_id: `provider_${call.id.slice(5)}`,
    failure_code: terminal ? script.failureCode ?? null : null,
    failure_message: null,
  };
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
        status: terminal ? script.status ?? "completed" : "in_progress",
        structured_result: structured,
        summary: terminal ? "Call finished." : null,
        attempts: [attempt],
      },
    ],
    structured_result: structured,
    summary: terminal ? "Call finished." : null,
    task_completed: terminal ? true : null,
    completion_confidence: terminal ? script.confidence ?? { score: 0.92, label: "high" } : null,
    evidence: terminal ? ["Recorded from the fake server."] : [],
    metadata: call.metadata,
    failure_code: terminal ? script.failureCode ?? null : null,
    failure_message: null,
    created_at: new Date(call.createdAtMs).toISOString(),
    completed_at: terminal ? completedAt : null,
  });
}

export async function startFakeCalle(scripts: FakeScript[]): Promise<FakeCalle> {
  const created: CreatedCall[] = [];
  const calls = new Map<string, StoredCall>();
  const idempotency = new Map<string, { id: string; bodyKey: string }>();
  const errorsSent = new Map<FakeScript, number>();
  let counter = 0;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(request.url ?? "/", "http://localhost");
      response.setHeader("content-type", "application/json");

      if (!(request.headers.authorization ?? "").startsWith("Bearer ")) {
        response.statusCode = 401;
        response.end(envelope("unauthorized", "Invalid or missing API key."));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/calls") {
        const body = JSON.parse(raw) as {
          task: string;
          recipients?: { phones: string[]; locale?: string }[];
          metadata?: Record<string, unknown>;
          result_schema?: Record<string, unknown>;
        };
        const phones = body.recipients?.[0]?.phones ?? [];
        const script = scripts.find((candidate) => candidate.phone === phones[0]);
        if (script === undefined) {
          response.statusCode = 400;
          response.end(envelope("invalid_recipient", `No fake script for ${String(phones[0])}.`));
          return;
        }
        const key = (request.headers["idempotency-key"] as string | undefined) ?? null;
        const bodyKey = JSON.stringify(body);
        if (key !== null) {
          const seen = idempotency.get(key);
          if (seen !== undefined) {
            if (seen.bodyKey !== bodyKey) {
              response.statusCode = 409;
              response.end(envelope("idempotency_conflict", "Key reused with a different body."));
              return;
            }
            response.statusCode = 201;
            response.end(snapshot(calls.get(seen.id)!, false));
            return;
          }
        }
        const failure = script.apiError;
        const sent = errorsSent.get(script) ?? 0;
        const failing = failure !== undefined && sent < (failure.times ?? Number.POSITIVE_INFINITY);
        if (failing && failure!.afterCreate !== true) {
          errorsSent.set(script, sent + 1);
          response.statusCode = failure!.status;
          response.end(envelope(failure!.code, "Fake server refused the call."));
          return;
        }
        counter += 1;
        const id = `call_fake${counter}`;
        const stored: StoredCall = {
          id,
          script,
          task: body.task,
          phones,
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
          phones,
          locale: body.recipients?.[0]?.locale,
          metadata: body.metadata ?? {},
          resultSchema: body.result_schema,
        });
        if (failing) {
          // The call exists and the caller is told nothing about it.
          errorsSent.set(script, sent + 1);
          response.statusCode = failure!.status;
          response.end(envelope(failure!.code, "Fake server lost the reply."));
          return;
        }
        response.statusCode = 201;
        response.end(snapshot(stored, false));
        return;
      }

      const eventsMatch = /^\/v1\/calls\/([^/]+)\/events$/.exec(url.pathname);
      if (request.method === "GET" && eventsMatch !== null) {
        const call = calls.get(eventsMatch[1]!);
        if (call === undefined) {
          response.statusCode = 404;
          response.end(envelope("not_found", "Unknown call."));
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
                created_at: new Date(call.createdAtMs + 10_000).toISOString(),
                level: "info",
                status: call.script.status ?? "completed",
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
        const call = calls.get(callMatch[1]!);
        if (call === undefined) {
          response.statusCode = 404;
          response.end(envelope("not_found", "Unknown call."));
          return;
        }
        if (call.script.pollError !== undefined) {
          response.statusCode = call.script.pollError.status;
          response.end(envelope(call.script.pollError.code, "Fake server could not read the call."));
          return;
        }
        call.polls += 1;
        const needed = call.script.pollsBeforeTerminal ?? 1;
        const terminal = call.script.stall === true ? false : call.polls >= needed;
        response.statusCode = 200;
        response.end(snapshot(call, terminal));
        return;
      }

      response.statusCode = 404;
      response.end(envelope("not_found", "Unknown route."));
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
