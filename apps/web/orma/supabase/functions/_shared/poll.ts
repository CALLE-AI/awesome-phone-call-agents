/**
 * T2.5 poll reconciliation.
 *
 * Webhooks get dropped, so polling is the safety net that makes a lost
 * delivery survivable. A dispatched run carries `poll_after` and the tick
 * advances it by re-fetching the authoritative call. Follow-up crosses tick
 * boundaries rather than looping, because a free Edge Function allows 150
 * seconds of wall clock per request.
 *
 * Whichever of the webhook and the poll arrives first wins. Every write here
 * is a conditional PATCH that only matches a still-pending run, so the second
 * arrival changes nothing and records nothing.
 * A terminal write stamps `terminal_writer` with `poll` in the same statement.
 *
 * This module sets a terminal `state` and deliberately leaves `completed_at`
 * null. The tick's finaliser owns `completed_at` and the ingestion that
 * follows, because `terminalRuns()` selects terminal runs with a null
 * `completed_at`, and a poll must not shortcut that.
 */

import type { CalleDeps } from "./calle.ts";
import { calleFetch } from "./calle-origin.ts";
import { recordCallEvent } from "./events.ts";
import { RESULT_VALIDATION_FAILED, type CallTaskFixture } from "./fixtures.ts";

/** The first follow-up is set by dispatch. Each pass after that waits ten. */
export const POLL_INTERVAL_MS = 10_000;

/**
 * A run the provider never resolves is worse than a failed one, because it is
 * invisible. Give up well past the 140 seconds a real call took, and name the
 * reason on the run so an operator sees where it stopped.
 */
export const POLL_GIVE_UP_MS = 15 * 60_000;

/**
 * The terminal states CALL-E can report, mapped onto `call_runs.state`.
 * `no_result` is the state `spec.md` section 3 names for a call whose result
 * failed validation, which CALL-E reports under its own status name.
 */
export type TerminalState = "completed" | "no_result" | "failed" | "canceled";

export type PollableRun = {
  id: string;
  state: string;
  poll_after: string | null;
};

type RunRow = {
  id: string;
  state: string;
  calle_call_id: string | null;
  dispatched_at: string | null;
  poll_after: string | null;
  created_at: string;
};

const PENDING_STATES = "in.(dispatched,awaiting_result)";

/**
 * Stamped on every terminal write, in the same statement as `state`. A writer
 * that matched no row reads it to tell this poll's move from its own.
 */
const TERMINAL_WRITER = "poll";

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

export function terminalStateFor(status: string): TerminalState | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  if ((RESULT_VALIDATION_FAILED as readonly string[]).includes(status)) return "no_result";
  return null;
}

/**
 * Re-fetches one authoritative call. It carries no run-state side effect, so
 * the tick's finaliser can reuse it for a run the webhook already terminalised.
 */
export async function fetchCall(
  callId: string,
  deps: CalleDeps,
): Promise<CallTaskFixture> {
  if (!callId) throw new Error("poll requires a CALL-E call id");
  const response = await calleFetch(deps, `/v1/calls/${encodeURIComponent(callId)}`);
  if (!response.ok) throw new Error(`CALL-E re-fetch returned HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) {
    throw new Error("CALL-E re-fetch returned no call task");
  }
  const call = value as Partial<CallTaskFixture>;
  if (typeof call.id !== "string" || typeof call.status !== "string") {
    throw new Error("CALL-E re-fetch response missing id or status");
  }
  if (call.id !== callId) {
    throw new Error(`CALL-E re-fetch returned ${call.id} for ${callId}`);
  }
  return call as CallTaskFixture;
}

async function readRun(deps: CalleDeps, runId: string): Promise<RunRow | null> {
  const query = new URLSearchParams({
    select: "id,state,calle_call_id,dispatched_at,poll_after,created_at",
    id: `eq.${runId}`,
    limit: "1",
  });
  const response = await deps.fetch(restUrl(deps.apiUrl, "call_runs", query.toString()), {
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("call_runs poll read failed");
  const rows = await response.json() as RunRow[];
  return rows[0] ?? null;
}

/**
 * Applies a patch only while the run is still pending, and reports whether
 * this caller was the one that won. Returning the representation is what makes
 * the loss observable rather than assumed.
 */
async function patchPendingRun(
  deps: CalleDeps,
  runId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const query = new URLSearchParams({ id: `eq.${runId}`, state: PENDING_STATES });
  const response = await deps.fetch(restUrl(deps.apiUrl, "call_runs", query.toString()), {
    method: "PATCH",
    headers: serviceHeaders(deps.serviceRoleKey, "return=representation"),
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error("call_runs poll update failed");
  const rows = await response.json() as unknown[];
  return Array.isArray(rows) && rows.length === 1;
}

function failure(code: string, message: string): Record<string, string> {
  return { failure_code: code, failure_message: message };
}

async function reschedule(
  deps: CalleDeps,
  runId: string,
  callId: string | null,
  detail: Record<string, string | number | boolean | null>,
): Promise<void> {
  const pollAfter = new Date(deps.now().getTime() + POLL_INTERVAL_MS).toISOString();
  const won = await patchPendingRun(deps, runId, { poll_after: pollAfter });
  if (!won) return;
  await recordCallEvent(runId, "polled", { calle_call_id: callId, ...detail }, deps);
}

/**
 * Advances one pending run by one poll pass. A transport failure, a provider
 * error or an unparseable body reschedules the next pass instead of throwing,
 * so one poisoned run cannot fail the whole tick.
 */
export async function pollRun(run: PollableRun, deps: CalleDeps): Promise<void> {
  const current = await readRun(deps, run.id);
  // The webhook may have terminalised this run between the tick's read and
  // this call. That is the race, and losing it is a no-op.
  if (!current || current.state !== "dispatched" && current.state !== "awaiting_result") {
    return;
  }

  if (!current.calle_call_id) {
    // The disposition and its billing are written together, as the ingestion
    // boundary writes them, so the pair can never disagree.
    const won = await patchPendingRun(deps, run.id, {
      state: "failed",
      terminal_writer: TERMINAL_WRITER,
      disposition: "not_answered",
      billable: false,
      calle_failure: failure("poll_unavailable", "run has no CALL-E call id to poll"),
    });
    if (won) {
      await recordCallEvent(
        run.id,
        "polled",
        { calle_call_id: null, state: "failed", failure_reason: "run has no CALL-E call id to poll" },
        deps,
      );
    }
    return;
  }

  // The window runs from a clock that never moves. `poll_after` cannot stand
  // in for a missing `dispatched_at`, because every pass rewrites it and the
  // deadline would slide forever. `created_at` is set once and never null.
  const windowStart = current.dispatched_at ?? current.created_at;
  const deadline = windowStart ? new Date(windowStart).getTime() + POLL_GIVE_UP_MS : NaN;
  const overdue = Number.isFinite(deadline) && deps.now().getTime() > deadline;

  // An overdue run still asks CALL-E first. Only the re-fetch may decide a
  // state, so a call that completed late must land as completed, not unanswered.
  const giveUp = async (message: string, outcome: string): Promise<void> => {
    const won = await patchPendingRun(deps, run.id, {
      state: "failed",
      terminal_writer: TERMINAL_WRITER,
      disposition: "not_answered",
      billable: false,
      calle_failure: failure("poll_timeout", message),
    });
    if (won) {
      await recordCallEvent(
        run.id,
        "polled",
        { calle_call_id: current.calle_call_id, state: "failed", failure_reason: "poll_timeout", outcome },
        deps,
      );
    }
  };

  let call: CallTaskFixture;
  try {
    call = await fetchCall(current.calle_call_id, deps);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    // Past the window a failing re-fetch also gives up. Retrying forever would
    // unbound the window, and the message keeps the re-fetch error visible.
    if (overdue) {
      await giveUp(`CALL-E re-fetch failed past the give-up window: ${reason}`, "refetch_failed");
      return;
    }
    await reschedule(deps, run.id, current.calle_call_id, {
      state: current.state,
      outcome: "refetch_failed",
      failure_reason: reason,
    });
    return;
  }

  const terminal = terminalStateFor(call.status);
  if (!terminal) {
    if (overdue) {
      await giveUp("CALL-E never reported a terminal state", "pending");
      return;
    }
    await reschedule(deps, run.id, call.id, { state: call.status, outcome: "pending" });
    return;
  }

  const failureCode = call.failure_code;
  const patch: Record<string, unknown> = {
    state: terminal,
    terminal_writer: TERMINAL_WRITER,
    calle_confidence: call.completion_confidence,
    calle_failure: failureCode ? failure(failureCode, call.failure_message ?? "") : null,
    poll_after: null,
  };
  const won = await patchPendingRun(deps, run.id, patch);
  if (!won) return;
  await recordCallEvent(
    run.id,
    "polled",
    { calle_call_id: call.id, state: terminal, outcome: "terminal" },
    deps,
  );
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function") {
  const NOW = new Date("2026-09-13T10:00:00.000Z");
  const RUN = "11111111-1111-4111-8111-111111111111";
  const CALL = "call_poll_1";

  type Seen = { method: string; url: string; body: unknown };

  const depsFor = (
    fetchImpl: typeof fetch,
    now: Date = NOW,
  ): CalleDeps => ({
    apiUrl: "https://orma-api.test",
    serviceRoleKey: "service-key",
    calleApiBase: "https://api.heycall-e.com",
    calleApiKey: "calle-key",
    webhookUrl: "https://orma-api.test/functions/v1/calle-webhook/secret",
    fetch: fetchImpl,
    now: () => now,
  });

  /** Every mock branches on method and path and throws on anything else, so no
   * test can reach a real service and no unexpected call can pass unnoticed. */
  const driver = (options: {
    run: Partial<RunRow> & { id: string; state: string };
    call?: unknown;
    callStatus?: number;
    patchWins?: boolean;
    callThrows?: boolean;
  }) => {
    const seen: Seen[] = [];
    const events: { kind: string; detail: Record<string, unknown> }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : null;
      seen.push({ method: request.method, url: request.url, body });
      if (url.host === "api.heycall-e.com") {
        if (options.callThrows) throw new Error("network down");
        if (options.callStatus && options.callStatus >= 400) {
          return new Response(null, { status: options.callStatus });
        }
        return Response.json(options.call ?? { id: CALL, status: "in_progress" });
      }
      if (url.host === "orma-api.test" && url.pathname === "/rest/v1/call_runs") {
        if (request.method === "GET") {
          return Response.json([{ calle_call_id: CALL, dispatched_at: NOW.toISOString(), poll_after: null, created_at: NOW.toISOString(), ...options.run }]);
        }
        if (request.method === "PATCH") {
          return Response.json(options.patchWins === false ? [] : [{ id: options.run.id }]);
        }
      }
      if (url.pathname === "/rest/v1/call_events" && request.method === "POST") {
        events.push(body as { kind: string; detail: Record<string, unknown> });
        return new Response(null, { status: 201 });
      }
      throw new Error(`unexpected request ${request.method} ${request.url}`);
    };
    return { seen, events, fetchImpl };
  };

  testFn("a pending call reschedules the next pass instead of finalising", async () => {
    const { seen, events, fetchImpl } = driver({
      run: { id: RUN, state: "awaiting_result" },
      call: { id: CALL, status: "in_progress" },
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    const patch = seen.find((entry) => entry.method === "PATCH");
    const body = patch?.body as { poll_after?: string; state?: string; terminal_writer?: string };
    if (!patch) throw new Error("a pending poll must persist the next poll time");
    if (body.state !== undefined) throw new Error("a pending poll must not write a terminal state");
    if (body.terminal_writer !== undefined) {
      throw new Error("a reschedule must not name a terminal writer");
    }
    if (body.poll_after !== new Date(NOW.getTime() + POLL_INTERVAL_MS).toISOString()) {
      throw new Error("the next pass must be ten seconds out");
    }
    if (!seen.some((entry) => entry.method === "GET" && entry.url.includes("/v1/calls/" + CALL))) {
      throw new Error("a pending poll must re-fetch the authoritative call");
    }
    if (events.length !== 1 || events[0].kind !== "polled") {
      throw new Error("a pending poll must record exactly one polled event");
    }
  });

  testFn("a completed call terminalises the run and leaves finalisation alone", async () => {
    const { seen, events, fetchImpl } = driver({
      run: { id: RUN, state: "dispatched" },
      call: { id: CALL, status: "completed", completion_confidence: { score: 0.9, label: "high" }, failure_code: null },
    });
    await pollRun({ id: RUN, state: "dispatched", poll_after: null }, depsFor(fetchImpl));
    const patch = seen.find((entry) => entry.method === "PATCH");
    const body = patch?.body as Record<string, unknown>;
    if (body.state !== "completed") throw new Error("a completed call must move the run to completed");
    if ("completed_at" in body) {
      throw new Error("the poll must not set completed_at, because the finaliser owns it");
    }
    if (body.terminal_writer !== "poll") {
      throw new Error("the terminal write must name the poll as the writer");
    }
    if (!patch?.url.includes("state=in.%28dispatched%2Cawaiting_result%29")) {
      throw new Error("the terminal write must only match a still-pending run");
    }
    if (events[0]?.detail.state !== "completed" || events[0]?.detail.calle_call_id !== CALL) {
      throw new Error("the terminal event must name the provider id and the authoritative state");
    }
  });

  testFn("a failed call records the failure the provider reported", async () => {
    const { events, fetchImpl } = driver({
      run: { id: RUN, state: "awaiting_result" },
      call: { id: CALL, status: "failed", failure_code: "no_answer", failure_message: "recipient did not pick up" },
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    if (events[0]?.detail.state !== "failed") throw new Error("a failed call must move the run to failed");
  });

  testFn("a validation failure terminalises the run as no_result", async () => {
    const { seen, events, fetchImpl } = driver({
      run: { id: RUN, state: "awaiting_result" },
      call: { id: CALL, status: "result_validation_failed" },
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    const body = seen.find((entry) => entry.method === "PATCH")?.body as Record<string, unknown>;
    if (body.state !== "no_result") {
      throw new Error(`a failed result validation must land as no_result, saw ${JSON.stringify(body.state)}`);
    }
    if (events[0]?.detail.state !== "no_result") {
      throw new Error(`the polled row must carry no_result, saw ${JSON.stringify(events[0]?.detail)}`);
    }
  });

  testFn("every provider status maps to the run state it produces", () => {
    const cases: Array<[string, string | null]> = [
      ["completed", "completed"],
      ["failed", "failed"],
      ["canceled", "canceled"],
      ["result_validation_failed", "no_result"],
      ["call.result_validation_failed", "no_result"],
      ["queued", null],
      ["in_progress", null],
    ];
    for (const [status, expected] of cases) {
      const mapped = terminalStateFor(status);
      if (mapped !== expected) {
        throw new Error(`${status} mapped to ${String(mapped)}, not ${String(expected)}`);
      }
    }
  });

  testFn("a run the webhook already terminalised is a no-op", async () => {
    const { seen, events, fetchImpl } = driver({ run: { id: RUN, state: "completed" } });
    await pollRun({ id: RUN, state: "completed", poll_after: null }, depsFor(fetchImpl));
    if (seen.some((entry) => entry.url.includes("api.heycall-e.com"))) {
      throw new Error("a terminal run must not be re-fetched");
    }
    if (seen.some((entry) => entry.method === "PATCH")) {
      throw new Error("a terminal run must not be written");
    }
    if (events.length !== 0) throw new Error("a terminal run must record nothing");
  });

  testFn("losing the race writes nothing", async () => {
    const { events, fetchImpl } = driver({
      run: { id: RUN, state: "awaiting_result" },
      call: { id: CALL, status: "completed" },
      patchWins: false,
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    if (events.length !== 0) {
      throw new Error("the loser of the race must record no timeline row");
    }
  });

  testFn("a provider id that disagrees with the run is rejected", async () => {
    const { events, fetchImpl } = driver({
      run: { id: RUN, state: "awaiting_result" },
      call: { id: "call_someone_else", status: "completed" },
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    if (events.length !== 1 || events[0].detail.outcome !== "refetch_failed") {
      throw new Error("a mismatched provider id must reschedule, not terminalise");
    }
  });

  testFn("a transport failure reschedules and never throws out of the tick", async () => {
    const { events, fetchImpl } = driver({
      run: { id: RUN, state: "awaiting_result" },
      callThrows: true,
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    if (events.length !== 1 || events[0].kind !== "polled" || events[0].detail.outcome !== "refetch_failed") {
      throw new Error("a transport failure must reschedule with a recorded reason");
    }
  });

  testFn("a run past the give-up window is failed with a reason", async () => {
    const stale = { id: RUN, state: "awaiting_result", dispatched_at: new Date(NOW.getTime() - POLL_GIVE_UP_MS - 1).toISOString() };
    const { seen, events, fetchImpl } = driver({ run: stale });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    const patch = seen.find((entry) => entry.method === "PATCH");
    const body = patch?.body as { state?: string; calle_failure?: { failure_code?: string }; terminal_writer?: string };
    if (body.state !== "failed") throw new Error("a lost call must not poll forever");
    if (body.terminal_writer !== "poll") {
      throw new Error("the give-up write must name the poll as the writer");
    }
    if (body.calle_failure?.failure_code !== "poll_timeout") {
      throw new Error("giving up must name the reason on the run");
    }
    if (!seen.some((entry) => entry.url.includes("api.heycall-e.com"))) {
      throw new Error("a run past its window must still ask CALL-E before giving up");
    }
    if (events[0]?.detail.failure_reason !== "poll_timeout") {
      throw new Error("the timeline must name where it stopped");
    }
  });

  testFn("a run past its window that CALL-E reports completed lands as completed, not unanswered", async () => {
    const stale = { id: RUN, state: "awaiting_result", dispatched_at: new Date(NOW.getTime() - POLL_GIVE_UP_MS - 60_000).toISOString() };
    const { seen, events, fetchImpl } = driver({
      run: stale,
      call: { id: CALL, status: "completed", completion_confidence: { score: 0.9, label: "high" }, failure_code: null },
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    const patches = seen.filter((entry) => entry.method === "PATCH");
    const body = patches[0]?.body as { state?: string; disposition?: string; calle_failure?: unknown };
    if (patches.length !== 1 || body?.state !== "completed") {
      throw new Error(`an overdue call CALL-E reports completed must land as completed, saw ${JSON.stringify(patches.map((p) => p.body))}`);
    }
    if (body.disposition !== undefined || body.calle_failure !== null) {
      throw new Error("a completed call must not carry a give-up disposition or failure");
    }
    if (events.length !== 1 || events[0].detail.state !== "completed" || events[0].detail.outcome !== "terminal") {
      throw new Error(`the timeline must record the authoritative terminal state, saw ${JSON.stringify(events)}`);
    }
  });

  testFn("a run past its window whose re-fetch fails gives up and names the re-fetch error", async () => {
    const stale = { id: RUN, state: "awaiting_result", dispatched_at: new Date(NOW.getTime() - POLL_GIVE_UP_MS - 60_000).toISOString() };
    const { seen, events, fetchImpl } = driver({ run: stale, callStatus: 503 });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    const patches = seen.filter((entry) => entry.method === "PATCH");
    const body = patches[0]?.body as { state?: string; calle_failure?: { failure_code?: string; failure_message?: string } };
    if (patches.length !== 1 || body?.state !== "failed" || body.calle_failure?.failure_code !== "poll_timeout") {
      throw new Error(`an overdue run whose re-fetch fails must give up, saw ${JSON.stringify(patches.map((p) => p.body))}`);
    }
    if (!body.calle_failure?.failure_message?.includes("HTTP 503")) {
      throw new Error("giving up after a failed re-fetch must keep the re-fetch error on the run");
    }
    if (events[0]?.detail.failure_reason !== "poll_timeout" || events[0]?.detail.outcome !== "refetch_failed") {
      throw new Error(`the timeline must say the re-fetch failed at the deadline, saw ${JSON.stringify(events)}`);
    }
  });

  testFn("a run without dispatched_at gives up on its creation time, not its sliding poll_after", async () => {
    const stale = {
      id: RUN,
      state: "awaiting_result",
      dispatched_at: null,
      created_at: new Date(NOW.getTime() - POLL_GIVE_UP_MS - 1).toISOString(),
      // Every reschedule rewrites poll_after to just behind now, so it can never age out.
      poll_after: new Date(NOW.getTime() - POLL_INTERVAL_MS).toISOString(),
    };
    const { seen, events, fetchImpl } = driver({ run: stale });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: stale.poll_after }, depsFor(fetchImpl));
    const read = seen.find((entry) => entry.method === "GET" && entry.url.includes("/rest/v1/call_runs"));
    if (!read || !new URL(read.url).searchParams.get("select")?.split(",").includes("created_at")) {
      throw new Error("the poll read must select created_at to bound the window");
    }
    const patch = seen.find((entry) => entry.method === "PATCH");
    const body = patch?.body as { state?: string; calle_failure?: { failure_code?: string } };
    if (body?.state !== "failed" || body.calle_failure?.failure_code !== "poll_timeout") {
      throw new Error("a run with no dispatched_at must still give up once its window has passed");
    }
    if (!seen.some((entry) => entry.url.includes("api.heycall-e.com"))) {
      throw new Error("a run past its window must still ask CALL-E before giving up");
    }
    if (events[0]?.detail.failure_reason !== "poll_timeout") {
      throw new Error("the timeline must name where it stopped");
    }
  });

  testFn("a run without a provider id is failed rather than polled forever", async () => {
    const { seen, events, fetchImpl } = driver({
      run: { id: RUN, state: "awaiting_result", calle_call_id: null },
    });
    await pollRun({ id: RUN, state: "awaiting_result", poll_after: null }, depsFor(fetchImpl));
    const patch = seen.find((entry) => entry.method === "PATCH");
    if ((patch?.body as { terminal_writer?: string } | null)?.terminal_writer !== "poll") {
      throw new Error("the missing-call-id write must name the poll as the writer");
    }
    if (seen.some((entry) => entry.url.includes("api.heycall-e.com"))) {
      throw new Error("a run without a provider id cannot be polled");
    }
    if (events[0]?.detail.failure_reason !== "run has no CALL-E call id to poll") {
      throw new Error("the absence of a provider id must be visible on the timeline");
    }
  });

  testFn("terminalStateFor maps only provider terminal states", () => {
    if (terminalStateFor("completed") !== "completed") throw new Error("completed must be terminal");
    if (terminalStateFor("failed") !== "failed") throw new Error("failed must be terminal");
    if (terminalStateFor("canceled") !== "canceled") throw new Error("canceled must be terminal");
    if (terminalStateFor("queued") !== null) throw new Error("queued is not terminal");
    if (terminalStateFor("in_progress") !== null) throw new Error("in_progress is not terminal");
  });
}
