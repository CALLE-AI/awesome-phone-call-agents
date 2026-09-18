#!/usr/bin/env node
// =============================================================================
// scripts/validate_official_runtime.mjs
// =============================================================================
//
// Pre-flight check for the ParcelBridge public-bridge offline official
// @call-e/core runtime proof. Confirms that:
//   * Node.js >= 22 is in use.
//   * @call-e/core is installed at the exact pinned version (0.2.3).
//   * `@call-e/core/mcp-client` exports a callable `callMcpTool` function.
//
// This script does NOT execute the synthetic plan_call. It only verifies
// the runtime shape so reviewers can `npm run validate` before running
// the full demo.
//
// Exit code: 0 on success, non-zero on any failure.

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fail(message) {
  process.stderr.write(`validate: FAIL — ${message}\n`);
  process.exit(1);
}

function info(message) {
  process.stdout.write(`validate: ${message}\n`);
}

// 1. Node engine check.
const major = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(major) || major < 22) {
  fail(
    `Node >= 22 required (process.versions.node = ${process.versions.node}).`
  );
}
info(`Node ${process.versions.node} OK.`);

// 2. node_modules presence + exact-pinned @call-e/core version.
const bridgeRoot = path.join(__dirname, "..");
const nodeModules = path.join(bridgeRoot, "node_modules");
const calleCorePkg = path.join(
  nodeModules,
  "@call-e",
  "core",
  "package.json"
);

if (!fs.existsSync(nodeModules)) {
  fail(
    "node_modules is missing. Run `npm ci` (or `npm install`) inside the bridge/ directory first."
  );
}
if (!fs.existsSync(calleCorePkg)) {
  fail(
    "node_modules/@call-e/core/package.json is missing. The exact-pin @call-e/core@0.2.3 dependency was not installed."
  );
}
const calleCorePkgJson = JSON.parse(fs.readFileSync(calleCorePkg, "utf8"));
if (calleCorePkgJson.name !== "@call-e/core") {
  fail(
    `Unexpected package name: ${calleCorePkgJson.name} (expected @call-e/core).`
  );
}
if (calleCorePkgJson.version !== "0.2.3") {
  fail(
    `Unexpected @call-e/core version: ${calleCorePkgJson.version} (expected exact pin 0.2.3).`
  );
}
info(`@call-e/core@${calleCorePkgJson.version} OK (exact pin).`);

// 3. callMcpTool export shape check.
let mod;
try {
  mod = await import("@call-e/core/mcp-client");
} catch (e) {
  fail(
    `Failed to import @call-e/core/mcp-client: ${e?.message || String(e)}`
  );
}
if (typeof mod.callMcpTool !== "function") {
  fail("@call-e/core/mcp-client did not export a callable callMcpTool.");
}
info("callMcpTool is exported and callable.");

// 4. package.json scripts present.
const selfPkgPath = path.join(bridgeRoot, "package.json");
const selfPkg = JSON.parse(fs.readFileSync(selfPkgPath, "utf8"));
const expectedScripts = ["demo:official-runtime-offline", "validate", "test"];
for (const name of expectedScripts) {
  if (!selfPkg.scripts || typeof selfPkg.scripts[name] !== "string") {
    fail(`package.json is missing the "${name}" script.`);
  }
}
info("package.json scripts present.");

process.stdout.write("validate: PASS\n");
process.exit(0);