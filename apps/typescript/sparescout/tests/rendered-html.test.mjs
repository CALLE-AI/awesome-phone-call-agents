import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the SpareScout sourcing experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SpareScout/);
  assert.match(html, /The right part/);
  assert.match(html, /Review supplier call plan/);
  assert.match(html, /Safe demo mode/);
  assert.match(html, /No phone calls or reservations will be made/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders every public product page with shared navigation", async () => {
  const pages = [
    ["/about", /The inventory exists/],
    ["/how-it-works", /From repeated calls/],
    ["/markets", /Global-ready means precise/],
    ["/safety", /real-world side effect/],
    ["/privacy", /does not infer consent/],
    ["/pilot", /Every attempt stays visible/],
    ["/history", /Your sourcing ledger/],
  ];

  for (const [path, expected] of pages) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, expected, path);
    assert.match(html, /How it works/, path);
    assert.match(html, /Privacy/, path);
    assert.match(html, /Try the demo/, path);
    assert.match(html, /aria-label="Mobile navigation"/, path);
    assert.match(html, /Global pilot/, path);
  }
});

test("keeps real-world side effects behind authenticated, recipient-bound approval", async () => {
  const [page, layout, packageJson, planRoute, executeRoute, runtime, liveSecurity, approval, provider, historyRoute, statusRoute, historyLedger, sourcingDatabase] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/plan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/execute/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/live-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/calle/approval.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/calle/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sourcing/requests/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/status/[requestId]/[callId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/history/history-ledger.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/sourcing.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Approve 3 demo calls/);
  assert.match(page, /A separate approval is always required before a reservation call/);
  assert.match(page, /Payment, purchase, and reservation are blocked/);
  assert.match(page, /no supplier was contacted and nothing was reserved/i);
  assert.doesNotMatch(page, /run_call|call start|confirm_token/);
  assert.match(layout, /SpareScout — Phone-powered parts sourcing/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(planRoute, /input\.executionMode === "live" && !getCalleCapabilities\(\)\.liveAvailable/);
  assert.match(planRoute, /status: 503/);
  assert.ok(planRoute.indexOf("getCalleCapabilities().liveAvailable") < planRoute.indexOf("await savePlannedRequest("));
  assert.match(planRoute, /isAuthorizedLiveOperator/);
  assert.match(planRoute, /assertAuthorizedLiveRecipients/);
  assert.match(executeRoute, /isAuthorizedLiveOperator/);
  assert.match(executeRoute, /getStoredSourcingCallPlan/);
  assert.match(executeRoute, /assertAuthorizedLiveRecipients/);
  assert.match(liveSecurity, /SPARESCOUT_OPERATOR_TOKEN/);
  assert.match(liveSecurity, /SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST/);
  assert.match(approval, /phone: "\[server-held\]"/);
  assert.doesNotMatch(runtime, /CALLE_BASE_URL/);
  assert.match(provider, /OFFICIAL_CALLE_ORIGIN = "https:\/\/api\.heycall-e\.com"/);
  assert.match(provider, /safeCalleBaseUrl/);
  assert.match(historyRoute, /authorization/);
  assert.match(historyRoute, /hashHistoryAccessToken/);
  assert.match(statusRoute, /authorization/);
  assert.match(statusRoute, /hashHistoryAccessToken/);
  assert.doesNotMatch(statusRoute, /calls\.create|executeSourcingPlan/);
  assert.match(historyRoute, /export async function DELETE/);
  assert.match(historyRoute, /deleteSourcingRequest\(id, await hashHistoryAccessToken\(token\)\)/);
  assert.match(historyLedger, /Permanently delete this request/);
  assert.match(historyLedger, /Delete durable record/);
  assert.match(sourcingDatabase, /DELETE FROM webhook_events/);
  assert.match(sourcingDatabase, /DELETE FROM sourcing_requests WHERE id = \? AND history_access_hash = \?/);
});
