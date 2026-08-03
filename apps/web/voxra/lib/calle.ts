/**
 * CALL-E MCP client — server-side only.
 * Implements the JSON-RPC 2.0 + MCP protocol to communicate with the CALL-E
 * MCP server, mirroring the logic in packages/core/lib/mcp-client.js.
 */

import { config } from "@/lib/config";

const MCP_URL = config.mcpUrl;
const MCP_PROTOCOL_VERSION = "2024-11-05";
const TIMEOUT_MS = config.timeoutMs;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CallPlanResult {
  plan_id: string;
  confirm_token: string;
  display_goal?: string;
  expires_at?: string;
}

export interface CallRunResult {
  run_id: string;
  status: string;
  message?: string;
}

export interface CallStatusResult {
  run_id: string;
  status: string;
  message?: string | null;
  display_goal?: string | null;
  result?: {
    post_summary?: string | null;
    transcript?: string | null;
    outcome?: {
      task_completed: boolean;
      completion_confidence: { score: number; label: string };
      evidence?: string[];
    } | null;
    extracted?: {
      calling?: {
        status?: string;
        calls?: Array<{
          status: string;
          call_start_time?: string | null;
          call_end_time?: string | null;
          duration_seconds?: number | null;
          ring_type?: string | null;
          hangup_type?: string | null;
        }>;
      };
    };
  };
  next_step?: {
    action: string;
    poll_after_seconds?: number | null;
    instruction?: string;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts all top-level JSON objects/arrays from a raw string.
 * Handles NDJSON (newline-separated) as well as concatenated objects with no
 * separator (e.g. `{}{"result":…}` as some MCP servers produce).
 */
function extractJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { results.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return results;
}

function jsonRpcPayload(id: string | undefined, method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, ...(params !== undefined ? { params } : {}) });
}

async function postMcp(headers: Record<string, string>, body: string, requestId?: string): Promise<{ responseHeaders: Headers; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(MCP_URL, { method: "POST", headers, body, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`CALL-E MCP error ${res.status}: ${text.slice(0, 300)}`);
    }
    // Handle NDJSON and concatenated JSON objects (some MCP servers emit multiple
    // JSON objects with no separator, e.g. `{}{"result":…}`).
    const objects = extractJsonObjects(text) as Array<Record<string, unknown>>;
    let parsed: unknown = null;
    // Prefer the object whose id matches the request
    if (requestId) {
      parsed = objects.find((o) => o.id === requestId) ?? null;
    }
    // Fall back to first object that carries result/error
    if (parsed === null) {
      parsed = objects.find((o) => "result" in o || "error" in o) ?? null;
    }
    // Last resort: first object
    if (parsed === null && objects.length > 0) {
      parsed = objects[0];
    }
    if (parsed === null) {
      throw new Error(`No parseable JSON in CALL-E response: ${text.slice(0, 200)}`);
    }
    return { responseHeaders: res.headers, json: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function openSession(accessToken: string): Promise<Record<string, string>> {
  const baseHeaders: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    Authorization: `Bearer ${accessToken}`,
  };

  const { responseHeaders, json: initBody } = await postMcp(
    baseHeaders,
    jsonRpcPayload("calle-init", "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "calle-web", version: "1.0.0" },
    }),
    "calle-init"
  );

  const sessionId = responseHeaders.get("mcp-session-id") ?? "";
  const rpcHeaders: Record<string, string> = sessionId
    ? { ...baseHeaders, "mcp-session-id": sessionId }
    : baseHeaders;

  // Send initialized notification (fire-and-forget, ignore errors)
  try {
    await postMcp(rpcHeaders, jsonRpcPayload(undefined, "notifications/initialized", {}));
  } catch {
    // non-fatal
  }

  void initBody; // suppress unused warning
  return rpcHeaders;
}

async function callTool<T = unknown>(
  accessToken: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<T> {
  const headers = await openSession(accessToken);
  const { json } = await postMcp(
    headers,
    jsonRpcPayload(`calle-${toolName}`, "tools/call", { name: toolName, arguments: args }),
    `calle-${toolName}`
  );
  const body = json as {
    result?: {
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: Record<string, unknown>;
    }
  };
  // Prefer content[].text — it always carries the full serialized payload.
  // structuredContent can have nullable placeholder fields, so use it only as fallback.
  const textContent = body.result?.content?.find((c) => c.type === "text")?.text;
  if (textContent) {
    // text content may be NDJSON or concatenated JSON objects
    const textObjects = extractJsonObjects(textContent);
    // Return the object with the most keys — most likely the real result
    if (textObjects.length > 0) {
      const best = textObjects.reduce((a, b) => {
        const aLen = typeof a === "object" && a !== null ? Object.keys(a as object).length : 0;
        const bLen = typeof b === "object" && b !== null ? Object.keys(b as object).length : 0;
        return bLen > aLen ? b : a;
      });
      return best as T;
    }
  }
  // Fallback: use structuredContent if text parsing yielded nothing
  if (body.result?.structuredContent && Object.keys(body.result.structuredContent).length > 0) {
    return body.result.structuredContent as T;
  }
  throw new Error(`Empty tool response from CALL-E: ${JSON.stringify(body).slice(0, 200)}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function planCall(
  accessToken: string,
  phone: string,
  goal: string
): Promise<CallPlanResult> {
  return callTool<CallPlanResult>(accessToken, "plan_call", { to_phones: [phone], goal });
}

export async function runCall(
  accessToken: string,
  planId: string,
  confirmToken: string
): Promise<CallRunResult> {
  return callTool<CallRunResult>(accessToken, "run_call", { plan_id: planId, confirm_token: confirmToken });
}

export async function getCallStatus(accessToken: string, runId: string): Promise<CallStatusResult> {
  return callTool<CallStatusResult>(accessToken, "get_call_run", { run_id: runId });
}
