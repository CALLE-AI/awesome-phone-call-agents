import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyCall } from "./classify.mjs";

const workflow = JSON.parse(await readFile(new URL("./absence-wave.workflow.json", import.meta.url)));
const nodes = Object.fromEntries(workflow.nodes.map((node) => [node.name, node.parameters.jsCode]));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const row = {
  id: "S-test", name: "Demo Student", schoolName: "Example School", absenceDate: "2026-10-25",
  phones: ["+12025550123", "+12025550124"], locale: "en-US", consent: true,
  apiBaseUrl: "https://api.heycall-e.com", dryRun: false, maxWaitSeconds: 10,
};
const ready = (id, outcome = "completed", result = {}) => ({
  id, call_id: `billing_${id}`, status: "completed", call_outcome: outcome,
  result_status: "available", result,
});

async function run(replies, overrides = {}) {
  const input = { ...row, ...overrides };
  const built = new Function("$input", nodes["Build Call Request"])({ first: () => ({ json: input }) });
  const requests = [];
  let clock = 0;
  const out = await new AsyncFunction("$input", "$env", "setTimeout", "Date", nodes["Create Call And Wait"])
    .call({ helpers: { httpRequest: async (request) => {
      requests.push(request);
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      assert.ok(reply, "unexpected request");
      return reply;
    } } }, { first: () => built[0] }, { CALL_E_API_KEY: "fake-key" },
    (resolve, delay) => { clock += delay; resolve(); }, { now: () => clock });
  const classified = new Function("$input", nodes["Classify Outcome"])({ first: () => out[0] });
  return { requests, output: out[0].json, classified: classified[0].json };
}

test("the generated request sends one phone and a closed scalar result schema", async () => {
  const { requests } = await run([ready("call_1")]);
  const request = requests[0];
  assert.equal(request.url, "https://api.heycall-e.com/v2/calls");
  assert.equal(request.body.phone, row.phones[0]);
  assert.equal(request.body.result_schema.additionalProperties, false);
  assert.equal("phones" in request.body, false);
  assert.equal("recipients" in request.body, false);
  assert.equal("recipient_result_schema" in request.body, false);
});

test("completed execution keeps polling until a result is ready", async () => {
  const result = { reason_category: "illness", expected_return: "tomorrow", parent_confirmed_aware: "yes" };
  const { requests, classified } = await run([
    { ...ready("call_1"), result_status: "pending", result: null }, ready("call_1", "completed", result),
  ]);
  assert.deepEqual(requests.map((item) => item.method), ["POST", "GET"]);
  assert.equal(requests[1].url, "https://api.heycall-e.com/v2/calls/call_1");
  assert.equal(classified.resolution, "resolved");
  assert.deepEqual(classified.callIds, ["call_1"]);
});

test("only no-answer or busy permits the next authorized number with a separate stable key", async () => {
  for (const outcome of ["no_answer", "busy"]) {
    const replies = [ready("call_1", outcome), ready("call_2")];
    const first = await run([...replies]);
    const replay = await run([...replies]);
    assert.deepEqual(first.requests, replay.requests);
    assert.deepEqual(first.requests.map((item) => item.body.phone), row.phones);
    assert.notEqual(first.requests[0].headers["Idempotency-Key"], first.requests[1].headers["Idempotency-Key"]);
    assert.equal(first.classified.attempts, 2);
  }
});

test("declined, unavailable, empty and technical-error results never trigger a fallback call", async () => {
  for (const call of [
    ready("call_1", "declined"), ready("call_1"),
    { ...ready("call_1"), result_status: "unavailable", result: null, error: null },
    { ...ready("call_1"), status: "failed", call_outcome: null, result_status: "not_applicable", result: null },
    { ...ready("call_1"), status: "canceled", call_outcome: null, result_status: "not_applicable", result: null },
  ]) {
    const { requests, classified } = await run([call]);
    assert.equal(requests.length, 1);
    assert.equal(classified.needsAHuman, true);
  }
});

test("pending and malformed result states time out without calling another number", async () => {
  for (const result_status of ["pending", undefined, []]) {
    const pending = { ...ready("call_1"), result_status, result: null };
    const { requests, classified } = await run([pending, pending, pending]);
    assert.equal(requests.filter((item) => item.method === "POST").length, 1);
    assert.equal(classified.resolution, "undetermined");
    assert.deepEqual(classified.callIds, ["call_1"]);
  }
});

test("creation and read failures stop fallback and keep accepted IDs for reconciliation", async () => {
  for (const replies of [
    [new Error("unknown acceptance")],
    [{ call_id: "billing_without_api_id" }],
    [{ ...ready("call_1"), result_status: "pending" }, new Error("read unavailable")],
    [ready("call_1", "no_answer"), new Error("unknown second acceptance")],
    [{ ...ready("call_1"), result_status: "pending" }, ready("wrong_call")],
  ]) {
    const { output, classified } = await run([...replies]);
    assert.equal(output.reconciliationRequired, true);
    assert.equal(classified.resolution, "undetermined");
    assert.equal(classified.needsAHuman, true);
    if (replies[0]?.id) assert.deepEqual(classified.callIds, ["call_1"]);
  }
});

test("the v2 classifier keeps unknown answers and safeguarding out of closed cases", () => {
  for (const result of [
    {},
    { reason_category: "unknown", expected_return: "unknown", parent_confirmed_aware: "unknown" },
    { reason_category: "transport", expected_return: "today", parent_confirmed_aware: "no" },
  ]) {
    const verdict = classifyCall(ready("call_1", "completed", result), [{ id: "call_1" }]);
    assert.equal(verdict.needsAHuman, true);
    assert.equal(verdict.attempts, 1);
  }
});

test("dry run executes the exported nodes without touching CALL-E", async () => {
  const { requests, classified } = await run([], { id: "S-1041", dryRun: true });
  assert.equal(requests.length, 0);
  assert.equal(classified.resolution, "resolved");
  assert.equal(classified.submittedByThisRun, false);
});


test("dry-run validation never reads blocked environment variables", () => {
  const cfg = new Function(nodes["Absence Config"])()[0];
  const blocked = new Proxy({}, { get() { throw new Error("env access blocked"); } });
  const out = new Function("$input", "$env", nodes["Validate Config"])({ first: () => cfg }, blocked);
  assert.equal(out[0].json.dryRun, true);
});
