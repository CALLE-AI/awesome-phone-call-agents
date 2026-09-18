#!/usr/bin/env node
// =============================================================================
// scripts/run_official_runtime_offline.mjs
// =============================================================================
//
// Human-runnable demo for the ParcelBridge public-bridge offline official
// @call-e/core runtime proof. Wraps `calle_inprocess_bridge.mjs` with a
// fictional business payload so a reviewer can `npm run
// demo:official-runtime-offline` and observe the runtime outcomes without
// typing JSON on stdin.
//
// Usage:
//   npm run demo:official-runtime-offline
//   # or directly:
//   node ./scripts/run_official_runtime_offline.mjs
//
// Exit code: 0 on success, 1 if the bridge reports ok=false.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRIDGE_PATH = path.join(__dirname, "..", "calle_inprocess_bridge.mjs");

const payload = {
  tool_name: "plan_call",
  tool_arguments: {
    // All values are FICTIONAL. The public bundle never carries real phone
    // numbers, real OAuth tokens, real plan IDs, real confirm tokens, or
    // real run IDs.
    user_input:
      "Parcel arrived at building access, recipient not on site, hold for pickup.",
    goal: "Coordinate a delivery exception (recipient unavailable).",
    to_phones: ["fictional-recipient"],
    language: "en-US",
    ttl_seconds: 1800,
  },
  request_meta: {
    "openai/userLocation": { country: "US", city: "Seattle" },
  },
  server_url: "https://offline.invalid",
};

const child = spawn(
  process.execPath,
  [BRIDGE_PATH],
  {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      // Bridge must NEVER see real OAuth tokens. Provide an explicit empty
      // env so reviewers can prove no CALL_E_TOKEN-shaped value is read.
      PATH: process.env.PATH || "",
      NODE_ENV: process.env.NODE_ENV || "",
    },
  }
);

let stdoutBuf = "";
child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk.toString("utf8");
});
child.on("error", (err) => {
  process.stderr.write(
    `Failed to spawn calle_inprocess_bridge.mjs: ${err.message}\n`
  );
  process.exit(1);
});
child.on("close", (code) => {
  let result;
  try {
    result = JSON.parse(stdoutBuf.trim());
  } catch (e) {
    process.stderr.write(
      `Bridge stdout was not valid JSON: ${e?.message || e}\nRaw: ${stdoutBuf}\n`
    );
    process.exit(1);
  }
  // Pretty-print the outcome summary in a way a reviewer can eyeball.
  const summary = {
    ok: result.ok,
    mode: result.mode,
    official_runtime_imported: result.official_runtime_imported,
    official_call_mcp_tool_executed: result.official_call_mcp_tool_executed,
    fetch_impl_injected: result.fetch_impl_injected,
    live_endpoint_accessed: result.live_endpoint_accessed,
    plan_call_invocations: result.plan_call_invocations,
    run_call_invocations: result.run_call_invocations,
    real_calls: result.real_calls,
    mcp_initialize_observed: result.mcp_initialize_observed,
    mcp_initialized_notification_observed:
      result.mcp_initialized_notification_observed,
    mcp_tools_call_observed: result.mcp_tools_call_observed,
    tool_name: result.tool_name,
    ready_to_run: result.ready_to_run,
    plan_id_present: result.plan_id_present,
    confirm_token_present: result.confirm_token_present,
    raw_response_persisted: result.raw_response_persisted,
    capability_values_persisted: result.capability_values_persisted,
    synthetic_cache_deleted: result.synthetic_cache_deleted,
    error: result.error,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (code !== 0 || !result.ok) {
    process.exit(1);
  }
  process.exit(0);
});

child.stdin.write(JSON.stringify(payload));
child.stdin.end();