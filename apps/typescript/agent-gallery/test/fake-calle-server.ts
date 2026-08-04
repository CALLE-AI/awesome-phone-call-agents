/**
 * An in-process fake CALL-E MCP server.
 *
 * It speaks the same wire protocol as the real server — JSON-RPC over HTTP with
 * an initialize handshake, a session header, and optional SSE framing — so the
 * client is exercised the way it will actually be used. Nothing here dials a
 * phone, and no credentials are needed.
 */

export const FAKE_TOKEN = "fake-access-token";
export const FAKE_SERVER_URL = "https://fake.invalid/mcp/openagent_oauth";

export interface FakeOptions {
  /** Frame tool responses as text/event-stream, as the real server sometimes does. */
  sse?: boolean;
  /** Reject every request with this status, to exercise credential failures. */
  rejectWithStatus?: number;
  /** Statuses returned by successive get_call_run polls; the last one repeats. */
  statusSequence?: string[];
  /** Result payload attached once a terminal status is reached. */
  terminalResult?: Record<string, unknown>;
}

export interface FakeCalle {
  fetch: typeof globalThis.fetch;
  /** Tool names in call order, for asserting the protocol sequence. */
  toolCalls: string[];
  runCallAttempts: number;
}

export function createFakeCalle(options: FakeOptions = {}): FakeCalle {
  const statuses = options.statusSequence ?? ["PREPARING", "COMPLETED"];
  const state = {
    toolCalls: [] as string[],
    runCallAttempts: 0,
    spentTokens: new Set<string>(),
    polls: 0,
  };

  function respond(payload: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    const body = JSON.stringify(payload);
    if (options.sse) {
      return new Response(`event: message\ndata: ${body}\n\n`, {
        status: init.status ?? 200,
        headers: { "content-type": "text/event-stream", ...(init.headers ?? {}) },
      });
    }
    return new Response(body, {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  }

  function structured(content: unknown, id: string) {
    return { jsonrpc: "2.0", id, result: { structuredContent: content } };
  }

  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    if (options.rejectWithStatus) {
      return new Response(JSON.stringify({ error: "denied" }), {
        status: options.rejectWithStatus,
        headers: { "content-type": "application/json" },
      });
    }

    const headers = new Headers(init?.headers as HeadersInit);
    if (headers.get("authorization") !== `Bearer ${FAKE_TOKEN}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method?: string;
      id?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };

    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { capabilities: {} } }), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "fake-session" },
      });
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }
    if (body.method !== "tools/call") {
      return respond({ jsonrpc: "2.0", id: body.id, error: { message: "unknown method" } });
    }

    const name = body.params?.name ?? "";
    const args = body.params?.arguments ?? {};
    state.toolCalls.push(name);

    if (name === "plan_call") {
      return respond(
        structured(
          {
            plan_id: "plan-1",
            ready_to_run: true,
            confirm_summary: "Call the customer about their appointment.",
            confirm_token: "confirm-1",
          },
          String(body.id),
        ),
      );
    }

    if (name === "run_call") {
      state.runCallAttempts += 1;
      const token = String(args.confirm_token ?? "");
      if (state.spentTokens.has(token)) {
        return respond({
          jsonrpc: "2.0",
          id: body.id,
          error: { message: "confirm_token already used" },
        });
      }
      state.spentTokens.add(token);
      return respond(
        structured({ run_id: "run-1", status: statuses[0], activity: [] }, String(body.id)),
      );
    }

    if (name === "get_call_run") {
      const index = Math.min(state.polls, statuses.length - 1);
      const status = statuses[index];
      state.polls += 1;
      const terminal = status === "COMPLETED" || status === "FAILED" || status === "NO ANSWER";
      return respond(
        structured(
          {
            run_id: "run-1",
            status,
            activity: [
              { run_id: "run-1", ts: "2026-08-04T13:57:02.000+08:00", level: "info", kind: "call", message: `status=${status}` },
            ],
            ...(terminal && options.terminalResult ? { result: options.terminalResult } : {}),
          },
          String(body.id),
        ),
      );
    }

    return respond({ jsonrpc: "2.0", id: body.id, error: { message: "unknown tool" } });
  }) as unknown as typeof globalThis.fetch;

  return {
    fetch: fetchImpl,
    get toolCalls() {
      return state.toolCalls;
    },
    get runCallAttempts() {
      return state.runCallAttempts;
    },
  };
}
