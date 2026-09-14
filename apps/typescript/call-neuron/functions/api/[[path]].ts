const PRODUCTION_BASE_URL = "https://seleven-mcp-sg.airudder.com";
const MCP_PROTOCOL_VERSION = "2025-11-25";
const INTEGRATION = "apps/typescript/call-neuron/0.1.0";
const REQUEST_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;

type Env = {
  CALLNEURON_ENV?: string;
  CALLNEURON_LIVE_MODE?: string;
  CALLNEURON_TEST_BASE_URL?: string;
};

type Context = {
  request: Request;
  env: Env;
};

type JsonObject = Record<string, unknown>;

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function json(payload: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...headers },
  });
}

function fail(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedString(value: unknown, max: number, required = true): value is string {
  return typeof value === "string" && value.length <= max && (!required || value.length > 0);
}

function testBaseUrl(env: Env) {
  if (env.CALLNEURON_ENV !== "test" || !env.CALLNEURON_TEST_BASE_URL) {
    return null;
  }
  const url = new URL(env.CALLNEURON_TEST_BASE_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Test upstream must be loopback HTTP.");
  }
  return url.origin;
}

function baseUrl(env: Env) {
  return testBaseUrl(env) || PRODUCTION_BASE_URL;
}

async function readJsonBody(request: Request): Promise<JsonObject> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_LIMIT) {
    throw new Error("Request is too large.");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("Content-Type must be application/json.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > REQUEST_LIMIT) {
    throw new Error("Request is too large.");
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isObject(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed;
}

async function fetchTimed(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readBounded(response: Response, limit = RESPONSE_LIMIT) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > limit) {
    throw new Error("CALL-E response exceeded the allowed size.");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > limit) {
    throw new Error("CALL-E response exceeded the allowed size.");
  }
  return new TextDecoder().decode(bytes);
}

async function brokerJson(url: string, init: RequestInit) {
  const response = await fetchTimed(url, init, 15_000);
  const text = await readBounded(response);
  if (!response.ok) {
    throw new Error(`CALL-E authentication returned HTTP ${response.status}.`);
  }
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!isObject(parsed)) {
    throw new Error("CALL-E authentication returned an invalid response.");
  }
  return parsed;
}

function integrationHeaders(extra: HeadersInit = {}) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-call-e-integration": INTEGRATION,
    ...extra,
  };
}

function requiredString(body: JsonObject, key: string, max: number) {
  const value = body[key];
  if (!boundedString(value, max)) {
    throw new Error(`${key} is invalid.`);
  }
  return value;
}

function safeLoginUrl(value: unknown, upstreamBaseUrl: string) {
  if (!boundedString(value, 2048)) {
    throw new Error("CALL-E returned an invalid login URL.");
  }
  const login = new URL(value);
  const upstream = new URL(upstreamBaseUrl);
  if (login.origin !== upstream.origin || (!testLoopback(upstream) && login.protocol !== "https:")) {
    throw new Error("CALL-E returned an unexpected login URL.");
  }
  return login.toString();
}

function testLoopback(url: URL) {
  return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
}

async function startLogin(env: Env, body: JsonObject) {
  if (!hasOnlyKeys(body, [])) {
    return fail("Unknown authentication fields.");
  }
  const upstream = baseUrl(env);
  const result = await brokerJson(`${upstream}/api/v1/openagent-auth/sessions`, {
    method: "POST",
    headers: integrationHeaders(),
    body: JSON.stringify({
      server_url: `${upstream}/mcp/openagent_oauth`,
      auth_base_url: upstream,
      channel: "openagent_oauth",
      scope: "openid email profile",
      client_name: "CallNeuron",
    }),
  });
  return json({
    ok: true,
    sessionId: requiredString(result, "session_id", 512),
    sessionSecret: requiredString(result, "session_secret", 512),
    loginUrl: safeLoginUrl(result.login_url, upstream),
    status: boundedString(result.status, 32) ? result.status : "PENDING",
    expiresAt: boundedString(result.expires_at, 64, false) ? result.expires_at : null,
    pollAfterMs: Number.isInteger(result.poll_after_ms) ? result.poll_after_ms : null,
  });
}

async function loginStatus(env: Env, body: JsonObject) {
  if (!hasOnlyKeys(body, ["sessionId", "sessionSecret"])) {
    return fail("Unknown authentication fields.");
  }
  const sessionId = requiredString(body, "sessionId", 512);
  const sessionSecret = requiredString(body, "sessionSecret", 512);
  const result = await brokerJson(`${baseUrl(env)}/api/v1/openagent-auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: integrationHeaders({ "x-openagent-session-secret": sessionSecret }),
  });
  return json({
    ok: true,
    status: boundedString(result.status, 32) ? result.status : "UNKNOWN",
    expiresAt: boundedString(result.expires_at, 64, false) ? result.expires_at : null,
    pollAfterMs: Number.isInteger(result.poll_after_ms) ? result.poll_after_ms : null,
  });
}

async function exchangeLogin(env: Env, body: JsonObject) {
  if (!hasOnlyKeys(body, ["sessionId", "sessionSecret"])) {
    return fail("Unknown authentication fields.");
  }
  const sessionId = requiredString(body, "sessionId", 512);
  const sessionSecret = requiredString(body, "sessionSecret", 512);
  const result = await brokerJson(
    `${baseUrl(env)}/api/v1/openagent-auth/sessions/${encodeURIComponent(sessionId)}/exchange`,
    {
      method: "POST",
      headers: integrationHeaders({ "x-openagent-session-secret": sessionSecret }),
    }
  );
  const token = result.token;
  if (!isObject(token)) {
    throw new Error("CALL-E exchange returned an invalid token document.");
  }
  return json({
    ok: true,
    accessToken: requiredString(token, "access_token", 4096),
    expiresAt: boundedString(result.expires_at, 64, false) ? result.expires_at : null,
  });
}

function validatePlanArguments(args: JsonObject) {
  const allowed = ["plan_id", "to_phones", "region", "language", "goal", "user_input", "ttl_seconds"];
  if (!hasOnlyKeys(args, allowed)) {
    throw new Error("plan_call includes unsupported fields.");
  }
  if (args.plan_id !== undefined && !boundedString(args.plan_id, 512)) {
    throw new Error("plan_id is invalid.");
  }
  if (args.to_phones !== undefined) {
    if (
      !Array.isArray(args.to_phones) ||
      args.to_phones.length !== 1 ||
      !boundedString(args.to_phones[0], 32) ||
      !/^\+[1-9]\d{7,14}$/u.test(args.to_phones[0])
    ) {
      throw new Error("to_phones must contain one E.164 number.");
    }
  }
  if (args.region !== undefined && args.region !== "MY") {
    throw new Error("region must be MY.");
  }
  if (args.language !== undefined && args.language !== "English") {
    throw new Error("language must be English.");
  }
  for (const key of ["goal", "user_input"]) {
    if (args[key] !== undefined && !boundedString(args[key], 12_000)) {
      throw new Error(`${key} is invalid.`);
    }
  }
  if (args.ttl_seconds !== undefined && args.ttl_seconds !== 86_400) {
    throw new Error("ttl_seconds must be 86400.");
  }
}

function validateToolCall(params: unknown) {
  if (!isObject(params) || !hasOnlyKeys(params, ["name", "arguments"])) {
    throw new Error("Invalid tools/call parameters.");
  }
  const name = requiredString(params, "name", 64);
  const args = params.arguments;
  if (!isObject(args)) {
    throw new Error("Tool arguments must be an object.");
  }
  if (name === "plan_call") {
    validatePlanArguments(args);
  } else if (name === "run_call") {
    if (!hasOnlyKeys(args, ["plan_id", "confirm_token", "ttl_seconds"])) {
      throw new Error("run_call includes unsupported fields.");
    }
    requiredString(args, "plan_id", 512);
    requiredString(args, "confirm_token", 512);
    if (args.ttl_seconds !== 86_400) {
      throw new Error("ttl_seconds must be 86400.");
    }
  } else if (name === "get_call_run") {
    if (!hasOnlyKeys(args, ["run_id", "cursor", "limit"])) {
      throw new Error("get_call_run includes unsupported fields.");
    }
    requiredString(args, "run_id", 512);
    if (args.cursor !== undefined && !boundedString(args.cursor, 2048)) {
      throw new Error("cursor is invalid.");
    }
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)) {
      throw new Error("limit must be an integer from 1 to 100.");
    }
  } else {
    throw new Error("Tool is not allowed.");
  }
  return { name, arguments: args };
}

function mcpPayload(body: JsonObject) {
  const method = requiredString(body, "method", 64);
  const id = boundedString(body.id, 128, false) ? body.id : undefined;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: id || "call-neuron-initialize",
      method,
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "call-neuron", version: "0.1.0" },
      },
    };
  }
  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", method, params: {} };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id: id || "call-neuron-tools", method };
  }
  if (method === "tools/call") {
    return {
      jsonrpc: "2.0",
      id: id || "call-neuron-tool-call",
      method,
      params: validateToolCall(body.params),
    };
  }
  throw new Error("MCP method is not allowed.");
}

async function proxyMcp(env: Env, body: JsonObject) {
  if (!hasOnlyKeys(body, ["accessToken", "mcpSessionId", "method", "id", "params"])) {
    return fail("Unknown MCP fields.");
  }
  const accessToken = requiredString(body, "accessToken", 4096);
  const sessionId = body.mcpSessionId;
  if (sessionId !== undefined && !boundedString(sessionId, 512)) {
    return fail("MCP session is invalid.");
  }
  const payload = mcpPayload(body);
  const timeout = payload.method === "tools/call" && (payload.params as JsonObject | undefined)?.name === "run_call" ? 45_000 : 30_000;
  const response = await fetchTimed(`${baseUrl(env)}/mcp/openagent_oauth`, {
    method: "POST",
    headers: integrationHeaders({
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    }),
    body: JSON.stringify(payload),
  }, timeout);
  const text = await readBounded(response);
  const contentType = response.headers.get("content-type") || "application/json";
  if (text && !contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
    throw new Error("CALL-E MCP returned an unsupported response type.");
  }
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": contentType,
  });
  for (const name of ["mcp-session-id", "mcp-protocol-version"]) {
    const value = response.headers.get(name);
    if (value) {
      headers.set(name, value.slice(0, 512));
    }
  }
  return new Response(text, { status: response.status, headers });
}

export async function onRequest({ request, env }: Context) {
  try {
    if (request.method !== "POST") {
      return fail("Method not allowed.", 405);
    }
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return fail("Cross-origin requests are not allowed.", 403);
    }
    if (env.CALLNEURON_ENV !== "test" && env.CALLNEURON_LIVE_MODE !== "operator-prototype") {
      return fail("Live CALL-E access is disabled for this deployment.", 403);
    }
    const body = await readJsonBody(request);
    if (url.pathname === "/api/auth/start") {
      return await startLogin(env, body);
    }
    if (url.pathname === "/api/auth/status") {
      return await loginStatus(env, body);
    }
    if (url.pathname === "/api/auth/exchange") {
      return await exchangeLogin(env, body);
    }
    if (url.pathname === "/api/mcp") {
      return await proxyMcp(env, body);
    }
    return fail("Route not found.", 404);
  } catch (error) {
    const message = error instanceof SyntaxError ? "Invalid JSON." : error instanceof Error ? error.message : "Request failed.";
    return fail(message, 400);
  }
}
