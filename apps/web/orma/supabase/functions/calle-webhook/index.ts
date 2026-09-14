/**
 * T2.6 CALL-E webhook receiver.
 *
 * CALL-E does not sign webhook requests. The path secret is the first gate.
 * The envelope only selects an authoritative GET /v1/calls/{id}. No call,
 * item, result, or billing state is ever taken from the webhook body.
 */

import { terminalStateFor } from "../_shared/poll.ts";
import { recordCallEvent } from "../_shared/events.ts";

const EVENT_ID_HEADER = "call-e-event-id";
const MAX_BODY_BYTES = 128 * 1024;
const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_-]+$/;
const CALL_ID_PATTERN = /^call_[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A claim is reclaimed once this much wall clock has passed without a
// terminal state, so a killed or failed invocation cannot strand an id.
const REFRESH_LEASE_MS = 5 * 60 * 1000;
const TERMINAL_EVENT_TYPES = new Set([
  "call.completed",
  "call.failed",
  "call.result_validation_failed",
]);

/** The tag this receiver stamps on the run, so attribution names the event. */
const EVENT_TAG_PREFIX = "webhook:";

const PENDING = "pending";
const REFRESHING = "refreshing";
const REFETCHED = "refetched";
const IGNORED = "ignored";

export type WebhookDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  webhookSecret: string;
  calleApiBase: string;
  calleApiKey: string;
  fetch: typeof fetch;
};

type WebhookEnvelope = {
  id: string;
  type: "call.completed" | "call.failed" | "call.result_validation_failed";
  created_at: string;
  data: { id: string };
};

type AuthoritativeCall = {
  id: string;
  status: string;
  metadata: { call_run_id?: string; phone_confirmation_id?: string };
};

export function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export function webhookUrl(apiUrl: string, secret: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/functions/v1/calle-webhook/${secret}`;
}

export function presentedWebhookSecret(pathname: string): string | null {
  const marker = "/calle-webhook/";
  const index = pathname.indexOf(marker);
  if (index === -1) return null;
  const secret = pathname.slice(index + marker.length).replace(/\/+$/, "");
  return secret || null;
}

export function webhookSecretsMatch(presented: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(presented);
  const right = encoder.encode(expected);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

function restUrl(apiUrl: string, path: string, query = ""): string {
  return `${apiUrl.replace(/\/+$/, "")}/rest/v1/${path}${query ? `?${query}` : ""}`;
}

function serviceHeaders(key: string, prefer?: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

export function parseWebhookEnvelope(body: string, headerEventId: string): WebhookEnvelope | null {
  if (!EVENT_ID_PATTERN.test(headerEventId)) return null;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Partial<WebhookEnvelope>;
  if (
    envelope.id !== headerEventId ||
    typeof envelope.id !== "string" ||
    typeof envelope.type !== "string" ||
    !TERMINAL_EVENT_TYPES.has(envelope.type) ||
    typeof envelope.created_at !== "string" ||
    Number.isNaN(Date.parse(envelope.created_at)) ||
    !envelope.data ||
    typeof envelope.data !== "object" ||
    typeof envelope.data.id !== "string" ||
    !CALL_ID_PATTERN.test(envelope.data.id)
  ) return null;
  return envelope as WebhookEnvelope;
}

function parseAuthoritativeCall(value: unknown, expectedCallId: string): AuthoritativeCall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const call = value as Partial<AuthoritativeCall>;
  if (
    call.id !== expectedCallId ||
    typeof call.status !== "string" ||
    call.status.trim().length === 0 ||
    !call.metadata ||
    typeof call.metadata !== "object" ||
    (typeof call.metadata.call_run_id !== "string" && typeof call.metadata.phone_confirmation_id !== "string") ||
    (typeof call.metadata.call_run_id === "string" && !UUID_PATTERN.test(call.metadata.call_run_id)) ||
    (typeof call.metadata.phone_confirmation_id === "string" && !UUID_PATTERN.test(call.metadata.phone_confirmation_id))
  ) return null;
  return call as AuthoritativeCall;
}

export function depsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): WebhookDeps {
  return {
    apiUrl: requireNamedEnv("ORMA_API_URL", getEnv),
    serviceRoleKey: requireNamedEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv),
    webhookSecret: requireNamedEnv("ORMA_WEBHOOK_SECRET", getEnv),
    calleApiBase: requireNamedEnv("CALLE_API_BASE", getEnv),
    calleApiKey: requireNamedEnv("CALLE_API_KEY", getEnv),
    fetch: fetchImpl,
  };
}

/** Records the event id. A conflict means CALL-E redelivered a known event. */
async function insertPendingEvent(deps: WebhookDeps, eventId: string): Promise<void> {
  const response = await deps.fetch(restUrl(deps.apiUrl, "webhook_events"), {
    method: "POST",
    headers: serviceHeaders(deps.serviceRoleKey, "return=minimal"),
    body: JSON.stringify({ event_id: eventId, type: PENDING }),
  });
  if (response.status === 409) return;
  if (!response.ok) throw new Error("webhook event record failed");
}

async function claimPendingEvent(deps: WebhookDeps, eventId: string, now = Date.now()): Promise<boolean> {
  const staleBefore = new Date(now - REFRESH_LEASE_MS).toISOString();
  const query = new URLSearchParams({
    event_id: `eq.${eventId}`,
    or: `(type.eq.${PENDING},and(type.eq.${REFRESHING},received_at.lt.${staleBefore}))`,
  });
  const response = await deps.fetch(restUrl(deps.apiUrl, "webhook_events", query.toString()), {
    method: "PATCH",
    headers: serviceHeaders(deps.serviceRoleKey, "return=representation"),
    body: JSON.stringify({ type: REFRESHING, received_at: new Date(now).toISOString() }),
  });
  if (!response.ok) throw new Error("webhook event claim failed");
  const rows: unknown = await response.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function setEventState(deps: WebhookDeps, eventId: string, type: string): Promise<void> {
  const query = new URLSearchParams({ event_id: `eq.${eventId}`, type: `eq.${REFRESHING}` });
  const response = await deps.fetch(restUrl(deps.apiUrl, "webhook_events", query.toString()), {
    method: "PATCH",
    headers: serviceHeaders(deps.serviceRoleKey, "return=minimal"),
    body: JSON.stringify({ type }),
  });
  if (!response.ok) throw new Error("webhook event state update failed");
}

async function fetchAuthoritativeCall(deps: WebhookDeps, callId: string): Promise<AuthoritativeCall | null> {
  const response = await deps.fetch(
    `${deps.calleApiBase.replace(/\/+$/, "")}/v1/calls/${encodeURIComponent(callId)}`,
    { headers: { authorization: `Bearer ${deps.calleApiKey}` } },
  );
  if (!response.ok) throw new Error(`CALL-E re-fetch returned HTTP ${response.status}`);
  return parseAuthoritativeCall(await response.json(), callId);
}

/**
 * Moves the run to the state the re-fetch reports, and only while the run is
 * still pending. The webhook and the poll both write here, so the conditional
 * PATCH is what makes exactly one of them win. The body never supplies a
 * state, only the authoritative GET does. The write also stamps this event's
 * tag on `terminal_writer`, in the same statement as the state.
 */
type RefetchOutcome = "applied" | "already_resolved" | "not_terminal";

async function terminaliseFromRefetch(
  deps: WebhookDeps,
  call: AuthoritativeCall,
  eventTag: string,
): Promise<RefetchOutcome> {
  const runId = call.metadata.call_run_id;
  if (!runId) throw new Error("call run metadata missing");
  const state = terminalStateFor(call.status);
  if (!state) return "not_terminal";
  const query = new URLSearchParams({
    id: `eq.${runId}`,
    state: "in.(dispatched,awaiting_result)",
  });
  const response = await deps.fetch(restUrl(deps.apiUrl, "call_runs", query.toString()), {
    method: "PATCH",
    headers: serviceHeaders(deps.serviceRoleKey, "return=representation"),
    body: JSON.stringify({ state, poll_after: null, terminal_writer: eventTag }),
  });
  if (!response.ok) throw new Error("call run terminalisation failed");
  const rows = await response.json() as unknown[];
  if (Array.isArray(rows) && rows.length === 1) return "applied";
  // Zero matched rows means another guarded write moved the run first. The
  // stored tag names that writer, so a redelivery of this event's own write
  // reads it back, and a second event or a poll reads a different tag.
  return await readTerminalWriter(deps, runId) === eventTag
    ? "applied"
    : "already_resolved";
}

/**
 * Reads the tag the guarded write stored. The column is written in the same
 * statement as `state`, so it names the one writer that moved the run. A null
 * means no tagged writer claimed the move, so this event did not.
 */
async function readTerminalWriter(deps: WebhookDeps, runId: string): Promise<string | null> {
  const query = new URLSearchParams({ select: "terminal_writer", id: `eq.${runId}`, limit: "1" });
  const response = await deps.fetch(restUrl(deps.apiUrl, "call_runs", query.toString()), {
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("call run attribution read failed");
  const runs = await response.json() as { terminal_writer?: string | null }[];
  return Array.isArray(runs) ? runs[0]?.terminal_writer ?? null : null;
}

async function hasMatchingOrmaRun(deps: WebhookDeps, call: AuthoritativeCall): Promise<boolean> {
  if (!call.metadata.call_run_id) return false;
  const query = new URLSearchParams({
    select: "id",
    id: `eq.${call.metadata.call_run_id}`,
    calle_call_id: `eq.${call.id}`,
    limit: "1",
  });
  const response = await deps.fetch(restUrl(deps.apiUrl, "call_runs", query.toString()), {
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("call run ownership check failed");
  const rows: unknown = await response.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function updatePhoneConfirmationFromRefetch(deps: WebhookDeps, call: AuthoritativeCall): Promise<boolean> {
  const confirmationId = call.metadata.phone_confirmation_id;
  if (!confirmationId) return false;
  const state = call.status === "completed" ? "dialled" : call.status === "failed" ? "failed" : "refused";
  // A confirmation may have been expired because its profile number changed
  // after CALL-E accepted the request. Recovery may repair a missing dispatch
  // write, but it must never move an expired, confirmed, or timed-out row.
  const recoverableStates = call.status === "completed"
    ? "in.(requested,failed)"
    : "in.(requested,dialled,failed)";
  const query = new URLSearchParams({
    id: `eq.${confirmationId}`,
    state: recoverableStates,
    expires_at: `gt.${new Date().toISOString()}`,
  });
  const response = await deps.fetch(
    restUrl(deps.apiUrl, "phone_confirmations", query.toString()),
    // The original dispatch patch can fail after CALL-E has accepted the
    // request. The authoritative re-fetch is then the durable handoff: it
    // binds the provider id and restores a completed call to a verifiable
    // state, rather than silently consuming the terminal event.
    { method: "PATCH", headers: serviceHeaders(deps.serviceRoleKey, "return=representation"), body: JSON.stringify({ state, calle_call_id: call.id }) },
  );
  if (!response.ok) throw new Error("phone confirmation webhook update failed");
  const rows = await response.json() as unknown[];
  return Array.isArray(rows) && rows.length === 1;
}

export function createWebhookHandler(deps: WebhookDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    const presented = presentedWebhookSecret(new URL(request.url).pathname);
    if (!presented || !webhookSecretsMatch(presented, deps.webhookSecret)) {
      return new Response(null, { status: 401 });
    }
    const headerEventId = request.headers.get(EVENT_ID_HEADER);
    if (!headerEventId) return new Response(null, { status: 400 });
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
        return new Response(null, { status: 413 });
      }
      const envelope = parseWebhookEnvelope(body, headerEventId);
      if (!envelope) return new Response(null, { status: 400 });
      await insertPendingEvent(deps, envelope.id);
      if (!await claimPendingEvent(deps, envelope.id)) return new Response(null, { status: 200 });
      try {
        const call = await fetchAuthoritativeCall(deps, envelope.data.id);
        if (!call) {
          await setEventState(deps, envelope.id, IGNORED);
          return new Response(null, { status: 200 });
        }
        if (call.metadata.phone_confirmation_id) {
          await updatePhoneConfirmationFromRefetch(deps, call);
          await setEventState(deps, envelope.id, REFETCHED);
          return new Response(null, { status: 200 });
        }
        if (!call.metadata.call_run_id) {
          await setEventState(deps, envelope.id, IGNORED);
          return new Response(null, { status: 200 });
        }
        if (!await hasMatchingOrmaRun(deps, call)) {
          await setEventState(deps, envelope.id, IGNORED);
          return new Response(null, { status: 200 });
        }
        // Persist the transition before the timeline claims it, so a failed
        // write never leaves an entry asserting a state that never landed.
        // The event row is released to pending below, so this is retried.
        const outcome = await terminaliseFromRefetch(deps, call, `${EVENT_TAG_PREFIX}${envelope.id}`);
        const eventDeps = { apiUrl: deps.apiUrl, serviceRoleKey: deps.serviceRoleKey, fetch: deps.fetch };
        await recordCallEvent(
          call.metadata.call_run_id,
          "webhook_received",
          { calle_call_id: call.id, event_type: envelope.type },
          eventDeps,
        );
        await recordCallEvent(
          call.metadata.call_run_id,
          "refetched",
          { calle_call_id: call.id, event_type: envelope.type, state: call.status, outcome },
          eventDeps,
        );
        await setEventState(deps, envelope.id, REFETCHED);
        return new Response(null, { status: 200 });
      } catch (error) {
        try {
          await setEventState(deps, envelope.id, PENDING);
        } catch (releaseError) {
          console.error("calle webhook event release failed", releaseError instanceof Error ? releaseError.message : "unknown error");
        }
        throw error;
      }
    } catch (error) {
      console.error("calle webhook re-fetch failed", error instanceof Error ? error.message : "unknown error");
      return new Response(null, { status: 500 });
    }
  };
}

if (import.meta.main) Deno.serve(createWebhookHandler(depsFromEnv()));

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  const event = (id = "evt_terminal"): Record<string, unknown> => ({
    id, type: "call.completed", created_at: "2026-09-13T12:00:00.000Z", data: { id: "call_terminal" },
  });
  const baseDeps = (fetchImpl: typeof fetch): WebhookDeps => ({
    apiUrl: "https://orma-api.nryn.dev", serviceRoleKey: "service-key",
    webhookSecret: "path-secret", calleApiBase: "https://api.call-e.test",
    calleApiKey: "calle-key", fetch: fetchImpl,
  });
  const request = (body: unknown = event(), eventId = "evt_terminal") => new Request(
    "https://orma-api.nryn.dev/functions/v1/calle-webhook/path-secret",
    { method: "POST", headers: { [EVENT_ID_HEADER]: eventId }, body: JSON.stringify(body) },
  );

  testFn("rejects a request without the path secret before reading its body", async () => {
    const handler = createWebhookHandler(baseDeps(async () => { throw new Error("fetch must not be called"); }));
    const response = await handler(new Request("https://orma-api.nryn.dev/functions/v1/calle-webhook/wrong", {
      method: "POST", headers: { [EVENT_ID_HEADER]: "evt_terminal" }, body: "not json",
    }));
    if (response.status !== 401) throw new Error("missing secret must be rejected");
  });

  testFn("rejects an envelope whose header id differs from its body id", async () => {
    const handler = createWebhookHandler(baseDeps(async () => { throw new Error("invalid envelope reached a dependency"); }));
    const response = await handler(request(event("evt_other")));
    if (response.status !== 400) throw new Error("header and body ids must match");
  });

  testFn("accepts and re-fetches each terminal contract fixture, documented and recorded", async () => {
    const fixtures = [
      "webhook-call-completed.documented.json",
      "webhook-call-failed.documented.json",
      "webhook-result-validation-failed.documented.json",
      "webhook-call-failed.recorded.json",
    ];
    for (const fixture of fixtures) {
      const raw = await Deno.readTextFile(new URL(`../../../testdata/calle/${fixture}`, import.meta.url));
      const value = JSON.parse(raw) as {
        headers: { "call-e-event-id": string };
        body: { id: string; data: { id: string } };
      };
      const body = JSON.stringify(value.body);
      if (!parseWebhookEnvelope(body, value.headers["call-e-event-id"])) {
        throw new Error(`fixture ${fixture} did not match the receiver contract`);
      }
      const refetched: string[] = [];
      const handler = createWebhookHandler(baseDeps(async (input, init) => {
        const current = new Request(input, init);
        if (current.url.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
        if (current.url.includes("/webhook_events?") && current.method === "PATCH") {
          return Response.json([{ event_id: value.headers["call-e-event-id"] }]);
        }
        if (current.url.endsWith("/call_events") && current.method === "POST") return new Response(null, { status: 201 });
        if (current.url.endsWith(`/v1/calls/${value.body.data.id}`)) {
          refetched.push(value.body.data.id);
          return Response.json({ id: value.body.data.id, status: "completed", metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" } });
        }
        if (current.url.includes("/call_runs?") && current.method === "GET") {
          return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
        }
        // The poll won this race. The receiver must still acknowledge.
        if (current.url.includes("/call_runs?") && current.method === "PATCH") return Response.json([]);
        throw new Error(`unexpected request ${current.method} ${current.url} while driving ${fixture}`);
      }));
      const response = await handler(new Request(
        "https://orma-api.nryn.dev/functions/v1/calle-webhook/path-secret",
        { method: "POST", headers: { [EVENT_ID_HEADER]: value.headers["call-e-event-id"] }, body },
      ));
      if (response.status !== 200) throw new Error(`fixture ${fixture} was not acknowledged`);
      if (refetched.length !== 1 || refetched[0] !== value.body.data.id) {
        throw new Error(`fixture ${fixture} did not re-fetch its own call id`);
      }
    }
  });

  testFn("re-fetches the documented terminal envelope and never uses body metadata", async () => {
    const requests: Request[] = [];
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      requests.push(current);
      if (current.url.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (current.url.includes("/webhook_events?") && current.method === "PATCH") return Response.json([{ event_id: "evt_terminal" }]);
      if (current.url.endsWith("/call_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (current.url.endsWith("/v1/calls/call_terminal")) {
        if (current.headers.get("authorization") !== "Bearer calle-key") throw new Error("CALL-E key missing");
        return Response.json({ id: "call_terminal", status: "completed", metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" } });
      }
      if (current.url.includes("/call_runs?")) return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    const body = { ...event(), data: { id: "call_terminal", call_run_id: "99999999-9999-4999-8999-999999999999" } };
    const response = await handler(request(body));
    if (response.status !== 200) throw new Error("valid notification must be acknowledged");
    const local = requests.find((current) => current.url.includes("/call_runs?"));
    if (!local || local.url.includes("99999999-9999-4999-8999-999999999999")) {
      throw new Error("untrusted body metadata selected a call run");
    }
    if (!local.url.includes("calle_call_id=eq.call_terminal")) throw new Error("local run must match fetched call");
  });

  testFn("a duplicate terminal event is a no-op and does not re-fetch", async () => {
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      if (current.method === "POST") return new Response(null, { status: 409 });
      if (current.url.includes("/webhook_events?") && current.method === "PATCH") return Response.json([]);
      throw new Error("duplicate reached CALL-E or call_runs");
    }));
    const response = await handler(request());
    if (response.status !== 200) throw new Error("duplicate must be acknowledged");
  });

  testFn("a confirmation webhook repairs a lost post-dispatch record write", async () => {
    const confirmationPatches: { url: URL; body: Record<string, unknown> }[] = [];
    const confirmationId = "22222222-2222-4222-8222-222222222222";
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      const currentUrl = new URL(current.url);
      if (currentUrl.pathname.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (currentUrl.pathname.endsWith("/webhook_events") && current.method === "PATCH") return Response.json([{ event_id: "evt_terminal" }]);
      if (currentUrl.pathname.endsWith("/v1/calls/call_terminal")) {
        return Response.json({ id: "call_terminal", status: "completed", metadata: { phone_confirmation_id: confirmationId } });
      }
      if (currentUrl.pathname.endsWith("/phone_confirmations") && current.method === "PATCH") {
        confirmationPatches.push({ url: currentUrl, body: JSON.parse(await current.text()) });
        return Response.json([{ id: confirmationId }]);
      }
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    const response = await handler(request());
    if (response.status !== 200) throw new Error("the repair webhook must be acknowledged");
    if (confirmationPatches.length !== 1) throw new Error(`expected one confirmation repair, saw ${confirmationPatches.length}`);
    const [patch] = confirmationPatches;
    if (
      patch.url.searchParams.get("id") !== `eq.${confirmationId}` ||
      patch.url.searchParams.get("state") !== "in.(requested,failed)" ||
      !patch.url.searchParams.get("expires_at")?.startsWith("gt.") ||
      patch.url.searchParams.has("calle_call_id")
    ) {
      throw new Error(`the repair must claim a live recoverable confirmation without a prior provider-id match, saw ${patch.url.search}`);
    }
    if (patch.body.state !== "dialled" || patch.body.calle_call_id !== "call_terminal") {
      throw new Error(`the repair must bind the provider call and restore verification eligibility, saw ${JSON.stringify(patch.body)}`);
    }
  });

  testFn("a delayed confirmation callback cannot revive an expired confirmation", async () => {
    const confirmationId = "33333333-3333-4333-8333-333333333333";
    let confirmationState = "expired";
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      const currentUrl = new URL(current.url);
      if (currentUrl.pathname.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (currentUrl.pathname.endsWith("/webhook_events") && current.method === "PATCH") return Response.json([{ event_id: "evt_terminal" }]);
      if (currentUrl.pathname.endsWith("/v1/calls/call_terminal")) {
        return Response.json({ id: "call_terminal", status: "completed", metadata: { phone_confirmation_id: confirmationId } });
      }
      if (currentUrl.pathname.endsWith("/phone_confirmations") && current.method === "PATCH") {
        const states = currentUrl.searchParams.get("state");
        const live = currentUrl.searchParams.get("expires_at")?.startsWith("gt.");
        if (states?.includes(confirmationState) && live) {
          confirmationState = (JSON.parse(await current.text()) as { state: string }).state;
          return Response.json([{ id: confirmationId }]);
        }
        return Response.json([]);
      }
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    const response = await handler(request());
    if (response.status !== 200) throw new Error("a delayed callback must be acknowledged");
    if (confirmationState !== "expired") {
      throw new Error(`a delayed callback revived an expired confirmation as ${confirmationState}`);
    }
  });

  testFn("a re-fetch failure releases the event so a retry can win", async () => {
    let callFetches = 0;
    let pending = true;
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      if (current.url.endsWith("/call_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (current.method === "POST") return new Response(null, { status: callFetches === 0 ? 201 : 409 });
      if (current.url.includes("/webhook_events?") && current.method === "PATCH") {
        const payload = JSON.parse(await current.text()) as { type: string };
        if (payload.type === REFRESHING && pending) { pending = false; return Response.json([{ event_id: "evt_terminal" }]); }
        if (payload.type === PENDING) { pending = true; return new Response(null, { status: 204 }); }
        if (payload.type === REFETCHED) return new Response(null, { status: 204 });
        return Response.json([]);
      }
      if (current.url.endsWith("/v1/calls/call_terminal")) {
        callFetches++;
        if (callFetches === 1) return new Response(null, { status: 503 });
        return Response.json({ id: "call_terminal", status: "completed", metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" } });
      }
      if (current.url.includes("/call_runs?")) return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    if ((await handler(request())).status !== 500) throw new Error("failed re-fetch must request a retry");
    if ((await handler(request())).status !== 200 || callFetches !== 2) throw new Error("retry must re-fetch after recovery");
  });

  testFn("writes webhook_received and refetched timeline rows for the matched run", async () => {
    const callEvents: { call_run_id: string; kind: string; detail: Record<string, unknown> }[] = [];
    const terminalPatches: { url: string; body: Record<string, unknown> }[] = [];
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      if (current.url.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (current.url.includes("/webhook_events?") && current.method === "PATCH") return Response.json([{ event_id: "evt_terminal" }]);
      if (current.url.endsWith("/call_events") && current.method === "POST") {
        callEvents.push(JSON.parse(await current.text()));
        return new Response(null, { status: 201 });
      }
      if (current.url.endsWith("/v1/calls/call_terminal")) {
        return Response.json({ id: "call_terminal", status: "completed", metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" } });
      }
      if (current.url.includes("/call_runs?") && current.method === "GET") {
        return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      }
      if (current.url.includes("/call_runs?") && current.method === "PATCH") {
        terminalPatches.push({ url: current.url, body: JSON.parse(await current.text()) });
        return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      }
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    const response = await handler(request({ ...event(), type: "call.failed" }));
    if (response.status !== 200) throw new Error("matched terminal event must be acknowledged");
    const kinds = callEvents.map((row) => row.kind);
    if (callEvents.length !== 2 || !kinds.includes("webhook_received") || !kinds.includes("refetched")) {
      throw new Error(`expected the webhook_received and refetched rows, saw ${JSON.stringify(kinds)}`);
    }
    for (const row of callEvents) {
      if (row.call_run_id !== "11111111-1111-4111-8111-111111111111") throw new Error("timeline row used the wrong run");
      if (row.detail.calle_call_id !== "call_terminal") throw new Error("timeline row must carry the provider call id");
      if (row.detail.event_type !== "call.failed") throw new Error("timeline row must record the notification type");
    }
    const refetchedRow = callEvents.find((row) => row.kind === "refetched");
    if (refetchedRow?.detail.state !== "completed") {
      throw new Error(`refetched row must carry the authoritative state, saw ${JSON.stringify(refetchedRow?.detail.state)}`);
    }
    if (callEvents.some((row) => row.detail.state === "call.failed")) {
      throw new Error("no timeline row may carry the webhook body type as state");
    }
    if (terminalPatches.length !== 1) {
      throw new Error(`the matched run must be moved exactly once, saw ${terminalPatches.length}`);
    }
    const [patch] = terminalPatches;
    if (patch.body.state !== "completed") {
      throw new Error(`the run must take the refetched state, saw ${JSON.stringify(patch.body.state)}`);
    }
    if (!patch.url.includes("state=in.%28dispatched%2Cawaiting_result%29")) {
      throw new Error("the move must only match a still-pending run, so the poll can win instead");
    }
    if (patch.body.poll_after !== null) {
      throw new Error("a terminal run must stop being polled");
    }
    if (patch.body.terminal_writer !== "webhook:evt_terminal") {
      throw new Error(`the move must name the event that made it, saw ${JSON.stringify(patch.body.terminal_writer)}`);
    }
  });

  testFn("a re-fetch that reports a failed result validation lands the run in no_result", async () => {
    const terminalPatches: { url: string; body: Record<string, unknown> }[] = [];
    const callEvents: { kind: string; detail: Record<string, unknown> }[] = [];
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      if (current.url.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (current.url.includes("/webhook_events?") && current.method === "PATCH") return Response.json([{ event_id: "evt_terminal" }]);
      if (current.url.endsWith("/call_events") && current.method === "POST") {
        callEvents.push(JSON.parse(await current.text()));
        return new Response(null, { status: 201 });
      }
      if (current.url.endsWith("/v1/calls/call_terminal")) {
        return Response.json({
          id: "call_terminal",
          status: "result_validation_failed",
          metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" },
        });
      }
      if (current.url.includes("/call_runs?") && current.method === "GET") {
        return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      }
      if (current.url.includes("/call_runs?") && current.method === "PATCH") {
        terminalPatches.push({ url: current.url, body: JSON.parse(await current.text()) });
        return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      }
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    const response = await handler(request({ ...event(), type: "call.result_validation_failed" }));
    if (response.status !== 200) throw new Error("a validation failure notification must be acknowledged");
    if (terminalPatches.length !== 1) {
      throw new Error(`the run must be moved exactly once, saw ${terminalPatches.length}`);
    }
    if (terminalPatches[0].body.state !== "no_result") {
      throw new Error(`a failed result validation must land as no_result, saw ${JSON.stringify(terminalPatches[0].body.state)}`);
    }
    const refetchedRow = callEvents.find((row) => row.kind === "refetched");
    if (refetchedRow?.detail.state !== "result_validation_failed") {
      throw new Error("the refetched row must carry the provider's own status");
    }
  });

  testFn("the refetched row marks whether the webhook's write won or the run was already resolved", async () => {
    for (const [patchRows, storedTag, expected] of [
      [1, null, "applied"],
      [0, "webhook:evt_other", "already_resolved"],
      [0, "poll", "already_resolved"],
      [0, null, "already_resolved"],
    ] as const) {
      const callEvents: { kind: string; detail: Record<string, unknown> }[] = [];
      const attributionReads: URL[] = [];
      const handler = createWebhookHandler(baseDeps(async (input, init) => {
        const current = new Request(input, init);
        const url = new URL(current.url);
        if (url.pathname.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
        if (url.pathname.endsWith("/webhook_events") && current.method === "PATCH") return Response.json([{ event_id: "evt_terminal" }]);
        if (url.pathname.endsWith("/call_events") && current.method === "POST") {
          callEvents.push(JSON.parse(await current.text()));
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/v1/calls/call_terminal")) {
          return Response.json({ id: "call_terminal", status: "failed", metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" } });
        }
        if (url.pathname.endsWith("/call_runs") && current.method === "GET") {
          if (url.searchParams.get("select") === "terminal_writer") {
            attributionReads.push(url);
            return Response.json([{ terminal_writer: storedTag }]);
          }
          return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
        }
        if (url.pathname.endsWith("/call_runs") && current.method === "PATCH") {
          return Response.json(patchRows === 1 ? [{ id: "11111111-1111-4111-8111-111111111111" }] : []);
        }
        throw new Error(`unexpected request ${current.method} ${current.url}`);
      }));
      const response = await handler(request());
      if (response.status !== 200) throw new Error("the receiver must acknowledge either way");
      const refetchedRow = callEvents.find((row) => row.kind === "refetched");
      if (refetchedRow?.detail.outcome !== expected) {
        throw new Error(`a PATCH matching ${patchRows} rows with tag ${storedTag} must record outcome ${expected}, saw ${JSON.stringify(refetchedRow?.detail)}`);
      }
      if (patchRows === 0 && attributionReads.length !== 1) {
        throw new Error("a lost write must read terminal_writer once");
      }
      if (patchRows === 1 && attributionReads.length !== 0) {
        throw new Error("a won write must not read attribution");
      }
      for (const read of attributionReads) {
        if (read.searchParams.get("id") !== "eq.11111111-1111-4111-8111-111111111111") {
          throw new Error(`attribution must read this run, saw ${read.search}`);
        }
      }
    }
  });

  testFn("a lost guarded write is attributed to the stored tag, never to a missing poll row", async () => {
    const RUN_ID = "11111111-1111-4111-8111-111111111111";
    const cases = [
      { name: "redelivery of this event's own write", storedTag: "webhook:evt_terminal", expected: "applied" },
      { name: "redelivery after a second event moved the run", storedTag: "webhook:evt_other", expected: "already_resolved" },
      { name: "redelivery after the poll moved the run", storedTag: "poll", expected: "already_resolved" },
      { name: "redelivery of an untagged move", storedTag: null, expected: "already_resolved" },
    ];
    for (const scenario of cases) {
      const callEvents: { kind: string; detail: Record<string, unknown> }[] = [];
      const attributionReads: URL[] = [];
      const handler = createWebhookHandler(baseDeps(async (input, init) => {
        const current = new Request(input, init);
        const url = new URL(current.url);
        if (url.pathname.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 409 });
        if (url.pathname.endsWith("/webhook_events") && current.method === "PATCH") return Response.json([{ event_id: "evt_terminal" }]);
        if (url.pathname.endsWith("/call_events") && current.method === "POST") {
          callEvents.push(JSON.parse(await current.text()));
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/v1/calls/call_terminal")) {
          return Response.json({ id: "call_terminal", status: "completed", metadata: { call_run_id: RUN_ID } });
        }
        if (url.pathname.endsWith("/call_runs") && current.method === "GET") {
          if (url.searchParams.get("select") === "terminal_writer") {
            attributionReads.push(url);
            return Response.json([{ terminal_writer: scenario.storedTag }]);
          }
          return Response.json([{ id: RUN_ID }]);
        }
        // The guard matches nothing, because the run already left the pending states.
        if (url.pathname.endsWith("/call_runs") && current.method === "PATCH") return Response.json([]);
        throw new Error(`unexpected request ${current.method} ${current.url}`);
      }));
      const response = await handler(request());
      if (response.status !== 200) throw new Error(`${scenario.name}: the receiver must acknowledge`);
      const refetchedRow = callEvents.find((row) => row.kind === "refetched");
      if (refetchedRow?.detail.outcome !== scenario.expected) {
        throw new Error(`${scenario.name}: expected outcome ${scenario.expected}, saw ${JSON.stringify(refetchedRow?.detail)}`);
      }
      if (attributionReads.length !== 1) {
        throw new Error(`${scenario.name}: a lost write must read terminal_writer once, saw ${attributionReads.length}`);
      }
      if (attributionReads[0].searchParams.get("id") !== `eq.${RUN_ID}`) {
        throw new Error(`${scenario.name}: attribution must read this run, saw ${attributionReads[0].search}`);
      }
    }
  });

  testFn("reclaims a refreshing event stranded past its lease and re-fetches once", async () => {
    const staleReceivedAt = new Date(Date.now() - REFRESH_LEASE_MS - 60_000).toISOString();
    const row = { event_id: "evt_terminal", type: REFRESHING, received_at: staleReceivedAt };
    let callFetches = 0;
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      if (current.url.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 409 });
      if (current.url.endsWith("/call_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (current.url.includes("/webhook_events?") && current.method === "PATCH") {
        const params = new URL(current.url).searchParams;
        const payload = JSON.parse(await current.text()) as { type: string; received_at: string };
        if (params.has("or")) {
          const cutoff = /received_at\.lt\.([^,)]+)/.exec(params.get("or") ?? "")?.[1] ?? "";
          if (row.type !== PENDING && !(row.type === REFRESHING && row.received_at < cutoff)) return Response.json([]);
        } else if (row.type !== (params.get("type") ?? "").replace("eq.", "")) {
          return Response.json([]);
        }
        row.type = payload.type;
        row.received_at = payload.received_at ?? row.received_at;
        return Response.json([{ ...row }]);
      }
      if (current.url.endsWith("/v1/calls/call_terminal")) {
        callFetches++;
        return Response.json({ id: "call_terminal", status: "completed", metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" } });
      }
      if (current.url.includes("/call_runs?")) return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    const response = await handler(request());
    if (response.status !== 200) throw new Error("stranded event must be reclaimed and acknowledged");
    if (callFetches !== 1) throw new Error(`stale claim must re-fetch exactly once, saw ${callFetches}`);
    if (row.type !== REFETCHED) throw new Error(`row must leave refreshing, saw ${row.type}`);
  });

  testFn("ignores a re-fetch that carries no usable status and writes no timeline row", async () => {
    const states: string[] = [];
    const handler = createWebhookHandler(baseDeps(async (input, init) => {
      const current = new Request(input, init);
      if (current.url.endsWith("/webhook_events") && current.method === "POST") return new Response(null, { status: 201 });
      if (current.url.includes("/webhook_events?") && current.method === "PATCH") {
        states.push((JSON.parse(await current.text()) as { type: string }).type);
        return Response.json([{ event_id: "evt_terminal" }]);
      }
      if (current.url.endsWith("/v1/calls/call_terminal")) {
        return Response.json({ id: "call_terminal", metadata: { call_run_id: "11111111-1111-4111-8111-111111111111" } });
      }
      throw new Error(`unexpected request ${current.method} ${current.url}`);
    }));
    const response = await handler(request());
    if (response.status !== 200) throw new Error("a re-fetch without status must be acknowledged");
    if (!states.includes(IGNORED)) throw new Error(`the event must be marked ignored, saw ${JSON.stringify(states)}`);
  });

  testFn("rejects a non-POST request with 405 before any dependency", async () => {
    const handler = createWebhookHandler(baseDeps(async () => { throw new Error("non-POST reached a dependency"); }));
    const response = await handler(new Request("https://orma-api.nryn.dev/functions/v1/calle-webhook/path-secret", { method: "GET" }));
    if (response.status !== 405) throw new Error("non-POST must be rejected");
    if (response.headers.get("allow") !== "POST") throw new Error("405 must advertise POST");
  });

  testFn("rejects a request without the event id header before any dependency", async () => {
    const handler = createWebhookHandler(baseDeps(async () => { throw new Error("missing header reached a dependency"); }));
    const response = await handler(new Request("https://orma-api.nryn.dev/functions/v1/calle-webhook/path-secret", {
      method: "POST", body: "x".repeat(MAX_BODY_BYTES + 1),
    }));
    if (response.status !== 400) throw new Error("missing event id header must be rejected before the body gate");
  });

  testFn("rejects a body over 128 KiB before any dependency", async () => {
    const handler = createWebhookHandler(baseDeps(async () => { throw new Error("oversized body reached a dependency"); }));
    const response = await handler(new Request("https://orma-api.nryn.dev/functions/v1/calle-webhook/path-secret", {
      method: "POST", headers: { [EVENT_ID_HEADER]: "evt_terminal" }, body: "x".repeat(MAX_BODY_BYTES + 1),
    }));
    if (response.status !== 413) throw new Error("oversized body must be rejected");
  });

  testFn("rejects an envelope whose type is not terminal before any dependency", async () => {
    const handler = createWebhookHandler(baseDeps(async () => { throw new Error("non-terminal type reached a dependency"); }));
    const response = await handler(request({ ...event(), type: "call.ringing" }));
    if (response.status !== 400) throw new Error("non-terminal type must be rejected");
  });

}
