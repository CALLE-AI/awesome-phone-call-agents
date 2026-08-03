/**
 * Local stand-in for the CALL-E Developer API. Speaks the documented wire
 * contract for create/get, so tests and the demo drive the real
 * `@call-e/calle` client against it with no credentials and no phone line.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeScript {
  phone: string;
  status?: "completed" | "failed" | "canceled";
  structuredResult?: Record<string, unknown> | null;
  summary?: string | null;
  failureCode?: string | null;
}

export interface CreatedCall {
  id: string;
  idempotencyKey: string | null;
  phone: string;
}

export interface FakeCalle {
  baseUrl: string;
  created: CreatedCall[];
  close: () => Promise<void>;
}

interface StoredCall {
  id: string;
  phone: string;
  script: FakeScript;
  polls: number;
}

function envelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

function snapshot(call: StoredCall, terminal: boolean): string {
  const script = call.script;
  const status = terminal ? script.status ?? "completed" : call.polls === 0 ? "queued" : "in_progress";
  const structuredResult = terminal ? script.structuredResult ?? null : null;
  return JSON.stringify({
    id: call.id,
    object: "call_task",
    status,
    task: "wellness check-in",
    recipients: [
      {
        id: `rcp_${call.id.slice(5)}`,
        phones: [call.phone],
        locale: "en-US",
        region: "US",
        status,
        structured_result: structuredResult,
        summary: terminal ? script.summary ?? "Call finished." : null,
        attempts: [],
      },
    ],
    structured_result: structuredResult,
    summary: terminal ? script.summary ?? "Call finished." : null,
    task_completed: terminal ? true : null,
    completion_confidence: null,
    evidence: [],
    metadata: {},
    failure_code: terminal ? script.failureCode ?? null : null,
    failure_message: null,
    created_at: "2026-08-04T17:01:50Z",
    completed_at: terminal ? "2026-08-04T17:03:40Z" : null,
  });
}

export async function startFakeCalle(scripts: FakeScript[]): Promise<FakeCalle> {
  const created: CreatedCall[] = [];
  const calls = new Map<string, StoredCall>();
  const idempotency = new Map<string, string>();
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
          recipients?: { phones?: string[] }[];
        };
        const phone = body.recipients?.[0]?.phones?.[0] ?? "";
        const script = scripts.find((candidate) => candidate.phone === phone);
        if (script === undefined) {
          response.statusCode = 400;
          response.end(envelope("invalid_recipient", `No fake script for this phone number.`));
          return;
        }

        const key = (request.headers["idempotency-key"] as string | undefined) ?? null;
        if (key !== null && idempotency.has(key)) {
          response.statusCode = 201;
          response.end(snapshot(calls.get(idempotency.get(key)!)!, false));
          return;
        }

        counter += 1;
        const id = `call_fake${counter}`;
        const stored: StoredCall = { id, phone, script, polls: 0 };
        calls.set(id, stored);
        if (key !== null) idempotency.set(key, id);
        created.push({ id, idempotencyKey: key, phone });

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
        call.polls += 1;
        response.statusCode = 200;
        response.end(snapshot(call, true));
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
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
