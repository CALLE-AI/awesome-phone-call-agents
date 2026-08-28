import { expandHomePath, resolveServerUrl } from "@call-e/core/config";
import {
  AuthRequiredError,
  callMcpTool,
  isUnauthorizedMcpError,
  type McpClientConfig,
} from "@call-e/core/mcp-client";

export { AuthRequiredError, isUnauthorizedMcpError };

/**
 * Reuses the token cache written by `calle auth login` (the `@call-e/cli`
 * package) at `~/.calle-mcp/cli` by default, so this tool doesn't need its
 * own login flow — authenticate once with the CLI and every tool that
 * builds this config picks it up. Override with CALLE_MCP_CACHE_ROOT /
 * CALLE_MCP_SERVER_URL if you're pointing at a different channel or a
 * per-app cache instead.
 */
export function resolveCalleMcpConfig(overrides: Partial<McpClientConfig> = {}): McpClientConfig {
  return {
    cacheRoot: expandHomePath(
      overrides.cacheRoot ?? process.env.CALLE_MCP_CACHE_ROOT ?? "~/.calle-mcp/cli",
    ),
    serverUrl: resolveServerUrl({
      serverUrl: overrides.serverUrl ?? process.env.CALLE_MCP_SERVER_URL,
    }),
    timeoutSeconds: overrides.timeoutSeconds ?? 30,
    ...overrides,
  };
}

export interface PlanCallInput {
  toPhones: string[];
  region: string;
  goal: string;
  language?: string;
  userInput?: string;
}

export interface PlanCallResult {
  plan_id: string;
  ready_to_run: boolean;
  next_step: string;
  clarifying_questions?: string[];
  confirm_summary: string;
  confirm_token?: string | null;
}

export interface RunCallResult {
  run_id: string;
  status: string;
  message?: string | null;
  result?: {
    summary?: string | null;
    outcome?: {
      task_completed: boolean;
      completion_confidence: { score: number; label: string };
      evidence?: string[];
    } | null;
    /** CALL-E's own generic call metadata — never schema-constrained. See extractStructuredResult. */
    extracted?: Record<string, unknown>;
    transcript?: string | null;
    call_id?: string | null;
  };
}

/** Plans a call without dialing. Always safe to call — no side effects. */
export async function planCall(
  config: McpClientConfig,
  input: PlanCallInput,
): Promise<PlanCallResult> {
  return callMcpTool<PlanCallResult>({
    config,
    toolName: "plan_call",
    toolArguments: {
      to_phones: input.toPhones,
      region: input.region,
      language: input.language ?? "English",
      goal: input.goal,
      user_input: input.userInput ?? "Plan the call exactly as specified in the goal.",
    },
  });
}

/**
 * Places the real call. Requires a `confirm_token` from a prior `planCall`
 * that came back `ready_to_run: true` — there is no path to a live call
 * that skips planning and human-visible confirmation.
 */
export async function runCall(
  config: McpClientConfig,
  planId: string,
  confirmToken: string,
): Promise<RunCallResult> {
  return callMcpTool<RunCallResult>({
    config,
    toolName: "run_call",
    toolArguments: { plan_id: planId, confirm_token: confirmToken },
  });
}

export async function getCallRun(config: McpClientConfig, runId: string): Promise<RunCallResult> {
  return callMcpTool<RunCallResult>({
    config,
    toolName: "get_call_run",
    toolArguments: { run_id: runId },
  });
}

const SETTLED_STATUSES = new Set([
  "COMPLETED",
  "NO_ANSWER",
  "NO ANSWER",
  "DECLINED",
  "FAILED",
  "ERROR",
  "CANCELLED",
  "CANCELED",
]);

export interface WaitForCallRunOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** Polls get_call_run until the run reaches a settled status or times out. */
export async function waitForCallRun(
  config: McpClientConfig,
  runId: string,
  options: WaitForCallRunOptions = {},
): Promise<RunCallResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const run = await getCallRun(config, runId);
    if (SETTLED_STATUSES.has(run.status.toUpperCase())) {
      return run;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for call run ${runId} to settle (last status: ${run.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
