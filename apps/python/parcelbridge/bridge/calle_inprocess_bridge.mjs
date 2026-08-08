// =============================================================================
// calle_inprocess_bridge.mjs
// =============================================================================
//
// ParcelBridge public-bridge offline official CALL-E runtime proof.
//
// This script:
//   1. Imports the official `callMcpTool` function from `@call-e/core/mcp-client`
//      — no re-implementation, no copy of the SDK source.
//   2. Allocates a temporary, public, synthetic auth cache via
//      `synthetic_auth_cache.mjs`.
//   3. Constructs a synthetic fetch implementation via
//      `synthetic_mcp_fetch.mjs` so the official SDK never opens a network
//      socket to a real CALL-E endpoint.
//   4. Invokes `callMcpTool({config, toolName, toolArguments, requestMeta,
//      fetchImpl})` with `toolName="plan_call"`.
//   5. Sanitizes the response (no opaque tokens, no phone numbers, no canary
//      values) and emits a JSON object on stdout describing the runtime
//      outcomes the test suite asserts on.
//
// Hard rules (inherited from the project protocol):
//   * NEVER accept phone numbers, OAuth tokens, plan IDs, confirm tokens,
//     run IDs, or live URLs on argv.
//   * NEVER read or write outside a per-run temporary cacheRoot (0700 dir,
//     0600 token file).
//   * NEVER contact a live CALL-E endpoint.
//   * NEVER invoke run_call, get_call_run, or track_ui_events. If asked, the
//     bridge refuses with an explicit error.
//   * NEVER persist raw MCP response bodies to disk. The sanitized summary
//     goes to stdout; the synthetic cache and any temp artifacts are removed
//     on exit.
//
// Stdin contract (JSON):
//   {
//     "tool_name": "plan_call",                      // required
//     "tool_arguments": { ... },                     // required object
//     "request_meta": { ... } | null,                // optional
//     "server_url": "https://offline.invalid"        // optional override
//   }
//
// Stdout contract (JSON, single object):
//   {
//     "ok": boolean,
//     "mode": "offline-official-runtime-proof",
//     "official_runtime_imported": true,
//     "official_call_mcp_tool_executed": true,
//     "fetch_impl_injected": true,
//     "live_endpoint_accessed": false,
//     "plan_call_invocations": 1,
//     "run_call_invocations": 0,
//     "real_calls": 0,
//     "mcp_initialize_observed": boolean,
//     "mcp_initialized_notification_observed": boolean,
//     "mcp_tools_call_observed": boolean,
//     "tool_name": string,
//     "tool_arguments_reached_official_client": boolean,
//     "request_meta_reached_official_client": boolean,
//     "ready_to_run": boolean,                       // from synthetic plan_call response
//     "plan_id_present": boolean,                    // we only confirm presence
//     "confirm_token_present": boolean,              // we only confirm presence
//     "raw_response_persisted": false,
//     "capability_values_persisted": false,
//     "authorization_header_observed": boolean,      // not the value
//     "synthetic_cache_deleted": true,
//     "exit_code": 0,
//     "error": { "class": "...", "message": "..." } | null
//   }

import process from "node:process";

import {
  createTempSyntheticCache,
  PUBLIC_OFFLINE_CANARY,
} from "./synthetic_auth_cache.mjs";
import { createSyntheticFetch } from "./synthetic_mcp_fetch.mjs";

const DEFAULT_SERVER_URL = "https://offline.invalid"; // RFC reserved .invalid TLD
const DEFAULT_TIMEOUT_SECONDS = 10;
const FORBIDDEN_TOOLS = new Set([
  "run_call",
  "get_call_run",
  "track_ui_events",
]);

async function readStdin() {
  let chunks = "";
  for await (const chunk of process.stdin) chunks += chunk;
  return chunks;
}

function emit(out) {
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function errorResult(className, message, extra) {
  return {
    ok: false,
    mode: "offline-official-runtime-proof",
    error: { class: className, message },
    exit_code: 0,
    ...(extra || {}),
  };
}

async function main() {
  // 1. Read stdin JSON payload.
  let raw;
  try {
    raw = await readStdin();
  } catch (e) {
    emit(errorResult("StdinReadError", String(e?.message || e)));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    emit(errorResult("StdinJsonError", String(e?.message || e)));
    return;
  }

  const toolName = payload?.tool_name;
  const toolArguments = payload?.tool_arguments;
  const requestMeta = payload?.request_meta ?? null;
  const serverUrl =
    typeof payload?.server_url === "string" && payload.server_url.length > 0
      ? payload.server_url
      : DEFAULT_SERVER_URL;

  if (!toolName || typeof toolName !== "string") {
    emit(errorResult("MissingToolName", "tool_name is required"));
    return;
  }
  if (FORBIDDEN_TOOLS.has(toolName)) {
    emit(
      errorResult(
        "ForbiddenTool",
        `tool_name='${toolName}' is forbidden in the public bridge (run_call / get_call_run / track_ui_events must never be invoked).`
      )
    );
    return;
  }
  if (typeof toolArguments !== "object" || toolArguments === null) {
    emit(
      errorResult(
        "MissingToolArguments",
        "tool_arguments must be a non-null object"
      )
    );
    return;
  }

  // 2. Import the official SDK (exact version pinned in package.json).
  let callMcpTool;
  try {
    const mod = await import("@call-e/core/mcp-client");
    callMcpTool = mod.callMcpTool;
    if (typeof callMcpTool !== "function") {
      emit(
        errorResult(
          "SdkShapeError",
          "@call-e/core/mcp-client did not export a callable callMcpTool"
        )
      );
      return;
    }
  } catch (e) {
    emit(
      errorResult(
        "SdkImportError",
        `Failed to import @call-e/core/mcp-client: ${
          e?.message || String(e)
        }`
      )
    );
    return;
  }

  // 3. Allocate a temporary, synthetic CALL-E auth cache document.
  let cacheCtx;
  try {
    cacheCtx = await createTempSyntheticCache({ serverUrl });
  } catch (e) {
    emit(
      errorResult(
        "SyntheticCacheError",
        `Failed to create temporary synthetic cache: ${
          e?.message || String(e)
        }`
      )
    );
    return;
  }

  // 4. Build the synthetic fetch implementation. The official SDK will only
  //    see requests that match the sentinel URL, and will receive synthesized
  //    JSON-RPC responses for initialize, notifications/initialized, and
  //    tools/call.
  const { fetchImpl, observations } = createSyntheticFetch({
    serverUrl,
    expectedAuthCanary: PUBLIC_OFFLINE_CANARY,
  });

  // 5. Construct the minimal official config. cacheRoot points at the
  //    private temp dir; serverUrl is the RFC-reserved sentinel; timeout
  //    is short and finite; client metadata is the public canary name.
  const config = {
    cacheRoot: cacheCtx.cacheRoot,
    serverUrl,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    mcpClientName: "parcelbridge-public-reference",
    mcpClientVersion: "0.1.0-public-ref",
    integrationHeader: "parcelbridge-public-reference",
  };

  // 6. Invoke the official SDK in-process with the injected synthetic fetch.
  let response;
  try {
    response = await callMcpTool({
      config,
      toolName,
      toolArguments,
      requestMeta,
      fetchImpl,
    });
  } catch (e) {
    await cacheCtx.cleanup();
    emit(
      errorResult(
        e?.constructor?.name || "SdkCallError",
        e?.message || String(e)
      )
    );
    return;
  }

  // 7. Remove the synthetic cache BEFORE emitting the sanitized summary.
  //    This guarantees the synthetic token document cannot outlive the run.
  let syntheticCacheDeleted = true;
  try {
    await cacheCtx.cleanup();
  } catch {
    syntheticCacheDeleted = false;
  }

  // 8. Build the sanitized summary. We never emit the canary value, the
  //    raw Authorization header, or the actual plan_id/confirm_token values.
  const result =
    response && typeof response === "object" ? response : {};

  const planIdPresent =
    typeof result.plan_id === "string" && result.plan_id.length > 0;
  const confirmTokenPresent =
    typeof result.confirm_token === "string" &&
    result.confirm_token.length > 0;
  const readyToRun = result.ready_to_run === true;

  emit({
    ok: true,
    mode: "offline-official-runtime-proof",
    transport_category: "A. OFFICIAL_PROGRAMMATIC_IN_MEMORY",
    official_runtime_imported: true,
    official_call_mcp_tool_executed: true,
    fetch_impl_injected: true,
    live_endpoint_accessed: false,
    plan_call_invocations: 1,
    run_call_invocations: 0,
    real_calls: 0,
    mcp_initialize_observed: observations.initializeObserved,
    mcp_initialized_notification_observed:
      observations.initializedNotificationObserved,
    mcp_tools_call_observed: observations.toolsCallObserved,
    tool_name: toolName,
    tool_arguments_reached_official_client:
      observations.toolArgumentsReachedOfficialClient,
    request_meta_reached_official_client:
      observations.requestMetaReachedOfficialClient,
    ready_to_run: readyToRun,
    plan_id_present: planIdPresent,
    confirm_token_present: confirmTokenPresent,
    raw_response_persisted: false,
    capability_values_persisted: false,
    authorization_header_observed: observations.authorizationHeaderPresent,
    authorization_header_length:
      observations.requests[0]?.headers_shape?.authorization_header_shape
        ?.token_length ?? 0,
    non_sentinel_url_blocked:
      observations.nonMatchingServerUrlAttempted === false
        ? true
        : !observations.nonMatchingServerUrlAttempted,
    rejected_methods: observations.rejectedMethods.slice(),
    synthetic_cache_deleted: syntheticCacheDeleted,
    exit_code: 0,
    error: null,
  });
}

main().catch(async (err) => {
  emit(
    errorResult(
      err?.constructor?.name || "UncaughtError",
      String(err?.message || err)
    )
  );
  // process.exit is intentionally avoided here: emit() already wrote a
  // newline-terminated JSON object, and the parent process can decide the
  // exit status from the JSON payload.
});