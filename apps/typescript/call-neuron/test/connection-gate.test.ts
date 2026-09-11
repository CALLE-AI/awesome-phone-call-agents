import assert from "node:assert/strict";
import test from "node:test";

import { startFakeServer } from "../../../shared/fake-mcp-broker-server.mjs";
import { onRequest } from "../functions/api/[[path]]";
import {
  callMcp,
  exchangeLogin,
  planIsSafelyIncomplete,
  readLoginStatus,
  startLogin,
  toolNames,
} from "../src/api";
import type { Recipient } from "../src/campaign";
import { createReviewedPlan, initializeCallE, refreshCallRun, startReviewedCall } from "../src/live";

type FakeServer = Awaited<ReturnType<typeof startFakeServer>>;

const testRecipient: Recipient = {
  id: "test-recipient",
  studentName: "Test Student",
  studentCode: "STU-TEST",
  recipientName: "Test Guardian",
  phone: "+15550101001",
  recipientType: "guardian",
  employeeCode: "EMP-TEST",
  consentSource: "Signed test consent",
  consentTimestamp: "2026-08-01T10:00:00Z",
  status: "eligible",
};

async function request(fake: FakeServer, path: string, body: Record<string, unknown>) {
  return onRequest({
    request: new Request(`http://callneuron.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env: {
      CALLNEURON_ENV: "test",
      CALLNEURON_TEST_BASE_URL: fake.baseUrl,
    },
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("connection gate authenticates, lists tools, and creates only an incomplete plan", async (t) => {
  const fake = await startFakeServer();
  t.after(() => fake.close());
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!target.startsWith("/api/")) {
      return nativeFetch(input, init);
    }
    return onRequest({
      request: new Request(`http://callneuron.test${target}`, init),
      env: { CALLNEURON_ENV: "test", CALLNEURON_TEST_BASE_URL: fake.baseUrl },
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const login = await startLogin();
  assert.equal(login.loginUrl.startsWith(fake.baseUrl), true);
  assert.equal(await readLoginStatus(login), "AUTHORIZED");

  const accessToken = await exchangeLogin(login);
  const initialized = await callMcp(accessToken, "initialize");
  assert.equal(Boolean(initialized.sessionId), true);
  await callMcp(accessToken, "notifications/initialized", { mcpSessionId: "" });
  await callMcp(accessToken, "notifications/initialized", { mcpSessionId: initialized.sessionId });
  const tools = await callMcp(accessToken, "tools/list", { mcpSessionId: initialized.sessionId });
  assert.equal(["plan_call", "run_call", "get_call_run"].every((name) => toolNames(tools).includes(name)), true);

  const plan = await callMcp(accessToken, "tools/call", {
    mcpSessionId: initialized.sessionId,
    params: {
      name: "plan_call",
      arguments: {
        user_input: "Create an incomplete English scholarship outreach plan without a phone number. Do not place or start a call.",
        ttl_seconds: 86_400,
      },
    },
  });
  assert.equal(planIsSafelyIncomplete(plan), true);

  const state = (await fetch(fake.stateUrl).then((response) => response.json())) as {
    tool_calls: Array<{ name: string }>;
  };
  assert.deepEqual(state.tool_calls.map((call) => call.name), ["plan_call"]);
});

test("connection gate supports CALL-E without an MCP session header", async (t) => {
  const fake = await startFakeServer({ statelessMcp: true });
  t.after(() => fake.close());
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!target.startsWith("/api/")) return nativeFetch(input, init);
    return onRequest({
      request: new Request(`http://callneuron.test${target}`, init),
      env: { CALLNEURON_ENV: "test", CALLNEURON_TEST_BASE_URL: fake.baseUrl },
    });
  };
  t.after(() => { globalThis.fetch = nativeFetch; });

  const login = await startLogin();
  const connection = await initializeCallE(await exchangeLogin(login));
  assert.equal(connection.sessionId, "");

  const state = (await fetch(fake.stateUrl).then((response) => response.json())) as {
    mcp_requests: Array<{ method: string; session_id: string | null }>;
  };
  assert.deepEqual(state.mcp_requests.map((item) => item.method), ["initialize", "notifications/initialized", "tools/list"]);
  assert.equal(state.mcp_requests.every((item) => item.session_id === null), true);
});

test("proxy rejects an expanded run_call contract before forwarding", async (t) => {
  const fake = await startFakeServer();
  t.after(() => fake.close());

  const response = await request(fake, "/api/mcp", {
    accessToken: "fake-access-token",
    mcpSessionId: "fake-mcp-session",
    method: "tools/call",
    params: {
      name: "run_call",
      arguments: {
        plan_id: "fake-plan",
        confirm_token: "fake-confirm",
        ttl_seconds: 86_400,
        automatic_retry: true,
      },
    },
  });
  assert.equal(response.status, 400);

  const state = (await fetch(fake.stateUrl).then((item) => item.json())) as {
    tool_calls: Array<{ name: string }>;
  };
  assert.equal(state.tool_calls.length, 0);
});

test("gated runtime performs the complete plan, explicit run, and status sequence against the fake broker", async (t) => {
  const fake = await startFakeServer();
  t.after(() => fake.close());
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!target.startsWith("/api/")) return nativeFetch(input, init);
    return onRequest({
      request: new Request(`http://callneuron.test${target}`, init),
      env: { CALLNEURON_ENV: "test", CALLNEURON_TEST_BASE_URL: fake.baseUrl },
    });
  };
  t.after(() => { globalThis.fetch = nativeFetch; });

  const login = await startLogin();
  const connection = await initializeCallE(await exchangeLogin(login));
  const plan = await createReviewedPlan(connection, testRecipient, {
    organization: "Example Learning Centre",
    offer: "A staff-approved tuition-support conversation is available.",
    details: "No award has been made.",
    callbackPhone: "+15550102000",
    escalation: "all eligibility and award questions",
  }, false);
  assert.equal(plan.planId, "fake-plan-1");
  assert.match(plan.instruction, /ready_to_run/u);
  assert.match(plan.instruction, /do not leave a voicemail/iu);
  assert.match(plan.instruction, /warm, respectful, patient tone/iu);
  assert.match(plan.instruction, /Hello, my name is CallNeuron/iu);
  assert.match(plan.instruction, /calling to share an education-support opportunity/iu);
  assert.match(plan.instruction, /Would you be interested in speaking with a staff member/iu);
  assert.match(plan.instruction, /human staff member.*will contact you shortly/iu);
  assert.match(plan.instruction, /preferred callback time/iu);
  assert.match(plan.instruction, /anything specific.*explain/iu);

  const queued = await startReviewedCall(connection, plan);
  assert.equal(queued.status, "QUEUED");
  const inProgress = await refreshCallRun(connection, queued);
  assert.equal(inProgress.status, "IN_PROGRESS");
  const completed = await refreshCallRun(connection, inProgress);
  assert.equal(completed.status, "COMPLETED");
  assert.match(completed.transcript, /Hello from CALL-E/u);

  const state = (await fetch(fake.stateUrl).then((response) => response.json())) as {
    tool_calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  };
  assert.deepEqual(state.tool_calls.map((call) => call.name), ["plan_call", "run_call", "get_call_run", "get_call_run"]);
  assert.deepEqual(state.tool_calls[0].arguments.to_phones, [testRecipient.phone]);
  assert.equal(state.tool_calls[0].arguments.language, "English");
  assert.equal(state.tool_calls[0].arguments.region, "MY");
});
