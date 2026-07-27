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
  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), MEDROUTE_DATA_DIR: dataDir, MEDROUTE_ACCESS_TOKEN: token, CALLE_API_KEY: options.live ? "test-key" : "", MEDROUTE_CALLE_CLIENT_MODULE: pathToFileURL(join(process.cwd(), "test", "mock-calle.js")).href, MEDROUTE_PYTHON: options.python || "python" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start")), 4_000);
    server.stdout.on("data", chunk => { if (chunk.toString().includes("MedRoute running")) { clearTimeout(timer); resolve(); } });
    server.once("error", reject);
  });
  const request = (path, init = {}) => fetch(`http://localhost:${port}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  return { dataDir, port, request, async close() { server.kill(); await rm(dataDir, { recursive: true, force: true }); } };
}

function checkBody(extra = {}) {
  return { medicine: "Amoxicillin", strength: "500 mg capsules", pharmacies, consentAcknowledged: true, ...extra };
}

test("rejects unauthenticated API access and invalid check inputs", async () => {
  const app = await startServer();
  try {
    assert.equal((await fetch(`http://localhost:${app.port}/api/history`)).status, 401);
    const missingConsent = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ consentAcknowledged: false })) });
    assert.equal(missingConsent.status, 400);
    const badPhone = await app.request("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkBody({ pharmacies: [{ name: "Outside Kenya", phone: "+15550101001" }] })) });
    assert.equal(badPhone.status, 400);
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
    assert.equal((await (await app.request("/api/history")).json()).history.length, 1);
  } finally { await app.close(); }
});

test("transcript generation failures return a safe error", async () => {
  const app = await startServer({ python: "missing-medroute-python" });
  try {
    await writeFile(join(app.dataDir, "medroute-history.json"), JSON.stringify([{ id: "run_123", createdAt: "2026-07-25T09:30:00.000Z", medicine: "Amoxicillin", strength: "500 mg", results: [{ pharmacy: "Demo", phone: "+254•••••0001", transcript: [{ speaker: "bot", text: "Hello." }] }] }]));
    const response = await app.request("/api/transcripts/run_123/0.pdf");
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.startsWith("Could not create transcript PDF:"), true);
  } finally { await app.close(); }
});
