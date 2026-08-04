// Server-side integration layer for CALL-E.
//
// Credentials live only here, supplied through Cloudflare Pages environment
// variables. They must never reach browser code, and neither must the
// confirm_token: it authorizes one real phone call, so it is created, spent,
// and discarded inside a single request.
//
// CALL-E is MCP. plan_call issues a plan_id and a confirm_token, run_call
// requires both, and get_call_run polls the result. The operator's explicit
// authorization happens in the browser before this endpoint is reached; the
// server then performs plan, confirm, and run as one atomic step.
//
// See docs/agent-gallery/calle-api-observations.md.

import { CalleError, createCalleClient, isTerminalStatus } from "../../src/calle";
import type { CalleActivity, CalleRun } from "../../src/calle";
import { validateRequest } from "../../src/workflows/appointment-recovery/validate";
import { buildCallGoal } from "../../src/workflows/appointment-recovery/workflow";
import type { RecoveryRequest } from "../../src/workflows/appointment-recovery/types";

type Env = {
  CALLE_ACCESS_TOKEN?: string;
  CALLE_SERVER_URL?: string;
};

type Context = {
  request: Request;
  env: Env;
  params: { path?: string[] };
};

const REQUEST_LIMIT = 64 * 1024;

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

/**
 * Duplicate guard for retries and double-clicks within one isolate.
 *
 * plan_call and run_call happen in the same request, so a repeated submission
 * would mint a fresh confirm_token and dial again; the token being single-use
 * does not help here. A new isolate starts with an empty map, so this covers the
 * realistic double-click and not a determined retry across cold starts. Durable
 * storage is the only complete answer and is out of scope for one call.
 */
const startedCalls = new Map<string, string>();

function clientFor(env: Env) {
  if (!env.CALLE_ACCESS_TOKEN || !env.CALLE_SERVER_URL) return null;
  return createCalleClient({
    accessToken: env.CALLE_ACCESS_TOKEN,
    serverUrl: env.CALLE_SERVER_URL,
  });
}

function calleFailure(error: unknown): Response {
  if (error instanceof CalleError) {
    const status = error.code === "auth" ? 502 : error.code === "timeout" ? 504 : 502;
    return json({ error: error.code, message: error.message }, status);
  }
  return json({ error: "unexpected", message: "The call could not be started." }, 500);
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, params } = context;
  const path = params.path ?? [];

  if (request.method === "POST" && path.length === 1 && path[0] === "calls") {
    return createCall(context);
  }
  if (request.method === "GET" && path.length === 2 && path[0] === "calls") {
    return getCallStatus(context, path[1]);
  }
  return json({ error: "not_found" }, 404);
}

async function createCall(context: Context): Promise<Response> {
  const body = await context.request.text();
  if (body.length > REQUEST_LIMIT) return json({ error: "request_too_large" }, 413);

  let payload: RecoveryRequest;
  try {
    payload = JSON.parse(body) as RecoveryRequest;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!payload?.request_key || typeof payload.request_key !== "string") {
    return json({ error: "missing_request_key" }, 400);
  }

  const existing = startedCalls.get(payload.request_key);
  if (existing) return json({ call_id: existing, deduplicated: true });

  // The browser already validated, but a server must never trust that.
  const errors = validateRequest(payload);
  if (errors.length > 0) return json({ error: "invalid_request", details: errors }, 400);

  const client = clientFor(context.env);
  if (!client) {
    return json(
      { error: "not_configured", message: "This deployment has no CALL-E credentials, so it cannot place calls." },
      503,
    );
  }

  try {
    const plan = await client.planCall({
      to_phones: [payload.customer.phone_e164],
      goal: buildCallGoal(payload),
      language: "English",
      region: payload.business.timezone.split("/")[0] === "Asia" ? "SG" : undefined,
    });

    if (!plan.ready_to_run || !plan.confirm_token) {
      return json(
        { error: "plan_incomplete", message: "CALL-E needs more detail before this call can run." },
        409,
      );
    }

    const run = await client.runCall({ plan_id: plan.plan_id, confirm_token: plan.confirm_token });
    startedCalls.set(payload.request_key, run.run_id);
    return json({ call_id: run.run_id, status: run.status });
  } catch (error) {
    return calleFailure(error);
  }
}

async function getCallStatus(context: Context, runId: string): Promise<Response> {
  const client = clientFor(context.env);
  if (!client) return json({ error: "not_configured" }, 503);

  let run: CalleRun;
  try {
    run = await client.getCallRun({ run_id: runId });
  } catch (error) {
    return calleFailure(error);
  }

  const activity = (run.activity ?? []).map((entry: CalleActivity) => ({
    ts: entry.ts,
    level: entry.level,
    message: entry.message,
  }));

  if (!isTerminalStatus(run.status)) {
    return json({ status: run.status, activity });
  }

  // The raw CALL-E result is returned rather than a classified one. Reading what
  // a call agreed to needs the offered windows, which live with the request in
  // the browser; classifying here without them would downgrade every successful
  // reschedule to `uncertain`.
  return json({ status: run.status, activity, calle_result: run.result ?? null });
}
