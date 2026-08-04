// Server-side integration layer for CALL-E.
//
// Credentials live only here, supplied through Cloudflare Pages environment
// variables. They must never reach browser code.
//
// The live CALL-E client is intentionally not implemented yet. Phase 2 of the
// implementation route places one throwaway real call to observe the actual
// surface (sibling apps in this repository use MCP Streamable HTTP), and this
// layer is then completed against the observed behavior.

type Env = {
  CALLE_API_KEY?: string;
  CALLE_BASE_URL?: string;
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

// Per-isolate duplicate guard. CALL-E is the durable system of record; before
// creating a call, the completed implementation must also check CALL-E's call
// list so a fresh isolate cannot double-create.
const seenRequestKeys = new Map<string, string>();

export async function onRequest(context: Context): Promise<Response> {
  const { request, params } = context;
  const path = params.path ?? [];

  if (request.method === "POST" && path.length === 1 && path[0] === "calls") {
    return createCall(context);
  }
  if (request.method === "GET" && path.length === 2 && path[0] === "calls") {
    return getCallStatus(path[1]);
  }
  return json({ error: "not_found" }, 404);
}

async function createCall(context: Context): Promise<Response> {
  const body = await context.request.text();
  if (body.length > REQUEST_LIMIT) {
    return json({ error: "request_too_large" }, 413);
  }

  let payload: { request_key?: string };
  try {
    payload = JSON.parse(body) as { request_key?: string };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!payload.request_key || typeof payload.request_key !== "string") {
    return json({ error: "missing_request_key" }, 400);
  }

  const existingCallId = seenRequestKeys.get(payload.request_key);
  if (existingCallId) {
    return json({ call_id: existingCallId, deduplicated: true });
  }

  return json(
    {
      error:
        "live_integration_pending: the CALL-E client is completed in Phase 4 " +
        "of the implementation route, after the Phase 2 throwaway call fixes " +
        "the integration surface.",
    },
    501,
  );
}

function getCallStatus(_callId: string): Response {
  return json({ error: "live_integration_pending" }, 501);
}
