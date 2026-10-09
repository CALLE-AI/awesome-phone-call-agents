import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { spawn } from "node:child_process";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { actorFromClaims } from "../authorization.js";

test("production startup requires a private recipient hash key", async () => {
  const server = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      MEDROUTE_ENV: "production",
      DATABASE_URL: "mock://database",
      MEDROUTE_OIDC_ISSUER: "https://issuer.example",
      MEDROUTE_OIDC_AUDIENCE: "medroute-test",
      MEDROUTE_OIDC_JWKS_URL: "https://issuer.example/jwks",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Production server did not exit")), 4_000);
    server.once("exit", (code) => { clearTimeout(timer); resolve(code); });
    server.once("error", reject);
  });
  assert.notEqual(exitCode, 0);
  assert.match(Buffer.concat(stderr).toString("utf8"), /MEDROUTE_RECIPIENT_HASH_KEY/);
});

test("production HTTP routes require subject and explicit read/live permissions", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const jwks = createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise(resolve => jwks.listen(0, "127.0.0.1", resolve));
  const jwksAddress = jwks.address();
  const issuer = `http://127.0.0.1:${jwksAddress.port}`;
  const audience = "medroute-test";
  const pendingKey = "other-worker-pending-key";
  const actor = actorFromClaims({ sub: "operator-1" }, issuer);
  const storedPendingKey = createHash("sha256").update(`${actor.subject}:${pendingKey}`).digest("hex");
  const port = 32000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      MEDROUTE_ENV: "production",
      DATABASE_URL: "mock://database",
      MEDROUTE_OIDC_ISSUER: issuer,
      MEDROUTE_OIDC_AUDIENCE: audience,
      MEDROUTE_OIDC_JWKS_URL: `${issuer}/.well-known/jwks.json`,
      MEDROUTE_RECIPIENT_HASH_KEY: "0123456789abcdef0123456789abcdef",
      MEDROUTE_PRODUCTION_STORE_MODULE: pathToFileURL(join(process.cwd(), "test", "mock-production-store.js")).href,
      MEDROUTE_TEST_PENDING_KEY: storedPendingKey,
      MEDROUTE_CALLE_CLIENT_MODULE: pathToFileURL(join(process.cwd(), "test", "mock-calle.js")).href,
      CALLE_API_KEY: "test-key"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Production test server did not start")), 5_000);
    server.stdout.on("data", chunk => { if (chunk.toString().includes("MedRoute running")) { clearTimeout(timer); resolve(); } });
    server.once("error", reject);
  });
  const token = claims => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const request = async (path, accessToken, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) } });
  try {
    const missingSubject = await token({ scope: "medroute.read" });
    assert.equal((await request("/api/history", missingSubject)).status, 401);
    const noPermissions = await token({ sub: "operator-1" });
    assert.equal((await request("/api/history", noPermissions)).status, 403);
    assert.equal((await request("/api/check-progress", noPermissions)).status, 403);
    const readOnly = await token({ sub: "operator-1", scope: "medroute.read" });
    assert.equal((await request("/api/history", readOnly)).status, 200);
    const body = JSON.stringify({ medicine: "Amoxicillin", pharmacies: [{ name: "Demo", phone: "+254700000001", distanceKm: 1 }], consentAcknowledged: true, confirmLive: true, liveCallAcknowledged: true });
    assert.equal((await request("/api/check", readOnly, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "production-auth-key-1" }, body })).status, 403);
    const liveOnly = await token({ sub: "operator-1", roles: ["medroute.live"] });
    // A reservation owned by another worker must survive both same-payload
    // retries and fingerprint conflicts, including subsequent retries.
    const pendingRequest = payload => request("/api/check", liveOnly, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pendingKey }, body: payload });
    for (const payload of [body, body, JSON.stringify({ ...JSON.parse(body), medicine: "Different" }), body]) {
      assert.equal((await pendingRequest(payload)).status, 409);
    }
    assert.equal((await request("/api/check", liveOnly, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "production-auth-key-2" }, body })).status, 200);
    const progressHeaders = { "Idempotency-Key": "production-auth-key-2" };
    assert.equal((await request("/api/check-progress", readOnly, { headers: progressHeaders })).status, 200);
    assert.equal((await request("/api/check-progress", liveOnly, { headers: progressHeaders })).status, 200);
    const otherReader = await token({ sub: "operator-2", scope: "medroute.read" });
    assert.equal((await request("/api/check-progress", otherReader, { headers: progressHeaders })).status, 404);
    // A reservation this request owns is released when a cooldown prevents
    // any call, allowing that key to be used for an eligible recipient.
    const ownedRequest = payload => request("/api/check", liveOnly, { method: "POST", headers: { "Idempotency-Key": "owned-cooldown-retry-key" }, body: payload });
    assert.equal((await ownedRequest(body)).status, 429);
    const otherBody = JSON.stringify({ ...JSON.parse(body), pharmacies: [{ name: "Other", phone: "+254700000003", distanceKm: 1 }] });
    assert.equal((await ownedRequest(otherBody)).status, 200);
  } finally {
    server.kill();
    await new Promise(resolve => jwks.close(resolve));
  }
});
