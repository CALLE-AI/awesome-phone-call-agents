/**
 * A minimal CALL-E MCP client.
 *
 * No workflow domain concepts belong in this file. It knows how to speak MCP to
 * CALL-E and nothing about what any particular call is for, so a second
 * workflow can reuse it unchanged.
 *
 * The access token is held only in this module's closure. It is never logged,
 * never returned, and never included in a thrown error, because errors from
 * here are surfaced to callers that may render them.
 */

export const MCP_PROTOCOL_VERSION = "2025-11-25";

export interface CalleActivity {
  run_id: string;
  ts: string;
  level: "info" | "warning" | "error";
  kind: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface CalleRunOutcome {
  task_completed?: boolean;
  completion_confidence?: { score: number; label: string };
  evidence?: string[];
}

export interface CalleRunResult {
  summary?: string | null;
  post_summary?: string | null;
  outcome?: CalleRunOutcome | null;
  extracted?: Record<string, unknown> | null;
  transcript?: string | null;
  call_id?: string | null;
}

export interface CalleRun {
  run_id: string;
  status: string;
  message?: string | null;
  result?: CalleRunResult | null;
  activity?: CalleActivity[] | null;
}

export interface CallePlan {
  plan_id: string;
  ready_to_run: boolean;
  confirm_summary?: string;
  /** Single-use token that `runCall` requires. Never send this to a browser. */
  confirm_token?: string | null;
  clarifying_questions?: unknown;
}

export interface PlanCallInput {
  to_phones: string[];
  goal: string;
  language?: string;
  region?: string;
}

export interface CalleClientOptions {
  serverUrl: string;
  accessToken: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** Errors safe to surface: they never carry credentials. */
export class CalleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CalleError";
  }
}

interface JsonRpcResponse {
  id?: string | number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/**
 * CALL-E answers either as JSON or as an SSE stream depending on the request,
 * so both shapes are accepted and the first JSON-RPC payload carrying a result
 * or error is used.
 */
export function parseMcpBody(text: string, contentType: string): JsonRpcResponse {
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as JsonRpcResponse;
        if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
      } catch {
        continue;
      }
    }
    throw new CalleError("CALL-E returned no usable event data.", "bad_response");
  }
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    throw new CalleError("CALL-E returned a malformed response.", "bad_response");
  }
}

export interface CalleClient {
  planCall(input: PlanCallInput): Promise<CallePlan>;
  runCall(input: { plan_id: string; confirm_token: string }): Promise<CalleRun>;
  getCallRun(input: { run_id: string }): Promise<CalleRun>;
}

export function createCalleClient(options: CalleClientOptions): CalleClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 45_000;
  let sessionId: string | null = null;
  let initializing: Promise<void> | null = null;

  async function post(payload: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(options.serverUrl, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          authorization: `Bearer ${options.accessToken}`,
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === "AbortError";
      throw new CalleError(
        aborted ? "CALL-E did not respond in time." : "Could not reach CALL-E.",
        aborted ? "timeout" : "unreachable",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function initialize(): Promise<void> {
    if (!initializing) {
      initializing = (async () => {
        const response = await post({
          jsonrpc: "2.0",
          id: "initialize",
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "agent-gallery", version: "0.1.0" },
          },
        });
        if (!response.ok) {
          throw new CalleError(
            response.status === 401 || response.status === 403
              ? "CALL-E rejected the server credentials."
              : `CALL-E initialize failed with status ${response.status}.`,
            response.status === 401 || response.status === 403 ? "auth" : "bad_response",
          );
        }
        sessionId = response.headers.get("mcp-session-id");
        await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      })().catch((error) => {
        initializing = null;
        throw error;
      });
    }
    return initializing;
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await initialize();
    const response = await post({
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new CalleError(
        response.status === 401 || response.status === 403
          ? "CALL-E rejected the server credentials."
          : `CALL-E ${name} failed with status ${response.status}.`,
        response.status === 401 || response.status === 403 ? "auth" : "bad_response",
      );
    }
    const parsed = parseMcpBody(text, response.headers.get("content-type") ?? "application/json");
    if (parsed.error) {
      throw new CalleError(`CALL-E rejected ${name}.`, "tool_error");
    }
    const result = parsed.result as { structuredContent?: unknown } | undefined;
    if (!result || result.structuredContent === undefined) {
      throw new CalleError(`CALL-E returned no structured content for ${name}.`, "bad_response");
    }
    return result.structuredContent;
  }

  return {
    async planCall(input) {
      const content = (await callTool("plan_call", {
        to_phones: input.to_phones,
        goal: input.goal,
        ...(input.language ? { language: input.language } : {}),
        ...(input.region ? { region: input.region } : {}),
      })) as CallePlan;
      if (!content?.plan_id) {
        throw new CalleError("CALL-E returned a plan without an identifier.", "bad_response");
      }
      return content;
    },

    async runCall(input) {
      const content = (await callTool("run_call", {
        plan_id: input.plan_id,
        confirm_token: input.confirm_token,
      })) as CalleRun;
      if (!content?.run_id) {
        throw new CalleError("CALL-E started a call without returning a run id.", "bad_response");
      }
      return content;
    },

    async getCallRun(input) {
      const content = (await callTool("get_call_run", { run_id: input.run_id })) as CalleRun;
      if (!content?.run_id) {
        throw new CalleError("CALL-E returned a run without an identifier.", "bad_response");
      }
      return content;
    },
  };
}
