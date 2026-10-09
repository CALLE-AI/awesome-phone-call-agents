/**
 * T4.1 transport and JWT authorisation, T4.2a tool wiring.
 *
 * Runtime env, same names as `scripts/bootstrap-env.sh` (no defaults):
 * `ORMA_API_URL`, `SUPABASE_ANON_KEY`.
 * Always `ORMA_API_URL`, never `*.supabase.co`.
 * Never use the service role. Every DB access runs under the caller's RLS.
 *
 * Function slug is `mcp`. Public path will be `orma-api.nryn.dev/mcp`.
 * Transport is Streamable HTTP in stateless mode with JSON responses.
 *
 * Authorisation is the caller's Supabase JWT (Authorization Bearer).
 * Missing or expired tokens are clean auth errors, never a 500.
 *
 * T4.2a wires the real tools. `registerOrmaTools` from `./tools/mod.ts`
 * registers all six handlers under the caller's RLS. `TOOL_NAMES` keeps one
 * source of truth in `./tools/mod.ts` and is re-exported here.
 *
 * Pin with:
 * `deno test --allow-net --allow-env --allow-read supabase/functions/mcp/index.ts`
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/webStandardStreamableHttp.js";
import { registerOrmaTools, TOOL_NAMES } from "./tools/mod.ts";
import { createOwnerClient, createStore } from "./tools/double.ts";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_NAME = "orma";
export const MCP_SERVER_VERSION = "0.1.0";

export { TOOL_NAMES };
export type { ToolName } from "./tools/mod.ts";

export type AuthenticatedUser = {
  userId: string;
};

export type UserScopedClient = SupabaseClient;

export type McpDeps = {
  apiUrl: string;
  anonKey: string;
  fetch: typeof fetch;
  authenticate?: (token: string) => Promise<AuthenticatedUser>;
  createUserClient?: (
    token: string,
    user: AuthenticatedUser,
  ) => UserScopedClient;
};

export class AuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export function depsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): McpDeps {
  const apiUrl = requireNamedEnv("ORMA_API_URL", getEnv);
  if (apiUrl.includes("supabase.co")) {
    throw new Error("ORMA_API_URL must not be a project host");
  }
  return {
    apiUrl,
    anonKey: requireNamedEnv("SUPABASE_ANON_KEY", getEnv),
    fetch: fetchImpl,
  };
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  if (!match) return null;
  return match[1];
}

export function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.includes("supabase.co")) {
    throw new Error("must not use the project host");
  }
  return base;
}

export function createUserScopedClient(
  deps: Pick<McpDeps, "apiUrl" | "anonKey" | "fetch">,
  token: string,
): UserScopedClient {
  if (!token) throw new AuthError("unauthorized: missing bearer token");
  const url = apiBase(deps.apiUrl);
  return createClient(url, deps.anonKey, {
    global: {
      fetch: deps.fetch,
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function authenticateBearer(
  deps: McpDeps,
  token: string,
): Promise<AuthenticatedUser> {
  if (deps.authenticate) return deps.authenticate(token);
  const client = createUserScopedClient(deps, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) {
    throw new AuthError("unauthorized: invalid or expired token");
  }
  return { userId: data.user.id };
}

export function createOrmaMcpServer(
  client: UserScopedClient,
  user: AuthenticatedUser,
): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });
  registerOrmaTools(server, client, user);
  return server;
}

function authErrorResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer error="invalid_token"',
      },
    },
  );
}

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
    {
      status: 405,
      headers: { "content-type": "application/json" },
    },
  );
}

export function createMcpHandler(
  deps: McpDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "GET" || req.method === "DELETE") {
      return methodNotAllowed();
    }
    if (req.method !== "POST") return methodNotAllowed();

    const token = extractBearerToken(req);
    if (token === null) {
      return authErrorResponse("unauthorized: missing bearer token");
    }

    let user: AuthenticatedUser;
    try {
      user = await authenticateBearer(deps, token);
    } catch (error) {
      if (error instanceof AuthError) {
        return authErrorResponse(error.message);
      }
      throw error;
    }

    const client = deps.createUserClient
      ? deps.createUserClient(token, user)
      : createUserScopedClient(deps, token);

    const server = createOrmaMcpServer(client, user);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } finally {
      await transport.close();
      await server.close();
    }
  };
}

if (import.meta.main) {
  const deps = depsFromEnv();
  Deno.serve(createMcpHandler(deps));
}

const testFn =
  (Deno as { test?: (n: string, f: () => void | Promise<void>) => void }).test

if (typeof testFn === "function" && !import.meta.main) {
  const A = "00000000-0000-4000-8000-00000000000a"
  const B = "00000000-0000-4000-8000-00000000000b"
  const tA = "token-user-a", tB = "token-user-b"
  const apiUrl = "https://orma-api.nryn.dev"
  const anonKey = "anon-key-test-value"
  const badHost = "https://pyuubklpkhjngiqqwypf.supabase.co"
  const fixtures = [
    { id: "item-a1", text: "dentist", user_id: A, status: "open" },
    { id: "item-b1", text: "visa", user_id: B, status: "open" },
  ]
  const hdrs = (token?: string) => {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    }
    if (token) h.authorization = `Bearer ${token}`
    return h
  }
  const rpc = (method: string, id: number, params: Record<string, unknown> = {}) =>
    JSON.stringify({ jsonrpc: "2.0", id, method, params })
  const mockRls = (ownerId: string) => ({
    from(table: string) {
      if (table !== "items") throw new Error(`unexpected table ${table}`)
      return {
        select(_c: string) {
          return {
            eq(column: string, value: string) {
              const rows = fixtures.filter((r) =>
                r.user_id === ownerId && (column !== "status" || r.status === value))
              return Promise.resolve({
                data: rows.map(({ id, text, user_id }) => ({ id, text, user_id })),
                error: null,
              })
            },
          }
        },
      }
    },
  }) as unknown as UserScopedClient
  const baseDeps = (o: Partial<McpDeps> = {}): McpDeps => ({
    apiUrl, anonKey,
    fetch: async () => new Response("{}", { status: 200 }),
    authenticate: async (token) => {
      if (token === tA) return { userId: A }
      if (token === tB) return { userId: B }
      throw new AuthError("unauthorized: invalid or expired token")
    },
    createUserClient: (_t, user) => mockRls(user.userId),
    ...o,
  })
  const authFetch = (resolve: (token: string) => Response): typeof fetch =>
    async (input, init) => {
      if (!String(input).includes("/auth/v1/user")) {
        return new Response("{}", { status: 200 })
      }
      const auth = new Headers(init?.headers).get("authorization") ?? ""
      return resolve(auth.replace(/^Bearer\s+/i, ""))
    }
  const post = (deps: McpDeps, token: string | undefined, body: string) =>
    createMcpHandler(deps)(new Request(`${apiUrl}/functions/v1/mcp`, {
      method: "POST", headers: hdrs(token), body,
    }))

  testFn("missing bearer token is refused with 401", async () => {
    const res = await post(baseDeps(), undefined, rpc("tools/list", 1))
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
    const body = await res.json() as { error?: { message?: string } }
    if (!body.error?.message?.includes("missing bearer token")) {
      throw new Error("missing token message")
    }
  })
  testFn("invalid bearer token is refused with 401", async () => {
    const res = await post(baseDeps(), "token-expired", rpc("tools/list", 1))
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
    const body = await res.json() as { error?: { message?: string } }
    if (!body.error?.message?.includes("invalid or expired")) {
      throw new Error("invalid token message")
    }
  })
  testFn("valid token lists the six tool names", async () => {
    const res = await post(baseDeps(), tA, rpc("tools/list", 2))
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
    const body = await res.json() as { result?: { tools?: Array<{ name: string }> } }
    const names = (body.result?.tools ?? []).map((t) => t.name).sort()
    if (names.join(",") !== [...TOOL_NAMES].sort().join(",")) {
      throw new Error(`tool list mismatch: ${names}`)
    }
  })
  testFn("user A list_items cannot read user B items", async () => {
    const res = await post(baseDeps(), tA, rpc("tools/call", 4, {
      name: "list_items", arguments: {},
    }))
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } }
    const rows = JSON.parse(body.result?.content?.[0]?.text ?? "") as Array<{ user_id: string }>
    if (rows.length !== 1 || rows[0].user_id !== A) throw new Error("caller rows only")
    if (rows.some((r) => r.user_id === B)) throw new Error("cross-user leak")
  })
  testFn("createUserScopedClient sends the caller JWT, never service role", async () => {
    const seen: Array<{ authorization: string | null; apikey: string | null }> = []
    const client = createUserScopedClient({
      apiUrl, anonKey,
      fetch: async (_i, init) => {
        const h = new Headers(init?.headers)
        seen.push({ authorization: h.get("authorization"), apikey: h.get("apikey") })
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
      },
    }, tA)
    await client.from("items").select("id")
    if (!seen.length) throw new Error("no fetch")
    for (const call of seen) {
      if (call.authorization !== `Bearer ${tA}`) throw new Error("bad Authorization")
      if (call.apikey !== anonKey) throw new Error("bad apikey")
    }
  })
  testFn("depsFromEnv requires ORMA_API_URL and SUPABASE_ANON_KEY", () => {
    const values: Record<string, string> = {}
    for (const name of ["ORMA_API_URL", "SUPABASE_ANON_KEY"]) {
      try {
        depsFromEnv((k) => values[k])
        throw new Error(`expected missing ${name}`)
      } catch (e) {
        if (!(e instanceof Error) || e.message !== `missing ${name}`) throw e
        values[name] = name === "ORMA_API_URL" ? "https://orma-api.nryn.dev" : "anon-test"
      }
    }
    if (depsFromEnv((k) => values[k]).apiUrl.includes("supabase.co")) {
      throw new Error("project host")
    }
  })
  testFn("authenticateBearer pins auth.getUser success without authenticate", async () => {
    const jwt = "jwt-valid-user-a"
    const fetchDouble = authFetch((token) => {
      if (token !== jwt) {
        return new Response(JSON.stringify({ message: "invalid JWT" }), {
          status: 401, headers: { "content-type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({ id: A, aud: "authenticated", role: "authenticated" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    const user = await authenticateBearer({ apiUrl, anonKey, fetch: fetchDouble }, jwt)
    if (user.userId !== A) throw new Error(`expected ${A}, got ${user.userId}`)
  })
  testFn("authenticateBearer pins auth.getUser failure without authenticate", async () => {
    const fetchDouble = authFetch(() =>
      new Response(JSON.stringify({ message: "invalid JWT" }), {
        status: 401, headers: { "content-type": "application/json" },
      }))
    try {
      await authenticateBearer({ apiUrl, anonKey, fetch: fetchDouble }, "token-expired")
      throw new Error("expected AuthError from getUser failure")
    } catch (e) {
      if (!(e instanceof AuthError)) throw e
      if (!e.message.includes("invalid or expired")) throw new Error("invalid or expired")
    }
  })
  testFn("handler refuses invalid token via real auth.getUser path", async () => {
    const fetchDouble = authFetch(() =>
      new Response(JSON.stringify({ message: "invalid JWT" }), {
        status: 401, headers: { "content-type": "application/json" },
      }))
    const deps: McpDeps = {
      apiUrl, anonKey, fetch: fetchDouble,
      createUserClient: (_t, user) => mockRls(user.userId),
    }
    const res = await post(deps, "token-expired", rpc("tools/list", 8))
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
    const body = await res.json() as { error?: { message?: string } }
    if (!body.error?.message?.includes("invalid or expired")) {
      throw new Error("handler must surface getUser auth failure")
    }
  })
  testFn("handler accepts valid token via real auth.getUser path", async () => {
    const jwt = "jwt-valid-user-a"
    const fetchDouble = authFetch((token) => {
      if (token !== jwt) {
        return new Response(JSON.stringify({ message: "invalid JWT" }), {
          status: 401, headers: { "content-type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({ id: A, aud: "authenticated", role: "authenticated" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    const deps: McpDeps = {
      apiUrl, anonKey, fetch: fetchDouble,
      createUserClient: (_t, user) => {
        if (user.userId !== A) throw new Error(`createUserClient saw ${user.userId}`)
        return mockRls(user.userId)
      },
    }
    const res = await post(deps, jwt, rpc("tools/list", 9))
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
    const body = await res.json() as { result?: { tools?: Array<{ name: string }> } }
    const names = (body.result?.tools ?? []).map((t) => t.name).sort()
    if (names.join(",") !== [...TOOL_NAMES].sort().join(",")) {
      throw new Error(`tool list mismatch after getUser: ${names}`)
    }
  })
  testFn("apiBase rejects supabase.co project hosts", () => {
    let threw = false
    try { apiBase(badHost) } catch (e) {
      threw = true
      if (!(e instanceof Error) || !e.message.includes("project host")) {
        throw new Error("apiBase must reject *.supabase.co")
      }
    }
    if (!threw) throw new Error("apiBase must throw for supabase.co URL")
  })
  testFn("depsFromEnv rejects supabase.co ORMA_API_URL", () => {
    let threw = false
    try {
      depsFromEnv((key) =>
        key === "ORMA_API_URL" ? badHost
          : key === "SUPABASE_ANON_KEY" ? "anon-test" : undefined)
    } catch (e) {
      threw = true
      if (!(e instanceof Error) || !e.message.includes("project host")) {
        throw new Error("depsFromEnv must reject *.supabase.co")
      }
    }
    if (!threw) throw new Error("depsFromEnv must throw for supabase.co URL")
  })
  testFn("createUserScopedClient rejects supabase.co apiUrl", () => {
    let threw = false
    try {
      createUserScopedClient({
        apiUrl: badHost, anonKey,
        fetch: async () => new Response("{}", { status: 200 }),
      }, tA)
    } catch (e) {
      threw = true
      if (!(e instanceof Error) || !e.message.includes("project host")) {
        throw new Error("createUserScopedClient must reject *.supabase.co")
      }
    }
    if (!threw) throw new Error("createUserScopedClient must throw for supabase.co URL")
  })
  testFn("end-to-end: initialize, list six tools, list_items round-trips", async () => {
    const store = createStore()
    const deps = baseDeps({
      createUserClient: (_t, user) => createOwnerClient(user.userId, store),
    })
    const init = await post(deps, tA, rpc("initialize", 11, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "orma-test", version: "0.0.0" },
    }))
    if (init.status !== 200) throw new Error(`initialize expected 200, got ${init.status}`)
    const initBody = await init.json() as {
      result?: { protocolVersion?: string, serverInfo?: { name?: string } },
    }
    if (initBody.result?.serverInfo?.name !== MCP_SERVER_NAME) {
      throw new Error("initialize must name the orma server")
    }
    if (initBody.result?.protocolVersion !== MCP_PROTOCOL_VERSION) {
      throw new Error(`protocol version mismatch: ${initBody.result?.protocolVersion}`)
    }

    const listed = await post(deps, tA, rpc("tools/list", 12))
    if (listed.status !== 200) throw new Error(`tools/list expected 200, got ${listed.status}`)
    const listBody = await listed.json() as { result?: { tools?: Array<{ name: string }> } }
    const names = (listBody.result?.tools ?? []).map((t) => t.name).sort()
    if (names.length !== TOOL_NAMES.length) {
      throw new Error(`expected six tools, got ${names.length}`)
    }
    if (names.join(",") !== [...TOOL_NAMES].sort().join(",")) {
      throw new Error(`tool list mismatch: ${names}`)
    }

    const res = await post(deps, tA, rpc("tools/call", 13, {
      name: "list_items", arguments: {},
    }))
    if (res.status !== 200) throw new Error(`tools/call expected 200, got ${res.status}`)
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } }
    const rows = JSON.parse(body.result?.content?.[0]?.text ?? "") as Array<{
      id: string, text: string, user_id: string,
    }>
    if (rows.length !== 1 || rows[0].id !== "item-a1") throw new Error("fixture rows mismatch")
    if (rows[0].text !== "dentist" || rows[0].user_id !== A) throw new Error("wrong fixture row")
    if (rows.some((r) => r.user_id === B)) throw new Error("cross-user leak")
  })
}
