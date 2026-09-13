import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const token = "test-operator-token";
const pharmacies = [
  { name: "Demo One", phone: "+254700000001", distanceKm: 1 },
  { name: "Demo Two", phone: "+254700000002", distanceKm: 4 }
];

async function startServer(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "medroute-test-"));
  const port = 31000 + Math.floor(Math.random() * 1000);
  const operatorToken = options.token ?? token;
  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), MEDROUTE_DATA_DIR: dataDir, MEDROUTE_ACCESS_TOKEN: operatorToken, CALLE_API_KEY: options.live ? "test-key" : "", MEDROUTE_CALLE_CLIENT_MODULE: pathToFileURL(join(process.cwd(), "test", "mock-calle.js")).href, MEDROUTE_PYTHON: options.python || "python", ...(options.env || {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start")), 4_000);
    server.stdout.on("data", chunk => { if (chunk.toString().includes("MedRoute running")) { clearTimeout(timer); resolve(); } });
    server.once("error", reject);
  });
  const request = (path, init = {}) => fetch(`http://localhost:${port}${path}`, { ...init, headers: { Authorization: `Bearer ${operatorToken}`, ...(init.headers || {}) } });
  return { dataDir, port, request, async close() { server.kill(); await rm(dataDir, { recursive: true, force: true }); } };
}

function checkBody(extra = {}) {
  return { medicine: "Amoxicillin", strength: "500 mg capsules", pharmacies, consentAcknowledged: true, ...extra };
}

test("local mode permits a friction-free operator flow and rejects invalid inputs", async () => {
  const app = await startServer();
  try {
    assert.equal((await fetch(`http://localhost:${app.port}/api/history`)).status, 200);
    const missingConsent = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ consentAcknowledged: false })) });
    assert.equal(missingConsent.status, 400);
    const badPhone = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ pharmacies: [{ name: "Invalid number", phone: "0700000001" }] })) });
    assert.equal(badPhone.status, 400);
    const partlyInvalid = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ pharmacies: [...pharmacies, { name: "Invalid", phone: "+0123" }] })) });
    assert.equal(partlyInvalid.status, 400);
    const negativeDistance = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ pharmacies: [{ ...pharmacies[0], distanceKm: -1 }] })) });
    assert.equal(negativeDistance.status, 400);
    const international = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ pharmacies: [{ name: "International Demo", phone: "+12025550123", distanceKm: 2 }] })) });
    assert.equal(international.status, 200);
  } finally { await app.close(); }
});

test("malformed JSON shapes return 400 and leave the server healthy", async () => {
  const app = await startServer();
  try {
    for (const body of [null, [], "invalid", 42, true, ...[null, [], "invalid", 42].map(p => checkBody({ pharmacies: [p] }))]) {
      const response = await app.request("/api/check", { method: "POST", body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
    assert.equal((await app.request("/healthz")).status, 200);
    assert.equal((await app.request("/api/check", { method: "POST", body: JSON.stringify(checkBody()) })).status, 200);
  } finally { await app.close(); }
});

test("unexpected asynchronous request failures return 500 without crashing", async () => {
  const app = await startServer();
  try {
    await writeFile(join(app.dataDir, "medroute-history.json"), "not-json");
    const response = await app.request("/api/check", { method: "POST", body: JSON.stringify(checkBody()) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "Unexpected server error.");
    assert.equal((await app.request("/healthz")).status, 200);
  } finally { await app.close(); }
});

test("post-creation polling failures preserve the call id and cooldown", async () => {
  const app = await startServer({ live: true });
  try {
    const body = JSON.stringify(checkBody({ pharmacies: [pharmacies[1]], confirmLive: true, liveCallAcknowledged: true }));
    const request = key => app.request("/api/check", { method: "POST", headers: { "Idempotency-Key": key }, body });
    const first = await request("poll-failure-first-key");
    assert.equal(first.status, 200);
    const record = await first.json();
    assert.equal(record.results[0].callId, "call_0002");
    assert.match(record.results[0].error, /outcome could not be confirmed/);
    const replay = await request("poll-failure-first-key");
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).id, record.id);
    assert.equal((await request("poll-failure-second-key")).status, 429);
    const history = await (await app.request("/api/history")).json();
    assert.equal(history.history[0].results[0].callId, "call_0002");
  } finally { await app.close(); }
});

test("safe local demo server permits token-free simulated checks", async () => {
  const app = await startServer({ token: "" });
  try {
    assert.equal((await fetch(`http://localhost:${app.port}/api/history`)).status, 200);
    const response = await fetch(`http://localhost:${app.port}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkBody()),
    });
    assert.equal(response.status, 200);
  } finally { await app.close(); }
});

test("a live request without credentials fails explicitly and saves no demo result", async () => {
  const app = await startServer({ token: "" });
  try {
    const response = await app.request("/api/check", { method: "POST", body: JSON.stringify(checkBody({ confirmLive: true, liveCallAcknowledged: true })) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Live calling is unavailable/);
    const history = await (await app.request("/api/history")).json();
    assert.equal(history.history.length, 0);
    const demo = await app.request("/api/check", { method: "POST", body: JSON.stringify(checkBody()) });
    assert.equal(demo.status, 200);
    assert.equal((await demo.json()).mode, "demo");
  } finally { await app.close(); }
});

test("structured demo quotes preserve the requested brand and offer different comparable prices", async () => {
  const app = await startServer();
  try {
    const productRequest = { strengthValue: "500", strengthUnit: "milligrams", form: "Tablet", releaseType: "standard", brand: "Example brand" };
    const response = await app.request("/api/check", { method: "POST", body: JSON.stringify(checkBody({ productRequest, pharmacies: [{ ...pharmacies[0], distanceKm: "" }, pharmacies[1]] })) });
    assert.equal(response.status, 200);
    const record = await response.json();
    assert.equal(record.schemaVersion, 2);
    assert.deepEqual(record.productRequest, productRequest);
    assert.equal(record.results.some(item => item.distanceKm === null), true);
    assert.deepEqual(record.results.map(item => item.result.offers[0].brand), ["Example brand", "Example brand"]);
    assert.deepEqual(record.results.map(item => item.result.offers[0].price).sort((a, b) => a - b), [600, 900]);
    assert.deepEqual(record.results.map(item => item.result.offers[0].stock_status), ["in_stock", "in_stock"]);
    const history = await (await app.request("/api/history")).json();
    assert.deepEqual(history.history[0], record);
  } finally { await app.close(); }
});

test("product details participate in live request idempotency", async () => {
  const app = await startServer({ live: true });
  try {
    const productRequest = { strengthValue: "500", strengthUnit: "milligrams", form: "Tablet", releaseType: "standard", brand: "A" };
    const submit = p => app.request("/api/check", { method: "POST", headers: { "Idempotency-Key": "product-comparison-key-1" }, body: JSON.stringify(checkBody({ productRequest: p, pharmacies: [pharmacies[0]], confirmLive: true, liveCallAcknowledged: true })) });
    const first = await submit(productRequest);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).results[0].result.offers[0].price, 600);
    assert.equal((await submit(productRequest)).status, 200);
    assert.equal((await submit({ ...productRequest, brand: "B" })).status, 409);
    assert.equal((await submit({ ...productRequest, releaseType: "extended" })).status, 409);
    assert.equal((await submit({ ...productRequest, requestedQuantity: 45 })).status, 409);
    assert.equal((await submit({ ...productRequest, form: "" })).status, 400);
  } finally { await app.close(); }
});

test("requested quantities validate before calling and persist with confirmed purchase terms", async () => {
  const app = await startServer({ live: true });
  try {
    const productRequest = { strengthValue: "500", strengthUnit: "milligrams", form: "Tablet", releaseType: "standard", brand: "", requestedQuantity: 45 };
    const submit = (p, live = false) => app.request("/api/check", { method: "POST", headers: { "Idempotency-Key": "quantity-purchase-check" }, body: JSON.stringify(checkBody({ productRequest: p, pharmacies: [pharmacies[0]], confirmLive: live, liveCallAcknowledged: live })) });
    for (const requestedQuantity of [null, "45", 0, -1, 1.5, 1_000_001, true]) {
      assert.equal((await submit({ ...productRequest, requestedQuantity }, true)).status, 400);
    }
    assert.equal((await submit({ ...productRequest, form: "Injection" })).status, 400);
    assert.equal((await submit({ ...productRequest, form: "Syrup", requestedQuantity: 2.5 })).status, 200);
    const response = await submit(productRequest, true);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.deepEqual(saved.productRequest, productRequest);
    assert.equal(saved.results[0].result.offers[0].purchaseMode, "whole_pack");
    assert.equal(saved.results[0].result.offers[0].availableQuantity, 180);
    const history = await (await app.request("/api/history")).json();
    assert.deepEqual(history.history.find(r => r.id === saved.id), saved);
    assert.equal((await submit({ ...productRequest, requestedQuantity: 60 }, true)).status, 409);
  } finally { await app.close(); }
});

test("the removed demo-token endpoint is unavailable when live calling is configured", async () => {
  const app = await startServer({ live: true });
  try {
    assert.equal((await app.request("/api/demo-access", { method: "POST" })).status, 404);
    const health = await (await fetch(`http://localhost:${app.port}/healthz`)).json();
    assert.equal(health.safeDemoMode, false);
    assert.equal(health.liveCallsAvailable, true);
    assert.equal(health.requiresOperatorToken, false);
  } finally { await app.close(); }
});

test("demo checks are saved atomically and phone numbers are masked", async () => {
  const app = await startServer();
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ medicine: `Medicine ${i}` })) })));
    assert.ok(responses.every(response => response.status === 200));
    const history = await (await app.request("/api/history")).json();
    assert.equal(history.history.length, 8);
    assert.match(history.history[0].results[0].phone, /^\+254.*\d{4}$/);
    assert.doesNotMatch(history.history[0].results[0].phone, /70000000/);
  } finally { await app.close(); }
});

test("development demo reset removes only demo records", async () => {
  const app = await startServer();
  try {
    await writeFile(join(app.dataDir, "medroute-history.json"), JSON.stringify([
      { id: "run_demo", createdAt: "2026-01-01T00:00:00.000Z", mode: "demo", medicine: "Demo medicine", strength: "", results: [] },
      { id: "run_live", createdAt: "2026-01-02T00:00:00.000Z", mode: "live", medicine: "Live medicine", strength: "", results: [] },
    ]));
    const response = await app.request("/api/demo/reset", { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deleted, 1);
    const history = (await (await app.request("/api/history")).json()).history;
    assert.deepEqual(history.map((record) => record.id), ["run_live"]);
  } finally { await app.close(); }
});

test("live calls require both consents and return ranked partial failures idempotently", async () => {
  const app = await startServer({ live: true });
  try {
    const noLiveConsent = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "1234567890123456" }, body: JSON.stringify(checkBody({ confirmLive: true })) });
    assert.equal(noLiveConsent.status, 400);
    const request = () => app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "stable-live-key-123" }, body: JSON.stringify(checkBody({ confirmLive: true, liveCallAcknowledged: true })) });
    const [first, second] = await Promise.all([request(), request()]);
    const [one, two] = await Promise.all([first.json(), second.json()]);
    assert.equal(one.id, two.id);
    assert.equal(one.results.length, 2);
    assert.equal(one.results.filter(result => result.error).length, 1);
    assert.match(one.results.find(result => result.error)?.error || "", /Simulated provider failure/);
    assert.equal(one.results.find(result => result.result)?.result.pickup_readiness, "ready_today");
    assert.equal((await (await app.request("/api/history")).json()).history.length, 1);
    const mismatched = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "stable-live-key-123" }, body: JSON.stringify(checkBody({ medicine: "Different medicine", confirmLive: true, liveCallAcknowledged: true })) });
    assert.equal(mismatched.status, 409);
    const cooldown = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "another-live-key-456" }, body: JSON.stringify(checkBody({ confirmLive: true, liveCallAcknowledged: true })) });
    assert.equal(cooldown.status, 429);
  } finally { await app.close(); }
});

test("live calls preserve an incomplete provider outcome and call reference", async () => {
  const app = await startServer({ live: true });
  try {
    const response = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "incomplete-provider-call-003" },
      body: JSON.stringify(checkBody({
        pharmacies: [{ name: "Incomplete result pharmacy", phone: "+254700000003", distanceKm: 1 }],
        confirmLive: true,
        liveCallAcknowledged: true,
      })),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).results[0];
    assert.equal(result.callId, "call_0003");
    assert.match(result.error, /complete result/);
    assert.match(result.result.notes, /ended after pickup/);
    assert.equal(result.transcript.length, 1);
  } finally { await app.close(); }
});

test("live calls wait through an early incomplete provider state before saving the completed call", async () => {
  const app = await startServer({
    live: true,
    env: {
      MEDROUTE_CALLE_CLIENT_MODULE: pathToFileURL(join(process.cwd(), "test", "mock-calle-late-result.js")).href,
      MEDROUTE_CALL_RESULT_POLL_MS: "1",
      MEDROUTE_CALL_INCOMPLETE_RESULT_GRACE_MS: "1000",
    },
  });
  try {
    const response = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "late-result-call-key-1" },
      body: JSON.stringify(checkBody({
        pharmacies: [{ name: "Late result pharmacy", phone: "+254700000004", distanceKm: 1 }],
        confirmLive: true,
        liveCallAcknowledged: true,
      })),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).results[0];
    assert.equal(result.error, undefined);
    assert.equal(result.callId, "call_late_result");
    assert.equal(result.result.stock_status, "in_stock");
    assert.equal(result.transcript.length, 2);
  } finally { await app.close(); }
});

test("live calls safely retry a transient call-plan preparation failure", async () => {
  const app = await startServer({ live: true });
  try {
    const response = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "retry-call-plan-key-005" },
      body: JSON.stringify(checkBody({
        pharmacies: [{ name: "Retry pharmacy", phone: "+254700000005", distanceKm: 1 }],
        confirmLive: true,
        liveCallAcknowledged: true,
      })),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).results[0];
    assert.equal(result.error, undefined);
    assert.equal(result.callId, "call_0005");
    assert.equal(result.result.stock_status, "in_stock");
  } finally { await app.close(); }
});

test("completed phone attempts report finalizing before result extraction finishes", async () => {
  const app = await startServer({ live: true, env: {
    MEDROUTE_CALLE_CLIENT_MODULE: pathToFileURL(join(process.cwd(), "test", "mock-calle-finalizing.js")).href,
    MEDROUTE_CALL_RESULT_POLL_MS: "70", MEDROUTE_CALL_FINALIZATION_GRACE_MS: "1000",
  } });
  try {
    const headers = { "Idempotency-Key": "finalizing-progress-test" };
    const pending = app.request("/api/check", { method: "POST", headers, body: JSON.stringify(checkBody({ pharmacies: [pharmacies[0]], confirmLive: true, liveCallAcknowledged: true })) });
    let observed;
    for (let i = 0; i < 30; i++) {
      const progress = await app.request("/api/check-progress", { headers });
      if (progress.ok) {
        observed = await progress.json();
        if (observed.phases.includes("finalizing")) break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(observed.phases, ["finalizing"]);
    assert.equal((await app.request("/api/check-progress", { headers: { "Idempotency-Key": "other-check-key" } })).status, 404);
    const saved = await (await pending).json();
    assert.equal(saved.results[0].result.stock_status, "in_stock");
    assert.equal(saved.results[0].error, undefined);
    assert.deepEqual((await (await app.request("/api/check-progress", { headers })).json()).phases, ["finished"]);
  } finally { await app.close(); }
});

test("a hung task status after hangup has a bounded processing wait and retains the transcript", async () => {
  const app = await startServer({ live: true, env: {
    MEDROUTE_CALLE_CLIENT_MODULE: pathToFileURL(join(process.cwd(), "test", "mock-calle-finalizing.js")).href,
    MEDROUTE_TEST_NEVER_FINALIZES: "true", MEDROUTE_CALL_RESULT_POLL_MS: "10", MEDROUTE_CALL_FINALIZATION_GRACE_MS: "50",
  } });
  try {
    const response = await app.request("/api/check", { method: "POST", headers: { "Idempotency-Key": "bounded-finalization-test" }, body: JSON.stringify(checkBody({ pharmacies: [pharmacies[0]], confirmLive: true, liveCallAcknowledged: true })) });
    const saved = await response.json();
    assert.equal(response.status, 200);
    assert.equal(saved.results[0].callId, "call_finalizing");
    assert.equal(saved.results[0].transcript.length, 1);
    assert.match(saved.results[0].error, /complete result/);
  } finally { await app.close(); }
});

test("a call-plan failure with no call id does not consume the pharmacy cooldown", async () => {
  const app = await startServer({ live: true });
  try {
    const body = JSON.stringify(checkBody({
      pharmacies: [{ name: "Undialed pharmacy", phone: "+254700000006", distanceKm: 1 }],
      confirmLive: true,
      liveCallAcknowledged: true,
    }));
    const first = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "failed-plan-first-key-006" },
      body,
    });
    const second = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "failed-plan-second-key-006" },
      body,
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.match((await second.json()).results[0].error, /call plan could not be prepared/i);
  } finally { await app.close(); }
});

test("live checks reject duplicate pharmacy recipients", async () => {
  const app = await startServer({ live: true });
  try {
    const response = await app.request("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "duplicate-recipient-key-1" },
      body: JSON.stringify(checkBody({
        pharmacies: [pharmacies[0], { ...pharmacies[0], name: "Duplicate recipient" }],
        confirmLive: true,
        liveCallAcknowledged: true,
      })),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /distinct authorized phone number/);
  } finally { await app.close(); }
});

test("rate limits repeated availability-check requests", async () => {
  const app = await startServer({ env: { MEDROUTE_MAX_CHECKS_PER_MINUTE: "1" } });
  try {
    const request = () => app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody()) });
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429);
  } finally { await app.close(); }
});

test("atomically blocks concurrent live calls to the same pharmacy with different keys", async () => {
  const app = await startServer({ live: true });
  try {
    const body = JSON.stringify(checkBody({ pharmacies: [pharmacies[0]], confirmLive: true, liveCallAcknowledged: true }));
    const request = key => app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body });
    const responses = await Promise.all([request("concurrent-live-key-1"), request("concurrent-live-key-2")]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
  } finally { await app.close(); }
});

test("does not silently overwrite malformed local history", async () => {
  const app = await startServer();
  try {
    await writeFile(join(app.dataDir, "medroute-history.json"), "not-json");
    const response = await app.request("/api/history");
    assert.equal(response.status, 500);
  } finally { await app.close(); }
});

test("transcript generation failures return a safe error", async () => {
  const app = await startServer({ python: "missing-medroute-python" });
  try {
    await writeFile(join(app.dataDir, "medroute-history.json"), JSON.stringify([{ id: "run_123_abc123", createdAt: "2026-07-25T09:30:00.000Z", medicine: "Amoxicillin", strength: "500 mg", results: [{ pharmacy: "Demo", phone: "+254•••••0001", transcript: [{ speaker: "bot", text: "Hello." }] }] }]));
    const response = await app.request("/api/transcripts/run_123_abc123/0.pdf");
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.startsWith("Could not create transcript PDF:"), true);
  } finally { await app.close(); }
});

test("GET /healthz returns status, mode, and uptime", async () => {
  const app = await startServer();
  try {
    const response = await fetch(`http://localhost:${app.port}/healthz`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "ok");
    assert.equal(data.mode, "development");
    assert.equal(data.safeDemoMode, true);
    assert.equal(data.liveCallsAvailable, false);
    assert.equal(data.requiresOperatorToken, false);
    assert.ok(typeof data.uptime === "number");
    assert.ok(data.uptime > 0);
  } finally { await app.close(); }
});

test("GET /healthz does not require authentication", async () => {
  const app = await startServer();
  try {
    const response = await fetch(`http://localhost:${app.port}/healthz`);
    assert.equal(response.status, 200);
  } finally { await app.close(); }
});

test("GET /healthz identifies an isolated safe demo", async () => {
  const app = await startServer({ token: "" });
  try {
    const response = await fetch(`http://localhost:${app.port}/healthz`);
    const data = await response.json();
    assert.equal(data.safeDemoMode, true);
    assert.equal(data.liveCallsAvailable, false);
    assert.equal(data.requiresOperatorToken, false);
  } finally { await app.close(); }
});

test("responses include X-Request-Id header", async () => {
  const app = await startServer();
  try {
    const response = await app.request("/api/history");
    const requestId = response.headers.get("x-request-id");
    assert.ok(requestId, "X-Request-Id header should be present");
    assert.match(requestId, /^req_[a-f0-9]{8}$/);
  } finally { await app.close(); }
});

test("responses echo client-provided X-Request-Id", async () => {
  const app = await startServer();
  try {
    const response = await app.request("/api/history", {
      headers: { "X-Request-Id": "my-custom-id-123" }
    });
    assert.equal(response.headers.get("x-request-id"), "my-custom-id-123");
  } finally { await app.close(); }
});
