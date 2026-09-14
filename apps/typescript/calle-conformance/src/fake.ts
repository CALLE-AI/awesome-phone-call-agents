/**
 * A CALL-E server that answers with the corpus.
 *
 * A fake written from the documentation reproduces the documentation. That is
 * the sentence this whole project turns on, and until now it was only an
 * argument: the corpus could audit someone else's fixtures, and it could prove
 * its own masking held, but nothing in here would answer an HTTP request. So a
 * team that wanted to develop against real behaviour still had to write their
 * own mock from the same documentation the corpus contradicts.
 *
 * This serves the fifteen captured responses over the wire, on the routes the
 * SDK actually calls, so `CALLE_BASE_URL=http://127.0.0.1:4010` is the whole
 * integration. Point a test suite at it and the payloads that arrive carry the
 * timestamp with no designator, the raw SIP code in `failureCode`, the
 * structured result with no conversation behind it, and the turn that lands
 * after the agent said goodbye.
 *
 * Two rules keep it honest.
 *
 * Payloads are served verbatim. The only field rewritten is the root `id`, so
 * a client can retrieve what it created. Timestamps are the captured ones,
 * which means they sit in the past; moving them to now would have meant
 * recomputing the intervals that carry three of the findings.
 *
 * The counter is modelled as measured, not as documented. Every create that
 * reaches the planner spends a unit, including the ones the planner then
 * rejects, which is the finding more than twenty projects in this repository
 * are budgeting against. At the cap the limiter answers first and spends
 * nothing, which is why watching the counter is free only while it is full.
 *
 *   node src/fake.ts [--port 4010] [--fixture <file>] [--quirk <id>]
 *                    [--settle <polls>] [--limit <units>] [--list]
 *
 * Nothing here places a call, and no key is read.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { QUIRKS, type CallPayload } from "./quirks.ts";

const FIXTURES = "fixtures/calls";
const QUEUED = "queued-no-failure-0turns-10f4ce.json";

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : (process.argv[i + 1] ?? fallback);
};
const has = (name: string) => process.argv.includes(`--${name}`);

const load = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as CallPayload;
const quirksIn = (call: CallPayload) => QUIRKS.filter((q) => q.holds(call)).map((q) => q.id);

const every = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (has("list")) {
  for (const file of every) {
    const ids = quirksIn(load(file));
    process.stdout.write(`${file}\n`);
    process.stdout.write(ids.length === 0 ? "    no quirk\n" : ids.map((i) => `    ${i}\n`).join(""));
  }
  process.exit(0);
}

/** Which captured responses this run will hand out, in order, round robin. */
function rota(): string[] {
  const pinned = flag("fixture", "");
  if (pinned !== "") {
    if (!every.includes(pinned)) {
      process.stderr.write(`no such fixture: ${pinned}\nRun with --list to see them.\n`);
      process.exit(2);
    }
    return [pinned];
  }
  const quirk = flag("quirk", "");
  if (quirk === "") return every.filter((f) => f !== QUEUED);

  if (!QUIRKS.some((q) => q.id === quirk)) {
    process.stderr.write(`no such quirk: ${quirk}\nRun with --list to see which fixtures carry which.\n`);
    process.exit(2);
  }
  const carriers = every.filter((f) => quirksIn(load(f)).includes(quirk));
  if (carriers.length === 0) {
    process.stderr.write(`no fixture in the corpus carries ${quirk}\n`);
    process.exit(2);
  }
  return carriers;
}

const PORT = Number(flag("port", "4010"));
const SETTLE = Number(flag("settle", "2"));
const LIMIT = Number(flag("limit", "20"));
const ROTA = rota();
const queued = load(QUEUED);

type Held = { terminal: CallPayload; polls: number };
const issued = new Map<string, Held>();
let handed = 0;
let spent = 0;

/**
 * The corpus stores what the SDK hands back, and the SDK renames on the way in.
 * A server that answered in the SDK's own vocabulary would leave every mapped
 * field undefined, so the corpus is put back on the wire before it is sent.
 *
 * These lists are the inverse of `fromApiCall`, `fromApiRecipient` and
 * `fromApiAttempt` in @call-e/calle 0.7.0. Transcript turns are not mapped by
 * the SDK at all, which is why their `offset_seconds` is already snake case in
 * the fixtures and is passed through untouched here.
 */
const CALL_KEYS = {
  structuredResult: "structured_result",
  taskCompleted: "task_completed",
  completionConfidence: "completion_confidence",
  failureCode: "failure_code",
  failureMessage: "failure_message",
  createdAt: "created_at",
  completedAt: "completed_at",
} as const;
const RECIPIENT_KEYS = { structuredResult: "structured_result" } as const;
const ATTEMPT_KEYS = {
  startedAt: "started_at",
  completedAt: "completed_at",
  transcriptTurns: "transcript_turns",
  providerCallId: "provider_call_id",
  failureCode: "failure_code",
  failureMessage: "failure_message",
} as const;

const rename = (value: unknown, keys: Record<string, string>): Record<string, unknown> => {
  const source = (value ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(source)) out[keys[key] ?? key] = held;
  return out;
};

const onWire = (call: CallPayload, id: string): Record<string, unknown> => {
  const out = rename({ ...call, id }, CALL_KEYS);
  const recipients = Array.isArray(call.recipients) ? call.recipients : [];
  out.recipients = recipients.map((recipient) => {
    const mapped = rename(recipient, RECIPIENT_KEYS);
    const attempts = Array.isArray(recipient?.attempts) ? recipient.attempts : [];
    mapped.attempts = attempts.map((attempt) => rename(attempt, ATTEMPT_KEYS));
    return mapped;
  });
  return out;
};

const send = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
};

const fail = (res: ServerResponse, status: number, code: string, message: string, details: Record<string, unknown> = {}) =>
  send(res, status, { error: { code, message, details } });

const body = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}") as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });

/**
 * The platform accepts a handful of regions. A create for any other one is
 * rejected, and the rejection still costs a unit, which is the whole point of
 * being able to run this locally.
 */
const SUPPORTED = new Set(["US", "CA", "GB", "AU", "NZ", "IE"]);

const regionOf = (payload: Record<string, unknown>): string => {
  const one = payload.recipient as { region?: unknown } | undefined;
  const many = payload.recipients as Array<{ region?: unknown }> | undefined;
  const first = Array.isArray(many) && many.length > 0 ? many[0] : one;
  const region = first?.region;
  return typeof region === "string" ? region.toUpperCase() : "US";
};

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (!/^Bearer\s+\S/.test(req.headers.authorization ?? "")) {
    return fail(res, 401, "authentication_error", "No API key was supplied.");
  }

  // The five endpoints a caller reaches for when it wants its own balance, and
  // which the platform does not serve. Reproduced so nobody writes against a
  // mock that answers them.
  if (["/v1/account", "/v1/balance", "/v1/credits", "/v1/usage", "/v1/me"].includes(path)) {
    return fail(res, 404, "not_found", `No route for ${path}.`);
  }

  if (req.method === "POST" && path === "/v1/calls") {
    if (spent >= LIMIT) {
      return fail(res, 429, "rate_limit_exceeded", "Call limit reached for this window.", {
        count: spent,
        limit: LIMIT,
        window_hours: 24,
      });
    }

    const payload = await body(req);
    spent += 1; // The planner was reached. Whatever it decides next, the unit is gone.

    const region = regionOf(payload);
    if (!SUPPORTED.has(region)) {
      return fail(res, 422, "unsupported_destination", `Region ${region} is not available.`, { region });
    }
    if (typeof payload.task !== "string" || payload.task.trim() === "") {
      return fail(res, 422, "invalid_request", "task is required.");
    }

    const id = `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    issued.set(id, { terminal: load(ROTA[handed % ROTA.length] as string), polls: 0 });
    handed += 1;
    return send(res, 201, onWire(queued, id));
  }

  const retrieve = /^\/v1\/calls\/([^/]+)$/.exec(path);
  if (req.method === "GET" && retrieve) {
    const callId = retrieve[1] as string;
    const held = issued.get(callId);
    if (held === undefined) return fail(res, 404, "not_found", "No such call.");
    held.polls += 1;
    return send(res, 200, onWire(held.polls > SETTLE ? held.terminal : queued, callId));
  }

  const events = /^\/v1\/calls\/([^/]+)\/events$/.exec(path);
  if (req.method === "GET" && events) {
    if (!issued.has(events[1] as string)) return fail(res, 404, "not_found", "No such call.");
    return send(res, 200, { object: "list", data: [], nextCursor: null });
  }

  return fail(res, 404, "not_found", `No route for ${req.method} ${path}.`);
}

export const server = createServer((req, res) => {
  route(req, res).catch(() => fail(res, 500, "internal_error", "The fake failed, which the real one would not phrase this way."));
});

if (process.argv[1]?.endsWith("fake.ts")) {
  server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`serving the corpus on http://127.0.0.1:${PORT}\n\n`);
    process.stdout.write(`  CALLE_BASE_URL=http://127.0.0.1:${PORT}\n\n`);
    process.stdout.write(`${ROTA.length} response${ROTA.length === 1 ? "" : "s"} in rotation, ${SETTLE} poll${SETTLE === 1 ? "" : "s"} queued before each settles.\n`);
    process.stdout.write(`${LIMIT} units in the window. Rejected creates spend one too.\n`);
    process.stdout.write(`Timestamps are the captured ones, so they sit in the past.\n`);
  });
}
