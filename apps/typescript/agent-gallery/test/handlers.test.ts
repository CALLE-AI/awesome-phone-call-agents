import assert from "node:assert/strict";
import test from "node:test";
import { handleCreateCall, handleGetCallStatus, type CalleEnv } from "../api/_lib/calls";
import { FAKE_SERVER_URL, FAKE_TOKEN, createFakeCalle } from "./fake-calle-server";
import type { CareCallRequest } from "../src/workflows/carecall";
import { MemoryDurableStore } from "../api/_lib/durable-store";
import { issueOperatorSession } from "../api/_lib/operator-auth";

const ACCESS_CODE = "test-operator-code";

const CONFIGURED = {
  CALLE_ACCESS_TOKEN: FAKE_TOKEN,
  CALLE_SERVER_URL: FAKE_SERVER_URL,
  CARECALL_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CARECALL_OPERATORS_JSON: JSON.stringify([{ id: "mei-chen", name: "Mei Chen", role: "coordinator", access_code_sha256: "1427b7e058bb398ae674d86981bc0e4f796661abc0ccbba06c3e9ec611f9f07f", senior_ids: ["mdm-lim"] }]),
  durableStore: new MemoryDurableStore(),
};

function validCareCallRequest(key: string): CareCallRequest {
  return {
    workflow: "carecall",
    request_key: key,
    organisation: { name: "Queenstown Care Team", timezone: "Asia/Singapore" },
    senior: {
      id: "mdm-lim",
      preferred_name: "Mdm Lim",
      phone_e164: "+6580000000",
      language: "English",
      authority_confirmed: true,
      permitted_call_window: "12:00 AM–11:59 PM",
    },
    routine: {
      id: "lim-morning-medication",
      kind: "medication",
      title: "Morning medication",
      caregiver_instruction: "Repeat the approved morning reminder.",
      caregiver_name: "Joanne Lim",
      trust_phrase: "Joanne asked me to call about your morning routine.",
    },
    authorization: { exactly_one_call: true, authorized_at: new Date().toISOString() },
  };
}

/** A create request carrying a signed operator session, as the console sends it. */
async function post(body: unknown, env: CalleEnv = CONFIGURED): Promise<Request> {
  const token = await issueOperatorSession("mei-chen", ACCESS_CODE, env);
  assert.ok(token);
  return new Request("https://app.invalid/api/carecall/jobs", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** The same request with no session at all. */
function unauthenticatedPost(body: unknown): Request {
  return new Request("https://app.invalid/api/carecall/jobs", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A status request carrying a signed operator session, as the polling browser sends it. */
async function get(env: CalleEnv = CONFIGURED): Promise<Request> {
  const token = await issueOperatorSession("mei-chen", ACCESS_CODE, env);
  assert.ok(token);
  return new Request("https://app.invalid/api/carecall/jobs/run-1", {
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Run a handler with the fake CALL-E installed as global fetch. */
async function withFakeCalle<T>(
  fake: ReturnType<typeof createFakeCalle>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** Place one call so a durable run record exists for the status handler to read. */
async function withStartedCall(env: CalleEnv, fake: ReturnType<typeof createFakeCalle>, key: string) {
  const response = await withFakeCalle(fake, async () => handleCreateCall(await post(validCareCallRequest(key), env), env));
  assert.equal(response.status, 200);
}

test("a deployment without CALL-E credentials cannot place a call", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore(), CALLE_ACCESS_TOKEN: undefined };
  const response = await handleCreateCall(await post(validCareCallRequest("no-creds"), env), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "not_configured");
});

test("a request without a key is refused", async () => {
  const response = await handleCreateCall(await post({ workflow: "carecall" }), CONFIGURED);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "missing_request_key");
});

test("malformed JSON is refused", async () => {
  const response = await handleCreateCall(await post("{not json"), CONFIGURED);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_json");
});

// The browser validates too, but a server that trusts the browser is not a
// safety boundary at all.
test("the server revalidates rather than trusting the browser", async () => {
  const request = validCareCallRequest("unvalidated");
  request.senior.authority_confirmed = false;
  request.senior.phone_e164 = "80000000";

  const response = await handleCreateCall(await post(request), CONFIGURED);
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "invalid_request");
  assert.ok(payload.details.some((d: string) => d.includes("E.164")));
  assert.ok(payload.details.some((d: string) => d.includes("authority")));
});

test("a valid CareCall request plans and runs exactly one call", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const fake = createFakeCalle();
  const response = await withFakeCalle(fake, async () =>
    handleCreateCall(await post(validCareCallRequest("happy-path"), env), env),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).call_id, "run-1");
  assert.deepEqual(fake.toolCalls, ["plan_call", "run_call"]);
});

test("CareCall fails closed without durable storage", async () => {
  const { durableStore: _store, ...withoutStore } = CONFIGURED;
  const request = await post(validCareCallRequest("no-durable-store"), CONFIGURED);
  const response = await handleCreateCall(request, withoutStore);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "durable_storage_not_configured");
});

test("CareCall enforces the operator's senior scope", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const payload = validCareCallRequest("scope-denied");
  payload.senior.id = "another-senior";
  const response = await handleCreateCall(await post(payload, env), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "senior_scope_denied");
});

test("durable request claims prevent a second CareCall dial", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const fake = createFakeCalle();
  const payload = validCareCallRequest("durable-dedupe");
  const first = await withFakeCalle(fake, async () => handleCreateCall(await post(payload, env), env));
  const second = await withFakeCalle(fake, async () => handleCreateCall(await post(payload, env), env));
  assert.equal(first.status, 200);
  assert.equal((await second.json()).deduplicated, true);
  assert.equal(fake.runCallAttempts, 1, "CALL-E was asked to dial more than once");
});

test("durable daily call limits stop additional spending", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore(), CARECALL_MAX_CALLS_PER_DAY: "1" };
  const fake = createFakeCalle();
  await withFakeCalle(fake, async () => handleCreateCall(await post(validCareCallRequest("limit-first"), env), env));
  const response = await withFakeCalle(fake, async () => handleCreateCall(await post(validCareCallRequest("limit-second"), env), env));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "daily_call_limit_reached");
  assert.equal(fake.runCallAttempts, 1);
});

test("terminal CareCall outcomes and attention cases are persisted server-side", async () => {
  const store = new MemoryDurableStore();
  const env = { ...CONFIGURED, durableStore: store };
  const fake = createFakeCalle({ statusSequence: ["COMPLETED"], terminalResult: { summary: "CARECALL_OUTCOME=unsure_if_taken", call_id: "call-care-1" } });
  await withStartedCall(env, fake, "persisted-outcome");
  const response = await withFakeCalle(fake, async () => handleGetCallStatus(await get(env), "run-1", env));
  const body = await response.json();
  assert.equal(body.carecall_result.outcome, "unsure_if_taken");
  assert.equal(body.carecall_result.urgency, "contact-now");
  assert.equal((await store.get<{ title: string }>("carecall:case:live-call-care-1"))?.title, "Unsure whether already taken");
});

test("an in-progress run reports status and activity but no result", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const fake = createFakeCalle({ statusSequence: ["PREPARING", "PREPARING"] });
  await withStartedCall(env, fake, "in-progress");
  const response = await withFakeCalle(fake, async () => handleGetCallStatus(await get(env), "run-1", env));

  const payload = await response.json();
  assert.equal(payload.status, "PREPARING");
  assert.ok(Array.isArray(payload.activity));
  assert.equal(payload.carecall_result, undefined);
});

test("a status request without a run id is refused", async () => {
  const response = await handleGetCallStatus(await get(), "", CONFIGURED);
  assert.equal(response.status, 400);
});

test("a status request for an unknown run is refused rather than guessed", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const response = await handleGetCallStatus(await get(env), "run-never-created", env);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "call_record_not_found");
});

// The browser's authorization checkbox is a value in a request body, so anyone
// can send it. These tests cover the boundary that actually protects the
// credentials and the call budget.

test("a caller without an operator session cannot place a call", async () => {
  const fake = createFakeCalle();
  const response = await withFakeCalle(fake, () =>
    handleCreateCall(unauthenticatedPost(validCareCallRequest("no-session")), CONFIGURED),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "invalid_operator_session");
  assert.deepEqual(fake.toolCalls, [], "CALL-E was contacted by an unauthorized caller");
});

test("a caller with a forged session token cannot place a call", async () => {
  const fake = createFakeCalle();
  const request = new Request("https://app.invalid/api/carecall/jobs", {
    method: "POST",
    headers: { authorization: "Bearer not-a-real-session-token" },
    body: JSON.stringify(validCareCallRequest("forged-session")),
  });
  const response = await withFakeCalle(fake, () => handleCreateCall(request, CONFIGURED));

  assert.equal(response.status, 401);
  assert.equal(fake.runCallAttempts, 0);
});

// Ordering matters: a caller who cannot place a call should not be able to use
// the endpoint as a free validator, or make the server parse their input.
test("the session gate runs before the request body is read", async () => {
  const response = await handleCreateCall(unauthenticatedPost("{not json"), CONFIGURED);
  assert.equal(response.status, 401, "malformed input was parsed before authorization");
});

test("a deployment with no operator configuration refuses to place calls", async () => {
  const response = await handleCreateCall(await post(validCareCallRequest("unset-operators")), {
    CALLE_ACCESS_TOKEN: FAKE_TOKEN,
    CALLE_SERVER_URL: FAKE_SERVER_URL,
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "invalid_operator_session");
});

test("reading what a real call said also requires an operator session", async () => {
  const fake = createFakeCalle({ statusSequence: ["COMPLETED"] });
  const request = new Request("https://app.invalid/api/carecall/jobs/run-1");
  const response = await withFakeCalle(fake, () => handleGetCallStatus(request, "run-1", CONFIGURED));

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.activity, undefined, "activity leaked to an unauthorized caller");
  assert.equal(payload.carecall_result, undefined, "a transcript leaked to an unauthorized caller");
});

test("an upstream failure is reported without inventing a call outcome", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const started = createFakeCalle();
  await withStartedCall(env, started, "upstream-failure");
  const failing = createFakeCalle({ rejectWithStatus: 500 });
  const response = await withFakeCalle(failing, async () => handleGetCallStatus(await get(env), "run-1", env));

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.status, undefined, "a failed poll must not look like a call status");
});
