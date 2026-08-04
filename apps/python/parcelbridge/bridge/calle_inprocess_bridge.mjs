// =============================================================================
// calle_inprocess_bridge.mjs
// =============================================================================
//
// INTEGRATION-PATTERN DOCUMENTATION, NOT VENDORED RUNTIME CODE.
//
// This file documents how a Node-based CALL-E bridge would wire
// into the ParcelBridge Python reference app. The reference app
// ships **only** an offline synthetic MCP interceptor; this
// .mjs file shows where a real integrator would insert a Node
// entry point that calls the upstream SDK's MCP envelope.
//
// The file is shipped as a comment-only stub. It contains no
// imports, no network calls, no subprocess invocations. A
// reviewer reading this file should understand exactly one
// thing: how the Python CLI's `demo` and `validate`
// subcommands could be exercised from a Node bridge in a real
// integration that this reference app does NOT provide.
//
// Why this is documentation and not runtime code:
//
//   * The ParcelBridge reference app's hard rule is that the
//     default mode is offline-fake / no-call. A Node entry
//     point that imports the upstream SDK would break that
//     rule if exercised at runtime.
//
//   * The integrator who wants live wiring is expected to
//     fork this stub, replace the comments with the upstream
//     SDK's MCP envelope, and submit a follow-up PR. That
//     follow-up PR is explicitly outside the scope of the
//     public bundle.
//
//   * Even if the upstream SDK is Node-native, the reference
//     app does NOT vendor it. Vendoring the SDK is forbidden
//     by the bundle's `docs/DISCLOSURE.md`.
//
// =============================================================================

// Conceptual shape:
//
//   import { spawn } from "node:child_process";
//   import { realMcpClient } from "<upstream-sdk>";
//
//   export async function callPlanFromNode(payload) {
//     // 1. The Node side would call realMcpClient.planCall(...).
//     //    That call is NOT made in the reference bundle.
//     //    The placeholder below is intentionally a no-op so
//     //    this file can be parsed without error.
//     return await realMcpClient.planCall(payload);
//   }
//
//   export async function runCallFromNode(payload) {
//     // 2. The Node side would call realMcpClient.runCall(...).
//     //    This call is forbidden in the reference bundle.
//     //    The line below is intentionally commented out.
//     //    return await realMcpClient.runCall(payload);
//     throw new Error("run_call is disabled in ParcelBridge");
//   }
//
// =============================================================================
// INTEGRATION CONTRACT (what an integrator fork would have to do)
// =============================================================================
//
// 1. Replace the `realMcpClient` import with the actual upstream
//    SDK import path. The exact name and module path depend on
//    the upstream SDK version and must be confirmed against the
//    upstream release notes.
//
// 2. The Node bridge must NEVER spawn a Python subprocess that
//    passes phone numbers, OAuth tokens, plan IDs, confirm
//    tokens, or run IDs. The Python CLI's `policy` module
//    rejects any argv that contains a banned substring; the
//    Node bridge must enforce the same constraint before
//    invoking the CLI.
//
// 3. The Node bridge must NOT spawn the Python CLI with a
//    `--run-call` flag or any other dial-path flag. The
//    reference app's CLI does NOT have such a flag by design;
//    the Node bridge must not add one.
//
// 4. The Node bridge must surface the upstream SDK's
//    response to the Python CLI through the inline fake MCP
//    server's `call_plan` method, not through any
//    subprocess pipe. The fake MCP server is in-process; a
//    subprocess pipe would imply a persistent Python
//    interpreter, which is forbidden by the bundle's
//    "no persistent state change" invariant.
//
// 5. The Node bridge must be hermetic: no writes to the user's
//    HOME, no reads of the OAuth cache, no writes to
//    `~/.config` or `~/.local/share`. The defensive test
//    suite's `test_defensive_invariants.py` enforces this
//    invariant from the Python side; the Node bridge must
//    enforce it from the Node side as well.
//
// =============================================================================
// DO NOT IMPORT THIS FILE
// =============================================================================
//
// This file is a documentation stub. The Python package
// (`parcelbridge.bridge.calle_inprocess_bridge`) does not
// load it. If you fork this bundle and wire a Node bridge,
// delete this documentation block and replace the contents
// with your integration. The reference bundle will reject
// any import of this file at runtime.
//
// =============================================================================

export const __parcelbridge_bridge_doc_stub__ = Object.freeze({
  status: "documentation_only",
  runtime: false,
  network: false,
  subprocess: false,
  upstream_sdk_imported: false,
});