/**
 * T2.4 CALL-E dispatch.
 *
 * This module is deliberately the only place that can issue POST /v1/calls.
 * The caller supplies a run already claimed by PostgreSQL. The durable key is
 * forwarded unchanged so a network retry cannot place a second call.
 */

import { assembleBriefing, renderCallTask, storeBriefing } from "./briefing.ts";
import {
  dryRunFixture,
  dryRunFixtureName,
  executeDryRun,
  isDryRun,
  maskedRequestBody,
} from "./dispatch-mode.ts";
import { type CallEventDetail, recordCallEvent } from "./events.ts";
import type { CallStatus, CallTaskFixture } from "./fixtures.ts";
import { loadCallFixtures } from "./fixtures.ts";
import { ingestTerminalRun } from "./ingest.ts";

const POLL_DELAY_MS = 60_000;

export type ClaimedRun = {
  id: string;
  user_id: string;
  idempotency_key: string;
  state: string;
  slot_id: string | null;
  dry_run: boolean;
};

type DispatchProfile = {
  id: string;
  phone_e164: string | null;
  phone_confirmed_at: string | null;
};

type Consent = { id: string };
type Slot = { local_time: string };

export type CalleDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  calleApiBase: string;
  calleApiKey: string;
  webhookUrl: string;
  /**
   * The Telegram bot token the finaliser threads into the post-call receipt.
   * `depsFromEnv` requires it, so production always carries one. A caller
   * that omits it keeps the pre-T7.5 behaviour of sending no receipt.
   */
  telegramBotToken?: string;
  fetch: typeof fetch;
  now: () => Date;
  /** Read only for the dry-mode decision, which fails closed when unset. */
  getEnv?: (name: string) => string | undefined;
};

export type CalleCallRequest = {
  task: string;
  recipients: Array<{ phones: string[] }>;
  result_schema: Record<string, unknown>;
  webhook_url: string;
  metadata: { call_run_id?: string; phone_confirmation_id?: string };
};

export type ConfirmationDispatch = { mode: "dry_run" | "live"; requestBody: string; callId: string | null };

export function maskedConfirmationRequestBody(requestBody: string, code: string): string {
  const masked = JSON.parse(maskedRequestBody(requestBody)) as Record<string, unknown>;
  const digits = code.split("").join(", ");
  if (typeof masked.task === "string") masked.task = masked.task.replaceAll(digits, "<redacted code>");
  return JSON.stringify(masked);
}

export function buildConfirmationCallRequest(
  confirmationId: string, phoneE164: string, code: string, webhookUrl: string,
): CalleCallRequest {
  const digits = code.split("").join(", ");
  return {
    task: `You are Orma. Say: Hello, this is Orma. Someone asked Orma to call this number with a confirmation code. Your code is ${digits}. Repeat: ${digits}. If you did not ask for this, hang up and Orma will not call again. Ask nothing, capture nothing, then end the call.`,
    recipients: [{ phones: [phoneE164] }],
    // CALL-E needs at least one property. Orma never reads this answer.
    result_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        code_read: {
          type: "string",
          enum: ["yes", "no", "unknown"],
          description: "Use yes only if the code was read aloud in full.",
        },
      },
    },
    webhook_url: webhookUrl,
    metadata: { phone_confirmation_id: confirmationId },
  };
}

/** The confirmation flow shares the sole CALL-E POST boundary with dispatch. */
export async function dispatchPhoneConfirmation(
  confirmationId: string, phoneE164: string, code: string, deps: CalleDeps,
): Promise<ConfirmationDispatch> {
  const requestBody = JSON.stringify(buildConfirmationCallRequest(confirmationId, phoneE164, code, deps.webhookUrl));
  if (isDryRun(false, deps.getEnv)) return { mode: "dry_run", requestBody: maskedConfirmationRequestBody(requestBody, code), callId: null };
  const response = await deps.fetch(`${deps.calleApiBase.replace(/\/+$/, "")}/v1/calls`, {
    method: "POST", headers: { authorization: `Bearer ${deps.calleApiKey}`, "content-type": "application/json", "idempotency-key": `orma:confirm:${confirmationId}` }, body: requestBody,
  });
  if (!response.ok) {
    // Keep CALL-E's reason for the log, with any number masked and the code removed.
    const reason = (await response.text().catch(() => ""))
      .replaceAll(code, "<code>")
      .replace(/\+?\d{7,15}/g, "<number>")
      .slice(0, 300);
    throw new Error(`CALL-E confirmation dispatch returned HTTP ${response.status}: ${reason}`);
  }
  const call = asCallTask(await response.json());
  return { mode: "live", requestBody: maskedConfirmationRequestBody(requestBody, code), callId: call.id };
}

/** The reviewed inline schema from docs/calle-call.md. */
export const CALL_E_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["captured_items", "retired_items"],
  properties: {
    captured_items: {
      type: "array",
      description: "New things the caller said they need to track. Empty array if none.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence_offset_seconds"],
        properties: {
          text: { type: "string", description: "The item in the caller's own words, one short line." },
          evidence_offset_seconds: { type: "integer", description: "Transcript offset in seconds where the caller said it." },
        },
      },
    },
    retired_items: {
      type: "array",
      description: "Items the caller asked to drop. Evidence is required because retiring is destructive. Empty array if none.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "evidence_offset_seconds"],
        properties: {
          item_id: { type: "string", description: "The id given in the task for that item." },
          evidence_offset_seconds: { type: "integer", description: "Transcript offset in seconds where the caller asked to drop it." },
        },
      },
    },
    commitments: {
      type: "array",
      description: "Things the caller said out loud they would do, with a time attached where they gave one.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "evidence_offset_seconds"],
        properties: {
          item_id: { type: "string", description: "The id given in the task for that item." },
          due: { type: "string", description: "When they said they would do it, in their own words. Omit if they gave no time." },
          evidence_offset_seconds: { type: "integer", description: "Transcript offset in seconds where they committed." },
        },
      },
    },
    slot_change_requested: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Use yes only if the caller asked for a different call time. Use unknown if it was ambiguous.",
    },
    slot_change_time: {
      type: "string",
      description: "The time they asked for, in their own words. Omit unless slot_change_requested is yes.",
    },
    mood: {
      type: "string",
      enum: ["ok", "low", "stressed", "energised", "unknown"],
      description: "How the caller sounded overall. Use unknown when the call was too short or too flat to tell.",
    },
  },
};

function requireNamedEnv(name: string, getEnv: (key: string) => string | undefined): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export function depsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): CalleDeps {
  const apiUrl = requireNamedEnv("ORMA_API_URL", getEnv);
  const webhookSecret = requireNamedEnv("ORMA_WEBHOOK_SECRET", getEnv);
  return {
    apiUrl,
    serviceRoleKey: requireNamedEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv),
    calleApiBase: requireNamedEnv("CALLE_API_BASE", getEnv),
    calleApiKey: requireNamedEnv("CALLE_API_KEY", getEnv),
    webhookUrl: `${apiUrl.replace(/\/+$/, "")}/functions/v1/calle-webhook/${webhookSecret}`,
    telegramBotToken: requireNamedEnv("TELEGRAM_BOT_TOKEN", getEnv),
    fetch: fetchImpl,
    now: () => new Date(),
    getEnv,
  };
}

function restUrl(base: string, path: string, query = ""): string {
  return `${base.replace(/\/+$/, "")}/rest/v1/${path}${query ? `?${query}` : ""}`;
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

async function readOne<T>(deps: CalleDeps, table: string, query: URLSearchParams): Promise<T | null> {
  const response = await deps.fetch(restUrl(deps.apiUrl, table, query.toString()), {
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error(`${table} read failed`);
  const rows = await response.json() as T[];
  return rows[0] ?? null;
}

async function updateRun(
  deps: CalleDeps,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const response = await deps.fetch(
    restUrl(deps.apiUrl, "call_runs", new URLSearchParams({ id: `eq.${runId}` }).toString()),
    {
      method: "PATCH",
      headers: serviceHeaders(deps.serviceRoleKey, "return=minimal"),
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) throw new Error("call_runs dispatch update failed");
}

function failure(code: string, message: string): Record<string, string> {
  return { failure_code: code, failure_message: message };
}

/**
 * The field set every dispatcher failure writes beside its code. `spec.md`
 * section 3 maps a failed run to `not_answered`, and that disposition is never
 * billed, so this is the only pair a failed dispatch may store. This module ends
 * a run in three places, and one definition is what keeps a fourth from
 * inventing its own.
 */
function failedDispatchFields(
  code: string,
  reason: string,
): {
  state: "failed";
  disposition: "not_answered";
  billable: false;
  calle_failure: Record<string, string>;
} {
  return {
    state: "failed",
    disposition: "not_answered",
    billable: false,
    calle_failure: failure(code, reason),
  };
}

/**
 * The row a dispatcher writes when it ends a run before any call exists. The
 * shape matches the finaliser's abandoned row, so one reader handles both, and
 * it satisfies the helper's terminal contract with a state and a reason.
 */
function finalisedFailureDetail(
  outcome: string,
  reason: string,
  state: string,
): CallEventDetail {
  return { calle_call_id: null, state, outcome, failure_reason: reason };
}

async function refuseRun(deps: CalleDeps, runId: string, reason: string): Promise<void> {
  await updateRun(deps, runId, {
    state: "canceled",
    disposition: "canceled",
    completed_at: deps.now().toISOString(),
    calle_failure: failure("dispatch_refused", reason),
  });
  // No call exists, so the run is terminal and its story ends here. The row
  // names the reason, because the refusal never reaches CALL-E.
  await recordCallEvent(
    runId,
    "finalised",
    finalisedFailureDetail("refused", reason, "canceled"),
    deps,
  );
}

export function buildCallRequest(
  callRunId: string,
  phoneE164: string,
  task: string,
  webhookUrl: string,
): CalleCallRequest {
  return {
    task,
    recipients: [{ phones: [phoneE164] }],
    result_schema: CALL_E_RESULT_SCHEMA,
    webhook_url: webhookUrl,
    metadata: { call_run_id: callRunId },
  };
}

function asCallTask(value: unknown): CallTaskFixture {
  if (typeof value !== "object" || value === null) throw new Error("CALL-E returned no call task");
  const call = value as Partial<CallTaskFixture>;
  if (typeof call.id !== "string" || typeof call.status !== "string") {
    throw new Error("CALL-E response missing id or status");
  }
  return call as CallTaskFixture;
}

function acceptedState(status: CallStatus): "dispatched" | "awaiting_result" {
  return status === "queued" || status === "in_progress" ? "dispatched" : "awaiting_result";
}

/**
 * What one dispatch did. `requestBody` is the exact body the dispatcher
 * assembled, and it is the same string in both modes, so a caller can compare
 * what a rehearsal would have sent against what a live dispatch posted. A
 * refused run assembled nothing.
 */
export type DispatchOutcome = {
  mode: "dry_run" | "live" | "refused";
  requestBody: string | null;
};

/** The tag the write that fails a stranded run stores. */
const RECOVERY_WRITER = "dispatch_recovery";

/**
 * The call CALL-E accepted before the run could store it. A failed write after
 * the POST would otherwise lose the only id a reconciler can match the call on.
 */
type PlacedCall = { callId: string | null };

/**
 * Dispatches one claimed run. A missing or revoked consent is terminally
 * canceled before any CALL-E request. A 409 is terminally visible and is never
 * retried with a different key.
 *
 * The claim is recorded here, inside the recovery, rather than by the caller. A
 * failed insert would otherwise strand the run in `claimed`, where no selector
 * takes it again, exactly as a failed dispatch does.
 *
 * A throw repairs the run before it is reported. When CALL-E accepted the call,
 * the repair reconciles it, because the call exists whether or not this process
 * recorded it.
 */
export async function dispatchClaimedRun(
  run: ClaimedRun,
  deps: CalleDeps,
): Promise<DispatchOutcome> {
  if (run.state !== "claimed") throw new Error("only claimed runs may dispatch");
  const placed: PlacedCall = { callId: null };
  try {
    await recordCallEvent(run.id, "claimed", { state: run.state }, deps);
    return await dispatchOne(run, deps, placed);
  } catch (error) {
    await recoverStrandedRun(deps, run, error, placed);
    throw error;
  }
}

async function dispatchOne(
  run: ClaimedRun,
  deps: CalleDeps,
  placed: PlacedCall,
): Promise<DispatchOutcome> {
  const profile = await readOne<DispatchProfile>(
    deps,
    "profiles",
    new URLSearchParams({ select: "id,phone_e164,phone_confirmed_at", id: `eq.${run.user_id}` }),
  );
  if (!profile?.phone_e164 || !profile.phone_confirmed_at) {
    await refuseRun(deps, run.id, "profile has no confirmed E.164 number");
    return { mode: "refused", requestBody: null };
  }

  const consent = await readOne<Consent>(
    deps,
    "consents",
    new URLSearchParams({ select: "id", user_id: `eq.${run.user_id}`, kind: "eq.outbound_calls", revoked_at: "is.null", limit: "1" }),
  );
  if (!consent) {
    await refuseRun(deps, run.id, "profile has no live outbound_calls consent");
    return { mode: "refused", requestBody: null };
  }

  if (!run.slot_id) {
    await refuseRun(deps, run.id, "call run has no source slot");
    return { mode: "refused", requestBody: null };
  }
  const slot = await readOne<Slot>(
    deps,
    "slots",
    new URLSearchParams({ select: "local_time", id: `eq.${run.slot_id}` }),
  );
  if (!slot?.local_time) {
    await refuseRun(deps, run.id, "call run source slot no longer exists");
    return { mode: "refused", requestBody: null };
  }

  const briefing = await assembleBriefing(
    { userId: run.user_id, slotLocalTime: slot.local_time },
    { apiUrl: deps.apiUrl, serviceRoleKey: deps.serviceRoleKey, fetch: deps.fetch },
  );
  await storeBriefing(run.id, briefing, {
    apiUrl: deps.apiUrl,
    serviceRoleKey: deps.serviceRoleKey,
    fetch: deps.fetch,
  });
  const body = buildCallRequest(run.id, profile.phone_e164, renderCallTask(briefing), deps.webhookUrl);
  const requestBody = JSON.stringify(body);

  // Dry mode is decided here, ahead of anything that can reach the network, and
  // it reuses the serialized body the live path would send. A run is dry when
  // the run says so, or when ORMA_DRY_RUN is unset or true. The operator picks
  // which recorded terminal shape the rehearsal replays.
  if (isDryRun(run.dry_run, deps.getEnv)) {
    const fixture = dryRunFixture(dryRunFixtureName(deps.getEnv));
    const rehearsed = await executeDryRun(run.id, run.user_id, requestBody, fixture, {
      recordEvent: async (event) => {
        await recordCallEvent(event.callRunId, event.kind, event.detail, deps);
      },
      updateRun: (callRunId, patch) => updateRun(deps, callRunId, patch),
      ingest: (source) =>
        ingestTerminalRun(source, {
          apiUrl: deps.apiUrl,
          serviceRoleKey: deps.serviceRoleKey,
          fetch: deps.fetch,
        }),
      now: deps.now,
    });
    // The rehearsal hands the assembled body back unchanged, so the two modes
    // stay comparable byte for byte even though only a mask is stored.
    return { mode: "dry_run", requestBody: rehearsed.requestBody };
  }

  const response = await deps.fetch(`${deps.calleApiBase.replace(/\/+$/, "")}/v1/calls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deps.calleApiKey}`,
      "content-type": "application/json",
      "idempotency-key": run.idempotency_key,
    },
    body: requestBody,
  });
  if (response.status === 409) {
    const reason = "CALL-E rejected this idempotency key with different inputs";
    await updateRun(deps, run.id, {
      ...failedDispatchFields("idempotency_conflict", reason),
      completed_at: deps.now().toISOString(),
    });
    await recordCallEvent(
      run.id,
      "finalised",
      finalisedFailureDetail("idempotency_conflict", reason, "failed"),
      deps,
    );
    throw new Error("CALL-E idempotency conflict");
  }
  if (!response.ok) {
    const reason = `CALL-E dispatch returned HTTP ${response.status}`;
    await updateRun(deps, run.id, {
      ...failedDispatchFields("dispatch_failed", reason),
      completed_at: deps.now().toISOString(),
    });
    await recordCallEvent(
      run.id,
      "finalised",
      finalisedFailureDetail("dispatch_failed", reason, "failed"),
      deps,
    );
    throw new Error("CALL-E dispatch failed");
  }

  const call = asCallTask(await response.json());
  const now = deps.now();
  // The id is held before the write. CALL-E has accepted the call, so the
  // recovery must be able to reconcile it even when this write fails and the
  // id never reaches the row.
  placed.callId = call.id;
  await updateRun(deps, run.id, {
    state: acceptedState(call.status),
    calle_call_id: call.id,
    calle_confidence: call.completion_confidence,
    calle_failure: call.failure_code ? failure(call.failure_code, call.failure_message ?? "") : null,
    dispatched_at: now.toISOString(),
    poll_after: new Date(now.getTime() + POLL_DELAY_MS).toISOString(),
  });
  await recordCallEvent(
    run.id,
    "dispatched",
    { calle_call_id: call.id, state: acceptedState(call.status) },
    deps,
  );
  return { mode: "live", requestBody };
}

/**
 * Repairs the run a failed dispatch would otherwise strand in `claimed`. That
 * state is invisible to the claim RPC, to the poll selector and to the
 * terminal selector, so nothing would dial the run and nothing would retry it.
 *
 * A call this attempt placed is reconciled, never failed. The id comes from the
 * response when the run's own write did not land, because the phone rang and
 * the poll must be able to answer for it. A run with no call id fails with the
 * reason and a completion time. Neither path returns the run to `scheduled`,
 * because a second dispatch could dial the same person twice.
 *
 * The run it fails records the `finalised` row that names the reason, so the
 * timeline ends with a cause rather than a bare claim. A reconciliation that
 * hands the run to the poll records no such row, because that story continues.
 *
 * A recovery write can itself fail, and then the run keeps the state it had.
 * The log names the accepted call id so an operator can reconcile it by hand.
 * Nothing re-queues the run, because the second dial is the worse outcome.
 */
async function recoverStrandedRun(
  deps: CalleDeps,
  run: ClaimedRun,
  cause: unknown,
  placed: PlacedCall,
): Promise<void> {
  const reason = cause instanceof Error ? cause.message : "unknown error";
  try {
    const current = await readOne<{ state: string; calle_call_id: string | null }>(
      deps,
      "call_runs",
      new URLSearchParams({ select: "state,calle_call_id", id: `eq.${run.id}` }),
    );
    // A refusal, a 409 or a landed dispatch has already moved the run. The
    // recovery never overwrites a state another writer landed.
    if (!current || current.state !== "claimed") return;
    const now = deps.now();
    const callId = current.calle_call_id ?? placed.callId;
    if (callId) {
      await updateRun(deps, run.id, {
        state: "awaiting_result",
        calle_call_id: callId,
        dispatched_at: now.toISOString(),
        poll_after: new Date(now.getTime() + POLL_DELAY_MS).toISOString(),
      });
      return;
    }
    await updateRun(deps, run.id, {
      ...failedDispatchFields("dispatch_failed", reason),
      terminal_writer: RECOVERY_WRITER,
      completed_at: now.toISOString(),
    });
    await recordCallEvent(
      run.id,
      "finalised",
      finalisedFailureDetail("dispatch_failed", reason, "failed"),
      deps,
    );
  } catch (error) {
    console.error(
      `dispatch recovery failed for run ${run.id}`,
      error instanceof Error ? error.message : "unknown error",
      placed.callId
        ? `accepted call ${placed.callId} needs manual reconciliation`
        : "no call was placed",
    );
  }
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function") {
  const run: ClaimedRun = {
    id: "run-1", user_id: "user-1", idempotency_key: "orma:user-1:2026-09-12:morning:v1",
    state: "claimed", slot_id: "slot-1", dry_run: false,
  };
  // Live dispatch is the explicit opt-in, so every live test says so.
  const baseDeps = (fetchImpl: typeof fetch): CalleDeps => ({
    apiUrl: "https://orma-api.nryn.dev", serviceRoleKey: "service-key",
    calleApiBase: "https://api.call-e.test", calleApiKey: "calle-key",
    webhookUrl: "https://orma-api.nryn.dev/functions/v1/calle-webhook/secret",
    fetch: fetchImpl, now: () => new Date("2026-09-12T00:00:00.000Z"),
    // Only the dry-run switch is live for these tests. Every other name reads
    // as unset, so the fixture choice stays on its default.
    getEnv: (name) => (name === "ORMA_DRY_RUN" ? "false" : undefined),
  });
  const stubFetch = (requests: Request[]): typeof fetch => async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.includes("/profiles")) return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
    if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
    if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
    if (request.url.includes("assemble_briefing")) return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
    if (request.url.includes("ingest_call_result")) return Response.json({ already_ingested: false, disposition: "answered_extracted", counts: { items: 1, mentions: 1, retirements: 0, commitments: 0 }, slot_change_requested: null });
    if (request.url.endsWith("/v1/calls")) return Response.json({ id: "call-1", status: "queued", completion_confidence: null });
    return new Response(null, { status: 204 });
  };

  /** Every `call_events` row one dispatch posted, in the order it posted them. */
  const recordedEvents = async (requests: Request[]) =>
    await Promise.all(
      requests
        .filter((request) => request.url.includes("call_events") && request.method === "POST")
        .map(async (request) =>
          await request.json() as { kind: string; detail: Record<string, unknown> }
        ),
    );

  /** The one row a run that ends before any call exists must append. */
  const onlyFinalised = async (requests: Request[]) => {
    const events = await recordedEvents(requests);
    if (events.map((event) => event.kind).join(",") !== "claimed,finalised") {
      throw new Error(`a failed run must read claimed then finalised, saw ${events.map((event) => event.kind).join(",")}`);
    }
    return events.at(-1)!.detail;
  };

  testFn("dispatch sends the durable key and records the returned CALL-E id", async () => {
    const requests: Request[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes("/profiles")) return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
      if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
      if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
      if (request.url.includes("assemble_briefing")) return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
      if (request.url.endsWith("/v1/calls")) return Response.json({ id: "call-1", status: "queued", completion_confidence: null });
      return new Response(null, { status: 204 });
    };
    await dispatchClaimedRun(run, baseDeps(fetchStub));
    const callRequest = requests.find((request) => request.url.endsWith("/v1/calls"));
    if (!callRequest || callRequest.headers.get("idempotency-key") !== run.idempotency_key) throw new Error("durable idempotency key was not forwarded");
    const requestBody = await callRequest.json() as CalleCallRequest;
    if (requestBody.metadata.call_run_id !== run.id || requestBody.recipients[0].phones[0] !== "+919999999999") throw new Error("CALL-E request shape is incomplete");
    const finalPatch = requests.filter((request) => request.method === "PATCH").at(-1);
    if (!finalPatch || !(await finalPatch.text()).includes('"calle_call_id":"call-1"')) throw new Error("returned call id was not stored");
  });

  testFn("missing consent is recorded and never reaches CALL-E", async () => {
    const requests: Request[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes("/profiles")) return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
      if (request.url.includes("/consents")) return Response.json([]);
      return new Response(null, { status: 204 });
    };
    await dispatchClaimedRun(run, baseDeps(fetchStub));
    if (requests.some((request) => request.url.endsWith("/v1/calls"))) throw new Error("dispatch called CALL-E without consent");
    const patch = requests.find((request) => request.method === "PATCH");
    if (!patch || !(await patch.text()).includes("dispatch_refused")) throw new Error("consent refusal was not recorded");
    const refused = await onlyFinalised(requests);
    if (
      refused.state !== "canceled" || refused.outcome !== "refused" ||
      refused.failure_reason !== "profile has no live outbound_calls consent"
    ) {
      throw new Error(`the refusal row must name the reason, saw ${JSON.stringify(refused)}`);
    }
  });

  testFn("a CALL-E 409 is visible and does not retry with a fresh key", async () => {
    const requests: Request[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes("/profiles")) return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
      if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
      if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
      if (request.url.includes("assemble_briefing")) return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
      if (request.url.endsWith("/v1/calls")) return new Response(null, { status: 409 });
      if (request.url.includes("/call_runs")) return Response.json([{ state: "failed", calle_call_id: null }]);
      return new Response(null, { status: 204 });
    };
    await dispatchClaimedRun(run, baseDeps(fetchStub)).then(() => { throw new Error("409 must fail"); }, () => undefined);
    if (requests.filter((request) => request.url.endsWith("/v1/calls")).length !== 1) throw new Error("409 must not retry");
    const patches = await Promise.all(
      requests.filter((request) => request.method === "PATCH")
        .map(async (request) => await request.text()),
    );
    if (!patches.some((body) => body.includes("idempotency_conflict"))) throw new Error("409 was not recorded");
    const conflictPatch = patches.find((body) => body.includes("idempotency_conflict"));
    if (
      !conflictPatch?.includes('"disposition":"not_answered"') ||
      !conflictPatch.includes('"billable":false')
    ) {
      throw new Error(`the 409 write must carry the pair for a failed run, saw ${String(conflictPatch)}`);
    }
    if (patches.some((body) => body.includes("dispatch_recovery") || body.includes("awaiting_result"))) {
      throw new Error("the recovery overwrote a state another writer landed");
    }
    const conflict = await onlyFinalised(requests);
    if (
      conflict.state !== "failed" || conflict.outcome !== "idempotency_conflict" ||
      conflict.failure_reason !== "CALL-E rejected this idempotency key with different inputs"
    ) {
      throw new Error(`the 409 row must name the conflict, saw ${JSON.stringify(conflict)}`);
    }
  });

  testFn("a rejected dispatch names the provider status on the timeline", async () => {
    const requests: Request[] = [];
    // The stub models the run, because the recovery must read the state the
    // rejected write landed and not write a second row for the same move.
    let state = "claimed";
    const patches: { state?: string; disposition?: string; billable?: boolean }[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes("/profiles")) return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
      if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
      if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
      if (request.url.includes("assemble_briefing")) return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
      if (request.url.endsWith("/v1/calls")) return new Response(null, { status: 503 });
      if (request.method === "PATCH") {
        const patch = JSON.parse(await request.text()) as {
          state?: string;
          disposition?: string;
          billable?: boolean;
        };
        patches.push(patch);
        if (typeof patch.state === "string") state = patch.state;
        return new Response(null, { status: 204 });
      }
      if (request.url.includes("/call_runs")) return Response.json([{ state, calle_call_id: null }]);
      return new Response(null, { status: 204 });
    };
    await dispatchClaimedRun(run, baseDeps(fetchStub)).then(
      () => { throw new Error("a rejected dispatch was reported as a dispatch"); },
      () => undefined,
    );
    const rejected = await onlyFinalised(requests);
    if (
      rejected.state !== "failed" || rejected.outcome !== "dispatch_failed" ||
      rejected.failure_reason !== "CALL-E dispatch returned HTTP 503"
    ) {
      throw new Error(`the rejected dispatch must name the status, saw ${JSON.stringify(rejected)}`);
    }
    if (requests.some((request) => request.method === "PATCH" && request.url.includes("awaiting_result"))) {
      throw new Error("the recovery overwrote a state another writer landed");
    }
    const rejectedPatch = patches.find((patch) => patch.state === "failed");
    if (rejectedPatch?.disposition !== "not_answered" || rejectedPatch.billable !== false) {
      throw new Error(`the rejected dispatch must write the pair for a failed run, saw ${JSON.stringify(rejectedPatch)}`);
    }
  });

  testFn("dispatch uses the committed CALL-E fixture and pins the complete request", async () => {
    const fixtures = await loadCallFixtures();
    const fixtureBytes = new TextEncoder().encode(JSON.stringify(fixtures.completed));
    const fixtureDigest = await crypto.subtle.digest("SHA-256", fixtureBytes);
    const fixtureHash = Array.from(new Uint8Array(fixtureDigest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (fixtureHash !== "bbe9c94ccd6c7cc57ebb5ddd5780848765f7b186916a3478542e2f02730d6bbb") {
      throw new Error("committed CALL-E fixture changed without dispatch review");
    }
    const requests: Request[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes("/profiles")) return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
      if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
      if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
      if (request.url.includes("assemble_briefing")) return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
      if (request.url.endsWith("/v1/calls")) return Response.json(fixtures.completed);
      return new Response(null, { status: 204 });
    };
    await dispatchClaimedRun(run, baseDeps(fetchStub));
    const request = requests.find((candidate) => candidate.url.endsWith("/v1/calls"));
    if (!request) throw new Error("dispatch did not call CALL-E");
    const body = await request.json() as CalleCallRequest;
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const requestHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (requestHash !== "628c5be36e81e4e591cb94373f5ca041b13e17d99249a1519bb17f1ee34fc831") {
      throw new Error("CALL-E request differs from the reviewed complete contract");
    }
    const patch = requests.filter((candidate) => candidate.method === "PATCH").at(-1);
    if (!patch || !(await patch.text()).includes(fixtures.completed.id)) {
      throw new Error("committed CALL-E fixture id was not stored");
    }
  });

  testFn("canonical runtime names derive the webhook URL", () => {
    const values: Record<string, string> = {
      ORMA_API_URL: "https://orma-api.nryn.dev/",
      ORMA_WEBHOOK_SECRET: "webhook-secret",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      CALLE_API_BASE: "https://api.call-e.test",
      CALLE_API_KEY: "calle-key",
      TELEGRAM_BOT_TOKEN: "fixture-bot-token",
    };
    const deps = depsFromEnv((key) => values[key]);
    if (deps.webhookUrl !== "https://orma-api.nryn.dev/functions/v1/calle-webhook/webhook-secret") {
      throw new Error("webhook URL must derive from canonical runtime names");
    }
  });

  testFn("a dry run assembles the live body byte for byte and records a mask of it", async () => {
    const live: Request[] = [];
    const posted = await dispatchClaimedRun(run, baseDeps(stubFetch(live)));
    const liveRequest = live.find((candidate) => candidate.url.endsWith("/v1/calls"));
    if (!liveRequest) throw new Error("the live path did not call CALL-E");
    const liveBody = await liveRequest.text();
    if (posted.requestBody !== liveBody) throw new Error("the live path reported a different body than it posted");

    const dry: Request[] = [];
    const rehearsed = await dispatchClaimedRun({ ...run, dry_run: true }, baseDeps(stubFetch(dry)));
    if (dry.some((candidate) => candidate.url.endsWith("/v1/calls"))) {
      throw new Error("a dry run called CALL-E");
    }
    if (rehearsed.requestBody !== liveBody) {
      throw new Error("the dry run assembled a different body than the live path posts");
    }
    const events = await Promise.all(
      dry.filter((candidate) => candidate.url.includes("call_events")).map(async (candidate) => await candidate.json()),
    );
    const dispatched = events.find((event) => event.kind === "dispatched");
    if (!dispatched) throw new Error("a dry run recorded no dispatch");
    const recorded = String(dispatched.detail.request_body);
    if (recorded === liveBody) throw new Error("the dry run recorded the live body unmasked");
    if (recorded !== maskedRequestBody(liveBody)) {
      throw new Error("the recorded body is not the mask of the body the live path posts");
    }
    if (recorded.includes("calle-webhook/secret")) throw new Error("the recorded body still carries the webhook secret");
    if (recorded.includes("+919999999999")) throw new Error("the recorded body still carries the callee's number");
    if (dispatched.detail.outbound_request_made !== false) {
      throw new Error("the dry run claimed an outbound request");
    }
  });

  const recoveryStub = (
    patches: Array<Record<string, unknown>>,
    callId: string | null,
    requests: Request[] = [],
  ): typeof fetch => async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.includes("/profiles")) return new Response(null, { status: 500 });
    if (request.method === "PATCH") {
      patches.push(JSON.parse(await request.text()) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }
    if (request.url.includes("/call_runs")) {
      return Response.json([{ state: "claimed", calle_call_id: callId }]);
    }
    return new Response(null, { status: 204 });
  };

  testFn("a dispatch that throws before its terminal write leaves no run claimed", async () => {
    const patches: Array<Record<string, unknown>> = [];
    const requests: Request[] = [];
    await dispatchClaimedRun(run, baseDeps(recoveryStub(patches, null, requests))).then(
      () => { throw new Error("a failing profile read was reported as a dispatch"); },
      (error) => {
        if (!(error instanceof Error) || error.message !== "profiles read failed") throw error;
      },
    );
    const recovered = patches.at(-1);
    if (!recovered || recovered.state !== "failed") {
      throw new Error(`a stranded run stayed out of every selector, saw ${JSON.stringify(recovered)}`);
    }
    if (recovered.terminal_writer !== "dispatch_recovery") throw new Error("the recovery write named no writer");
    if (!recovered.completed_at) throw new Error("the failed stranded run carried no completion time");
    const recordedFailure = JSON.stringify(recovered.calle_failure);
    if (recordedFailure !== JSON.stringify({ failure_code: "dispatch_failed", failure_message: "profiles read failed" })) {
      throw new Error(`the recovery recorded no reason, saw ${recordedFailure}`);
    }
    const stranded = await onlyFinalised(requests);
    if (
      stranded.state !== "failed" || stranded.outcome !== "dispatch_failed" ||
      stranded.failure_reason !== "profiles read failed"
    ) {
      throw new Error(`the stranded row must name the cause, saw ${JSON.stringify(stranded)}`);
    }
  });

  testFn("a stranded run that recorded a call id is handed to the poll", async () => {
    const patches: Array<Record<string, unknown>> = [];
    const requests: Request[] = [];
    await dispatchClaimedRun(run, baseDeps(recoveryStub(patches, "call-1", requests))).then(
      () => undefined,
      () => undefined,
    );
    const recovered = patches.at(-1);
    if (!recovered || recovered.state !== "awaiting_result") {
      throw new Error(`a stranded run with a call id cannot be polled, saw ${JSON.stringify(recovered)}`);
    }
    if (typeof recovered.poll_after !== "string" || new Date(recovered.poll_after).getTime() <= Date.parse("2026-09-12T00:00:00.000Z")) {
      throw new Error(`the recovered run has no poll window, saw ${JSON.stringify(recovered.poll_after)}`);
    }
    if (recovered.terminal_writer !== undefined) throw new Error("a pending recovery tagged a terminal writer");
    const events = await recordedEvents(requests);
    if (events.some((event) => event.kind === "finalised")) {
      throw new Error("a run handed to the poll must record no finalised row");
    }
  });

  testFn("a dry run replays the recording into the ingestion seam", async () => {
    const seen: Request[] = [];
    await dispatchClaimedRun({ ...run, dry_run: true }, baseDeps(stubFetch(seen)));
    const ingest = seen.find((candidate) => candidate.url.includes("ingest_call_result"));
    if (!ingest) throw new Error("a dry run never reached the ingestion seam");
    const payload = await ingest.json() as Record<string, unknown>;
    if (payload.p_result_valid !== true) throw new Error("the recorded extraction was rejected");
    if ((payload.p_transcript_turns as unknown[]).length !== 27) throw new Error("the dry run lost the recorded transcript");
    const structured = payload.p_structured as { captured_items: Array<{ text: string }> };
    if (structured?.captured_items?.[0]?.text !== "Continental") throw new Error("the dry run lost the recorded extraction");
    if (payload.p_state !== "completed" || payload.p_disposition !== "answered_extracted") {
      throw new Error("the dry run synthesized the wrong terminal state");
    }
    const moved = seen.filter((candidate) => candidate.method === "PATCH").at(-1);
    if (!moved || !(await moved.text()).includes('"billable":false')) {
      throw new Error("a dry run did not move the run without billing it");
    }
  });

  testFn("a failed claim insert leaves no run in the dispatch step", async () => {
    const patches: Array<Record<string, unknown>> = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.includes("/call_events") && request.method === "POST") {
        const body = JSON.parse(await request.text()) as { kind?: string };
        if (body.kind === "claimed") return new Response(null, { status: 500 });
        return new Response(null, { status: 204 });
      }
      if (request.method === "PATCH") {
        patches.push(JSON.parse(await request.text()) as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }
      if (request.url.includes("/call_runs")) {
        return Response.json([{ state: "claimed", calle_call_id: null }]);
      }
      throw new Error(`the dispatcher reached an unexpected endpoint, saw ${request.url}`);
    };
    await dispatchClaimedRun(run, baseDeps(fetchStub)).then(
      () => { throw new Error("a failed claim insert was reported as a dispatch"); },
      (error) => {
        if (!(error instanceof Error) || error.message !== "call event insert failed") throw error;
      },
    );
    const recovered = patches.at(-1);
    if (recovered?.state !== "failed" || recovered.terminal_writer !== RECOVERY_WRITER) {
      throw new Error(`a run whose claim insert failed stayed out of every selector, saw ${JSON.stringify(recovered)}`);
    }
    if (!recovered.completed_at) throw new Error("the failed claim insert left no completion time");
  });

  testFn("a call CALL-E accepted is handed to the poll when its write fails", async () => {
    const patches: Array<Record<string, unknown>> = [];
    let stateWrites = 0;
    const fetchStub: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/v1/calls")) {
        return Response.json({ id: "call-1", status: "queued", completion_confidence: null });
      }
      if (request.url.includes("/profiles")) return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
      if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
      if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
      if (request.url.includes("assemble_briefing")) return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
      if (request.method === "PATCH") {
        const patch = JSON.parse(await request.text()) as Record<string, unknown>;
        patches.push(patch);
        // Only the dispatcher's own state write fails, and the call is placed.
        if (typeof patch.state === "string" && patch.terminal_writer !== RECOVERY_WRITER && stateWrites++ === 0) {
          return new Response(null, { status: 500 });
        }
        return new Response(null, { status: 204 });
      }
      if (request.url.includes("/call_runs")) {
        return Response.json([{ state: "claimed", calle_call_id: null }]);
      }
      return new Response(null, { status: 204 });
    };
    await dispatchClaimedRun(run, baseDeps(fetchStub)).then(
      () => { throw new Error("a failed write after the call was reported as a dispatch"); },
      () => undefined,
    );
    const recovered = patches.at(-1);
    if (recovered?.state !== "awaiting_result" || recovered.calle_call_id !== "call-1") {
      throw new Error(`the accepted call was not handed to the poll, saw ${JSON.stringify(recovered)}`);
    }
    if (typeof recovered.poll_after !== "string") throw new Error("the reconciled run carries no poll window");
    if (recovered.terminal_writer !== undefined) throw new Error("the reconciliation tagged a terminal writer");
  });

  testFn("the dispatcher rehearses the fixture the operator selected", async () => {
    const requests: Request[] = [];
    const deps: CalleDeps = {
      ...baseDeps(stubFetch(requests)),
      getEnv: (name: string) => (name === "ORMA_DRY_RUN_FIXTURE" ? "failed" : undefined),
    };
    await dispatchClaimedRun({ ...run, dry_run: true }, deps);
    const events = await recordedEvents(requests);
    const dispatched = events.find((event) => event.kind === "dispatched");
    if (dispatched?.detail.fixture !== "failed") {
      throw new Error(`a selected failed fixture was not rehearsed, saw ${JSON.stringify(dispatched?.detail.fixture)}`);
    }
    const patches = await Promise.all(
      requests.filter((candidate) => candidate.method === "PATCH" && candidate.url.includes("call_runs"))
        .map(async (candidate) => JSON.parse(await candidate.text()) as Record<string, unknown>),
    );
    const terminal = patches.find((patch) => typeof patch.state === "string");
    if (terminal?.state !== "failed" || terminal.terminal_writer !== "dry_run") {
      throw new Error(`the failed rehearsal landed the wrong terminal shape, saw ${JSON.stringify(terminal)}`);
    }
  });

  testFn("a confirmation dry-run record redacts its code, number, and webhook secret", () => {
    const rawCode = "123456";
    const request = JSON.stringify(buildConfirmationCallRequest(
      "123e4567-e89b-12d3-a456-426614174000", "+919999999991", rawCode,
      "https://orma-api.nryn.dev/functions/v1/calle-webhook/deployment-secret",
    ));
    const masked = maskedConfirmationRequestBody(request, rawCode);
    if (masked.includes(rawCode) || masked.includes("1, 2, 3, 4, 5, 6")) {
      throw new Error("the dry-run confirmation record contains the code");
    }
    if (masked.includes("+919999999991") || masked.includes("deployment-secret")) {
      throw new Error("the dry-run confirmation record contains a protected destination value");
    }
  });
}
