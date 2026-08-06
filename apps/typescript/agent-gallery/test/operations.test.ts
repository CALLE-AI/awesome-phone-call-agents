import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDurableStore } from "../api/_lib/durable-store";
import { authenticateOperator, hashOperatorAccessCodeForSetup, issueOperatorSession, operatorCanAccessSenior } from "../api/_lib/operator-auth";

const secret = "a-test-session-secret-that-is-longer-than-32-characters";

async function authEnv() {
  return {
    CARECALL_SESSION_SECRET: secret,
    CARECALL_OPERATORS_JSON: JSON.stringify([{
      id: "operator-1",
      name: "Operator One",
      role: "coordinator",
      access_code_sha256: await hashOperatorAccessCodeForSetup("correct-code"),
      senior_ids: ["senior-1"],
    }]),
  };
}

test("durable claims are atomic and return the original record", async () => {
  const store = new MemoryDurableStore();
  assert.equal(await store.claim("request-1", { state: "pending" }, 60), true);
  assert.equal(await store.claim("request-1", { state: "duplicate" }, 60), false);
  assert.deepEqual(await store.get("request-1"), { state: "pending" });
});

test("durable leases refresh and release only for their current owner", async () => {
  const store = new MemoryDurableStore();
  const owner = { job_id: "job-1" };
  assert.equal(await store.claim("active-call", owner, 60), true);
  assert.equal(await store.refreshClaim("active-call", { job_id: "job-2" }, 60), false);
  assert.equal(await store.refreshClaim("active-call", owner, 60), true);
  assert.equal(await store.releaseClaim("active-call", { job_id: "job-2" }), false);
  assert.equal(await store.releaseClaim("active-call", owner), true);
  assert.equal(await store.get("active-call"), null);
});

test("durable counters and indexes survive separate operations", async () => {
  const store = new MemoryDurableStore();
  assert.equal(await store.increment("daily", 60), 1);
  assert.equal(await store.increment("daily", 60), 2);
  await store.addToIndex("cases", 1, "older");
  await store.addToIndex("cases", 2, "newer");
  assert.deepEqual(await store.readIndex("cases"), ["newer", "older"]);
});

test("operator sessions are signed, expiring, and senior-scoped", async () => {
  const env = await authEnv();
  const now = Date.parse("2026-08-06T10:00:00Z");
  const token = await issueOperatorSession("operator-1", "correct-code", env, now);
  assert.ok(token);
  const request = new Request("https://app.invalid", { headers: { authorization: `Bearer ${token}` } });
  const session = await authenticateOperator(request, env, now + 1000);
  assert.ok(session);
  assert.equal(operatorCanAccessSenior(session, "senior-1"), true);
  assert.equal(operatorCanAccessSenior(session, "senior-2"), false);
  assert.equal(await authenticateOperator(request, env, now + 31 * 60_000), null);
});

test("wrong codes and tampered sessions fail closed", async () => {
  const env = await authEnv();
  assert.equal(await issueOperatorSession("operator-1", "wrong-code", env), null);
  const token = await issueOperatorSession("operator-1", "correct-code", env);
  assert.ok(token);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  const request = new Request("https://app.invalid", { headers: { authorization: `Bearer ${tampered}` } });
  assert.equal(await authenticateOperator(request, env), null);
});
