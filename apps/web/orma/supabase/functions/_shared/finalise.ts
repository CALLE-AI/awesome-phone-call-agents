/**
 * T2.7a finalise terminal runs.
 *
 * The poll and the webhook move a run to a terminal state and write no rows
 * about the call itself. Ingestion owns those rows, and it needs the
 * authoritative CALL-E payload. This module is the join between them. For one
 * terminal run it re-fetches the call, hands the payload to ingestion, and
 * records one `finalised` row on the timeline.
 *
 * Ingestion owns `completed_at`, and the tick selects terminal runs whose
 * `completed_at` is null. A successful ingest therefore removes the run from
 * the queue by itself. A failed re-fetch writes no call rows, so the run stays
 * queued. The tick isolates every finalise call, exactly as it isolates the
 * poll, so one run's failure costs no sibling.
 *
 * The work is bounded. A failed attempt is counted on the run and pushes
 * `finalise_after` into the future, so the tick skips the run for a wait and a
 * batch of stuck runs cannot hold every slot. After the last attempt this
 * module ends the run and names the reason on the timeline. A run with no
 * CALL-E call id has nothing to re-fetch, so it ends at once the same way. A
 * rehearsal's call id is synthetic, and CALL-E never issued it, so that run
 * ends at once too rather than asking CALL-E about a call that cannot exist.
 *
 * Those give-up paths are the only place outside ingestion that writes
 * `completed_at`, and each writes a `finalised` row that names why.
 *
 * The re-fetch is the authority. A run the poll failed as unanswered is
 * written as completed when CALL-E later reports the call finished.
 *
 * Ingestion commits `completed_at` first, so a failed `finalised` append would
 * lose that row for good. `recordCallEvent` owns the append retry, from one
 * budget, and a lost append is named on the run row.
 *
 * After the `finalised` row lands, and only when this pass did the
 * ingestion, the module sends the T7.4 post-call receipt over Telegram. The
 * receipt names user content, so text the no-CTA guard refuses falls back to
 * the seam's generic receipt. Any other failure is logged with the run id
 * and never un-finalises the run. A replay returns before the receipt path.
 *
 * A dry run never reaches this module. `dispatch-mode.ts` replays its recorded
 * fixture into ingestion inside the dispatch step, and ingestion completes the
 * run there.
 */

import {
  depsFromEnv as calleDepsFromEnv,
  type CalleDeps,
} from "./calle.ts";
import type { DeliverTelegramDeps } from "./deliver-telegram.ts";
import { EVENT_APPEND_ATTEMPTS, recordCallEvent } from "./events.ts";
import type { CallTaskFixture } from "./fixtures.ts";
import {
  type IngestDeps,
  type IngestResult,
  ingestTerminalRun,
  type TerminalCallSource,
} from "./ingest.ts";
import { fetchCall, terminalStateFor, type TerminalState } from "./poll.ts";
import { deliverIngestionReceipt } from "./receipt.ts";

/**
 * One terminal run, as the tick selects it. `calle_call_id` is null only for a
 * run the poll failed before CALL-E ever returned an id. Such a run has no call
 * to re-fetch, so the step ends it and names that reason on the timeline.
 */
export type FinaliseRun = {
  id: string;
  state: string;
  user_id: string;
  calle_call_id: string | null;
};

/** The reason a run with no provider call id is ended with. */
export const NO_CALL_ID_REASON = "the run has no CALL-E call id to re-fetch";

/** The reason a run whose call id is one of ours is ended with. */
export const SYNTHETIC_CALL_ID_REASON =
  "the run's call id is synthetic, so CALL-E cannot re-fetch it";

/**
 * A rehearsal's call id is invented by `dispatch-mode.ts` and carries the
 * `fixture:` prefix. CALL-E never issued it, so a re-fetch can only fail.
 */
export function isSyntheticCallId(callId: string): boolean {
  return callId.startsWith("fixture:");
}

/** Failed attempts this module spends on one run before it ends the run. */
export const FINALISE_MAX_ATTEMPTS = 3;

/** The wait a failed attempt sets before the tick may select the run again. */
export const FINALISE_RETRY_WAIT_MS = 5 * 60_000;

/** Injected so the checks run without a real pause. */
export type Sleep = (ms: number) => Promise<void>;

const waitMs: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ingestion reads the REST transport only. The CALL-E key stays out of it. */
function ingestDeps(deps: CalleDeps): IngestDeps {
  return {
    apiUrl: deps.apiUrl,
    serviceRoleKey: deps.serviceRoleKey,
    fetch: deps.fetch,
  };
}

/** The receipt reads profiles, items and deliveries over the same REST
 * transport, and speaks Telegram with the threaded bot token. */
function receiptDeps(deps: CalleDeps, botToken: string): DeliverTelegramDeps {
  return {
    apiUrl: deps.apiUrl,
    serviceRoleKey: deps.serviceRoleKey,
    botToken,
    fetch: deps.fetch,
  };
}

/**
 * Reads one item's text through PostgREST. No row, or a blank text,
 * resolves to null, which drops the id from the receipt. A read that fails
 * throws, so the whole receipt fails as one unit and the caller logs it.
 */
async function resolveItemText(
  deps: CalleDeps,
  itemId: string,
): Promise<string | null> {
  const url = `${apiBase(deps.apiUrl)}/rest/v1/items?id=eq.${
    encodeURIComponent(itemId)
  }&select=text`;
  const response = await deps.fetch(url, {
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("items receipt read failed");
  const rows = await response.json() as Array<{ text?: string | null }>;
  const text = rows[0]?.text;
  return typeof text === "string" && text !== "" ? text : null;
}

/**
 * The payload a re-fetched call carries into ingestion. The turns come from the
 * first attempt CALL-E reports, which is what `dryRunSource` reads out of a
 * recorded fixture, so a rehearsal and a live run ingest the same shape.
 */
function terminalCallSource(
  run: FinaliseRun,
  call: CallTaskFixture,
): TerminalCallSource {
  const attempt = call.recipients[0]?.attempts[0];
  return {
    callRunId: run.id,
    userId: run.user_id,
    raw: call,
    transcriptTurns: attempt?.transcript_turns ?? [],
    structuredResult: call.structured_result,
  };
}

/**
 * The reason the timeline names for a failed or canceled call. `call_events` is
 * a row an operator reads, so this carries the provider's failure code and
 * never its free text. Ingestion stores that message verbatim on the run.
 */
function failureReason(call: CallTaskFixture, state: TerminalState): string {
  if (state === "completed") return "";
  const code = typeof call.failure_code === "string" ? call.failure_code.trim() : "";
  return code || `CALL-E reported ${state} without a failure code`;
}

/**
 * What the `finalised` row records. The counts are ingestion's own, and the
 * state is the one the authoritative payload reports, which is what ingestion
 * has just written on the run.
 */
type FinalisedDetail = {
  calle_call_id: string;
  state: TerminalState;
  disposition: string;
  item_count: number;
  mention_count: number;
  retirement_count: number;
  commitment_count: number;
  failure_reason: string;
};

function finalisedDetail(
  call: CallTaskFixture,
  state: TerminalState,
  ingested: IngestResult,
): FinalisedDetail {
  return {
    calle_call_id: call.id,
    state,
    disposition: ingested.disposition,
    item_count: ingested.counts.items,
    mention_count: ingested.counts.mentions,
    retirement_count: ingested.counts.retirements,
    commitment_count: ingested.counts.commitments,
    failure_reason: failureReason(call, state),
  };
}

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.includes("supabase.co")) {
    throw new Error("must use ORMA_API_URL, not project host");
  }
  return base;
}

function serviceHeaders(key: string): HeadersInit {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

/** What the attempt boundary reported back about one failed attempt. */
type AttemptOutcome = {
  attempts: number;
  finalised: boolean;
};

/**
 * Records one failed attempt through the SQL boundary that owns the attempt
 * count and the wait. The boundary answers with what the run row now holds, so
 * this module compares the database's count and never a count of its own.
 */
async function recordAttempt(
  run: FinaliseRun,
  reason: string,
  deps: CalleDeps,
): Promise<AttemptOutcome> {
  const response = await deps.fetch(
    `${apiBase(deps.apiUrl)}/rest/v1/rpc/record_finalise_failure`,
    {
      method: "POST",
      headers: serviceHeaders(deps.serviceRoleKey),
      body: JSON.stringify({
        p_call_run_id: run.id,
        p_wait_seconds: Math.round(FINALISE_RETRY_WAIT_MS / 1000),
        p_error: reason,
      }),
    },
  );
  if (!response.ok) throw new Error("finalise attempt could not be recorded");
  const body = await response.json() as { attempts?: unknown; finalised?: unknown };
  return {
    attempts: typeof body.attempts === "number" ? body.attempts : 0,
    finalised: body.finalised === true,
  };
}

/**
 * Ends a run this module can never finish, and says why on the timeline. The
 * SQL boundary ends the run and answers which writer won, so the reason is
 * appended exactly once even when two ticks give up together.
 */
async function abandonRun(
  run: FinaliseRun,
  reason: string,
  attempts: number,
  deps: CalleDeps,
  sleep: Sleep,
): Promise<void> {
  const response = await deps.fetch(
    `${apiBase(deps.apiUrl)}/rest/v1/rpc/abandon_call_run`,
    {
      method: "POST",
      headers: serviceHeaders(deps.serviceRoleKey),
      body: JSON.stringify({ p_call_run_id: run.id, p_reason: reason }),
    },
  );
  if (!response.ok) throw new Error("call_runs abandon failed");
  if (await response.json() !== true) return;
  await recordCallEvent(run.id, "finalised", {
    calle_call_id: run.calle_call_id,
    state: run.state,
    outcome: "abandoned",
    attempts,
    failure_reason: reason,
  }, deps, sleep);
}

/**
 * Decides what one failed attempt means. An attempt inside the limit leaves
 * the run queued and reports the failure. The last attempt ends the run, names
 * the reason on the timeline, and reports success, because the run is finished
 * and the queue is one shorter.
 */
async function attemptFailed(
  run: FinaliseRun,
  error: unknown,
  deps: CalleDeps,
  sleep: Sleep,
): Promise<null> {
  const reason = error instanceof Error ? error.message : "unknown error";
  let outcome: AttemptOutcome;
  try {
    outcome = await recordAttempt(run, reason, deps);
  } catch (recordError) {
    // The run stays queued for the next tick. The failure this attempt met is
    // the one worth reporting, so it is the one that travels.
    console.error(
      `finalise attempt was not recorded for run ${run.id}`,
      recordError instanceof Error ? recordError.message : "unknown error",
    );
    throw error;
  }
  if (outcome.finalised) {
    // A concurrent ingest finished the run while this attempt failed. There is
    // nothing left to finalise, and the run must never be re-fetched.
    console.error(`finalise attempt raced a finished run ${run.id}`, reason);
    return null;
  }
  if (outcome.attempts < FINALISE_MAX_ATTEMPTS) throw error;
  await abandonRun(
    run,
    `${reason} after ${outcome.attempts} attempts`,
    outcome.attempts,
    deps,
    sleep,
  );
  return null;
}

/**
 * The message the receipt seam throws when composed text asks or chases. The
 * seam refuses the text before it reads the profile or writes a deliveries
 * row, so a refused attempt leaves nothing behind.
 */
const CTA_REFUSAL_MESSAGE = "receipt text must not ask or chase";

/** True when a receipt attempt failed on the no-CTA guard alone. */
function isCtaRefusal(error: unknown): boolean {
  return error instanceof Error && error.message === CTA_REFUSAL_MESSAGE;
}

/**
 * Sends the T7.4 post-call receipt once the finalised row stands. The
 * receipt is bookkeeping beside the call, so any failure is logged with the
 * run id, never a key, and swallowed, and the run stays finalised. A caller
 * that threads no bot token keeps the pre-T7.5 behaviour of sending none.
 *
 * The named texts are user content, so any of them can carry a question or
 * a polite phrase the no-CTA guard refuses. That refusal lands before the
 * profile read and any deliveries row, so the wrapper retries once with no
 * named texts and the seam sends its own honest generic receipt. The retry
 * asks for nothing and reveals nothing. Every other failure keeps the old
 * silence, and no path here repeats ingestion or un-finalises the run.
 */
async function sendPostCallReceipt(
  run: FinaliseRun,
  call: CallTaskFixture,
  deps: CalleDeps,
): Promise<void> {
  const botToken = deps.telegramBotToken;
  if (!botToken) return;
  try {
    await deliverIngestionReceipt(
      {
        userId: run.user_id,
        callRunId: run.id,
        structured: call.structured_result,
        resolveRetiredText: (itemId) => resolveItemText(deps, itemId),
      },
      receiptDeps(deps, botToken),
    );
  } catch (error) {
    if (!isCtaRefusal(error)) {
      console.error(
        `post-call receipt failed for run ${run.id}`,
        error instanceof Error ? error.message : "unknown error",
      );
      return;
    }
    // One receipt attempt path, not a second receipt. The refusal is thrown
    // before the seam inserts a row, so this retry cannot duplicate one.
    try {
      await deliverIngestionReceipt(
        { userId: run.user_id, callRunId: run.id, structured: null },
        receiptDeps(deps, botToken),
      );
    } catch (fallbackError) {
      console.error(
        `post-call receipt failed for run ${run.id}`,
        fallbackError instanceof Error
          ? fallbackError.message
          : "unknown error",
      );
    }
  }
}

/**
 * Finalises one terminal run. Nothing is written before the ingest lands, so a
 * failed re-fetch leaves the run queued with no partial state anywhere. This is
 * the pass without the attempt bound, and `finaliseStep` is what the tick runs.
 */
export async function finaliseRun(
  run: FinaliseRun,
  deps: CalleDeps,
  sleep: Sleep = waitMs,
): Promise<IngestResult> {
  if (!run.calle_call_id) {
    throw new Error(`call run ${run.id} has no CALL-E call id to re-fetch`);
  }
  const call = await fetchCall(run.calle_call_id, deps);
  const ingested = await ingestTerminalRun(
    terminalCallSource(run, call),
    ingestDeps(deps),
  );
  // A replay means a concurrent finaliser already committed the rows and the
  // `ingested` row with them. Its own `finalised` row stands, and the zero
  // counts this summary carries would misreport the run.
  if (ingested.alreadyIngested) return ingested;
  // Ingestion refuses a non-terminal payload, so the state is known here.
  const state = terminalStateFor(call.status);
  if (!state) throw new Error(`CALL-E reports ${call.status} for a finalised run`);
  await recordCallEvent(
    run.id,
    "finalised",
    finalisedDetail(call, state, ingested),
    deps,
    sleep,
  );
  // One receipt per successful finalise, and a replay returned above, so a
  // run is never receipted twice. A failure here must not un-finalise the
  // run and must never repeat ingestion.
  await sendPostCallReceipt(run, call, deps);
  return ingested;
}

/**
 * One run's finalise step, with the attempt bound around it. The tick wires
 * this as its finalise step, so a terminal run either lands, waits for its next
 * attempt, or is ended with a reason. None of them is retried forever.
 */
export async function finaliseStep(
  run: FinaliseRun,
  deps: CalleDeps,
  sleep: Sleep = waitMs,
): Promise<IngestResult | null> {
  if (!run.calle_call_id) {
    // Nothing to re-fetch, ever. A wait here would only hold a batch slot.
    await abandonRun(run, NO_CALL_ID_REASON, 0, deps, sleep);
    return null;
  }
  if (isSyntheticCallId(run.calle_call_id)) {
    // A rehearsal reaches this line only when its ingestion failed, because a
    // rehearsal that ingested is already finished. Its call id is ours, so
    // CALL-E can never answer for it, and three re-fetches would put three
    // 404s on the wire for nothing before the same ending. End it now.
    await abandonRun(run, SYNTHETIC_CALL_ID_REASON, 0, deps, sleep);
    return null;
  }
  try {
    return await finaliseRun(run, deps, sleep);
  } catch (error) {
    return await attemptFailed(run, error, deps, sleep);
  }
}

const testFn =
  (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void })
    .test;

if (typeof testFn === "function") {
  const RUN: FinaliseRun = {
    id: "11111111-1111-4111-8111-111111111111",
    state: "failed",
    user_id: "33333333-3333-4333-8333-333333333333",
    calle_call_id: "call_finalise_1",
  };
  const API = "https://orma-api.nryn.dev";
  const CALLE = "https://api.call-e.test";
  const CALLE_HOST = new URL(CALLE).host;

  /** Every stub throws on a path it does not expect, so no request passes
   * unnoticed and no run row can be written behind the ingestion seam. */
  const depsFor = (fetchImpl: typeof fetch, botToken?: string): CalleDeps => ({
    apiUrl: API,
    serviceRoleKey: "service-key",
    calleApiBase: CALLE,
    calleApiKey: "calle-key",
    webhookUrl: `${API}/functions/v1/calle-webhook/secret`,
    fetch: fetchImpl,
    now: () => new Date("2026-09-12T00:00:00.000Z"),
    ...(botToken ? { telegramBotToken: botToken } : {}),
  });

  const payload = (overrides: Record<string, unknown> = {}): unknown => ({
    id: RUN.calle_call_id,
    object: "call_task",
    status: "completed",
    task: "the briefing",
    recipients: [{
      id: "rcp_1",
      status: "completed",
      structured_result: null,
      summary: "done",
      attempts: [{
        id: "att_1",
        status: "completed",
        transcript_turns: [
          { offset_seconds: 12, speaker: "callee", text: "Renew the passport" },
        ],
      }],
    }],
    structured_result: {
      captured_items: [
        { text: "Renew the passport", evidence_offset_seconds: 12 },
      ],
      retired_items: [],
    },
    completion_confidence: { score: 0.8, label: "high" },
    failure_code: null,
    failure_message: null,
    created_at: "2026-09-12T00:00:01.000Z",
    completed_at: "2026-09-12T00:00:05.000Z",
    ...overrides,
  });

  const summary = (overrides: Record<string, unknown> = {}): unknown => ({
    already_ingested: false,
    disposition: "answered_extracted",
    counts: { items: 1, mentions: 1, retirements: 0, commitments: 0 },
    slot_change_requested: null,
    ...overrides,
  });

  const BOT_TOKEN = "fixture-bot-token";
  const TELEGRAM_HOST = "api.telegram.org";

  /** Options a receipt test threads. A test that threads no bot token never
   * reaches any of the receipt branches below. */
  type ReceiptOptions = {
    botToken?: string;
    items?: Record<string, string | null>;
    profilesStatus?: number;
    telegramStatus?: number;
  };

  const driver = (
    call: unknown,
    ingest: unknown = summary(),
    receipt: ReceiptOptions = {},
  ) => {
    const seen: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push(request);
      const url = new URL(request.url);
      if (url.host === CALLE_HOST) return Response.json(call);
      if (url.pathname === "/rest/v1/rpc/ingest_call_result") {
        return Response.json(ingest);
      }
      if (url.pathname === "/rest/v1/call_events") {
        return new Response(null, { status: 201 });
      }
      if (url.pathname === "/rest/v1/items") {
        const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
        const text = receipt.items?.[id];
        return Response.json(text === undefined ? [] : [{ text }]);
      }
      if (url.pathname === "/rest/v1/profiles") {
        if (receipt.profilesStatus) {
          return new Response(null, { status: receipt.profilesStatus });
        }
        return Response.json([{
          id: RUN.user_id,
          telegram_chat_id: 424242,
          telegram_receipts: true,
        }]);
      }
      if (url.pathname === "/rest/v1/deliveries" && request.method === "POST") {
        return Response.json([{
          id: "delivery-1",
          user_id: RUN.user_id,
          channel: "telegram",
          kind: "post_call",
          call_run_id: RUN.id,
          payload: {},
          sent_at: null,
          error: null,
        }]);
      }
      if (url.pathname === "/rest/v1/deliveries" && request.method === "PATCH") {
        return new Response(null, { status: 200 });
      }
      if (url.host === TELEGRAM_HOST) {
        if (receipt.telegramStatus) {
          return new Response(null, { status: receipt.telegramStatus });
        }
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected request ${request.method} ${request.url}`);
    };
    return { seen, deps: depsFor(fetchImpl, receipt.botToken) };
  };

  /**
   * Drives one bounded finalise step. The attempt boundary, the give-up
   * boundary and the timeline append are stubs, so a check reads what this
   * module asked each of them for.
   */
  const stepDriver = (options: {
    call?: unknown;
    callStatus?: number;
    attempt?: { attempts: number; finalised: boolean };
    abandonWon?: boolean;
    eventStatus?: () => number;
  } = {}) => {
    const seen: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push(request);
      const url = new URL(request.url);
      if (url.host === CALLE_HOST) {
        if (options.callStatus) return new Response(null, { status: options.callStatus });
        return Response.json(options.call ?? payload());
      }
      if (url.pathname.endsWith("/rpc/ingest_call_result")) {
        return Response.json(summary());
      }
      if (url.pathname.endsWith("/rpc/record_finalise_failure")) {
        return Response.json(options.attempt ?? { attempts: 1, finalised: false });
      }
      if (url.pathname.endsWith("/rpc/abandon_call_run")) {
        return Response.json(options.abandonWon ?? true);
      }
      if (url.pathname === "/rest/v1/call_events") {
        return new Response(null, { status: options.eventStatus ? options.eventStatus() : 201 });
      }
      throw new Error(`unexpected request ${request.method} ${request.url}`);
    };
    return { seen, deps: depsFor(fetchImpl) };
  };

  /** The checks never wait on a real clock. */
  const instant: Sleep = async () => {};

  testFn(
    "a terminal run is re-fetched, ingested and named on the timeline",
    async () => {
      const { seen, deps } = driver(payload());
      const ingested = await finaliseRun(RUN, deps);

      const refetch = seen.find((request) => new URL(request.url).host === CALLE_HOST);
      if (
        !refetch || refetch.method !== "GET" ||
        !refetch.url.endsWith(`/v1/calls/${RUN.calle_call_id}`)
      ) {
        throw new Error("the finaliser must re-fetch the authoritative call");
      }
      const ingestRequest = seen.find((request) =>
        request.url.endsWith("/rpc/ingest_call_result")
      );
      if (!ingestRequest || ingestRequest.method !== "POST") {
        throw new Error("a re-fetched call must reach ingestion");
      }
      const body = await ingestRequest.json() as Record<string, unknown>;
      if (body.p_call_run_id !== RUN.id || body.p_user_id !== RUN.user_id) {
        throw new Error("ingestion lost the run identity");
      }
      if ((body.p_transcript_turns as unknown[]).length !== 1) {
        throw new Error("the re-fetched transcript did not reach ingestion");
      }
      if (body.p_state !== "completed" || body.p_disposition !== "answered_extracted") {
        throw new Error("the payload's own state did not reach ingestion");
      }
      if (body.p_completed_at !== "2026-09-12T00:00:05.000Z") {
        throw new Error("the provider completion time did not reach ingestion");
      }
      if (ingested.disposition !== "answered_extracted" || ingested.counts.items !== 1) {
        throw new Error("the ingest summary was not handed back");
      }

      const event = seen.find((request) => request.url.endsWith("/call_events"));
      if (!event || event.method !== "POST") {
        throw new Error("a finalised run must record its own timeline row");
      }
      const row = await event.json() as {
        call_run_id: string;
        kind: string;
        detail: Record<string, unknown>;
      };
      if (row.call_run_id !== RUN.id || row.kind !== "finalised") {
        throw new Error("the timeline row lost its run or its transition");
      }
      const detail = row.detail;
      if (detail.state !== "completed" || detail.disposition !== "answered_extracted") {
        throw new Error("the finalised row lost the state or the disposition");
      }
      if (
        detail.item_count !== 1 || detail.mention_count !== 1 ||
        detail.retirement_count !== 0 || detail.commitment_count !== 0
      ) {
        throw new Error(`the finalised row lost its counts: ${JSON.stringify(detail)}`);
      }
      if (detail.calle_call_id !== RUN.calle_call_id) {
        throw new Error("the finalised row lost the provider call id");
      }
    },
  );

  testFn("a failed re-fetch leaves the run queued and writes nothing", async () => {
    const seen: Request[] = [];
    const deps = depsFor(async (input) => {
      const request = new Request(input);
      seen.push(request);
      if (new URL(request.url).host !== CALLE_HOST) {
        throw new Error(`unexpected request ${request.url}`);
      }
      return new Response(null, { status: 503 });
    });
    await finaliseRun(RUN, deps).then(
      () => {
        throw new Error("a failed re-fetch was reported as a finalised run");
      },
      (error) => {
        if (!(error instanceof Error) || !error.message.includes("503")) throw error;
      },
    );
    if (seen.length !== 1) {
      throw new Error(`a failed re-fetch made ${seen.length - 1} further request(s)`);
    }
  });

  testFn(
    "a run with no CALL-E call id is not re-fetched and stays queued",
    async () => {
      let called = false;
      const deps = depsFor(async () => {
        called = true;
        return Response.json(payload());
      });
      await finaliseRun({ ...RUN, calle_call_id: null }, deps).then(
        () => {
          throw new Error("a run with no call id was reported as finalised");
        },
        (error) => {
          if (!(error instanceof Error) || !error.message.includes("no CALL-E call id")) {
            throw error;
          }
        },
      );
      if (called) throw new Error("a run with no call id must not reach the network");
    },
  );

  testFn("a stranded rehearsal is ended without asking CALL-E about a fake id", async () => {
    const { seen, deps } = stepDriver({ abandonWon: true });
    const finished = await finaliseStep(
      { ...RUN, state: "completed", calle_call_id: "fixture:call_recorded" },
      deps,
      instant,
    );
    if (finished !== null) throw new Error("a stranded rehearsal must report no ingest");
    if (seen.some((request) => new URL(request.url).host === CALLE_HOST)) {
      throw new Error("a synthetic call id must never reach CALL-E");
    }
    const abandon = seen.find((request) => request.url.endsWith("/rpc/abandon_call_run"));
    const abandonBody = await abandon?.json() as { p_reason?: string } | undefined;
    if (abandonBody?.p_reason !== SYNTHETIC_CALL_ID_REASON) {
      throw new Error(`the rehearsal's ending lost its reason, saw ${JSON.stringify(abandonBody)}`);
    }
    if (seen.some((request) => request.url.endsWith("/rpc/record_finalise_failure"))) {
      throw new Error("a synthetic call id must not spend a retry attempt");
    }
    const event = seen.find((request) => request.url.endsWith("/call_events"));
    const row = await event?.json() as {
      kind?: string;
      detail?: Record<string, unknown>;
    } | undefined;
    if (row?.kind !== "finalised" || row.detail?.outcome !== "abandoned") {
      throw new Error(`the rehearsal's ending must be on the timeline, saw ${JSON.stringify(row)}`);
    }
    if (row.detail?.state !== "completed") {
      throw new Error("the row must name the state the run held, which the boundary replaces");
    }
  });

  testFn("only a synthetic id is refused, so a real one is still re-fetched", () => {
    if (isSyntheticCallId("call_real_1")) throw new Error("a provider call id was refused");
    if (!isSyntheticCallId("fixture:call_recorded")) {
      throw new Error("a rehearsal's call id was not recognised");
    }
  });

  testFn("the authoritative payload decides the state the timeline records", async () => {
    // The poll gave up on this call and stored `failed` with no completion time.
    // CALL-E later reports the call completed, and that is the truth the run takes.
    const { seen, deps } = driver(payload());
    await finaliseRun(RUN, deps);
    const event = seen.find((request) => request.url.endsWith("/call_events"));
    const row = await event!.json() as { detail: Record<string, unknown> };
    if (row.detail.state !== "completed" || row.detail.failure_reason !== "") {
      throw new Error(`a recovered call kept its stored failure: ${JSON.stringify(row.detail)}`);
    }
  });

  testFn("a failed call names the provider's code and not its free text", async () => {
    const { seen, deps } = driver(payload({
      status: "failed",
      failure_code: "call_failed",
      failure_message: "calling task status=NO ANSWER (Hangup by: bot)",
    }), summary({
      disposition: "not_answered",
      counts: { items: 0, mentions: 0, retirements: 0, commitments: 0 },
    }));
    await finaliseRun(RUN, deps);
    const event = seen.find((request) => request.url.endsWith("/call_events"));
    const row = await event!.json() as { detail: Record<string, unknown> };
    if (row.detail.state !== "failed" || row.detail.failure_reason !== "call_failed") {
      throw new Error(`the failure reason is not the provider's code: ${JSON.stringify(row.detail)}`);
    }
    if (JSON.stringify(row.detail).includes("NO ANSWER")) {
      throw new Error("the timeline row pasted the provider's free text");
    }
  });

  testFn("a canceled call still names a failure reason", async () => {
    const { seen, deps } = driver(
      payload({ status: "canceled", failure_code: null, failure_message: null }),
      summary({
        disposition: "canceled",
        counts: { items: 0, mentions: 0, retirements: 0, commitments: 0 },
      }),
    );
    await finaliseRun(RUN, deps);
    const event = seen.find((request) => request.url.endsWith("/call_events"));
    const row = await event!.json() as { detail: Record<string, unknown> };
    if (row.detail.state !== "canceled" || row.detail.failure_reason === "") {
      throw new Error(`a canceled run needs a reason: ${JSON.stringify(row.detail)}`);
    }
  });

  testFn("a replay writes no second timeline row", async () => {
    const { seen, deps } = driver(payload(), summary({
      already_ingested: true,
      counts: { items: 0, mentions: 0, retirements: 0, commitments: 0 },
    }));
    const ingested = await finaliseRun(RUN, deps);
    if (!ingested.alreadyIngested) {
      throw new Error("the replay marker was not handed back");
    }
    if (seen.some((request) => request.url.endsWith("/call_events"))) {
      throw new Error("a replay wrote a second finalised row");
    }
  });

  testFn("a call CALL-E has not finished cannot be finalised", async () => {
    const { seen, deps } = driver(payload({ status: "in_progress" }));
    await finaliseRun(RUN, deps).then(
      () => {
        throw new Error("a pending call was reported as finalised");
      },
      (error) => {
        if (!(error instanceof Error) || !error.message.includes("terminal call status")) {
          throw error;
        }
      },
    );
    if (seen.length !== 1) {
      throw new Error("a pending call must not write anything");
    }
  });

  testFn("a failed attempt is counted on the run and the run stays queued", async () => {
    const { seen, deps } = stepDriver({
      callStatus: 503,
      attempt: { attempts: 1, finalised: false },
    });
    await finaliseStep(RUN, deps, instant).then(
      () => {
        throw new Error("a failed attempt was reported as a finished run");
      },
      (error) => {
        if (!(error instanceof Error) || !error.message.includes("503")) throw error;
      },
    );
    const record = seen.find((request) =>
      request.url.endsWith("/rpc/record_finalise_failure")
    );
    if (!record || record.method !== "POST") {
      throw new Error("a failed attempt must be counted on the run");
    }
    const body = await record.json() as {
      p_call_run_id?: string;
      p_wait_seconds?: number;
      p_error?: string;
    };
    if (body.p_call_run_id !== RUN.id) {
      throw new Error("the attempt lost the run");
    }
    if (body.p_wait_seconds !== FINALISE_RETRY_WAIT_MS / 1000) {
      throw new Error(`the attempt lost its wait: ${JSON.stringify(body)}`);
    }
    if (!body.p_error?.includes("503")) {
      throw new Error(`the attempt lost the failure: ${JSON.stringify(body)}`);
    }
    const ended = seen.some((request) =>
      request.url.endsWith("/call_events") ||
      request.url.endsWith("/rpc/abandon_call_run")
    );
    if (ended) throw new Error("an attempt inside the limit ended the run");
  });

  testFn("the last attempt ends the run and names the reason", async () => {
    const { seen, deps } = stepDriver({
      callStatus: 503,
      attempt: { attempts: FINALISE_MAX_ATTEMPTS, finalised: false },
    });
    const finished = await finaliseStep(RUN, deps, instant);
    if (finished !== null) {
      throw new Error("a given-up run must report no ingest");
    }
    const abandon = seen.find((request) =>
      request.url.endsWith("/rpc/abandon_call_run")
    );
    if (!abandon || abandon.method !== "POST") {
      throw new Error("the last attempt must end the run");
    }
    const abandonBody = await abandon.json() as {
      p_call_run_id?: string;
      p_reason?: string;
    };
    if (
      abandonBody.p_call_run_id !== RUN.id ||
      !abandonBody.p_reason?.includes("503") ||
      !abandonBody.p_reason.includes(`${FINALISE_MAX_ATTEMPTS} attempts`)
    ) {
      throw new Error(`the give-up lost its run or its reason: ${JSON.stringify(abandonBody)}`);
    }
    // The disposition and its billing are the SQL boundary's, because it is the
    // last writer for this run. `test-ingest.sh` reads the pair back as
    // `failed | not_answered | false`. This module must therefore send neither,
    // so a future caller cannot smuggle a pair the boundary would ignore.
    const abandonKeys = Object.keys(abandonBody).sort().join(",");
    if (abandonKeys !== "p_call_run_id,p_reason") {
      throw new Error(`the give-up must leave the disposition to the boundary, sent ${abandonKeys}`);
    }
    const event = seen.find((request) => request.url.endsWith("/call_events"));
    const row = await event!.json() as {
      kind?: string;
      detail?: Record<string, unknown>;
    };
    if (row.kind !== "finalised" || row.detail?.outcome !== "abandoned") {
      throw new Error(`the give-up must name itself on the timeline: ${JSON.stringify(row)}`);
    }
    if (
      row.detail?.state !== RUN.state ||
      row.detail?.attempts !== FINALISE_MAX_ATTEMPTS ||
      typeof row.detail?.failure_reason !== "string" ||
      row.detail.failure_reason === ""
    ) {
      throw new Error(`the give-up row lost its state, attempts or reason: ${JSON.stringify(row.detail)}`);
    }
  });

  testFn("a run with no call id ends at once and names why", async () => {
    const { seen, deps } = stepDriver();
    const finished = await finaliseStep({ ...RUN, calle_call_id: null }, deps, instant);
    if (finished !== null) {
      throw new Error("a run with no call id reported an ingest");
    }
    if (seen.some((request) => new URL(request.url).host === CALLE_HOST)) {
      throw new Error("a run with no call id must not reach CALL-E");
    }
    if (seen.some((request) => request.url.endsWith("/rpc/record_finalise_failure"))) {
      throw new Error("a run with nothing to re-fetch must not spend an attempt");
    }
    const abandon = seen.find((request) =>
      request.url.endsWith("/rpc/abandon_call_run")
    );
    if (!abandon) throw new Error("a run with no call id must be ended");
    const abandonBody = await abandon.json() as { p_reason?: string };
    if (abandonBody.p_reason !== NO_CALL_ID_REASON) {
      throw new Error(`the ended run lost its reason: ${JSON.stringify(abandonBody)}`);
    }
    const event = seen.find((request) => request.url.endsWith("/call_events"));
    const row = await event!.json() as {
      kind?: string;
      detail?: Record<string, unknown>;
    };
    if (row.kind !== "finalised" || row.detail?.failure_reason !== NO_CALL_ID_REASON) {
      throw new Error(`the timeline must name why the run ended: ${JSON.stringify(row)}`);
    }
  });

  testFn("a transient timeline failure is retried and the row still lands", async () => {
    let appends = 0;
    const { seen, deps } = stepDriver({
      eventStatus: () => (++appends === 1 ? 500 : 201),
    });
    const ingested = await finaliseRun(RUN, deps, instant);
    if (ingested.disposition !== "answered_extracted") {
      throw new Error("the ingest summary was lost");
    }
    const events = seen.filter((request) =>
      request.url.endsWith("/call_events")
    );
    if (appends !== 2 || events.length !== 2) {
      throw new Error(`the append was attempted ${appends} time(s)`);
    }
    const row = await events[1].json() as { kind?: string };
    if (row.kind !== "finalised") {
      throw new Error("the retried append lost its transition");
    }
  });

  testFn("a lost finalised append never becomes a second ingest", async () => {
    const { seen, deps } = stepDriver({
      eventStatus: () => 500,
      attempt: { attempts: 0, finalised: true },
    });
    const finished = await finaliseStep(RUN, deps, instant);
    if (finished !== null) {
      throw new Error("a run whose ingest landed must not be given up on");
    }
    const ingests = seen.filter((request) =>
      request.url.endsWith("/rpc/ingest_call_result")
    );
    if (ingests.length !== 1) {
      throw new Error(`the run was ingested ${ingests.length} time(s)`);
    }
    const appends = seen.filter((request) =>
      request.url.endsWith("/call_events")
    );
    // One budget, owned by `recordCallEvent`. A second wrapper here would make
    // this nine requests, and the loss record on the run row is what stays.
    if (appends.length !== EVENT_APPEND_ATTEMPTS) {
      throw new Error(`the append must be attempted ${EVENT_APPEND_ATTEMPTS} times, saw ${appends.length}`);
    }
    if (seen.some((request) => request.url.endsWith("/rpc/abandon_call_run"))) {
      throw new Error("a run whose ingest landed must never be abandoned");
    }
  });

  testFn(
    "a successful finalise sends one post_call receipt naming resolved texts",
    async () => {
      const { seen, deps } = driver(
        payload({
          structured_result: {
            captured_items: [{
              text: "Renew the passport",
              evidence_offset_seconds: 12,
            }],
            retired_items: [{
              item_id: "item-1",
              evidence_offset_seconds: 30,
            }],
            commitments: [{
              item_id: "item-2",
              due: "Friday",
              evidence_offset_seconds: 45,
            }],
          },
        }),
        summary({
          counts: { items: 1, mentions: 1, retirements: 1, commitments: 1 },
        }),
        {
          botToken: BOT_TOKEN,
          items: { "item-1": "Old passport", "item-2": "Book the appointment" },
        },
      );
      const ingested = await finaliseRun(RUN, deps);
      if (ingested.alreadyIngested) {
        throw new Error("the fixture must be a fresh ingest");
      }

      const itemReads = seen.filter((request) =>
        new URL(request.url).pathname === "/rest/v1/items"
      );
      const reads = itemReads.map((request) => {
        const url = new URL(request.url);
        return {
          id: (url.searchParams.get("id") ?? "").replace(/^eq\./, ""),
          select: url.searchParams.get("select"),
          authorization: request.headers.get("authorization"),
        };
      }).sort((a, b) => a.id.localeCompare(b.id));
      if (reads.map((read) => read.id).join(",") !== "item-1,item-2") {
        throw new Error(
          `the receipt resolved the wrong ids: ${JSON.stringify(reads)}`,
        );
      }
      if (reads.some((read) => read.select !== "text")) {
        throw new Error("the items read must select only the text");
      }
      if (reads.some((read) => read.authorization !== "Bearer service-key")) {
        throw new Error("the items read must carry the service role");
      }

      const sends = seen.filter((request) =>
        new URL(request.url).host === TELEGRAM_HOST
      );
      if (sends.length !== 1) {
        throw new Error(`one receipt must reach Telegram, saw ${sends.length}`);
      }
      const send = await sends[0].json() as { chat_id: number; text: string };
      if (send.chat_id !== 424242) {
        throw new Error("the receipt went to the wrong chat");
      }
      for (
        const named of [
          "Renew the passport",
          "Old passport",
          "Book the appointment",
        ]
      ) {
        if (!send.text.includes(named)) {
          throw new Error(
            `the receipt lost ${JSON.stringify(named)}: ${JSON.stringify(send.text)}`,
          );
        }
      }

      const posts = seen.filter((request) =>
        request.method === "POST" &&
        new URL(request.url).pathname === "/rest/v1/deliveries"
      );
      if (posts.length !== 1) {
        throw new Error(`one post_call row must be written, saw ${posts.length}`);
      }
      const row = await posts[0].json() as {
        user_id: string;
        kind: string;
        call_run_id: string;
      };
      if (
        row.kind !== "post_call" || row.call_run_id !== RUN.id ||
        row.user_id !== RUN.user_id
      ) {
        throw new Error(
          `the deliveries row lost its identity: ${JSON.stringify(row)}`,
        );
      }
      if (seen.indexOf(posts[0]) > seen.indexOf(sends[0])) {
        throw new Error("the deliveries row must precede the send");
      }
      const patch = seen.find((request) =>
        request.method === "PATCH" && request.url.includes("/rest/v1/deliveries")
      );
      if (!patch) throw new Error("the sent receipt must be marked sent");
    },
  );

  testFn("an unresolved item id is dropped rather than printed", async () => {
    const { seen, deps } = driver(
      payload({
        structured_result: {
          captured_items: [],
          retired_items: [{
            item_id: "item-gone",
            evidence_offset_seconds: 30,
          }],
        },
      }),
      summary({
        counts: { items: 0, mentions: 0, retirements: 1, commitments: 0 },
      }),
      { botToken: BOT_TOKEN, items: {} },
    );
    await finaliseRun(RUN, deps);
    const sends = seen.filter((request) =>
      new URL(request.url).host === TELEGRAM_HOST
    );
    if (sends.length !== 1) throw new Error("the receipt must still go out");
    const send = await sends[0].json() as { text: string };
    if (send.text.includes("item-gone")) {
      throw new Error("the receipt printed an id it could not resolve");
    }
    if (!send.text.includes("Retired: none")) {
      throw new Error(
        `the unresolved id must leave no name: ${JSON.stringify(send.text)}`,
      );
    }
  });

  testFn(
    "a telegram receipt failure leaves the ingest result and timeline unchanged",
    async () => {
      const { seen, deps } = driver(payload(), summary(), {
        botToken: BOT_TOKEN,
        telegramStatus: 500,
      });
      const ingested = await finaliseRun(RUN, deps);
      if (
        ingested.disposition !== "answered_extracted" ||
        ingested.counts.items !== 1
      ) {
        throw new Error("a failed receipt must not change the ingest result");
      }
      const event = seen.find((request) =>
        request.url.endsWith("/call_events")
      );
      const row = await event!.json() as { kind: string };
      if (row.kind !== "finalised") {
        throw new Error("a failed receipt must not remove the finalised row");
      }
      const patch = seen.find((request) =>
        request.method === "PATCH" && request.url.includes("/rest/v1/deliveries")
      );
      const patchBody = await patch!.json() as { error: string };
      if (patchBody.error !== "telegram sendMessage failed") {
        throw new Error(
          `the failed receipt lost its error text: ${JSON.stringify(patchBody)}`,
        );
      }
    },
  );

  testFn(
    "a receipt that throws before any row still leaves the run finalised",
    async () => {
      const { seen, deps } = driver(payload(), summary(), {
        botToken: BOT_TOKEN,
        profilesStatus: 503,
      });
      const ingested = await finaliseRun(RUN, deps);
      if (ingested.disposition !== "answered_extracted") {
        throw new Error("a failed receipt must not change the ingest result");
      }
      if (
        seen.some((request) =>
          new URL(request.url).pathname === "/rest/v1/deliveries"
        )
      ) {
        throw new Error("a failed profile read must write no deliveries row");
      }
      const event = seen.find((request) =>
        request.url.endsWith("/call_events")
      );
      const row = await event!.json() as { kind: string };
      if (row.kind !== "finalised") {
        throw new Error("the finalised row must stand");
      }
    },
  );

  testFn(
    "unsafe user text still sends one generic post_call receipt",
    async () => {
      const { seen, deps } = driver(
        payload({
          structured_result: {
            captured_items: [{
              text: "Should I renew the passport again?",
              evidence_offset_seconds: 12,
            }],
            retired_items: [{
              item_id: "item-1",
              evidence_offset_seconds: 30,
            }],
          },
        }),
        summary({
          counts: { items: 1, mentions: 1, retirements: 1, commitments: 0 },
        }),
        {
          botToken: BOT_TOKEN,
          items: { "item-1": "Please cancel the old card" },
        },
      );
      const ingested = await finaliseRun(RUN, deps);
      if (ingested.alreadyIngested) {
        throw new Error("the fixture must be a fresh ingest");
      }
      const ingests = seen.filter((request) =>
        request.url.endsWith("/rpc/ingest_call_result")
      );
      if (ingests.length !== 1) {
        throw new Error(
          `the fallback must never repeat ingestion, saw ${ingests.length}`,
        );
      }
      const sends = seen.filter((request) =>
        new URL(request.url).host === TELEGRAM_HOST
      );
      if (sends.length !== 1) {
        throw new Error(`one generic receipt must go out, saw ${sends.length}`);
      }
      const send = await sends[0].json() as { chat_id: number; text: string };
      if (send.chat_id !== 424242) {
        throw new Error("the fallback went to the wrong chat");
      }
      if (send.text.includes("?")) {
        throw new Error(`the fallback must not ask: ${JSON.stringify(send.text)}`);
      }
      for (
        const unsafe of [
          "Should I renew the passport again?",
          "Please cancel the old card",
        ]
      ) {
        if (send.text.includes(unsafe)) {
          throw new Error(
            `the fallback printed unsafe text: ${JSON.stringify(unsafe)}`,
          );
        }
      }
      if (send.text !== "Call summary\nCaptured: none\nRetired: none") {
        throw new Error(
          `the fallback must be the generic summary: ${JSON.stringify(send.text)}`,
        );
      }
      const posts = seen.filter((request) =>
        request.method === "POST" &&
        new URL(request.url).pathname === "/rest/v1/deliveries"
      );
      if (posts.length !== 1) {
        throw new Error(`the fallback must write one row, saw ${posts.length}`);
      }
      const post = await posts[0].json() as {
        kind: string;
        call_run_id: string;
        payload: { text: string };
      };
      if (post.kind !== "post_call" || post.call_run_id !== RUN.id) {
        throw new Error(`the fallback row lost its identity: ${JSON.stringify(post)}`);
      }
      if (post.payload.text !== "Call summary\nCaptured: none\nRetired: none") {
        throw new Error(
          `the fallback row must not carry the refused text: ${JSON.stringify(post.payload)}`,
        );
      }
      const patch = seen.find((request) =>
        request.method === "PATCH" && request.url.includes("/rest/v1/deliveries")
      );
      if (!patch) throw new Error("the fallback must be marked sent");
      const event = seen.find((request) => request.url.endsWith("/call_events"));
      const timeline = await event!.json() as { kind: string };
      if (timeline.kind !== "finalised") {
        throw new Error("the fallback must leave the finalised row standing");
      }
    },
  );

  testFn(
    "a replay sends no receipt and writes no second post_call row",
    async () => {
      const { seen, deps } = driver(
        payload(),
        summary({
          already_ingested: true,
          counts: { items: 0, mentions: 0, retirements: 0, commitments: 0 },
        }),
        { botToken: BOT_TOKEN, items: { "item-1": "Old passport" } },
      );
      const ingested = await finaliseRun(RUN, deps);
      if (!ingested.alreadyIngested) {
        throw new Error("the replay marker was not handed back");
      }
      const receiptTraffic = seen.filter((request) => {
        const path = new URL(request.url).pathname;
        return (
          path === "/rest/v1/items" ||
          path === "/rest/v1/profiles" ||
          path === "/rest/v1/deliveries" ||
          new URL(request.url).host === TELEGRAM_HOST
        );
      });
      if (receiptTraffic.length !== 0) {
        throw new Error(
          `a replay sent receipt traffic: ${
            JSON.stringify(receiptTraffic.map((request) => request.url))
          }`,
        );
      }
    },
  );

  testFn(
    "no threaded bot token preserves the old receipt-free finalise",
    async () => {
      const { seen, deps } = driver(payload(), summary());
      await finaliseRun(RUN, deps);
      // The re-fetch, the ingest and the timeline append, and nothing else.
      if (seen.length !== 3) {
        throw new Error(
          `a finalise without a token must make no receipt calls, saw ${seen.length}`,
        );
      }
    },
  );

  testFn("calleDepsFromEnv requires the telegram bot token by name", () => {
    const values: Record<string, string> = {
      ORMA_API_URL: API,
      ORMA_WEBHOOK_SECRET: "webhook-secret",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      CALLE_API_BASE: CALLE,
      CALLE_API_KEY: "calle-key",
    };
    try {
      calleDepsFromEnv((key) => values[key]);
      throw new Error("depsFromEnv must require TELEGRAM_BOT_TOKEN");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "missing TELEGRAM_BOT_TOKEN"
      ) {
        throw error;
      }
    }
    values.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const deps = calleDepsFromEnv((key) => values[key]);
    if (deps.telegramBotToken !== BOT_TOKEN) {
      throw new Error("the bot token must be threaded into the deps");
    }
  });
}
