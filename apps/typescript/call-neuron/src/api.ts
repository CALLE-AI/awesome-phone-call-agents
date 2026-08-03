type JsonObject = Record<string, unknown>;

export type PendingLogin = {
  sessionId: string;
  sessionSecret: string;
  loginUrl: string;
};

export type McpReply = {
  body: JsonObject | null;
  sessionId: string;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function postJson(path: string, body: JsonObject) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("The connection service returned unreadable data.");
  }
  if (!response.ok || !isObject(parsed)) {
    const message = isObject(parsed) && typeof parsed.error === "string" ? parsed.error : "The connection service failed.";
    throw new Error(message);
  }
  return parsed;
}

function stringField(value: JsonObject, key: string) {
  const field = value[key];
  if (typeof field !== "string" || !field) {
    throw new Error(`The connection service omitted ${key}.`);
  }
  return field;
}

export async function startLogin(): Promise<PendingLogin> {
  const result = await postJson("/api/auth/start", {});
  return {
    sessionId: stringField(result, "sessionId"),
    sessionSecret: stringField(result, "sessionSecret"),
    loginUrl: stringField(result, "loginUrl"),
  };
}

export async function readLoginStatus(login: PendingLogin) {
  const result = await postJson("/api/auth/status", {
    sessionId: login.sessionId,
    sessionSecret: login.sessionSecret,
  });
  return stringField(result, "status").trim().toUpperCase();
}

export async function exchangeLogin(login: PendingLogin) {
  const result = await postJson("/api/auth/exchange", {
    sessionId: login.sessionId,
    sessionSecret: login.sessionSecret,
  });
  return stringField(result, "accessToken");
}

function parseSse(text: string) {
  const messages = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  if (!messages.length) {
    return null;
  }
  return JSON.parse(messages.at(-1) as string) as unknown;
}

export async function callMcp(
  accessToken: string,
  method: "initialize" | "notifications/initialized" | "tools/list" | "tools/call",
  options: { mcpSessionId?: string; id?: string; params?: JsonObject } = {}
): Promise<McpReply> {
  const { mcpSessionId, ...requestOptions } = options;
  const response = await fetch("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken, method, ...requestOptions, ...(mcpSessionId ? { mcpSessionId } : {}) }),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text
      ? response.headers.get("content-type")?.includes("text/event-stream")
        ? parseSse(text)
        : JSON.parse(text)
      : null;
  } catch {
    throw new Error("CALL-E returned unreadable MCP data.");
  }
  if (!response.ok) {
    const message = isObject(parsed) && typeof parsed.error === "string" ? parsed.error : `CALL-E returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (parsed !== null && !isObject(parsed)) {
    throw new Error("CALL-E returned an invalid MCP response.");
  }
  if (isObject(parsed) && isObject(parsed.error)) {
    throw new Error(typeof parsed.error.message === "string" ? parsed.error.message : "CALL-E rejected the MCP request.");
  }
  return {
    body: parsed,
    sessionId: response.headers.get("mcp-session-id") || mcpSessionId || "",
  };
}

export function toolNames(reply: McpReply) {
  const result = reply.body?.result;
  if (!isObject(result) || !Array.isArray(result.tools)) {
    throw new Error("CALL-E did not return a tool list.");
  }
  return result.tools.flatMap((tool) => (isObject(tool) && typeof tool.name === "string" ? [tool.name] : []));
}

export function planIsSafelyIncomplete(reply: McpReply) {
  const result = reply.body?.result;
  if (!isObject(result) || !isObject(result.structuredContent)) {
    throw new Error("CALL-E did not return a structured plan.");
  }
  return result.structuredContent.ready_to_run === false && !result.structuredContent.run_id;
}
