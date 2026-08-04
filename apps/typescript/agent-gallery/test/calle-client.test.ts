import assert from "node:assert/strict";
import test from "node:test";
import { CalleError, createCalleClient, parseMcpBody } from "../src/calle";
import { classifyDelivery, isTerminalStatus, normalizeStatus } from "../src/calle";
import { FAKE_SERVER_URL, FAKE_TOKEN, createFakeCalle } from "./fake-calle-server";

function clientFor(fake: ReturnType<typeof createFakeCalle>) {
  return createCalleClient({
    serverUrl: FAKE_SERVER_URL,
    accessToken: FAKE_TOKEN,
    fetch: fake.fetch,
  });
}

test("plans, runs, and polls a call over the MCP handshake", async () => {
  const fake = createFakeCalle({ terminalResult: { summary: "done", call_id: "call-1" } });
  const client = clientFor(fake);

  const plan = await client.planCall({
    to_phones: ["+6560000000"],
    goal: "Confirm the appointment.",
    language: "English",
    region: "SG",
  });
  assert.equal(plan.plan_id, "plan-1");
  assert.equal(plan.ready_to_run, true);

  const run = await client.runCall({ plan_id: plan.plan_id, confirm_token: plan.confirm_token! });
  assert.equal(run.run_id, "run-1");

  const polled = await client.getCallRun({ run_id: run.run_id });
  assert.equal(polled.status, "PREPARING");

  assert.deepEqual(fake.toolCalls, ["plan_call", "run_call", "get_call_run"]);
});

// The single-use confirm_token is what makes a retry safe, so the app never
// needs to store state to avoid double-dialling.
test("a confirm token cannot start a second call", async () => {
  const fake = createFakeCalle();
  const client = clientFor(fake);
  const plan = await client.planCall({ to_phones: ["+6560000000"], goal: "Confirm." });

  await client.runCall({ plan_id: plan.plan_id, confirm_token: plan.confirm_token! });
  await assert.rejects(
    () => client.runCall({ plan_id: plan.plan_id, confirm_token: plan.confirm_token! }),
    (error: unknown) => error instanceof CalleError && error.code === "tool_error",
  );
  assert.equal(fake.runCallAttempts, 2, "the server saw both attempts");
});

test("reads results framed as server-sent events", async () => {
  const fake = createFakeCalle({ sse: true });
  const plan = await clientFor(fake).planCall({ to_phones: ["+6560000000"], goal: "Confirm." });
  assert.equal(plan.plan_id, "plan-1");
});

test("rejected credentials surface as an auth error that never echoes the token", async () => {
  const fake = createFakeCalle({ rejectWithStatus: 401 });
  const client = createCalleClient({
    serverUrl: FAKE_SERVER_URL,
    accessToken: "super-secret-token",
    fetch: fake.fetch,
  });

  await assert.rejects(
    () => client.planCall({ to_phones: ["+6560000000"], goal: "Confirm." }),
    (error: unknown) => {
      assert.ok(error instanceof CalleError);
      assert.equal(error.code, "auth");
      assert.ok(!error.message.includes("super-secret-token"), "token leaked into the error");
      return true;
    },
  );
});

test("a malformed body is an error rather than a silent empty result", () => {
  assert.throws(() => parseMcpBody("not json", "application/json"), CalleError);
  assert.throws(() => parseMcpBody("event: ping\n\n", "text/event-stream"), CalleError);
});

test("skips event-stream frames that carry no result", () => {
  const body = 'event: ping\ndata: {"jsonrpc":"2.0"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":"x","result":{"structuredContent":{"ok":true}}}\n\n';
  const parsed = parseMcpBody(body, "text/event-stream");
  assert.deepEqual(parsed.result, { structuredContent: { ok: true } });
});

test("a tool response without structured content is rejected", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: {} }), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": "s" },
    })) as unknown as typeof globalThis.fetch;

  const client = createCalleClient({
    serverUrl: FAKE_SERVER_URL,
    accessToken: FAKE_TOKEN,
    fetch: fetchImpl,
  });
  await assert.rejects(
    () => client.planCall({ to_phones: ["+6560000000"], goal: "Confirm." }),
    (error: unknown) => error instanceof CalleError && error.code === "bad_response",
  );
});

test("an unreachable server is reported without pretending the call failed cleanly", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof globalThis.fetch;

  const client = createCalleClient({
    serverUrl: FAKE_SERVER_URL,
    accessToken: FAKE_TOKEN,
    fetch: fetchImpl,
  });
  await assert.rejects(
    () => client.planCall({ to_phones: ["+6560000000"], goal: "Confirm." }),
    (error: unknown) => error instanceof CalleError && error.code === "unreachable",
  );
});

test("delivery classification is workflow-agnostic", () => {
  assert.equal(classifyDelivery("COMPLETED"), "answered");
  assert.equal(classifyDelivery("NO ANSWER"), "unreachable");
  assert.equal(classifyDelivery("DECLINED"), "unreachable");
  assert.equal(classifyDelivery("FAILED"), "failed");
  assert.equal(classifyDelivery("EXPIRED"), "timed_out");
  assert.equal(classifyDelivery("SOMETHING_NEW"), "unknown");
  assert.equal(normalizeStatus("no answer"), "NO_ANSWER");
  assert.ok(isTerminalStatus("VOICEMAIL"));
  assert.ok(!isTerminalStatus("PREPARING"));
});
