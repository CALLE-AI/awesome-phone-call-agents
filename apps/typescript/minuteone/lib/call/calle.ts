import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallConnectionStatus, CallProvider, CallResult, JsonSchema, PlaceCallInput } from "./provider";
import { extractStructuredAnswers } from "./extract";
import { extractStructuredAnswersHeuristically } from "./extract-heuristic";

/**
 * CALL-E has no REST/SDK surface for this — `calle mcp config` shows it's an OAuth-protected
 * MCP server. `calle auth login` caches a long-lived bearer access token (~1000-day TTL) at
 * ~/.calle-mcp/cli/<hash>/token.json; its `token.access_token` value is what CALLE_API_KEY holds.
 */
const MCP_SERVER_URL = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";

/**
 * Hard ceiling so one stuck call can't block the poller from processing the rest of its batch.
 * Real-call verification (2026-09-12) showed a completed qualification call alone took 140s;
 * with CALL-E's pre-dial "PREPARING" phase on top, a 3-minute ceiling clipped a call that
 * finished successfully seconds later, mis-logging it as a timeout/no_answer.
 */
const MAX_POLL_MS = 6 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_POLL_INTERVAL_MS = 5000;

/** Statuses documented by CALL-E as terminal; anything else keeps polling. */
const TERMINAL_STATUSES = new Set(["COMPLETED", "NO ANSWER", "DECLINED", "FAILED"]);

/** next_step.action values that mean "nothing more we can do without a human" — treat as terminal. */
const BLOCKED_ACTIONS = new Set([
  "ask_user_for_missing_info",
  "ask_user_for_retry_confirmation",
  "plan_call_same_plan_id",
  "report_blocked",
]);

interface PlanCallOutput {
  plan_id: string;
  ready_to_run: boolean;
  next_step: string;
  clarifying_questions?: string[];
  confirm_token: string | null;
  confirm_summary: string;
}

interface RunOutcome {
  task_completed: boolean;
  completion_confidence?: { score: number; label: string };
  evidence?: string[];
}

interface RunResultPayload {
  summary?: string | null;
  post_summary?: string | null;
  outcome?: RunOutcome | null;
  extracted?: Record<string, unknown>;
  transcript?: string | null;
  call_id?: string | null;
  call_ids?: string[];
}

interface NextStep {
  action: string;
  instruction: string;
  poll_after_seconds?: number | null;
}

interface CallRunOutput {
  run_id: string;
  status: string;
  message?: string | null;
  result?: RunResultPayload;
  activity?: { ts: string }[];
  next_cursor?: string | null;
  next_step?: NextStep | null;
}

/**
 * Real CALL-E provider: an MCP client wrapping plan_call -> run_call -> poll(get_call_run).
 * There's no `resultSchema` parameter on plan_call/run_call themselves — the expected field keys
 * are spelled out in the goal text by task-builder.ts, but the real API has no way to honor that:
 * `extracted` comes back as fixed platform bookkeeping, never the requested fields (confirmed via
 * a real call on 2026-09-12 — see resolveStructuredResult below). So `resultSchema` is instead
 * used here, post-call, to drive a second LLM extraction pass over the call's summary/transcript.
 */
export class CalleCallProvider implements CallProvider {
  private client: Promise<Client> | null = null;

  async placeCall(input: PlaceCallInput): Promise<CallResult> {
    const client = await this.getClient();

    const plan = await callTool<PlanCallOutput>(client, "plan_call", {
      to_phones: [input.phone],
      goal: input.task,
    });

    if (!plan.ready_to_run || !plan.confirm_token) {
      return {
        connectionStatus: "failed",
        structuredResult: null,
        evidence:
          plan.clarifying_questions && plan.clarifying_questions.length > 0
            ? plan.clarifying_questions
            : [plan.next_step],
        callId: plan.plan_id,
        durationS: 0,
      };
    }

    const run = await callTool<CallRunOutput>(client, "run_call", {
      plan_id: plan.plan_id,
      confirm_token: plan.confirm_token,
    });

    return this.pollUntilDone(client, run.run_id, input.resultSchema);
  }

  private async pollUntilDone(
    client: Client,
    runId: string,
    resultSchema: JsonSchema,
  ): Promise<CallResult> {
    const deadline = Date.now() + MAX_POLL_MS;
    let cursor: string | undefined;
    let latest: CallRunOutput | null = null;

    while (Date.now() < deadline) {
      const run = await callTool<CallRunOutput>(client, "get_call_run", {
        run_id: runId,
        ...(cursor ? { cursor } : {}),
      });
      latest = run;
      cursor = run.next_cursor ?? cursor;

      if (isTerminal(run)) return mapRunToCallResult(run, resultSchema);

      const waitMs = run.next_step?.poll_after_seconds
        ? run.next_step.poll_after_seconds * 1000
        : DEFAULT_POLL_INTERVAL_MS;
      await sleep(Math.min(waitMs, MAX_POLL_INTERVAL_MS));
    }

    return {
      connectionStatus: "failed",
      structuredResult: null,
      evidence: [
        `Timed out after ${MAX_POLL_MS / 1000}s waiting for CALL-E run ${runId} to finish` +
          (latest ? ` (last status: ${latest.status}).` : "."),
      ],
      callId: runId,
      durationS: 0,
    };
  }

  private async getClient(): Promise<Client> {
    if (!this.client) this.client = this.connect();
    return this.client;
  }

  private async connect(): Promise<Client> {
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "CALLE_API_KEY is not set — required to place real CALL-E calls. See .env.example.",
      );
    }

    const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    });
    const client = new Client({ name: "minuteone", version: "0.1.0" });
    await client.connect(transport);
    return client;
  }
}

function isTerminal(run: CallRunOutput): boolean {
  if (run.next_step) {
    if (run.next_step.action === "report_result") return true;
    if (BLOCKED_ACTIONS.has(run.next_step.action)) return true;
    return false;
  }
  return TERMINAL_STATUSES.has(run.status);
}

async function mapRunToCallResult(run: CallRunOutput, resultSchema: JsonSchema): Promise<CallResult> {
  if (run.next_step && BLOCKED_ACTIONS.has(run.next_step.action)) {
    return {
      connectionStatus: "failed",
      structuredResult: null,
      evidence: [run.next_step.instruction],
      callId: run.result?.call_id ?? run.run_id,
      durationS: durationFromActivity(run.activity),
    };
  }

  const connectionStatus = mapStatus(run.status);
  const evidence =
    run.result?.outcome?.evidence && run.result.outcome.evidence.length > 0
      ? run.result.outcome.evidence
      : [run.result?.summary ?? run.message ?? `CALL-E run ended with status ${run.status}.`];

  return {
    connectionStatus,
    structuredResult:
      connectionStatus === "completed" ? await resolveStructuredResult(run, resultSchema) : null,
    evidence,
    callId: run.result?.call_id ?? run.run_id,
    durationS: durationFromActivity(run.activity),
    transcriptRef: run.result?.transcript ?? undefined,
  };
}

/**
 * CALL-E's real `extracted` is fixed platform bookkeeping (goal echo, region, call timing) —
 * it never contains the business-specific fields task-builder.ts asks for, because the real API
 * has no structured-output parameter. The actual answers only ever show up as prose in
 * `summary`/`transcript`, so a completed call needs those turned back into the flat shape
 * scoreAnswers()/mapResult() expect. Three-tier fallback, most to least accurate: an LLM pass
 * (only attempted if ANTHROPIC_API_KEY is set — real money, real credits, not required to run
 * this app), then a free local keyword/regex parser (extract-heuristic.ts — no external calls,
 * more fragile on messy real speech), then CALL-E's raw (unhelpful but never absent) `extracted`
 * so a successfully-completed call is never lost to an extraction-layer error.
 */
async function resolveStructuredResult(
  run: CallRunOutput,
  resultSchema: JsonSchema,
): Promise<Record<string, unknown>> {
  const callText = {
    summary: run.result?.summary ?? run.result?.post_summary ?? run.message ?? "",
    transcript: run.result?.transcript ?? null,
  };

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await extractStructuredAnswers(resultSchema, callText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`LLM extraction failed for run ${run.run_id}, falling back to heuristic: ${message}`);
    }
  }

  try {
    return extractStructuredAnswersHeuristically(resultSchema, callText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Heuristic extraction failed for run ${run.run_id}: ${message}`);
    return run.result?.extracted ?? {};
  }
}

function mapStatus(status: string): CallConnectionStatus {
  switch (status) {
    case "COMPLETED":
      return "completed";
    case "NO ANSWER":
      return "no_answer";
    case "DECLINED":
      return "declined";
    case "FAILED":
      return "failed";
    default:
      return "failed";
  }
}

function durationFromActivity(activity?: { ts: string }[]): number {
  if (!activity || activity.length < 2) return 0;
  const first = Date.parse(activity[0].ts);
  const last = Date.parse(activity[activity.length - 1].ts);
  if (Number.isNaN(first) || Number.isNaN(last) || last <= first) return 0;
  return Math.round((last - first) / 1000);
}

async function callTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });

  if (result.isError) {
    const text = extractText(result.content);
    throw new Error(`CALL-E tool "${name}" failed: ${text ?? "unknown error"}`);
  }

  if (result.structuredContent) return result.structuredContent as T;

  const text = extractText(result.content);
  if (text) return JSON.parse(text) as T;

  throw new Error(`CALL-E tool "${name}" returned no structured content or text.`);
}

function extractText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const block = content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text",
  );
  return block?.text ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
