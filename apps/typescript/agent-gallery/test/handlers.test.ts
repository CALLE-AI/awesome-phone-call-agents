import assert from "node:assert/strict";
import test from "node:test";
import { handleCreateCall, handleGetCallStatus } from "../api/_lib/calls";
import { ACCESS_CODE_HEADER } from "../src/access";
import { FAKE_SERVER_URL, FAKE_TOKEN, createFakeCalle } from "./fake-calle-server";
import type { RecoveryRequest } from "../src/workflows/appointment-recovery/types";
import type { CareCallRequest } from "../src/workflows/carecall";
import { MemoryDurableStore } from "../api/_lib/durable-store";
import { issueOperatorSession } from "../api/_lib/operator-auth";

const ACCESS_CODE = "test-operator-code";

const CONFIGURED = {
  CALLE_ACCESS_TOKEN: FAKE_TOKEN,
  CALLE_SERVER_URL: FAKE_SERVER_URL,
  OPERATOR_ACCESS_CODE: ACCESS_CODE,
  CARECALL_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CARECALL_OPERATORS_JSON: JSON.stringify([{ id: "mei-chen", name: "Mei Chen", role: "coordinator", access_code_sha256: "1427b7e058bb398ae674d86981bc0e4f796661abc0ccbba06c3e9ec611f9f07f", senior_ids: ["mdm-lim"] }]),
  durableStore: new MemoryDurableStore(),
};

function validRequest(key: string): RecoveryRequest {
  return {
    request_key: key,
    business: {
      name: "Glow & Co. Hair Studio",
      timezone: "Asia/Singapore",
      callback_number_e164: "+6560000000",
    },
    customer: { given_name: "Mei", phone_e164: "+6580000000", consent_confirmed: true },
    appointment: {
      service: "Cut and color",
      original_time: "2026-08-03T14:00:00+08:00",
      status: "missed",
    },
    replacement_windows: [{ start: "2099-08-07T10:00:00+08:00", end: "2099-08-07T12:00:00+08:00" }],
  };
}

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

function post(body: unknown, accessCode: string | null = ACCESS_CODE): Request {
  return new Request("https://app.invalid/api/calls", {
    method: "POST",
    headers: accessCode === null ? {} : { [ACCESS_CODE_HEADER]: accessCode },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function careCallPost(body: unknown): Promise<Request> {
  const token = await issueOperatorSession("mei-chen", ACCESS_CODE, CONFIGURED);
  assert.ok(token);
  return new Request("https://app.invalid/api/calls", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function careCallPostFor(body: unknown, env: typeof CONFIGURED): Promise<Request> {
  const token = await issueOperatorSession("mei-chen", ACCESS_CODE, env);
  assert.ok(token);
  return new Request("https://app.invalid/api/calls", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

/** A status request carrying an access code, as the polling browser sends it. */
function get(accessCode: string | null = ACCESS_CODE): Request {
  return new Request("https://app.invalid/api/calls/run-1", {
    headers: accessCode === null ? {} : { [ACCESS_CODE_HEADER]: accessCode },
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

test("a deployment without credentials cannot place a call", async () => {
  const response = await handleCreateCall(post(validRequest("no-creds")), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "not_configured");
});

test("a request without a key is refused", async () => {
  const response = await handleCreateCall(post({ business: {} }), CONFIGURED);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "missing_request_key");
});

test("malformed JSON is refused", async () => {
  const response = await handleCreateCall(post("{not json"), CONFIGURED);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_json");
});

// The browser validates too, but a server that trusts the browser is not a
// safety boundary at all.
test("the server revalidates rather than trusting the browser", async () => {
  const request = validRequest("unvalidated");
  request.customer.consent_confirmed = false;
  request.customer.phone_e164 = "80000000";

  const response = await handleCreateCall(post(request), CONFIGURED);
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "invalid_request");
  assert.ok(payload.details.some((d: string) => d.includes("E.164")));
  assert.ok(payload.details.some((d: string) => d.includes("authority")));
});

test("a valid request plans and runs one call", async () => {
  const fake = createFakeCalle();
  const response = await withFakeCalle(fake, () =>
    handleCreateCall(post(validRequest("happy-path")), CONFIGURED),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.call_id, "run-1");
  assert.deepEqual(fake.toolCalls, ["plan_call", "run_call"]);
});

test("a valid CareCall request uses the same protected one-call handshake", async () => {
  const fake = createFakeCalle();
  const response = await withFakeCalle(fake, () =>
    careCallPost(validCareCallRequest("carecall-happy-path")).then((request) => handleCreateCall(request, CONFIGURED)),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).call_id, "run-1");
  assert.deepEqual(fake.toolCalls, ["plan_call", "run_call"]);
});

test("CareCall fails closed without durable storage", async () => {
  const { durableStore: _store, ...withoutStore } = CONFIGURED;
  const request = await careCallPostFor(validCareCallRequest("no-durable-store"), CONFIGURED);
  const response = await handleCreateCall(request, withoutStore);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "durable_storage_not_configured");
});

test("CareCall enforces the operator's senior scope", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const payload = validCareCallRequest("scope-denied");
  payload.senior.id = "another-senior";
  const response = await handleCreateCall(await careCallPostFor(payload, env), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "senior_scope_denied");
});

test("durable request claims prevent a second CareCall dial", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore() };
  const fake = createFakeCalle();
  const payload = validCareCallRequest("durable-dedupe");
  const first = await withFakeCalle(fake, async () => handleCreateCall(await careCallPostFor(payload, env), env));
  const second = await withFakeCalle(fake, async () => handleCreateCall(await careCallPostFor(payload, env), env));
  assert.equal(first.status, 200);
  assert.equal((await second.json()).deduplicated, true);
  assert.equal(fake.runCallAttempts, 1);
});

test("durable daily call limits stop additional spending", async () => {
  const env = { ...CONFIGURED, durableStore: new MemoryDurableStore(), CARECALL_MAX_CALLS_PER_DAY: "1" };
  const fake = createFakeCalle();
  await withFakeCalle(fake, async () => handleCreateCall(await careCallPostFor(validCareCallRequest("limit-first"), env), env));
  const response = await withFakeCalle(fake, async () => handleCreateCall(await careCallPostFor(validCareCallRequest("limit-second"), env), env));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "daily_call_limit_reached");
  assert.equal(fake.runCallAttempts, 1);
});

test("terminal CareCall outcomes and attention cases are persisted server-side", async () => {
  const store = new MemoryDurableStore();
  const env = { ...CONFIGURED, durableStore: store };
  const fake = createFakeCalle({ statusSequence: ["COMPLETED"], terminalResult: { summary: "CARECALL_OUTCOME=unsure_if_taken", call_id: "call-care-1" } });
  const createRequest = await careCallPostFor(validCareCallRequest("persisted-outcome"), env);
  await withFakeCalle(fake, () => handleCreateCall(createRequest, env));
  const token = await issueOperatorSession("mei-chen", ACCESS_CODE, env);
  assert.ok(token);
  const statusRequest = new Request("https://app.invalid/api/calls/run-1", { headers: { authorization: `Bearer ${token}` } });
  const response = await withFakeCalle(fake, () => handleGetCallStatus(statusRequest, "run-1", env));
  const body = await response.json();
  assert.equal(body.carecall_result.outcome, "unsure_if_taken");
  assert.equal(body.carecall_result.urgency, "contact-now");
  assert.equal((await store.get<{ title: string }>("carecall:case:live-call-care-1"))?.title, "Unsure whether already taken");
});

test("resubmitting the same request key does not dial twice", async () => {
  const fake = createFakeCalle();
  const first = await withFakeCalle(fake, () =>
    handleCreateCall(post(validRequest("dedupe-key")), CONFIGURED),
  );
  const second = await withFakeCalle(fake, () =>
    handleCreateCall(post(validRequest("dedupe-key")), CONFIGURED),
  );

  assert.equal((await first.json()).call_id, "run-1");
  const repeat = await second.json();
  assert.equal(repeat.call_id, "run-1");
  assert.equal(repeat.deduplicated, true);
  assert.equal(fake.runCallAttempts, 1, "CALL-E was asked to dial more than once");
});

test("an in-progress run reports status and activity but no result", async () => {
  const fake = createFakeCalle({ statusSequence: ["PREPARING"] });
  const response = await withFakeCalle(fake, () => handleGetCallStatus(get(), "run-1", CONFIGURED));

  const payload = await response.json();
  assert.equal(payload.status, "PREPARING");
  assert.ok(Array.isArray(payload.activity));
  assert.equal(payload.calle_result, undefined);
});

test("a terminal run returns the raw CALL-E result for the workflow to read", async () => {
  const fake = createFakeCalle({
    statusSequence: ["COMPLETED"],
    terminalResult: { summary: "Rebooked.", call_id: "call-1" },
  });
  const response = await withFakeCalle(fake, () => handleGetCallStatus(get(), "run-1", CONFIGURED));

  const payload = await response.json();
  assert.equal(payload.status, "COMPLETED");
  assert.equal(payload.calle_result.call_id, "call-1");
});

test("a status request without a run id is refused", async () => {
  const response = await handleGetCallStatus(get(), "", CONFIGURED);
  assert.equal(response.status, 400);
});

// The browser's authorization checkbox is a value in a request body, so anyone
// can send it. These tests cover the boundary that actually protects the
// credentials and the call budget.

test("a caller without an access code cannot place a call", async () => {
  const fake = createFakeCalle();
  const response = await withFakeCalle(fake, () =>
    handleCreateCall(post(validRequest("no-code"), null), CONFIGURED),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "invalid_access_code");
  assert.deepEqual(fake.toolCalls, [], "CALL-E was contacted by an unauthorized caller");
});

test("a caller with the wrong access code cannot place a call", async () => {
  const fake = createFakeCalle();
  const response = await withFakeCalle(fake, () =>
    handleCreateCall(post(validRequest("wrong-code"), "not-the-code"), CONFIGURED),
  );

  assert.equal(response.status, 401);
  assert.equal(fake.runCallAttempts, 0);
});

// Ordering matters: a caller who cannot place a call should not be able to use
// the endpoint as a free validator, or make the server parse their input.
test("the access gate runs before the request body is read", async () => {
  const response = await handleCreateCall(post("{not json", null), CONFIGURED);
  assert.equal(response.status, 401, "malformed input was parsed before authorization");
});

test("a deployment with no access code configured refuses to place calls", async () => {
  const response = await handleCreateCall(post(validRequest("unset-code")), {
    CALLE_ACCESS_TOKEN: FAKE_TOKEN,
    CALLE_SERVER_URL: FAKE_SERVER_URL,
  });

  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error,
    "not_configured",
    "an unset access code must fail closed, and must not say which part is unset",
  );
});

test("reading what a real call said also requires an access code", async () => {
  const fake = createFakeCalle({ statusSequence: ["COMPLETED"] });
  const response = await withFakeCalle(fake, () =>
    handleGetCallStatus(get(null), "run-1", CONFIGURED),
  );

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.activity, undefined, "activity leaked to an unauthorized caller");
  assert.equal(payload.calle_result, undefined, "a transcript leaked to an unauthorized caller");
});

test("an upstream failure is reported without inventing a call outcome", async () => {
  const fake = createFakeCalle({ rejectWithStatus: 500 });
  const response = await withFakeCalle(fake, () => handleGetCallStatus(get(), "run-1", CONFIGURED));

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.status, undefined, "a failed poll must not look like a call status");
});
