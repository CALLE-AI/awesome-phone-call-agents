/**
 * Local stand-in for the CALL-E Developer API.
 *
 * Scripts are keyed by phone and phase, because one party gets a gather call, a
 * confirm call and sometimes a release call in the same run. The server speaks
 * the documented wire contract, so the tests drive the real `@call-e/calle`
 * client against it with no credentials, no network and no phone line.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type FakePhase = "gather" | "confirm" | "release";

export interface FakeScript {
  phone: string;
  phase: FakePhase;
  status?: "completed" | "failed" | "canceled";
  botLines?: string[];
  userLines?: string[];
  transcript?: boolean;
  structuredResult?: Record<string, unknown> | null;
  confidence?: { score: number; label: string } | null;
  failureCode?: string | null;
  apiError?: { status: number; code: string };
  stall?: boolean;
}

export interface CreatedCall {
  id: string;
  idempotencyKey: string | null;
  task: string;
  phones: string[];
  phase: string;
  slotId: string;
  metadata: Record<string, unknown>;
  resultSchema: Record<string, unknown> | undefined;
}

export interface FakeCalle {
  baseUrl: string;
  created: CreatedCall[];
  close: () => Promise<void>;
}

export interface FakeOptions {
  /**
   * What the API reports as the moment a call finished. It defaults to the clock
   * when the server starts, so a test that pins no clock still gets timestamps its
   * own run can act on. A test that pins a clock passes the matching stamp here,
   * which is what makes a late answer reproducible.
   */
  completedAt?: string;
}

/** The three timestamps the API puts on a call, in the order they happen. */
interface Stamps {
  createdAt: string;
  startedAt: string;
  completedAt: string;
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

/**
 * What the caller says when a script does not override it. These are the lines
 * the real scripts ask for, so a confirm transcript contains the confirmation
 * question and a reader can bind an answer to it.
 */
const BOT_LINES: Record<FakePhase, string[]> = {
  gather: [
    "This is an automated scheduling call. Nothing is booked yet.",
    "Which of those could you do? You can say more than one option number or say none of them.",
  ],
  confirm: [
    "This is an automated scheduling call. I am confirming one appointment.",
    "Can I confirm that time? Please say confirm or say no if it does not work.",
  ],
  release: [
    "This is an automated scheduling call. This is a short update, no action needed.",
    "The appointment we discussed is not going ahead and nothing is booked.",
  ],
};

function turns(script: FakeScript): unknown[] {
  if (script.transcript === false) {
    return [];
  }
  const bot = script.botLines ?? BOT_LINES[script.phase];
  const user = script.userLines ?? [];
  const output: unknown[] = [];
  let offset = 0;
  for (let index = 0; index < Math.max(bot.length, user.length); index += 1) {
    if (bot[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "bot", text: bot[index] });
      offset += 4;
    }
    if (user[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "user", text: user[index] });
      offset += 4;
    }
  }
  return output;
}

function snapshot(call: StoredCall, terminal: boolean, stamps: Stamps): string {
  const script = call.script;
  const status = terminal ? script.status ?? "completed" : call.polls === 0 ? "queued" : "in_progress";
  const structured = terminal ? script.structuredResult ?? null : null;
  const attempt = {
    id: `att_${call.id.slice(5)}`,
    phone: call.phones[0],
    status: terminal ? script.status ?? "completed" : "dialing",
    started_at: stamps.startedAt,
    completed_at: terminal ? stamps.completedAt : null,
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
    completion_confidence: terminal ? script.confidence ?? { score: 0.9, label: "high" } : null,
    evidence: terminal ? ["Recorded from the fake server."] : [],
    metadata: call.metadata,
    failure_code: terminal ? script.failureCode ?? null : null,
    failure_message: null,
    created_at: stamps.createdAt,
    completed_at: terminal ? stamps.completedAt : null,
  });
}

export async function startFakeCalle(
  scripts: FakeScript[],
  options: FakeOptions = {},
): Promise<FakeCalle> {
  const completedAt = options.completedAt ?? new Date().toISOString();
  const finished = Date.parse(completedAt);
  const base = Number.isNaN(finished) ? Date.now() : finished;
  // Created, rang for a bit, then finished, in that order.
  const stamps: Stamps = {
    createdAt: new Date(base - 80_000).toISOString(),
    startedAt: new Date(base - 75_000).toISOString(),
    completedAt,
  };
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
      response.setHeader("content-type", "application/json");
      if (!(request.headers.authorization ?? "").startsWith("Bearer ")) {
        response.statusCode = 401;
        response.end(envelope("unauthorized", "Invalid or missing API key."));
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
        const phase = String(body.metadata?.phase ?? "");
        const script = scripts.find(
          (candidate) => candidate.phone === phones[0] && candidate.phase === phase,
        );
        if (script === undefined) {
          response.statusCode = 400;
          response.end(
            envelope("invalid_recipient", `No fake script for ${String(phones[0])} in phase ${phase}.`),
          );
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
            response.end(snapshot(calls.get(seen.id)!, false, stamps));
            return;
          }
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
          phase,
          slotId: String(body.metadata?.slot_id ?? ""),
          metadata: body.metadata ?? {},
          resultSchema: body.result_schema,
        });
        response.statusCode = 201;
        response.end(snapshot(stored, false, stamps));
        return;
      }

      const events = /^\/v1\/calls\/([^/]+)\/events$/.exec(url.pathname);
      if (request.method === "GET" && events !== null) {
        const call = calls.get(events[1]!);
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
                created_at: stamps.completedAt,
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

      const single = /^\/v1\/calls\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && single !== null) {
        const call = calls.get(single[1]!);
        if (call === undefined) {
          response.statusCode = 404;
          response.end(envelope("not_found", "Unknown call."));
          return;
        }
        call.polls += 1;
        response.statusCode = 200;
        response.end(snapshot(call, call.script.stall !== true, stamps));
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
