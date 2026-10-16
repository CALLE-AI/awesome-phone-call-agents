#!/usr/bin/env node
// Fake CALL-E Developer API server for offline tests and demos.
//
// It speaks the same three documented endpoints (POST /v1/calls,
// GET /v1/calls/{call_id}, GET /v1/calls/{call_id}/events), honors
// Idempotency-Key semantics, walks calls through a status lifecycle to a
// terminal state, and posts unsigned terminal webhooks carrying
// CALL-E-Event-Id. It never places a real call, needs no credentials, and
// binds to localhost by default.
//
// Shape sources (this file follows them; it is not a specification):
//   - https://github.com/CALLE-AI/call-e-integrations README "API" section
//   - packages/cli/docs/cli-reference.md in the same repository
// Statuses are lowercase, matching the documented example response. The
// "NO ANSWER" alias is a deliberately chosen fake no_answer test scenario.

import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCENARIO, METADATA_CONTROLS, SCENARIOS, scheduleLifecycle, TERMINAL_STATUSES } from "./lib/lifecycle.mjs";
import { deliverWebhook, isHttpUrl } from "./lib/webhook.mjs";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_TTL_SECONDS = 86400;
const DEFAULT_TERMINAL_DELAY_MS = 1200;

/**
 * @typedef {Object} AttemptRecord
 * @property {string} id
 * @property {string} phone
 * @property {string} status
 * @property {string} started_at
 * @property {string | null} completed_at
 * @property {string | null} summary
 * @property {{ offset_seconds: number, speaker: string, text: string }[]} transcript_turns
 * @property {string} provider_call_id
 * @property {string | null} failure_code
 * @property {string | null} failure_message
 *
 * @typedef {Object} RecipientRecord
 * @property {string} id
 * @property {string[]} phones
 * @property {string} region
 * @property {string | null} locale
 * @property {string} status
 * @property {Record<string, unknown> | null} structured_result
 * @property {AttemptRecord[]} attempts
 *
 * @typedef {Object} CallRecord
 * @property {string} id
 * @property {string} status
 * @property {string} created_at
 * @property {string} task
 * @property {Record<string, unknown> | null} metadata
 * @property {string | null} webhook_url
 * @property {number} ttl_seconds
 * @property {Record<string, unknown> | null} result_schema
 * @property {Record<string, unknown> | null} recipient_result_schema
 * @property {RecipientRecord[]} recipients
 * @property {boolean | null} task_completed
 * @property {{ score: number, label: string } | null} completion_confidence
 * @property {string[]} evidence
 * @property {Record<string, unknown> | null} structured_result
 * @property {string} scenario
 */

/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** @param {http.ServerResponse} res @param {number} status @param {string} code @param {string} message */
function sendError(res, status, code, message) {
  send(res, status, { error: { code, message, details: {} } });
}

/** @param {string} body @returns {Record<string, unknown> | null} */
function parseJsonObject(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the create-call body. Returns a list of `{ status, code, message }`
 * failures; empty means valid. Mutates nothing.
 * @param {Record<string, unknown>} body
 * @returns {{ status: number, code: string, message: string }[]}
 */
export function validateCreateBody(body) {
  const failures = [];
  const task = body.task;
  if (typeof task !== "string" || task.trim().length === 0) {
    failures.push({ status: 400, code: "invalid_task", message: "task must be a non-empty string." });
  }
  const recipients = body.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    failures.push({ status: 400, code: "no_recipients", message: "recipients must be a non-empty array." });
  } else {
    recipients.forEach((recipient, index) => {
      if (!isPlainObject(recipient)) {
        failures.push({ status: 400, code: "invalid_recipient", message: `recipients[${index}] must be an object.` });
        return;
      }
      const phones = recipient.phones;
      if (!Array.isArray(phones) || phones.length === 0) {
        failures.push({ status: 400, code: "no_recipients", message: `recipients[${index}].phones must be a non-empty array.` });
        return;
      }
      for (const phone of phones) {
        if (typeof phone !== "string" || !E164_PATTERN.test(phone)) {
          failures.push({
            status: 400,
            code: "invalid_e164",
            message: `recipients[${index}].phones entry "${String(phone)}" is not an E.164 number like +15555550100.`,
          });
        }
      }
      if (recipient.region !== undefined && (typeof recipient.region !== "string" || recipient.region.length !== 2)) {
        failures.push({ status: 400, code: "invalid_region", message: `recipients[${index}].region must be a 2-letter code.` });
      }
      if (recipient.locale !== undefined && typeof recipient.locale !== "string") {
        failures.push({ status: 400, code: "invalid_locale", message: `recipients[${index}].locale must be a string.` });
      }
    });
  }
  if (body.result_schema !== undefined && !isPlainObject(body.result_schema)) {
    failures.push({ status: 400, code: "invalid_result_schema", message: "result_schema must be an object." });
  }
  if (body.recipient_result_schema !== undefined && !isPlainObject(body.recipient_result_schema)) {
    failures.push({ status: 400, code: "invalid_recipient_result_schema", message: "recipient_result_schema must be an object." });
  }
  if (body.metadata !== undefined && !isPlainObject(body.metadata)) {
    failures.push({ status: 400, code: "invalid_metadata", message: "metadata must be an object." });
  }
  if (body.webhook_url !== undefined && (typeof body.webhook_url !== "string" || !isHttpUrl(body.webhook_url))) {
    failures.push({ status: 400, code: "invalid_webhook_url", message: "webhook_url must be an http(s) URL." });
  }
  if (body.ttl_seconds !== undefined) {
    const ttl = Number(body.ttl_seconds);
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > DEFAULT_TTL_SECONDS) {
      failures.push({ status: 400, code: "invalid_ttl_seconds", message: `ttl_seconds must be a number in (0, ${DEFAULT_TTL_SECONDS}].` });
    }
  }
  const scenario = isPlainObject(body.metadata) ? body.metadata[METADATA_CONTROLS.scenario] : undefined;
  if (scenario !== undefined && (typeof scenario !== "string" || !(scenario in SCENARIOS))) {
    failures.push({
      status: 400,
      code: "invalid_scenario",
      message: `metadata.scenario must be one of: ${Object.keys(SCENARIOS).join(", ")}.`,
    });
  }
  return failures;
}

/**
 * @param {Object} [options]
 * @param {string | null} [options.apiKey] When set, requests must carry this exact Bearer token. Any non-empty token is accepted otherwise.
 * @param {number} [options.terminalDelayMs] Default terminal delay.
 * @param {(line: string) => void} [options.log]
 * @returns {{ server: http.Server, close: () => void, port: () => number, callCount: () => number }}
 */
export function createFakeCalleServer(options = {}) {
  const apiKey = options.apiKey ?? null;
  const log = options.log ?? (() => {});
  const timing = {
    preparingMs: 150,
    dialingMs: 250,
    terminalMs: options.terminalDelayMs ?? DEFAULT_TERMINAL_DELAY_MS,
  };

  /** @type {Map<string, CallRecord>} */
  const calls = new Map();
  /** @type {Map<string, { callId: string, body: string }>} */
  const idempotency = new Map();
  /** @type {Map<string, { id: string, type: string, call_id: string, created_at: string, level: string, status: string, message: string, details: Record<string, unknown> }[]>} */
  const events = new Map();
  /** @type {Set<NodeJS.Timeout>} */
  const timers = new Set();

  /**
   * @param {string} callId
   * @param {string} type
   * @param {string} message
   * @param {string} [level]
   */
  function pushEvent(callId, type, message, level = "info") {
    const call = calls.get(callId);
    const list = events.get(callId) ?? [];
    const event = {
      id: `evt_${randomUUID().slice(0, 12)}`,
      type,
      call_id: callId,
      created_at: new Date().toISOString(),
      level,
      status: call?.status ?? "unknown",
      message,
      details: {},
    };
    list.push(event);
    events.set(callId, list);
    return event;
  }

  /** @param {CallRecord} call @param {Record<string, unknown>} body */
  function startCall(call, body) {
    calls.set(call.id, call);
    events.set(call.id, []);
    pushEvent(call.id, "call.created", "Call created.", "info");
    const scheduled = scheduleLifecycle(
      call,
      (callId, type, message, level) => pushEvent(callId, type, message, level),
      () => {
        const terminalEvent = (events.get(call.id) ?? []).at(-1);
        if (call.webhook_url && terminalEvent) {
          const repeat = Number(
            (isPlainObject(call.metadata) && call.metadata[METADATA_CONTROLS.webhookRepeat]) || 1,
          );
          void deliverWebhook(
            call.webhook_url,
            { type: `call.${call.status}`, call_id: call.id, status: call.status, occurred_at: new Date().toISOString() },
            { repeat: Number.isFinite(repeat) ? repeat : 1, eventId: terminalEvent.id, log },
          );
        }
      },
      timing,
    );
    for (const timer of scheduled) {
      timers.add(timer);
      timer.once?.("timeout", () => timers.delete(timer));
    }
    return call;
  }

  /** @param {CallRecord} call @returns {Record<string, unknown>} */
  function publicCall(call) {
    return {
      call_id: call.id,
      status: call.status,
      created_at: call.created_at,
      ttl_seconds: call.ttl_seconds,
      task: call.task,
      task_completed: call.task_completed,
      completion_confidence: call.completion_confidence,
      evidence: call.evidence,
      structured_result: call.structured_result,
      recipients: call.recipients.map((recipient) => ({
        id: recipient.id,
        phones: recipient.phones,
        region: recipient.region,
        locale: recipient.locale,
        status: recipient.status,
        structured_result: recipient.structured_result,
        attempts: recipient.attempts,
      })),
    };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && path === "/healthz") {
      send(res, 200, { ok: true });
      return;
    }

    const bearer = req.headers.authorization ?? "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : "";
    if (!token || (apiKey !== null && token !== apiKey)) {
      sendError(res, 401, "unauthorized", "A valid Bearer API key is required.");
      return;
    }

    const callMatch = path.match(/^\/v1\/calls\/([^/]+)$/);
    const eventsMatch = path.match(/^\/v1\/calls\/([^/]+)\/events$/);

    if (req.method === "POST" && path === "/v1/calls") {
      const raw = await readBody(req, res);
      if (raw === null) return;
      const body = parseJsonObject(raw);
      if (!body) {
        sendError(res, 400, "invalid_json", "Request body must be a JSON object.");
        return;
      }
      const failures = validateCreateBody(body);
      if (failures.length > 0) {
        sendError(res, failures[0].status, failures[0].code, failures[0].message);
        return;
      }
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
        const existing = idempotency.get(idempotencyKey);
        if (existing) {
          const replay = calls.get(existing.callId);
          if (replay && existing.body === raw) {
            send(res, 201, { ...publicCall(replay), idempotent_replay: true });
            return;
          }
          sendError(res, 409, "idempotency_key_reuse", "This Idempotency-Key was already used with a different body.");
          return;
        }
      }
      const callId = `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const ttlSeconds = Number(body.ttl_seconds ?? DEFAULT_TTL_SECONDS);
      /** @type {CallRecord} */
      const call = {
        id: callId,
        status: "queued",
        created_at: new Date().toISOString(),
        task: String(body.task),
        metadata: isPlainObject(body.metadata) ? body.metadata : null,
        webhook_url: typeof body.webhook_url === "string" ? body.webhook_url : null,
        ttl_seconds: ttlSeconds,
        result_schema: isPlainObject(body.result_schema) ? body.result_schema : null,
        recipient_result_schema: isPlainObject(body.recipient_result_schema) ? body.recipient_result_schema : null,
        recipients: /** @type {Recipients from body} */ (body.recipients).map((recipient, index) => ({
          id: `rcp_${callId.slice(5)}_${index + 1}`,
          phones: recipient.phones.map((phone) => String(phone)),
          region: typeof recipient.region === "string" ? recipient.region : "US",
          locale: typeof recipient.locale === "string" ? recipient.locale : null,
          status: "pending",
          structured_result: null,
          attempts: [],
        })),
        task_completed: null,
        completion_confidence: null,
        evidence: [],
        structured_result: null,
        scenario: DEFAULT_SCENARIO,
      };
      startCall(call, body);
      if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
        idempotency.set(idempotencyKey, { callId: call.id, body: raw });
      }
      log(`created ${call.id} (scenario ${isPlainObject(body.metadata) ? body.metadata[METADATA_CONTROLS.scenario] ?? DEFAULT_SCENARIO : DEFAULT_SCENARIO})`);
      send(res, 201, publicCall(call));
      return;
    }

    if (req.method === "GET" && callMatch) {
      const call = calls.get(callMatch[1]);
      if (!call) {
        sendError(res, 404, "not_found", "Unknown call_id.");
        return;
      }
      const expiresAt = Date.parse(call.created_at) + call.ttl_seconds * 1000;
      if (TERMINAL_STATUSES.has(call.status) && Date.now() > expiresAt) {
        sendError(res, 404, "expired", "ttl_seconds elapsed; the run is no longer queryable.");
        return;
      }
      send(res, 200, publicCall(call));
      return;
    }

    if (req.method === "GET" && eventsMatch) {
      const call = calls.get(eventsMatch[1]);
      if (!call) {
        sendError(res, 404, "not_found", "Unknown call_id.");
        return;
      }
      const limitParam = Number(url.searchParams.get("limit") ?? "");
      const list = events.get(call.id) ?? [];
      const limited = Number.isFinite(limitParam) && limitParam > 0 ? list.slice(-limitParam) : list;
      send(res, 200, { events: limited });
      return;
    }

    sendError(res, 404, "not_found", "Unknown endpoint.");
  });

  return {
    server,
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      server.close();
    },
    port() {
      const address = server.address();
      return typeof address === "object" && address ? address.port : 0;
    },
    callCount() {
      return calls.size;
    },
  };
}

/**
 * Read a request body with a size cap. Sends the error itself and returns null
 * when the body is unusable.
 * @param {http.IncomingMessage} req @param {http.ServerResponse} res
 * @returns {Promise<string | null>}
 */
async function readBody(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendError(res, 413, "payload_too_large", "Request body exceeds 1 MiB.");
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const flagValue = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const port = Number(flagValue("--port") ?? process.env.FAKE_CALLE_PORT ?? 8787);
  const host = flagValue("--host") ?? process.env.FAKE_CALLE_HOST ?? "127.0.0.1";
  const apiKey = flagValue("--api-key") ?? process.env.FAKE_CALLE_API_KEY ?? null;
  const terminalDelayMs = Number(flagValue("--terminal-delay-ms") ?? process.env.FAKE_CALLE_TERMINAL_DELAY_MS ?? DEFAULT_TERMINAL_DELAY_MS);
  const runner = createFakeCalleServer({ apiKey, terminalDelayMs, log: (line) => console.log(`[fake-calle-server] ${line}`) });
  runner.server.listen(port, host, () => {
    console.log(`[fake-calle-server] listening on http://${host}:${runner.server.address()?.port ?? port}`);
    console.log(`[fake-calle-server] auth: ${apiKey ? "fixed key (--api-key)" : "any non-empty Bearer token"}`);
  });
}
