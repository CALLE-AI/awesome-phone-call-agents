/**
 * Claims due call runs. PostgreSQL owns the claim so concurrent cron requests
 * cannot send the same run to CALL-E twice.
 *
 * T2.4 wires each claimed run to the guarded CALL-E dispatcher.
 *
 * T2.7a wires each terminal run to the finaliser, which re-fetches the call
 * and turns it into rows. The finaliser bounds its own attempts, and this
 * select skips a run that is waiting for its next one.
 * Pin with: deno test --allow-env --allow-net supabase/functions/tick/index.ts
 */

import { withSupabase } from "npm:@supabase/server@1.6.0";
import {
  type CalleDeps,
  depsFromEnv as calleDepsFromEnv,
  dispatchClaimedRun,
} from "../_shared/calle.ts";
import { finaliseStep } from "../_shared/finalise.ts";
import { pollRun } from "../_shared/poll.ts";

const CLAIM_LIMIT = 20;

export type TickRun = {
  id: string;
  state: string;
  poll_after: string | null;
};

export type ClaimedTickRun = TickRun & {
  user_id: string;
  idempotency_key: string;
  slot_id: string | null;
  /** The claim RPC returns the whole row, so dry mode is decided per run. */
  dry_run: boolean;
};

/** A terminal run carries the two fields the re-fetch needs. */
export type TerminalTickRun = TickRun & {
  user_id: string;
  calle_call_id: string | null;
};

export type TickDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
  dispatchClaimed?: (run: ClaimedTickRun) => Promise<void>;
  /** Resolves false, or throws, when the pass did not land. */
  pollDue: (run: TickRun) => Promise<boolean | void>;
  /**
   * One bounded finalise pass. A throw means the attempt was counted on the
   * run, so the tick does not report it as landed and the next tick waits.
   */
  finalise: (run: TerminalTickRun) => Promise<void>;
  now: () => Date;
};

export type TickResult = {
  /**
   * The dispatch steps that ran to completion. A step counts only when its
   * claim and its dispatch both returned, so a dispatch that threw is never
   * counted. That holds when CALL-E accepted the call and a later write
   * failed, when the recovery failed the run, and when the run completed and
   * only the last timeline write failed. `polled` and `finalised` count the
   * same way, and neither counts a step that threw. A finalise step that ends
   * a stuck run counts, because it finished that run's work.
   */
  claimed: number;
  polled: number;
  finalised: number;
};

export function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

/**
 * One run's poll pass, isolated from the rest. A write that fails leaves the
 * run's `poll_after` untouched, so the next tick retries it. One broken run
 * must never cost every other run in the same tick.
 */
export async function pollStep(
  run: TickRun,
  calleDeps: CalleDeps,
): Promise<boolean> {
  try {
    await pollRun(run, calleDeps);
    return true;
  } catch (error) {
    console.error(
      `poll failed for run ${run.id}`,
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}

/**
 * One run's claim-and-dispatch step, isolated from the rest. The dispatcher
 * records the claim, and it repairs the run when either the claim or the
 * dispatch throws, so a failed dispatch costs that run and never the poll or
 * the finalise stages that follow it.
 */
export async function dispatchStep(
  run: ClaimedTickRun,
  deps: TickDeps,
): Promise<boolean> {
  try {
    await deps.dispatchClaimed!(run);
    return true;
  } catch (error) {
    console.error(
      `dispatch failed for run ${run.id}`,
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}

/**
 * Runs one step per run in isolation and counts only the steps that landed.
 * A step fails when it throws or reports false, and the tick then must not
 * claim it in the response body.
 */
async function countSucceeded<T extends TickRun>(
  runs: T[],
  step: (run: T) => Promise<boolean | void>,
  stage: string,
): Promise<number> {
  const results = await Promise.all(runs.map(async (run) => {
    try {
      return await step(run) !== false;
    } catch (error) {
      console.error(
        `${stage} failed for run ${run.id}`,
        error instanceof Error ? error.message : "unknown error",
      );
      return false;
    }
  }));
  return results.filter(Boolean).length;
}

export function depsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): TickDeps {
  const calleDeps = calleDepsFromEnv(getEnv, fetchImpl);
  return {
    apiUrl: requireNamedEnv("ORMA_API_URL", getEnv),
    serviceRoleKey: requireNamedEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv),
    fetch: fetchImpl,
    dispatchClaimed: async (run) => { await dispatchClaimedRun(run, calleDeps); },
    pollDue: (run) => pollStep(run, calleDeps),
    finalise: async (run) => { await finaliseStep(run, calleDeps); },
    now: () => new Date(),
  };
}

function serviceHeaders(key: string): HeadersInit {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

function restUrl(base: string, path: string, query = ""): string {
  return `${base.replace(/\/+$/, "")}/rest/v1/${path}${
    query ? `?${query}` : ""
  }`;
}

async function readRows<T extends TickRun>(
  deps: TickDeps,
  query: URLSearchParams,
): Promise<T[]> {
  const response = await deps.fetch(
    restUrl(deps.apiUrl, "call_runs", query.toString()),
    {
      headers: serviceHeaders(deps.serviceRoleKey),
    },
  );
  if (!response.ok) throw new Error("call_runs read failed");
  return await response.json() as T[];
}

/** Calls the only SQL boundary allowed to claim runs. Do not replace this with
 * a REST PATCH: PostgREST cannot provide a `FOR UPDATE SKIP LOCKED` claim.
 */
export async function claimDueRuns(deps: TickDeps): Promise<ClaimedTickRun[]> {
  const response = await deps.fetch(
    restUrl(deps.apiUrl, "rpc/claim_due_call_runs"),
    {
      method: "POST",
      headers: serviceHeaders(deps.serviceRoleKey),
      body: JSON.stringify({ p_limit: CLAIM_LIMIT }),
    },
  );
  if (!response.ok) throw new Error("due call_runs claim failed");
  return await response.json() as ClaimedTickRun[];
}

export async function duePolls(deps: TickDeps): Promise<TickRun[]> {
  const query = new URLSearchParams({
    select: "id,state,poll_after",
    state: "in.(dispatched,awaiting_result)",
    poll_after: `lte.${deps.now().toISOString()}`,
    order: "poll_after",
    limit: String(CLAIM_LIMIT),
  });
  return readRows(deps, query);
}

export async function terminalRuns(deps: TickDeps): Promise<TerminalTickRun[]> {
  const now = deps.now().toISOString();
  const query = new URLSearchParams({
    select: "id,state,poll_after,user_id,calle_call_id",
    state: "in.(completed,no_result,failed,canceled)",
    completed_at: "is.null",
    // A run that failed an attempt waits before its next one, so a batch of
    // stuck runs can never hold every slot.
    or: `(finalise_after.is.null,finalise_after.lte.${now})`,
    // A run nobody has tried yet goes first, so a fresh run always finds a slot.
    order: "finalise_after.asc.nullsfirst,scheduled_for.asc",
    limit: String(CLAIM_LIMIT),
  });
  return readRows<TerminalTickRun>(deps, query);
}

export async function tick(deps: TickDeps): Promise<TickResult> {
  const claimed = deps.dispatchClaimed ? await claimDueRuns(deps) : [];
  // Each claimed run dispatches in isolation, like the poll and finalise
  // stages below. One run that cannot dispatch costs its siblings nothing and
  // stays out of the count the response reports.
  const dispatched = deps.dispatchClaimed
    ? await countSucceeded(claimed, (run) => dispatchStep(run, deps), "dispatch")
    : 0;

  const polls = await duePolls(deps);
  const polled = await countSucceeded(polls, deps.pollDue, "poll");

  const terminal = await terminalRuns(deps);
  // Each run finalises in isolation, like pollStep. One run that cannot
  // finalise is counted on the run and skipped until its next attempt, so it
  // costs its siblings nothing and never holds the batch.
  const finalised = await countSucceeded(terminal, deps.finalise, "finalise");

  return { claimed: dispatched, polled, finalised };
}

export function createTickHandler(
  deps: TickDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    try {
      return Response.json(await tick(deps));
    } catch (error) {
      console.error(
        "tick failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return new Response(null, { status: 500 });
    }
  };
}

export function createAuthenticatedTickHandler(
  deps: TickDeps,
): (request: Request) => Promise<Response> {
  // The minute cron shares the Vault-backed scheduler credential from T2.1.
  return withSupabase({ auth: "secret:materialise" }, createTickHandler(deps));
}

if (import.meta.main) Deno.serve(createAuthenticatedTickHandler(depsFromEnv()));

const testFn =
  (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void })
    .test;
if (typeof testFn === "function" && !import.meta.main) {
  const baseDeps = (fetchImpl: typeof fetch): TickDeps => ({
    apiUrl: "https://orma-api.nryn.dev",
    serviceRoleKey: "test-service-key",
    fetch: fetchImpl,
    dispatchClaimed: async () => undefined,
    pollDue: async () => undefined,
    finalise: async () => undefined,
    now: () => new Date("2026-09-12T00:00:00.000Z"),
  });

  /**
   * PostgREST answers a select with the columns it was asked for and no
   * others, and it skips a row whose finalise wait has not passed. A stub that
   * ignores `select` cannot measure the projection, and one that ignores the
   * gate cannot measure the bound.
   */
  const terminalAnswer = (
    url: URL,
    rows: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> => {
    const select = url.searchParams.get("select") ?? "";
    const bound = url.searchParams.get("or")?.match(/finalise_after\.lte\.(.+)\)/)?.[1];
    const before = bound ?? new Date().toISOString();
    return rows
      .filter((row) =>
        typeof row.finalise_after !== "string" || row.finalise_after <= before
      )
      .map((row) => {
        const answer: Record<string, unknown> = {};
        for (const key of select.split(",")) {
          if (key in row) answer[key] = row[key];
        }
        return answer;
      });
  };

  testFn(
    "a tick without dispatch leaves scheduled runs unclaimed",
    async () => {
      const calls: string[] = [];
      const fetchStub: typeof fetch = async (input) => {
        calls.push(new URL(String(input)).pathname);
        return Response.json([]);
      };
      const deps = baseDeps(fetchStub);
      deps.dispatchClaimed = undefined;
      const result = await tick(deps);
      if (result.claimed !== 0) {
        throw new Error("an unavailable dispatcher must prevent claims");
      }
      if (calls.some((path) => path.endsWith("/rpc/claim_due_call_runs"))) {
        throw new Error(
          "an unavailable dispatcher must not call the claim RPC",
        );
      }
    },
  );

  testFn(
    "a tick with nothing due does not call a row mutation endpoint",
    async () => {
      const calls: Array<{ path: string; method: string }> = [];
      const fetchStub: typeof fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        calls.push({ path: url.pathname, method: init.method ?? "GET" });
        return Response.json([]);
      };
      const result = await tick(baseDeps(fetchStub));
      if (
        result.claimed !== 0 || result.polled !== 0 || result.finalised !== 0
      ) throw new Error("expected no work");
      if (
        calls.some((call) =>
          call.path.endsWith("/call_runs") && call.method !== "GET"
        )
      ) {
        throw new Error("an empty tick must not mutate a call run");
      }
    },
  );

  testFn(
    "claiming uses the atomic RPC with the bounded batch size",
    async () => {
      let request: Request | undefined;
      const fetchStub: typeof fetch = async (input, init = {}) => {
        request = new Request(String(input), init);
        return Response.json([]);
      };
      await claimDueRuns(baseDeps(fetchStub));
      if (
        !request || !request.url.endsWith("/rest/v1/rpc/claim_due_call_runs") ||
        request.method !== "POST"
      ) {
        throw new Error("claim must use the SQL RPC");
      }
      if (await request.text() !== '{"p_limit":20}') {
        throw new Error("claim must preserve the batch bound");
      }
    },
  );

  testFn(
    "configured tick claims a due run and reaches CALL-E dispatch",
    async () => {
      const requests: Request[] = [];
      const fetchStub: typeof fetch = async (input, init) => {
        const request = new Request(String(input), init);
        requests.push(request);
        if (request.url.endsWith("/rpc/claim_due_call_runs")) {
          return Response.json([{
            id: "run-1",
            state: "claimed",
            poll_after: null,
            user_id: "user-1",
            idempotency_key: "orma:user-1:2026-09-12:morning:v1",
            slot_id: "slot-1",
            dry_run: false,
          }]);
        }
        if (request.url.includes("/profiles")) {
          return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
        }
        if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
        if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
        if (request.url.includes("assemble_briefing")) {
          return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
        }
        if (request.url.endsWith("/v1/calls")) {
          return Response.json({ id: "call-1", status: "queued", completion_confidence: null });
        }
        if (request.url.includes("ingest_call_result")) {
          return Response.json({ already_ingested: false, disposition: "answered_extracted", counts: { items: 1, mentions: 1, retirements: 0, commitments: 0 }, slot_change_requested: null });
        }
        return Response.json([]);
      };
      const env: Record<string, string> = {
        ORMA_API_URL: "https://orma-api.nryn.dev",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        CALLE_API_BASE: "https://api.heycall-e.com",
        CALLE_API_KEY: "calle-key",
        ORMA_WEBHOOK_SECRET: "webhook-secret",
        ORMA_DRY_RUN: "false",
        TELEGRAM_BOT_TOKEN: "fixture-bot-token",
      };
      const result = await tick(depsFromEnv((key) => env[key], fetchStub));
      if (result.claimed !== 1) throw new Error("configured tick did not claim the due run");
      if (!requests.some((request) => request.url.endsWith("/v1/calls"))) {
        throw new Error("configured tick did not dispatch the claimed run to CALL-E");
      }
    },
  );

  testFn(
    "a tick with no dry-run setting never reaches CALL-E",
    async () => {
      const requests: Request[] = [];
      const fetchStub: typeof fetch = async (input, init) => {
        const request = new Request(String(input), init);
        requests.push(request);
        if (request.url.endsWith("/rpc/claim_due_call_runs")) {
          return Response.json([{
            id: "run-1",
            state: "claimed",
            poll_after: null,
            user_id: "user-1",
            idempotency_key: "orma:user-1:2026-09-12:morning:v1",
            slot_id: "slot-1",
            dry_run: false,
          }]);
        }
        if (request.url.includes("/profiles")) {
          return Response.json([{ id: "user-1", phone_e164: "+919999999999", phone_confirmed_at: "2026-09-01T00:00:00Z" }]);
        }
        if (request.url.includes("/consents")) return Response.json([{ id: "consent-1" }]);
        if (request.url.includes("/slots")) return Response.json([{ local_time: "08:00" }]);
        if (request.url.includes("assemble_briefing")) {
          return Response.json({ user_name: "Narayan", open_count: 0, lead_line: "Nothing urgent today.", open_items: "Nothing open.", last_call_summary: "", slot_local_time: "08:00" });
        }
        if (request.url.includes("ingest_call_result")) {
          return Response.json({ already_ingested: false, disposition: "answered_extracted", counts: { items: 1, mentions: 1, retirements: 0, commitments: 0 }, slot_change_requested: null });
        }
        if (request.url.endsWith("/v1/calls")) {
          return Response.json({ id: "call-1", status: "queued", completion_confidence: null });
        }
        return Response.json([]);
      };
      const env: Record<string, string> = {
        ORMA_API_URL: "https://orma-api.nryn.dev",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        CALLE_API_BASE: "https://api.heycall-e.com",
        CALLE_API_KEY: "calle-key",
        ORMA_WEBHOOK_SECRET: "webhook-secret",
        TELEGRAM_BOT_TOKEN: "fixture-bot-token",
      };
      await tick(depsFromEnv((key) => env[key], fetchStub));
      if (requests.some((request) => request.url.endsWith("/v1/calls"))) {
        throw new Error("an unset dry-run setting placed a real call");
      }
      if (!requests.some((request) => request.url.includes("ingest_call_result"))) {
        throw new Error("a dry run reached no result ingestion");
      }
      const dispatched = await Promise.all(
        requests.filter((request) => request.url.includes("call_events") && request.method === "POST")
          .map(async (request) => await request.json()),
      );
      if (!dispatched.some((event) => event.kind === "dispatched" && event.detail.outbound_request_made === false)) {
        throw new Error("the dry run did not record that it stayed inside the process");
      }
    },
  );

  testFn(
    "a run that cannot finalise costs neither the tick nor its siblings",
    async () => {
      const fetchStub: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("completed_at") === "is.null") {
          return Response.json([
            { id: "run-broken", state: "completed", poll_after: null },
            { id: "run-healthy", state: "failed", poll_after: null },
          ]);
        }
        return Response.json([]);
      };
      const finalised: string[] = [];
      const deps: TickDeps = {
        ...baseDeps(fetchStub),
        dispatchClaimed: undefined,
        finalise: async (run) => {
          if (run.id === "run-broken") throw new Error("finalisation implementation is unavailable");
          finalised.push(run.id);
        },
      };
      const response = await createTickHandler(deps)(
        new Request("https://orma-api.nryn.dev/functions/v1/tick", { method: "POST" }),
      );
      if (response.status !== 200) {
        throw new Error(`a finalise failure must not turn the tick red, saw ${response.status}`);
      }
      if (finalised.length !== 1 || finalised[0] !== "run-healthy") {
        throw new Error(`the sibling run must still finalise, saw ${JSON.stringify(finalised)}`);
      }
    },
  );

  testFn(
    "a failed re-fetch leaves its run queued while its siblings finalise",
    async () => {
      const requests: Request[] = [];
      const callTask = (callId: string) => ({
        id: callId,
        status: "completed",
        completed_at: "2026-09-12T00:00:05.000Z",
        failure_code: null,
        failure_message: null,
        structured_result: {
          captured_items: [
            { text: "Renew the passport", evidence_offset_seconds: 12 },
          ],
          retired_items: [],
        },
        recipients: [{
          attempts: [{
            transcript_turns: [
              { offset_seconds: 12, speaker: "callee", text: "Renew the passport" },
            ],
          }],
        }],
      });
      const fetchStub: typeof fetch = async (input, init) => {
        const request = new Request(String(input), init);
        requests.push(request);
        const url = new URL(request.url);
        if (url.host === "api.heycall-e.com") {
          return url.pathname.endsWith("/v1/calls/call-stuck")
            ? new Response(null, { status: 503 })
            : Response.json(callTask("call-healthy"));
        }
        if (url.pathname.endsWith("/rpc/claim_due_call_runs")) return Response.json([]);
        if (url.searchParams.get("completed_at") === "is.null") {
          return Response.json(terminalAnswer(url, [
            { id: "run-stuck", state: "failed", poll_after: null, user_id: "user-1", calle_call_id: "call-stuck", finalise_after: null },
            { id: "run-healthy", state: "failed", poll_after: null, user_id: "user-1", calle_call_id: "call-healthy", finalise_after: null },
          ]));
        }
        if (url.searchParams.get("state") === "in.(dispatched,awaiting_result)") {
          return Response.json([]);
        }
        if (url.pathname.endsWith("/rpc/record_finalise_failure")) {
          return Response.json({ attempts: 1, finalised: false });
        }
        if (url.pathname.endsWith("/rpc/ingest_call_result")) {
          return Response.json({
            already_ingested: false,
            disposition: "answered_extracted",
            counts: { items: 1, mentions: 1, retirements: 0, commitments: 0 },
            slot_change_requested: null,
          });
        }
        if (url.pathname.endsWith("/call_events")) {
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/rest/v1/profiles")) {
          return Response.json([{
            id: "user-1",
            telegram_chat_id: 424242,
            telegram_receipts: true,
          }]);
        }
        if (url.pathname.endsWith("/rest/v1/deliveries") && request.method === "POST") {
          return Response.json([{
            id: "delivery-1",
            user_id: "user-1",
            channel: "telegram",
            kind: "post_call",
            call_run_id: "run-healthy",
            payload: {},
            sent_at: null,
            error: null,
          }]);
        }
        if (url.pathname.endsWith("/rest/v1/deliveries") && request.method === "PATCH") {
          return new Response(null, { status: 200 });
        }
        if (url.host === "api.telegram.org") {
          return Response.json({ ok: true });
        }
        throw new Error(`unexpected request ${request.method} ${request.url}`);
      };
      const env: Record<string, string> = {
        ORMA_API_URL: "https://orma-api.nryn.dev",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        CALLE_API_BASE: "https://api.heycall-e.com",
        CALLE_API_KEY: "calle-key",
        ORMA_WEBHOOK_SECRET: "webhook-secret",
        TELEGRAM_BOT_TOKEN: "fixture-bot-token",
      };
      const body = await tick(depsFromEnv((key) => env[key], fetchStub));

      if (body.finalised !== 1) {
        throw new Error(`only the reachable run may finalise, saw ${JSON.stringify(body)}`);
      }
      const ingest = requests.filter((request) =>
        request.url.endsWith("/rpc/ingest_call_result")
      );
      if (ingest.length !== 1) {
        throw new Error(`a failed re-fetch must not reach ingestion, saw ${ingest.length}`);
      }
      const ingestBody = await ingest[0].json() as {
        p_call_run_id?: string;
        p_user_id?: string;
      };
      if (ingestBody.p_call_run_id !== "run-healthy" || ingestBody.p_user_id !== "user-1") {
        throw new Error(`the reachable sibling must finalise with its own identity, saw ${JSON.stringify(ingestBody)}`);
      }
      const attempt = requests.find((request) =>
        request.url.endsWith("/rpc/record_finalise_failure")
      );
      if (!attempt || attempt.method !== "POST") {
        throw new Error("the failed attempt must be counted on the stuck run");
      }
      const attemptBody = await attempt.json() as {
        p_call_run_id?: string;
        p_wait_seconds?: number;
      };
      if (attemptBody.p_call_run_id !== "run-stuck" || !(attemptBody.p_wait_seconds! > 0)) {
        throw new Error(`the attempt must name the stuck run and its wait, saw ${JSON.stringify(attemptBody)}`);
      }
      const events = requests.filter((request) => request.url.endsWith("/call_events"));
      if (events.length !== 1) {
        throw new Error(`the stuck run must record nothing, saw ${events.length} row(s)`);
      }
      const row = await events[0].json() as {
        call_run_id?: string;
        kind?: string;
        detail?: { state?: string };
      };
      if (
        row.call_run_id !== "run-healthy" || row.kind !== "finalised" ||
        row.detail?.state !== "completed"
      ) {
        throw new Error(`the timeline row is wrong: ${JSON.stringify(row)}`);
      }
      // Ingestion owns `completed_at`, and it never ran for the stuck run. The
      // attempt count is recorded through its own SQL boundary, so every plain
      // `call_runs` write stays inside ingestion and the next tick still
      // selects the run.
      const writes = requests.filter((request) =>
        request.method === "PATCH" && request.url.includes("/call_runs")
      );
      if (writes.length !== 0) {
        throw new Error("the finaliser must leave every run write to ingestion");
      }
      const sends = requests.filter((request) =>
        request.url.includes("api.telegram.org")
      );
      if (sends.length !== 1) {
        throw new Error(
          `the finalised sibling must send one receipt, saw ${sends.length}`,
        );
      }
      const post = requests.find((request) =>
        request.method === "POST" && request.url.endsWith("/rest/v1/deliveries")
      );
      const postBody = await post!.json() as {
        kind: string;
        call_run_id: string;
      };
      if (
        postBody.kind !== "post_call" ||
        postBody.call_run_id !== "run-healthy"
      ) {
        throw new Error(
          `the receipt row lost its kind or run: ${JSON.stringify(postBody)}`,
        );
      }
    },
  );

  testFn(
    "the terminal select asks for the attempt bound and the queue order",
    async () => {
      let url: URL | undefined;
      const deps: TickDeps = {
        ...baseDeps(async (input) => {
          url = new URL(String(input));
          return Response.json([]);
        }),
        dispatchClaimed: undefined,
      };
      await terminalRuns(deps);
      if (!url) throw new Error("the terminal select made no request");
      const params = url.searchParams;
      if (params.get("select") !== "id,state,poll_after,user_id,calle_call_id") {
        throw new Error(`the terminal select must carry the re-fetch fields: ${params.get("select")}`);
      }
      if (params.get("completed_at") !== "is.null") {
        throw new Error(`only an unfinished run is queued: ${params.get("completed_at")}`);
      }
      const or = params.get("or") ?? "";
      if (
        !or.includes("finalise_after.is.null") ||
        !or.includes(`finalise_after.lte.${deps.now().toISOString()}`)
      ) {
        throw new Error(`the terminal select must skip a run that is waiting: ${or}`);
      }
      if (params.get("order") !== "finalise_after.asc.nullsfirst,scheduled_for.asc") {
        throw new Error(`an untried run must be selected first: ${params.get("order")}`);
      }
      if (params.get("limit") !== "20") {
        throw new Error(`the batch bound was lost: ${params.get("limit")}`);
      }
    },
  );

  testFn(
    "a run that cannot dispatch costs neither the tick nor its siblings",
    async () => {
      const fetchStub: typeof fetch = async (input, init) => {
        const url = new URL(new Request(String(input), init).url);
        if (url.pathname.endsWith("/rpc/claim_due_call_runs")) {
          return Response.json([
            { id: "run-broken", state: "claimed", poll_after: null, user_id: "user-1", idempotency_key: "k1", slot_id: "slot-1", dry_run: false },
            { id: "run-healthy", state: "claimed", poll_after: null, user_id: "user-1", idempotency_key: "k2", slot_id: "slot-1", dry_run: false },
          ]);
        }
        if (url.searchParams.get("state") === "in.(dispatched,awaiting_result)") {
          return Response.json([{ id: "run-pending", state: "awaiting_result", poll_after: null }]);
        }
        if (url.searchParams.get("completed_at") === "is.null") {
          return Response.json([{ id: "run-terminal", state: "completed", poll_after: null }]);
        }
        return Response.json([]);
      };
      const dispatched: string[] = [];
      const polled: string[] = [];
      const finalised: string[] = [];
      const deps: TickDeps = {
        ...baseDeps(fetchStub),
        dispatchClaimed: async (run) => {
          if (run.id === "run-broken") throw new Error("call_runs dispatch update failed");
          dispatched.push(run.id);
        },
        pollDue: async (run) => { polled.push(run.id); },
        finalise: async (run) => { finalised.push(run.id); },
      };
      const response = await createTickHandler(deps)(
        new Request("https://orma-api.nryn.dev/functions/v1/tick", { method: "POST" }),
      );
      const body = await response.json() as TickResult;
      if (response.status !== 200) {
        throw new Error(`a failed dispatch must not turn the tick red, saw ${response.status}`);
      }
      if (dispatched.join(",") !== "run-healthy") {
        throw new Error(`a failed dispatch cost its sibling, saw ${JSON.stringify(dispatched)}`);
      }
      if (body.claimed !== 1 || body.polled !== 1 || body.finalised !== 1) {
        throw new Error(`the tick must report the stages that landed, saw ${JSON.stringify(body)}`);
      }
      if (polled.join(",") !== "run-pending" || finalised.join(",") !== "run-terminal") {
        throw new Error(`a failed dispatch skipped a later stage, saw ${JSON.stringify({ polled, finalised })}`);
      }
    },
  );

  testFn("dispatchStep reports a swallowed dispatch failure as false", async () => {
    const landed = await dispatchStep(
      { id: "run-1", state: "claimed", poll_after: null, user_id: "user-1", idempotency_key: "k1", slot_id: "slot-1", dry_run: false },
      {
        ...baseDeps(async () => Response.json([])),
        dispatchClaimed: async () => { throw new Error("call_runs dispatch update failed"); },
      },
    );
    if (landed !== false) throw new Error(`a dispatch that throws must report false, saw ${landed}`);
  });

  testFn(
    "the tick reports only the polls and finalisations that landed",
    async () => {
      const fetchStub: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("completed_at") === "is.null") {
          return Response.json([
            { id: "run-broken", state: "completed", poll_after: null },
            { id: "run-healthy", state: "failed", poll_after: null },
          ]);
        }
        if (url.searchParams.get("state") === "in.(dispatched,awaiting_result)") {
          return Response.json([
            { id: "poll-swallowed", state: "awaiting_result", poll_after: null },
            { id: "poll-thrown", state: "awaiting_result", poll_after: null },
            { id: "poll-ok", state: "awaiting_result", poll_after: null },
          ]);
        }
        return Response.json([]);
      };
      const deps: TickDeps = {
        ...baseDeps(fetchStub),
        dispatchClaimed: undefined,
        pollDue: async (run) => {
          if (run.id === "poll-swallowed") return false;
          if (run.id === "poll-thrown") throw new Error("poll write failed");
          return true;
        },
        finalise: async (run) => {
          if (run.id === "run-broken") throw new Error("finalisation implementation is unavailable");
        },
      };
      const response = await createTickHandler(deps)(
        new Request("https://orma-api.nryn.dev/functions/v1/tick", { method: "POST" }),
      );
      const body = await response.json() as TickResult;
      if (response.status !== 200 || body.polled !== 1 || body.finalised !== 1) {
        throw new Error(`the tick must count landed steps only, saw ${response.status} ${JSON.stringify(body)}`);
      }
    },
  );

  testFn("pollStep reports a swallowed poll failure as false", async () => {
    const calleDeps = {
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "service-key",
      calleApiBase: "https://api.heycall-e.com",
      calleApiKey: "calle-key",
      webhookUrl: "https://orma-api.nryn.dev/functions/v1/calle-webhook/secret",
      fetch: (async () => new Response(null, { status: 500 })) as typeof fetch,
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    } as CalleDeps;
    const landed = await pollStep({ id: "run-1", state: "awaiting_result", poll_after: null }, calleDeps);
    if (landed !== false) throw new Error(`a poll whose run read fails must report false, saw ${landed}`);
  });

  testFn("only the named scheduler secret API key reaches tick", async () => {
    const oldUrl = Deno.env.get("SUPABASE_URL");
    const oldKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
    const oldPublishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    Deno.env.set("SUPABASE_URL", "https://orma-api.nryn.dev");
    Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ materialise: "fixture-materialise-key" }));
    Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "fixture-publishable-key" }));
    let reads = 0;
    const handler = createAuthenticatedTickHandler({
      ...baseDeps(async () => {
        reads += 1;
        return Response.json([]);
      }),
      dispatchClaimed: undefined,
    });
    try {
      const rejected = await handler(new Request("https://orma-api.nryn.dev/functions/v1/tick", { method: "POST" }));
      if (rejected.status !== 401 || reads !== 0) throw new Error("missing secret must not reach tick");
      const accepted = await handler(new Request("https://orma-api.nryn.dev/functions/v1/tick", {
        method: "POST", headers: { apikey: "fixture-materialise-key" },
      }));
      if (accepted.status !== 200 || Number(reads) !== 2) {
        throw new Error("named scheduler secret must authenticate tick");
      }
    } finally {
      if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", oldUrl);
      if (oldKeys === undefined) Deno.env.delete("SUPABASE_SECRET_KEYS"); else Deno.env.set("SUPABASE_SECRET_KEYS", oldKeys);
      if (oldPublishableKeys === undefined) Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS");
      else Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", oldPublishableKeys);
    }
  });
}
