import assert from "node:assert/strict";
import test from "node:test";
import { CalleCallsProvider, CalleGoalRunProvider, FakeGoalRunProvider, FAKE_PUBLISHED_GOAL, normalizeGoalResult, verifyGoalContract } from "../app/lib/call-provider.ts";
import { buildCallInstructions } from "../app/lib/call-instructions.ts";
import { CALL_EVIDENCE_SCHEMA } from "../app/lib/evidence.ts";
import { compileGoalContext, fingerprintVariables } from "../app/lib/goal-context.ts";

const request = { goalId: "goal-phase1", interviewId: "INT-047", authorizationVersion: 3, phone: "+15550123456", variables: compileGoalContext("dry_cleaner").variables, task: buildCallInstructions(compileGoalContext("dry_cleaner").plan), resultSchema: CALL_EVIDENCE_SCHEMA };

test("call attempt progress overrides a stale queued task without prematurely ending extraction", async () => {
  for (const [attempt, expected] of [["in_progress", "IN_PROGRESS"], ["completed", "PROCESSING_EVIDENCE"]]) {
    const provider = new CalleCallsProvider("test", "https://api.heycall-e.com", async (url) => Response.json(url.includes("/events")
      ? { data: [], next_cursor: null }
      : { id: "call_test", status: "queued", recipients: [{ status: "queued", attempts: [{ status: attempt }] }], structured_result: null }));
    const result = await provider.get("", "call_test");
    assert.equal(result.status, expected);
    assert.equal(result.terminal, false);
    assert.equal(result.error, null);
  }
});

test("event progress advances a stale snapshot and event failures preserve snapshot progress", async () => {
  const provider = new CalleCallsProvider("test", "https://api.heycall-e.com", async (url) => Response.json(url.includes("/events")
    ? { data: [{ status: "in_progress" }], next_cursor: null }
    : { id: "call_test", status: "queued", recipients: [] }));
  assert.equal((await provider.get("", "call_test")).status, "IN_PROGRESS");
  const unavailable = new CalleCallsProvider("test", "https://api.heycall-e.com", async (url) => {
    if (url.includes("/events")) throw new Error("network unavailable");
    return Response.json({ id: "call_test", status: "in_progress", recipients: [] });
  });
  assert.equal((await unavailable.get("", "call_test")).status, "IN_PROGRESS");
});

test("completed calls retain evidence and stop requesting progress events", async () => {
  let requests = 0;
  const provider = new CalleCallsProvider("test", "https://api.heycall-e.com", async () => {
    requests++;
    return Response.json({ id: "call_test", status: "completed", structured_result: { factual_statements: "Observed equipment" } });
  });
  const result = await provider.get("", "call_test");
  assert.equal(result.terminal, true);
  assert.equal(result.status, "COMPLETED");
  assert.equal(requests, 1);
  assert.equal(result.result.factual_statements, "Observed equipment");
});

test("fake Goal Run completes without a network request", async () => {
  const provider = new FakeGoalRunProvider();
  assert.equal(verifyGoalContract(await provider.getGoal(request.goalId)).valid, true);
  const created = await provider.create(request);
  assert.equal(created.terminal, false);
  const completed = await provider.get(request.goalId, created.goalRunId);
  assert.equal(completed.terminal, true);
  assert.equal(completed.result.outcome, "bounded");
  assert.equal(completed.result.human_review_required, "yes");
});

test("CALL-E Goal Run adapter sends only phone and scalar variables", async () => {
  let captured;
  const mockFetch = async (url, init) => {
    captured = { url, init };
    return Response.json({ id: "goal-run-test", run_id: "telephone-run-test", status: "in_progress", run_spec: { id: "rspec-v1", version: 1 }, result: null, error: null }, { status: 201 });
  };
  const provider = new CalleGoalRunProvider("secret-test-key", "https://api.heycall-e.com", mockFetch);
  const result = await provider.create(request);
  assert.equal(result.goalRunId, "goal-run-test");
  assert.equal(captured.url, "https://api.heycall-e.com/v1/goals/goal-phase1/runs");
  assert.equal(captured.init.headers["idempotency-key"], "sitewitness:INT-047:3");
  assert.equal(captured.init.headers.authorization, "Bearer secret-test-key");
  const payload = JSON.parse(captured.init.body);
  assert.deepEqual(Object.keys(payload).sort(), ["phone", "variables"]);
  assert.equal(Object.values(payload.variables).every((value) => ["string", "number", "boolean"].includes(typeof value)), true);
});

test("Goal Run remains active until result or error is present", async () => {
  let responsePayload = { id: "gr-1", run_id: "run-1", status: "completed", run_spec: { id: "rspec-v1", version: 1 }, result: null, error: null };
  const provider = new CalleGoalRunProvider("key", "https://api.heycall-e.com", async () => Response.json(responsePayload));
  assert.equal((await provider.get("goal-1", "gr-1")).terminal, false);
  responsePayload = { ...responsePayload, result: { outcome: "bounded" } };
  assert.equal((await provider.get("goal-1", "gr-1")).terminal, true);
});

test("CALL-E Calls adapter requests structured evidence and preserves transcript payloads", async () => {
  let captured;
  const mockFetch = async (url, init) => {
    captured = { url, init };
    return Response.json({ id: "call_test", status: "queued", structured_result: null, recipients: [] }, { status: 201 });
  };
  const provider = new CalleCallsProvider("secret-test-key", "https://api.heycall-e.com", mockFetch);
  const created = await provider.create(request);
  assert.equal(created.goalRunId, "call_test");
  assert.equal(created.terminal, false);
  assert.equal(captured.url, "https://api.heycall-e.com/v1/calls");
  const payload = JSON.parse(captured.init.body);
  assert.deepEqual(payload.recipients, [{ phones: [request.phone] }]);
  assert.deepEqual(payload.result_schema, CALL_EVIDENCE_SCHEMA);
  assert.equal(payload.task, request.task);
  assert.match(payload.task, /equipment_and_location/);
});

test("compiles different site-specific branch priorities", async () => {
  const dry = compileGoalContext("dry_cleaner");
  const gas = compileGoalContext("gas_station");
  const repair = compileGoalContext("auto_repair");
  assert.match(dry.plan.priorityBranches.join(" "), /machinery|drop shop/i);
  assert.match(gas.plan.priorityBranches.join(" "), /tank|closure/i);
  assert.match(repair.plan.priorityBranches.join(" "), /parts washer|sump/i);
  assert.notEqual(await fingerprintVariables(dry.variables), await fingerprintVariables(gas.variables));
});

test("published Goal contract exposes required inputs and evidence results", () => {
  const valid = verifyGoalContract(FAKE_PUBLISHED_GOAL);
  assert.deepEqual(valid, { valid: true, missingInputs: [], missingResults: [] });
  assert.equal("factual_statements" in FAKE_PUBLISHED_GOAL.resultSchema.properties, true);
});

test("normalizes the published compact Goal result for EP review", () => {
  const normalized = normalizeGoalResult({ factual_statements: "The respondent observed customer drop-off.", source_type: "direct observation", supporting_quotes: "Customers dropped clothes off here.", uncertainty_notes: "The exact first year is uncertain." });
  assert.equal(normalized.human_review_required, "yes");
  assert.equal(normalized.outcome, "unknown");
  assert.equal(normalized.statements[0].source_type, "first_hand");
  assert.equal(normalized.statements[0].certainty, "uncertain");
});
