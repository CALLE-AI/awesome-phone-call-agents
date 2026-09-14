/**
 * Local stand-in for the CALL-E Developer API. One errand is one call, so scripts
 * are keyed by phone. It speaks the documented wire contract, so the tests drive
 * the real `@call-e/calle` client against it with no credentials and no phone line.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeScript {
  phone: string;
  status?: "completed" | "failed" | "canceled";
  botLines?: string[];
  userLines?: string[];
  transcript?: boolean;
  structuredResult?: Record<string, unknown> | null;
  confidence?: { score: number; label: string } | null;
  failureCode?: string | null;
  apiError?: { status: number; code: string };
  /**
   * One answer per create attempt, in order, so a first attempt that leaves the
   * call unknown can be followed by an answer of another class.
   */
  createErrors?: { status: number; code: string }[];
  /** The call is created and the answer to the create is lost, so the caller cannot tell. */
  lostCreateResponse?: boolean;
  /** Reading the call back fails, so the result of a created call cannot be read. */
  pollError?: { status: number; code: string };
  stall?: boolean;
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
}

function envelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message, details: {} } });
}

function turns(script: FakeScript): unknown[] {
  if (script.transcript === false) {
    return [];
  }
  const bot = script.botLines ?? ["Hello, I am an automated assistant calling on behalf of someone."];
  const user = script.userLines ?? [];
  const output: unknown[] = [];
  let offset = 0;
  for (let index = 0; index < Math.max(bot.length, user.length); index += 1) {
    if (bot[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "bot", text: bot[index] });
      offset += 6;
    }
    if (user[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "user", text: user[index] });
      offset += 7;
    }
  }
  return output;
}

function snapshot(call: StoredCall, terminal: boolean): string {
  const script = call.script;
  const status = terminal ? script.status ?? "completed" : call.polls === 0 ? "queued" : "in_progress";
  const structured = terminal ? script.structuredResult ?? null : null;
  const attempt = {
    id: `att_${call.id.slice(5)}`,
    phone: call.phones[0],
    status: terminal ? script.status ?? "completed" : "dialing",
    started_at: "2026-08-04T17:02:00Z",
    completed_at: terminal ? "2026-08-04T17:03:40Z" : null,
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
    completion_confidence: terminal ? script.confidence ?? { score: 0.91, label: "high" } : null,
    evidence: terminal ? ["Recorded from the fake server."] : [],
    metadata: call.metadata,
    failure_code: terminal ? script.failureCode ?? null : null,
    failure_message: null,
    created_at: "2026-08-04T17:01:50Z",
    completed_at: terminal ? "2026-08-04T17:03:40Z" : null,
  });
}

export async function startFakeCalle(scripts: FakeScript[]): Promise<FakeCalle> {
  const created: CreatedCall[] = [];
  const calls = new Map<string, StoredCall>();
  const idempotency = new Map<string, { id: string; bodyKey: string }>();
  /** Create attempts per script, so `createErrors` can answer them one at a time. */
  const createAttempts = new Map<string, number>();
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
        const attempts = (createAttempts.get(script.phone) ?? 0) + 1;
        createAttempts.set(script.phone, attempts);
        const sequenced = script.createErrors?.[attempts - 1];
        if (sequenced !== undefined) {
          response.statusCode = sequenced.status;
          response.end(envelope(sequenced.code, `Fake server answered create attempt ${attempts} with an error.`));
          return;
        }
        if (script.apiError !== undefined) {
          response.statusCode = script.apiError.status;
          response.end(envelope(script.apiError.code, "Fake server refused the call."));
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
        if (script.lostCreateResponse === true) {
          // The call exists. The caller just never finds out from this response.
          response.statusCode = 503;
          response.end(envelope("service_unavailable", "The answer to the create was lost."));
          return;
        }
        response.statusCode = 201;
        response.end(snapshot(stored, false));
        return;
      }

      const single = /^\/v1\/calls\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && single !== null) {
        const call = calls.get(single[1]!);
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
        response.statusCode = 200;
        response.end(snapshot(call, call.script.stall !== true));
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
