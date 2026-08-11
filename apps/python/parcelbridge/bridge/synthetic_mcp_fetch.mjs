// =============================================================================
// synthetic_mcp_fetch.mjs
// =============================================================================
//
// Public-bridge synthetic fetch implementation for the ParcelBridge offline
// official CALL-E runtime proof. This module exports `createSyntheticFetch`,
// a factory that returns a `fetchImpl` compatible with
// `@call-e/core::callMcpTool`.
//
// Hard invariants
// ---------------
//   * The returned fetch implementation NEVER opens a network socket. It
//     inspects the supplied request body, dispatches on JSON-RPC `method`,
//     and returns a fully synthetic Response object.
//   * It records every observed JSON-RPC method name + payload shape so the
//     test suite can verify that `initialize`, `notifications/initialized`,
//     and `tools/call` were each issued by the official SDK.
//   * It captures the Authorization header the SDK constructs (which always
//     contains the synthetic PUBLIC_OFFLINE_CANARY value) so the test suite
//     can assert that header preservation happened, without ever echoing
//     the canary value to stdout or to the public Response payload.
//   * It rejects any URL that does NOT match the configured sentinel
//     `serverUrl` (defaults to `https://offline.invalid`).
//
// What the synthetic responses look like
// --------------------------------------
//   * `initialize`: returns protocolVersion, serverInfo, capabilities.
//   * `notifications/initialized`: returns 202 Accepted with empty body.
//   * `tools/call` (toolName=plan_call): returns a synthetic plan envelope
//     with `ready_to_run: true`, capability-shaped placeholders, and a
//     `structuredContent` block that includes a clearly-labeled
//     `_origin: "OFFLINE_SYNTHETIC_FETCH"` field.
//
// What this module does NOT do
// ----------------------------
//   * Does NOT contact any network.
//   * Does NOT invoke `globalThis.fetch`.
//   * Does NOT shell out, spawn subprocesses, or read the user's HOME.
//   * Does NOT carry real OAuth tokens, real phone numbers, real plan_ids,
//     real confirm_tokens, or real run_ids.

const OFFLINE_FETCH_ORIGIN = "OFFLINE_SYNTHETIC_FETCH";

// Tiny Response-shape implementation. The official SDK only needs
// `.ok`, `.status`, `.text()`, and `.headers.entries()`. We make this
// minimal so no unintended surface is exposed.
class SyntheticResponse {
  constructor({ ok, status, bodyText, headers }) {
    this._ok = ok;
    this._status = status;
    this._bodyText = bodyText;
    this._headers = headers || {};
  }
  get ok() {
    return this._ok;
  }
  get status() {
    return this._status;
  }
  async text() {
    return this._bodyText;
  }
  get headers() {
    const entries = Object.entries(this._headers);
    return {
      entries: () => entries[Symbol.iterator](),
      has: (k) =>
        Object.prototype.hasOwnProperty.call(this._headers, k.toLowerCase()),
      get: (k) => this._headers[k.toLowerCase()] ?? null,
      forEach: (cb) => {
        for (const [k, v] of entries) cb(v, k, this);
      },
    };
  }
}

function jsonRpcOk(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

export function createSyntheticFetch({
  serverUrl,
  expectedAuthCanary,
} = {}) {
  if (typeof serverUrl !== "string" || !serverUrl) {
    throw new Error("createSyntheticFetch: serverUrl is required");
  }

  const observations = {
    requests: [], // [{ method, headers (sanitized), hadAuthorizationHeader }]
    initializeObserved: false,
    initializedNotificationObserved: false,
    toolsCallObserved: false,
    toolCallNames: [],
    toolArgumentsReachedOfficialClient: false,
    requestMetaReachedOfficialClient: false,
    authorizationHeaderPresent: false,
    nonMatchingServerUrlAttempted: false,
    rejectedMethods: [],
  };

  async function fetchImpl(url, init) {
    const method = init?.method || "POST";
    let body = {};
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = {};
      }
    }

    // Reject any URL that does not match the configured sentinel.
    if (url !== serverUrl) {
      observations.nonMatchingServerUrlAttempted = true;
      return new SyntheticResponse({
        ok: false,
        status: 0,
        bodyText: JSON.stringify(
          jsonRpcError(
            body?.id ?? "synthetic",
            -32000,
            "OFFLINE_SYNTHETIC_BLOCKED_NON_SENTINEL_URL"
          )
        ),
        headers: { "content-type": "application/json" },
      });
    }

    // Capture the Authorization header (without echoing the canary value).
    const headers = init?.headers || {};
    const authHeader =
      typeof headers.Authorization === "string"
        ? headers.Authorization
        : typeof headers.authorization === "string"
          ? headers.authorization
          : null;
    const authHeaderShape = authHeader
      ? {
          prefix: authHeader.split(" ")[0],
          token_length: authHeader.slice(authHeader.indexOf(" ") + 1).length,
        }
      : null;
    observations.authorizationHeaderPresent = !!authHeader;
    observations.requests.push({
      jsonrpc_method: body?.method || null,
      jsonrpc_id: body?.id || null,
      hasParams: !!body?.params,
      headers_shape: {
        accept: headers.Accept || headers.accept || null,
        content_type:
          headers["Content-Type"] ||
          headers["content-type"] ||
          null,
        mcp_protocol_version:
          headers["MCP-Protocol-Version"] ||
          headers["mcp-protocol-version"] ||
          null,
        authorization_header_shape: authHeaderShape,
      },
    });

    if (expectedAuthCanary && authHeader) {
      // Best-effort check: if the canary is present, the token should match.
      // We do NOT log the canary value here.
      if (!authHeader.includes(expectedAuthCanary)) {
        // Authorization header was sent but did not contain the synthetic
        // canary. Mark for forensics but still return a synthetic response
        // so the SDK doesn't error out before the test can assert.
        observations.authorizationHeaderPresent = false;
      }
    }

    const rpcMethod = body?.method;
    if (rpcMethod === "initialize") {
      observations.initializeObserved = true;
      const envelope = jsonRpcOk(body?.id, {
        protocolVersion:
          body?.params?.protocolVersion || "2025-03-26",
        capabilities: {},
        serverInfo: {
          name: "parcelbridge-public-synthetic",
          version: "0.0.0",
        },
      });
      return new SyntheticResponse({
        ok: true,
        status: 200,
        bodyText: JSON.stringify(envelope),
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "parcelbridge-public-synthetic-session",
        },
      });
    }

    if (rpcMethod === "notifications/initialized") {
      observations.initializedNotificationObserved = true;
      // 202 Accepted with empty body is acceptable per MCP semantics.
      return new SyntheticResponse({
        ok: true,
        status: 202,
        bodyText: "",
        headers: { "content-type": "application/json" },
      });
    }

    if (rpcMethod === "tools/call") {
      observations.toolsCallObserved = true;
      const toolName = body?.params?.name;
      const toolArguments = body?.params?.arguments || {};
      const requestMeta = body?.params?._meta || null;
      observations.toolCallNames.push(toolName);
      observations.toolArgumentsReachedOfficialClient =
        typeof toolArguments === "object" &&
        toolArguments !== null &&
        Object.keys(toolArguments).length > 0;
      observations.requestMetaReachedOfficialClient =
        requestMeta !== null &&
        typeof requestMeta === "object" &&
        Object.keys(requestMeta).length > 0;

      if (toolName === "plan_call") {
        const structuredContent = {
          _origin: OFFLINE_FETCH_ORIGIN,
          _safe_marker: "OFFLINE_SYNTHETIC_FETCH",
          ready_to_run: true,
          received_user_input_present:
            typeof toolArguments.user_input === "string",
          received_user_input_length:
            typeof toolArguments.user_input === "string"
              ? toolArguments.user_input.length
              : 0,
          received_goal_present: typeof toolArguments.goal === "string",
          received_goal_length:
            typeof toolArguments.goal === "string"
              ? toolArguments.goal.length
              : 0,
          received_to_phones_count: Array.isArray(toolArguments.to_phones)
            ? toolArguments.to_phones.length
            : 0,
          received_language:
            typeof toolArguments.language === "string"
              ? toolArguments.language
              : null,
          received_ttl_seconds:
            typeof toolArguments.ttl_seconds === "number"
              ? toolArguments.ttl_seconds
              : null,
          received_region_present:
            typeof toolArguments.region === "string",
          received_scheduled_at_present:
            typeof toolArguments.scheduled_at === "string",
          received_plan_id_input_present:
            typeof toolArguments.plan_id === "string",
          received_request_meta_present:
            requestMeta !== null && typeof requestMeta === "object",
          received_request_meta_keys:
            requestMeta && typeof requestMeta === "object"
              ? Object.keys(requestMeta)
              : [],
        };
        const envelope = jsonRpcOk(body?.id, {
          ready_to_run: true,
          plan_id: "plan_public_offline_canary_xxxxxxxxxxxxxxxxx",
          confirm_token:
            "confirm_public_offline_canary_yyyyyyyyyyyyyyyy",
          structuredContent,
        });
        return new SyntheticResponse({
          ok: true,
          status: 200,
          bodyText: JSON.stringify(envelope),
          headers: { "content-type": "application/json" },
        });
      }

      // Unknown / disallowed tools (run_call, get_call_run, track_ui_events)
      // MUST be blocked by the public bridge at the callMcpTool call site.
      // We still produce an MCP error so the official SDK surfaces it cleanly.
      observations.rejectedMethods.push(toolName);
      return new SyntheticResponse({
        ok: false,
        status: 200,
        bodyText: JSON.stringify(
          jsonRpcError(
            body?.id,
            -32001,
            `PUBLIC_BRIDGE_TOOL_NOT_PERMITTED:${toolName}`
          )
        ),
        headers: { "content-type": "application/json" },
      });
    }

    // Any other method (resources/list, prompts/list, ping, etc.) is rejected.
    observations.rejectedMethods.push(rpcMethod);
    return new SyntheticResponse({
      ok: false,
      status: 200,
      bodyText: JSON.stringify(
        jsonRpcError(
          body?.id,
          -32002,
          `PUBLIC_BRIDGE_UNSUPPORTED_METHOD:${rpcMethod}`
        )
      ),
      headers: { "content-type": "application/json" },
    });
  }

  return {
    fetchImpl,
    observations,
    metadata: Object.freeze({
      origin: OFFLINE_FETCH_ORIGIN,
      live_endpoint_accessed: false,
      supports_initialize: true,
      supports_notifications_initialized: true,
      supports_plan_call: true,
      rejects_run_call: true,
      rejects_get_call_run: true,
      rejects_track_ui_events: true,
      rejects_non_sentinel_urls: true,
    }),
  };
}

export const __synthetic_mcp_fetch_metadata__ = Object.freeze({
  origin: OFFLINE_FETCH_ORIGIN,
  live_endpoint_accessed: false,
});