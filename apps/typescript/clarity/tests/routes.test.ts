import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import application from "../fixtures/demo-application.json" with { type: "json" };
import clarifications from "../fixtures/demo-clarifications.json" with { type: "json" };
import type { Clarification } from "../lib/types";

const project = process.cwd();
const sandbox = await fs.mkdtemp(path.join(tmpdir(), "clarity-routes-"));
await fs.cp(path.join(project, "fixtures"), path.join(sandbox, "fixtures"), {
  recursive: true, filter: (source) => !source.endsWith("golden-run.json"),
});
process.chdir(sandbox);
const { POST: analyze } = await import("../app/api/analyze/route");
const { POST: call } = await import("../app/api/call/route");
const { POST: authorize } = await import("../app/api/call/authorize/route");
const { POST: reconcile } = await import("../app/api/call/reconcile/route");
const { GET: status } = await import("../app/api/call/[id]/route");
const { GET: debug } = await import("../app/api/debug/route");
const { GET: example } = await import("../app/api/example/route");
const { POST: webhook } = await import("../app/api/calle/webhook/route");
const { createSession, getSession, updateSession } = await import("../lib/session");
const { operatorId } = await import("../lib/auth");
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const TOKEN = "test-operator-credential-32-characters-long";
const WEBHOOK = "test-webhook-credential-32-characters-long";
const PHONE = "+12025550100";
const requests: Request[] = [];
const providerCalls = new Map<string, Record<string, unknown>>();
let nextPhone = 100;

beforeEach(() => {
  process.env.DEMO_MODE = "live";
  process.env.CLARITY_AUTH_TOKEN = TOKEN;
  process.env.CLARITY_ORIGIN = "https://clarity.example";
  process.env.CLARITY_WEBHOOK_SECRET = WEBHOOK;
  process.env.CALLE_API_KEY = "fake-provider-key";
  delete process.env.CALLE_BASE_URL;
  requests.length = 0;
  globalThis.fetch = async (input) => {
    const request = input as Request;
    requests.push(request.clone());
    if (request.method === "POST") {
      const payload = await request.json();
      const result = wireCall(payload.metadata.session_id, payload.recipients[0]);
      providerCalls.set(result.id, result);
      return Response.json(result, { status: 201 });
    }
    const id = request.url.split("/").at(-1)!;
    return providerCalls.has(id) ? Response.json(providerCalls.get(id)) : Response.json({}, { status: 404 });
  };
});

afterEach(() => { mock.restoreAll(); });
after(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(project);
  for (const key of ["DEMO_MODE", "CLARITY_ORIGIN", "CLARITY_AUTH_TOKEN", "CLARITY_WEBHOOK_SECRET", "CALLE_API_KEY", "CALLE_BASE_URL"]) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
  await fs.rm(sandbox, { recursive: true, force: true });
});

function request(body?: unknown, headers: Record<string, string> = {}, authenticated = true) {
  return new Request("https://clarity.example/api", {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(authenticated ? { authorization: `Basic ${Buffer.from(`clarity:${TOKEN}`).toString("base64")}` } : {}), "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function hook(body: unknown, secret = WEBHOOK) {
  return request(body, { authorization: `Bearer ${secret}` }, false);
}
function wireCall(sessionId: string, recipient = { phones: [PHONE], region: "US", locale: "en" }) {
  return {
    id: `call_${sessionId}`, object: "call_task", status: "queued", task: "Test", metadata: { app: "clarity", session_id: sessionId },
    recipients: [{ id: "recipient_test", ...recipient, status: "pending", attempts: [] }], created_at: new Date().toISOString(),
  };
}
async function liveSession(phone = `+12025550${String(nextPhone++).padStart(3, "0")}`) {
  const session = await createSession({ application: { ...application, candidatePhone: PHONE }, clarifications: clarifications as Clarification[], ownerId: operatorId() });
  return { session, phone };
}
async function consented(phone?: string) {
  const result = await liveSession(phone);
  const response = await authorize(request({ sessionId: result.session.id, phone: result.phone, consent: true }));
  assert.equal(response.status, 200, await response.clone().text());
  return result;
}
function poll(id: string, authenticated = true) { return status(request(undefined, {}, authenticated), { params: Promise.resolve({ id }) }); }

test("every app data route rejects unauthenticated and forged-host requests before network access", async () => {
  const postRoutes = [analyze, call, authorize, reconcile];
  for (const handler of postRoutes) {
    for (const headers of [{}, { host: "localhost", "x-forwarded-host": "localhost", "x-forwarded-for": "127.0.0.1", authorization: "Bearer wrong" }]) {
      assert.equal((await handler(request({}, headers as Record<string, string>, false))).status, 401);
    }
  }
  assert.equal((await poll("anything", false)).status, 401);
  assert.equal((await debug(request(undefined, {}, false))).status, 401);
  assert.equal((await example(request(undefined, {}, false))).status, 401);
  assert.equal(requests.length, 0);
});

test("missing or weak server authentication fails closed even for replay", async () => {
  process.env.DEMO_MODE = "replay";
  for (const token of ["", "short"]) {
    process.env.CLARITY_AUTH_TOKEN = token;
    assert.equal((await analyze(request(application))).status, 503);
    assert.equal((await poll("anything")).status, 503);
  }
  assert.equal(requests.length, 0);
});

test("authenticated browser mutations reject cross-origin requests", async () => {
  const cases: Record<string, string>[] = [{ origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }, { origin: "null" }];
  for (const headers of cases) {
    assert.equal((await call(request({}, headers as Record<string, string>))).status, 403);
  }
  assert.equal(requests.length, 0);
});

test("analysis never selects a resume, answer, browser or environment phone", async () => {
  process.env.DEMO_MODE = "replay";
  const response = await analyze(request({ ...application, resume: `${application.resume}\nPhone: ${PHONE}\nEmployer: +442079460100`, candidatePhone: PHONE }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.candidatePhone, null);
  const stored = await getSession(result.sessionId);
  assert.equal(stored?.application.candidatePhone, undefined);
  assert.equal(stored?.authorization, undefined);
  assert.equal(stored?.ownerId, operatorId());
});

test("a replay works without a recipient and repeat requests reuse its call", async () => {
  process.env.DEMO_MODE = "replay";
  const analyzed = await (await analyze(request(application))).json();
  assert.equal((await call(request({ sessionId: analyzed.sessionId }))).status, 200);
  assert.equal((await (await call(request({ sessionId: analyzed.sessionId }))).json()).alreadyPlaced, true);
  assert.equal((await poll(analyzed.sessionId)).status, 200);
  assert.equal(requests.length, 0);
});

test("knowing another owner's session or call id grants no access", async () => {
  const { session } = await liveSession();
  process.env.CLARITY_AUTH_TOKEN = "different-operator-credential-32-characters";
  const auth = { authorization: `Basic ${Buffer.from(`clarity:${process.env.CLARITY_AUTH_TOKEN}`).toString("base64")}` };
  assert.equal((await call(request({ sessionId: session.id }, auth))).status, 404);
  assert.equal((await authorize(request({ sessionId: session.id, phone: PHONE, consent: true }, auth))).status, 404);
  assert.equal((await status(request(undefined, auth), { params: Promise.resolve({ id: session.id }) })).status, 404);
  process.env.CLARITY_AUTH_TOKEN = TOKEN;
  assert.equal((await poll("call_known_id")).status, 404);
  assert.equal(requests.length, 0);
});

test("resume phone and legacy candidatePhone cannot dial without stored consent", async () => {
  const { session } = await liveSession();
  assert.equal((await call(request({ sessionId: session.id }))).status, 403);
  assert.equal(requests.length, 0);
});

test("consent requires true and a strictly canonical destination", async () => {
  const { session } = await liveSession();
  for (const phone of [PHONE + "\n", "２０２５５５０１００", "2025550100", "+1 2025550100", "+99912345678"]) {
    assert.equal((await authorize(request({ sessionId: session.id, phone, consent: true }))).status, 400);
  }
  for (const consent of [false, "true", undefined]) {
    assert.equal((await authorize(request({ sessionId: session.id, phone: PHONE, consent }))).status, 400);
  }
  assert.equal((await getSession(session.id))?.authorization, undefined);
  assert.equal(requests.length, 0);
});

test("expired and other-owner consent cannot dial", async () => {
  const { session } = await consented();
  const saved = (await getSession(session.id))!;
  await updateSession(session.id, { authorization: { ...saved.authorization!, expiresAt: new Date(0).toISOString() } });
  assert.equal((await call(request({ sessionId: session.id }))).status, 403);
  await updateSession(session.id, { authorization: { ...saved.authorization!, ownerId: "other" } });
  assert.equal((await call(request({ sessionId: session.id }))).status, 403);
  assert.equal(requests.length, 0);
});

test("call destination overrides and reauthorization after create are forbidden", async () => {
  const { session, phone } = await consented();
  assert.equal((await call(request({ sessionId: session.id, phone: "+442079460100" }))).status, 400);
  assert.equal((await call(request({ sessionId: session.id }))).status, 200);
  assert.equal((await authorize(request({ sessionId: session.id, phone, consent: true }))).status, 409);
  assert.equal(requests.length, 1);
});

test("international create uses precisely the confirmed phone, region and English locale", async () => {
  const { session } = await consented("+442079460100");
  assert.equal((await call(request({ sessionId: session.id }))).status, 200);
  const payload = await requests[0]!.json();
  assert.deepEqual(payload.recipients, [{ phones: ["+442079460100"], region: "GB", locale: "en" }]);
  assert.equal(requests[0]!.headers.get("idempotency-key"), `clarity:${session.id}`);
  assert.equal(requests[0]!.redirect, "error");
  assert.equal(new URL(requests[0]!.url).origin, "https://api.heycall-e.com");
  assert.equal(payload.webhook_url, undefined);
  const summary = await (await poll(session.id)).text();
  assert.ok(!summary.includes("+442079460100"));
  assert.ok(!summary.includes('"authorization"'));
  assert.ok(!summary.includes('"ownerId"'));
});

test("concurrent clicks create only once", async () => {
  const { session } = await consented();
  const responses = await Promise.all([call(request({ sessionId: session.id })), call(request({ sessionId: session.id }))]);
  assert.ok(responses.some((response) => response.status === 200));
  assert.ok(responses.every((response) => [200, 409].includes(response.status)));
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
});

test("a timeout persists an ambiguous state and blocks both retries and fresh sessions to the destination", async () => {
  const { session, phone } = await consented();
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new Error(`timeout ${phone} fake-provider-key`); };
  const response = await call(request({ sessionId: session.id }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.ambiguous, true);
  assert.ok(!body.error.includes(phone));
  assert.ok(!body.error.includes("fake-provider-key"));
  assert.equal((await getSession(session.id))?.createState, "ambiguous");
  assert.equal((await call(request({ sessionId: session.id }))).status, 409);
  const fresh = await consented(phone);
  assert.equal((await call(request({ sessionId: fresh.session.id }))).status, 409);
  assert.equal((await (await poll(session.id)).json()).ambiguous, true);
  assert.equal(attempts, 1);
});

test("an invalid successful provider response is ambiguous and cannot be retried", async () => {
  const { session } = await consented();
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return Response.json({ accepted: true }); };
  assert.equal((await call(request({ sessionId: session.id }))).status, 409);
  assert.equal((await call(request({ sessionId: session.id }))).status, 409);
  assert.equal(attempts, 1);
});

test("failure to persist before create prevents all provider I/O", async () => {
  const { session } = await consented();
  mock.method(fs, "rename", async () => { throw new Error("disk unavailable"); });
  assert.equal((await call(request({ sessionId: session.id }))).status, 502);
  assert.equal(requests.length, 0);
});

test("failure to persist an accepted create remains halted after the disk recovers", async () => {
  const { session, phone } = await consented();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    mock.method(fs, "rename", async () => { throw new Error("disk unavailable"); });
    return Response.json(wireCall(session.id, { phones: [phone], region: "US", locale: "en" }));
  };
  const response = await call(request({ sessionId: session.id }));
  assert.equal((await response.json()).ambiguous, true);
  mock.restoreAll();
  assert.equal((await getSession(session.id))?.createState, "creating");
  assert.equal((await call(request({ sessionId: session.id }))).status, 409);
  assert.equal(attempts, 1);
});

test("reconciliation only GETs a provider call matching session and destination", async () => {
  const { session, phone } = await consented();
  const providerFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("connection lost"); };
  await call(request({ sessionId: session.id }));
  const known = wireCall(session.id, { phones: [phone], region: "US", locale: "en" });
  providerCalls.set(known.id, known);
  const wrong = wireCall("unrelated");
  providerCalls.set(wrong.id, wrong);
  globalThis.fetch = providerFetch;
  assert.equal((await reconcile(request({ sessionId: session.id, callId: wrong.id }))).status, 409);
  assert.equal((await getSession(session.id))?.callId, null);
  assert.equal((await reconcile(request({ sessionId: session.id, callId: known.id }))).status, 200);
  assert.equal((await getSession(session.id))?.callId, known.id);
  assert.equal((await (await call(request({ sessionId: session.id }))).json()).alreadyPlaced, true);
  assert.ok(requests.every((r) => r.method === "GET"));
});

test("webhook bearer authentication is separate from operator authentication", async () => {
  assert.equal((await webhook(request({ data: { id: "call_guess" } }))).status, 401);
  assert.equal((await webhook(hook({ data: { id: "call_guess" } }, "wrong"))).status, 401);
  delete process.env.CLARITY_WEBHOOK_SECRET;
  assert.equal((await webhook(hook({ data: { id: "call_guess" } }))).status, 503);
  assert.equal(requests.length, 0);
});

test("authenticated webhook ignores forged transcript/results and re-fetches the known call", async () => {
  const { session } = await consented();
  await call(request({ sessionId: session.id }));
  const id = (await getSession(session.id))!.callId!;
  const event = { id: "event_repeated", data: { id, status: "completed", summary: "FORGED", structuredResult: { answer: "FORGED" }, recipients: [] } };
  assert.equal((await webhook(hook(event))).status, 200);
  assert.ok(!JSON.stringify(await getSession(session.id)).includes("FORGED"));
  assert.equal((await getSession(session.id))?.call?.status, "queued");
  assert.equal((await webhook(hook(event))).status, 200);
  assert.equal(requests.filter((r) => r.method === "GET").length, 2);
});

test("failed webhook verification can retry the same event ID successfully", async () => {
  const { session } = await consented();
  await call(request({ sessionId: session.id }));
  const id = (await getSession(session.id))!.callId!;
  const event = { id: "retry_event", data: { id } };
  const providerFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("timeout"); };
  assert.equal((await webhook(hook(event))).status, 502);
  globalThis.fetch = providerFetch;
  assert.equal((await webhook(hook(event))).status, 200);
  assert.equal((await webhook(hook({ data: { id: "call_unknown" } }))).status, 200);
});

test("webhook provider mismatch leaves stored evidence unchanged", async () => {
  const { session } = await consented();
  await call(request({ sessionId: session.id }));
  const id = (await getSession(session.id))!.callId!;
  const before = JSON.stringify(await getSession(session.id));
  providerCalls.set(id, { ...wireCall("unrelated"), id });
  assert.equal((await webhook(hook({ data: { id } }))).status, 502);
  assert.equal(JSON.stringify(await getSession(session.id)), before);
});

test("turning off live mode also prevents old live sessions from dialing", async () => {
  const { session } = await consented();
  process.env.DEMO_MODE = "replay";
  assert.equal((await call(request({ sessionId: session.id }))).status, 403);
  assert.equal(requests.length, 0);
});

test("malformed requests and traversal IDs cannot read or change sessions", async () => {
  process.env.DEMO_MODE = "replay";
  for (const body of [null, [], { resume: 42 }, { candidateName: {} }]) assert.equal((await analyze(request(body))).status, 400);
  for (const body of [null, [], {}, { sessionId: 42 }, { sessionId: "../private" }]) assert.equal((await call(request(body))).status, 400);
  for (const body of [null, [], {}, { data: { id: "../private" } }]) assert.equal((await webhook(hook(body))).status, 400);
  await fs.writeFile(path.join(sandbox, "private.json"), JSON.stringify({ id: "private" }));
  assert.equal(await getSession("../private"), null);
});
