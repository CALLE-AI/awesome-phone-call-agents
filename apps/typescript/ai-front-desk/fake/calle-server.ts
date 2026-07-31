// Local stand-in for the CALL-E Developer API, so tests drive the real
// @call-e/calle SDK against it with no credentials and no phone line.
// Speaks the same wire contract as apps/typescript/call-on-behalf/fake/calle-server.ts.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeScript {
  phone: string;
  status?: "completed" | "failed" | "canceled";
  botLines?: string[];
  userLines?: string[];
  structuredResult?: Record<string, unknown> | null;
}

export interface FakeCalle {
  baseUrl: string;
  close: () => Promise<void>;
}

interface StoredCall {
  id: string;
  script: FakeScript;
  task: string;
}

function envelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message, details: {} } });
}

function turns(script: FakeScript): unknown[] {
  const bot = script.botLines ?? ["Hello, this is an automated assistant."];
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

function snapshot(call: StoredCall): string {
  const script = call.script;
  const status = script.status ?? "completed";
  const attempt = {
    id: `att_${call.id.slice(5)}`,
    phone: script.phone,
    status,
    started_at: "2026-08-04T17:02:00Z",
    completed_at: "2026-08-04T17:03:40Z",
    summary: null,
    transcript_turns: turns(script),
    provider_call_id: `provider_${call.id.slice(5)}`,
    failure_code: null,
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
        phones: [script.phone],
        locale: "en-US",
        region: "US",
        status,
        structured_result: script.structuredResult ?? null,
        summary: "Call finished.",
        attempts: [attempt],
      },
    ],
    structured_result: script.structuredResult ?? null,
    summary: "Call finished.",
    task_completed: status === "completed",
    completion_confidence: { score: 0.91, label: "high" },
    evidence: ["Recorded from the fake server."],
    metadata: {},
    failure_code: null,
    failure_message: null,
    created_at: "2026-08-04T17:01:50Z",
    completed_at: "2026-08-04T17:03:40Z",
  });
}

export async function startFakeCalle(scripts: FakeScript[]): Promise<FakeCalle> {
  const calls = new Map<string, StoredCall>();
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
        const body = JSON.parse(raw) as { task: string; recipients?: { phones: string[] }[] };
        const phone = body.recipients?.[0]?.phones?.[0];
        const script = scripts.find((candidate) => candidate.phone === phone);
        if (script === undefined) {
          response.statusCode = 400;
          response.end(envelope("invalid_recipient", `No fake script for ${String(phone)}.`));
          return;
        }
        counter += 1;
        const id = `call_fake${counter}`;
        calls.set(id, { id, script, task: body.task });
        response.statusCode = 201;
        response.end(snapshot(calls.get(id)!));
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
        response.statusCode = 200;
        response.end(snapshot(call));
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
