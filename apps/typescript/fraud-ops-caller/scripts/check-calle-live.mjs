#!/usr/bin/env node
import "./register-server-only-stub.mjs";
import http from "node:http";
import Module from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// ponytail: tsx@4.19.3 CJS-resolves @call-e/calle and hits the ESM-only
// exports map. Point the specifier at the published dist file.
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
      idem: req.headers["idempotency-key"] ?? "",
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "call_capture_1",
        status: "completed",
        recording_id: "rec_capture",
        recipient_result: {
          disposition: "uploading_now",
          quotes: ["ok"],
          next_action: "watch",
        },
      })
    );
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
process.env.CALLE_API_KEY = "test_key";
process.env.CALLE_BASE_URL = `http://127.0.0.1:${port}`;
process.env.CALLE_LIVE_CALLS_ENABLED = "true";

const { placeLiveCall, assertCalleBaseUrl } = await import(
  pathToFileURL(fileURLToPath(new URL("../src/lib/calle-live.ts", import.meta.url))).href
);

assertCalleBaseUrl(process.env.CALLE_BASE_URL);

const { getCase } = await import(
  pathToFileURL(fileURLToPath(new URL("../src/lib/cases.ts", import.meta.url))).href
);
const { buildCallPlan } = await import(
  pathToFileURL(fileURLToPath(new URL("../src/lib/plan.ts", import.meta.url))).href
);

const fraudCase = getCase("case_demo_kyc_001");
const plan = await buildCallPlan(fraudCase);
await placeLiveCall(fraudCase, plan);
server.close();

const post = seen.find((s) => s.method === "POST" && /v1\/calls/.test(s.url ?? ""));
if (!post) {
  console.error("check-calle-live failed: no POST /v1/calls", seen);
  process.exit(1);
}
if (!String(post.auth).includes("test_key") && !String(post.auth).startsWith("Bearer ")) {
  console.error("check-calle-live failed: missing Authorization", post);
  process.exit(1);
}
if (!post.idem) {
  console.error("check-calle-live failed: missing Idempotency-Key", post);
  process.exit(1);
}
console.log("ok: live SDK posted /v1/calls with auth + idempotency");
