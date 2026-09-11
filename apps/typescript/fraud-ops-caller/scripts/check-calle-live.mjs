#!/usr/bin/env node
import "./register-server-only-stub.mjs";
import http from "node:http";
import Module from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// ponytail: tsx CJS-resolves @call-e/calle and hits the ESM-only exports map.
const calleDist = fileURLToPath(
  new URL("../node_modules/@call-e/calle/dist/index.js", import.meta.url)
);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...args) {
  if (request === "@call-e/calle") return calleDist;
  return originalResolveFilename.call(this, request, ...args);
};

const seen = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    seen.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization ?? "",
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const { assertCalleBaseUrl, CALLE_PRODUCTION_ORIGIN } = await import(
  pathToFileURL(fileURLToPath(new URL("../src/lib/calle-origin.ts", import.meta.url))).href
);

let rejectedLocal = false;
try {
  assertCalleBaseUrl(`http://127.0.0.1:${port}`);
} catch {
  rejectedLocal = true;
}
if (!rejectedLocal) {
  console.error("check-calle-live failed: localhost must be rejected");
  server.close();
  process.exit(1);
}

let rejectedArbitrary = false;
try {
  assertCalleBaseUrl("https://evil.example");
} catch {
  rejectedArbitrary = true;
}
if (!rejectedArbitrary) {
  console.error("check-calle-live failed: arbitrary https must be rejected");
  server.close();
  process.exit(1);
}

assertCalleBaseUrl(CALLE_PRODUCTION_ORIGIN);

process.env.CALLE_API_KEY = "test_key_must_not_leave_host";
process.env.CALLE_BASE_URL = `http://127.0.0.1:${port}`;
process.env.CALLE_LIVE_CALLS_ENABLED = "true";

const { getCase } = await import(
  pathToFileURL(fileURLToPath(new URL("../src/lib/cases.ts", import.meta.url))).href
);
const { buildCallPlan } = await import(
  pathToFileURL(fileURLToPath(new URL("../src/lib/plan.ts", import.meta.url))).href
);
const { placeLiveCall } = await import(
  pathToFileURL(fileURLToPath(new URL("../src/lib/calle-live.ts", import.meta.url))).href
);

const fraudCase = getCase("case_demo_kyc_001");
const plan = await buildCallPlan(fraudCase);
let threw = false;
try {
  await placeLiveCall(fraudCase, plan);
} catch {
  threw = true;
}
server.close();

if (!threw) {
  console.error("check-calle-live failed: local origin must fail closed");
  process.exit(1);
}
if (seen.length) {
  console.error("check-calle-live failed: API key was sent off the allowlist", seen);
  process.exit(1);
}
console.log("ok: CALLE_API_KEY stays pinned to HTTPS production origin");
