/** Regression suite for red-team findings. Mock/network-stub only. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveCalleAdapter } from "../../src/calle/live-adapter.js";
import { MockCalleAdapter } from "../../src/calle/mock-adapter.js";
import type { CalleAdapter, CallePollResult } from "../../src/calle/types.js";
import { canonicalize } from "../../src/runtime/crypto.js";
import { IntentDispatcher } from "../../src/runtime/dispatcher.js";
import { verifyEvidencePack } from "../../src/runtime/evidence.js";
import {
  isGlobalStopActive,
  setDurableOperatorStop,
} from "../../src/runtime/global-stop.js";
import { MissionRuntime } from "../../src/runtime/mission-runtime.js";
import { MissionStore } from "../../src/runtime/store.js";
import { freezeTemplate } from "../../src/runtime/templates.js";
import type { CanonicalCallPayload } from "../../src/runtime/types.js";

const NOON = new Date("2026-08-03T12:00:00+02:00");

function payload(task = "Runtime hardening fixture"): CanonicalCallPayload {
  return {
    task,
    recipients: [
      { phones: ["+490000000000"], region: "DE", locale: "de-DE" },
    ],
    metadata: { fixture: "runtime-hardening" },
    recipient_result_schema: {
      type: "object",
      required: ["acceptance"],
      properties: { acceptance: { type: "string" } },
    },
  };
}

function createMission(runtime: MissionRuntime, key: string) {
  return runtime.createMission({
    client_request_id: `${key}:request`,
    mission_idempotency_key: key,
    template_id: "test-runtime",
    template_version: 1,
    graph_snapshot: { fixture: key },
  });
}

function terminalPoll(
  outcome: CallePollResult["business_outcome"],
  overrides: Partial<CallePollResult> = {},
): CallePollResult {
  return {
    call_id: "fixture_call",
    status: "completed",
    provider_state: "completed",
    business_outcome: outcome,
    transcript: [
      { speaker: "bot", text: "Can you take Friday at 15:00?" },
      { speaker: "user", text: outcome === "declined" ? "No." : "Yes." },
    ],
    structured: {
      acceptance: outcome,
      confirmed_slot: "2026-09-04T15:00:00+02:00",
    },
    confirmation_question_asked: true,
    answer_after_question: true,
    slot_matches_offered: true,
    schema_valid: true,
    reliable_transcript: true,
    transcript_result_conflict: false,
    ...overrides,
  };
}

async function durableMissionAndSnapshotProof(root: string): Promise<void> {
  const dbPath = join(root, "durable.sqlite");
  const input = {
    client_request_id: "durable-request",
    mission_idempotency_key: "durable-key",
    template_id: "test-runtime",
    template_version: 1,
    graph_snapshot: { version: 1 },
  };
  const storeA = new MissionStore(dbPath);
  const runtimeA = new MissionRuntime();
  runtimeA.attachStore(storeA);
  const first = runtimeA.createMission(input);

  const mock = new MockCalleAdapter();
  runtimeA.providerRunsExporter = () => mock.exportRuns();
  const task = runtimeA.addTask(first.mission_id, "First", "First");
  const intent = runtimeA.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const dispatcher = new IntentDispatcher(runtimeA, mock, { now: NOON });
  assert.equal((await dispatcher.dispatch(intent.call_intent_id)).ok, true);

  const secondMission = createMission(runtimeA, "second-durable-key");
  runtimeA.addTask(secondMission.mission_id, "Second", "Second");
  assert.equal(storeA.loadSnapshot(first.mission_id)?.provider_runs.length, 1);
  assert.equal(storeA.loadSnapshot(secondMission.mission_id)?.provider_runs.length, 0);

  const snapshot = storeA.loadSnapshot(first.mission_id)!;
  const tampered = structuredClone(snapshot);
  tampered.intents[0]!.canonical_call_payload.task = "TAMPERED";
  assert.throws(
    () => MissionRuntime.fromSnapshot(tampered),
    (error: unknown) =>
      (error as { code?: string }).code === "SNAPSHOT_PAYLOAD_INTEGRITY",
  );

  const storeB = new MissionStore(dbPath);
  const runtimeB = new MissionRuntime();
  runtimeB.attachStore(storeB);
  const retried = runtimeB.createMission(input);
  assert.equal(retried.mission_id, first.mission_id);
  assert.throws(
    () => runtimeB.createMission({ ...input, graph_snapshot: { version: 2 } }),
    (error: unknown) =>
      (error as { code?: string }).code === "MISSION_IDEMPOTENCY_CONFLICT",
  );

  storeB.close();
  storeA.close();
}

async function providerOwnershipAndResumeProof(): Promise<void> {
  const runtime = new MissionRuntime();
  const mission = createMission(runtime, "ownership");
  const intents = ["A", "B"].map((label) => {
    const task = runtime.addTask(mission.mission_id, label, label);
    return runtime.authorizeIntent({
      call_task_id: task.call_task_id,
      attempt_no: 1,
      payload: payload(label),
      consent_recorded: true,
      timezone: "Europe/Berlin",
    });
  });
  runtime.beginDispatch(intents[0]!.call_intent_id);
  runtime.attachProviderRun(intents[0]!.call_intent_id, "one_provider_run");
  runtime.beginDispatch(intents[1]!.call_intent_id);
  assert.throws(() =>
    runtime.attachProviderRun(intents[1]!.call_intent_id, "one_provider_run"),
  );

  const blockedRuntime = new MissionRuntime();
  const blockedMission = createMission(blockedRuntime, "resume-block");
  const stuckTask = blockedRuntime.addTask(
    blockedMission.mission_id,
    "Stuck",
    "Stuck",
  );
  const stuck = blockedRuntime.authorizeIntent({
    call_task_id: stuckTask.call_task_id,
    attempt_no: 1,
    payload: payload("stuck"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  blockedRuntime.beginDispatch(stuck.call_intent_id);
  blockedRuntime.markAmbiguous(stuck.call_intent_id, "lost response");
  blockedRuntime.pauseMission(blockedMission.mission_id, "operator review");
  blockedRuntime.resumeMission(blockedMission.mission_id, "unsafe resume attempt");
  assert.equal(
    blockedRuntime.getMission(blockedMission.mission_id)?.status,
    "blocked_needs_resolution",
  );
  const downstreamTask = blockedRuntime.addTask(
    blockedMission.mission_id,
    "Downstream",
    "Downstream",
  );
  const downstream = blockedRuntime.authorizeIntent({
    call_task_id: downstreamTask.call_task_id,
    attempt_no: 1,
    payload: payload("downstream"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const result = await new IntentDispatcher(
    blockedRuntime,
    new MockCalleAdapter(),
    { now: NOON },
  ).dispatch(downstream.call_intent_id);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.code, "MISSION_HAS_STUCK_INTENT");
}

async function outcomeAndResultConflictProof(): Promise<void> {
  const unreliableAdapter: CalleAdapter = {
    mode: "mock",
    idempotency_guarantee: "hard",
    async createCall() {
      return { call_id: "unreliable_decline", status: "accepted", reused: false };
    },
    async getCall() {
      return terminalPoll("declined", { reliable_transcript: false });
    },
  };
  const runtime = new MissionRuntime();
  const mission = createMission(runtime, "negative-evidence");
  const task = runtime.addTask(mission.mission_id, "Negative", "Negative");
  const intent = runtime.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const dispatcher = new IntentDispatcher(runtime, unreliableAdapter, { now: NOON });
  await dispatcher.dispatch(intent.call_intent_id);
  assert.equal(
    (await dispatcher.ingestTerminal(intent.call_intent_id)).outcome,
    "unresolved",
  );

  let polls = 0;
  const changingAdapter: CalleAdapter = {
    mode: "mock",
    idempotency_guarantee: "hard",
    async createCall() {
      return { call_id: "changing_result", status: "accepted", reused: false };
    },
    async getCall() {
      polls += 1;
      return terminalPoll("declined", {
        call_id: "changing_result",
        transcript:
          polls === 1
            ? terminalPoll("declined").transcript
            : [
                { speaker: "bot", text: "Changed?" },
                { speaker: "user", text: "Changed result." },
              ],
      });
    },
  };
  const conflictRuntime = new MissionRuntime();
  const conflictMission = createMission(conflictRuntime, "result-conflict");
  const conflictTask = conflictRuntime.addTask(
    conflictMission.mission_id,
    "Conflict",
    "Conflict",
  );
  const conflictIntent = conflictRuntime.authorizeIntent({
    call_task_id: conflictTask.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const conflictDispatcher = new IntentDispatcher(
    conflictRuntime,
    changingAdapter,
    { now: NOON },
  );
  await conflictDispatcher.dispatch(conflictIntent.call_intent_id);
  await conflictDispatcher.ingestTerminal(conflictIntent.call_intent_id);
  await assert.rejects(
    () => conflictDispatcher.ingestTerminal(conflictIntent.call_intent_id),
    (error: unknown) => (error as { code?: string }).code === "RESULT_CONFLICT",
  );
  assert.equal(
    conflictRuntime.getMission(conflictMission.mission_id)?.status,
    "blocked_needs_resolution",
  );
  assert.equal(
    verifyEvidencePack(conflictRuntime.exportEvidencePack(conflictMission.mission_id)).ok,
    false,
  );
}

async function frozenDagProof(): Promise<void> {
  const runtime = new MissionRuntime();
  const template = freezeTemplate("dispatch-bridge");
  const mission = runtime.createMission({
    client_request_id: "dag-request",
    mission_idempotency_key: "dag-key",
    template_id: template.template_id,
    template_version: template.template_version,
    graph_snapshot: template.graph_snapshot,
  });
  assert.throws(
    () => runtime.addTask(mission.mission_id, "Bypass", "Practice"),
    (error: unknown) => (error as { code?: string }).code === "GRAPH_NODE_REQUIRED",
  );

  const practiceTask = runtime.addTask(
    mission.mission_id,
    "Practice acknowledge",
    "Practice",
    { graph_node_id: "practice" },
  );
  assert.throws(
    () =>
      runtime.authorizeIntent({
        call_task_id: practiceTask.call_task_id,
        attempt_no: 1,
        payload: payload("practice before fact"),
        consent_recorded: true,
        timezone: "Europe/Berlin",
      }),
    (error: unknown) => (error as { code?: string }).code === "MISSING_REQUIRED_FACTS",
  );

  const customerTask = runtime.addTask(
    mission.mission_id,
    "Customer confirm",
    "Customer",
    { graph_node_id: "customer" },
  );
  const customerIntent = runtime.authorizeIntent({
    call_task_id: customerTask.call_task_id,
    attempt_no: 1,
    payload: payload("customer confirmation"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const mock = new MockCalleAdapter();
  mock.scenarioByKey.set(
    customerIntent.provider_idempotency_key,
    "verbally_confirmed",
  );
  const dispatcher = new IntentDispatcher(runtime, mock, { now: NOON });
  await dispatcher.dispatch(customerIntent.call_intent_id);
  await dispatcher.ingestTerminal(customerIntent.call_intent_id);
  runtime.recordFact({
    mission_id: mission.mission_id,
    fact: "appointment_time",
    value: "2026-09-04T15:00:00+02:00",
    confirmedBy: "customer",
    source_intent_id: customerIntent.call_intent_id,
  });

  const practiceIntent = runtime.authorizeIntent({
    call_task_id: practiceTask.call_task_id,
    attempt_no: 1,
    payload: payload("practice after fact"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  assert.equal(
    Array.isArray(
      practiceIntent.canonical_call_payload.metadata.continuum_fact_provenance,
    ),
    true,
  );
  mock.scenarioByKey.set(
    practiceIntent.provider_idempotency_key,
    "practice_acknowledged",
  );
  await dispatcher.dispatch(practiceIntent.call_intent_id);
  await dispatcher.ingestTerminal(practiceIntent.call_intent_id);
  assert.equal(
    runtime.events
      .list(mission.mission_id)
      .some((event) => event.event_type === "fact_consumed"),
    true,
  );
  assert.equal(verifyEvidencePack(runtime.exportEvidencePack(mission.mission_id)).ok, true);
}

async function durableStopAndLiveCapProof(root: string): Promise<void> {
  const managedKeys = [
    "CONTINUUM_GLOBAL_STOP_FILE",
    "CONTINUUM_OPERATOR_STOP",
    "SPIKE_STOP",
    "SPIKE_LIVE",
    "CALLE_API_KEY",
    "CALLE_BASE_URL",
    "CALLE_LIVE_EXPERIMENT",
    "CALLE_LIVE_CONFIRMATION",
    "CALLE_LIVE_ALLOWLIST",
    "CALLE_LIVE_CONSENT",
    "CALLE_LIVE_MAX_CALLS",
    "CALLE_LIVE_BUDGET_REMAINING",
    "CALLE_LIVE_TIMEZONE",
    "CALLE_LIVE_WINDOW_START",
    "CALLE_LIVE_WINDOW_END",
    "CALLE_LIVE_RESERVATION_FILE",
  ] as const;
  const previous = new Map(managedKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.CONTINUUM_GLOBAL_STOP_FILE = join(root, "global-stop.lock");
    delete process.env.SPIKE_STOP;
    delete process.env.CONTINUUM_OPERATOR_STOP;
    setDurableOperatorStop(true);
    assert.equal(isGlobalStopActive(), true);
    delete process.env.CONTINUUM_OPERATOR_STOP;
    assert.equal(isGlobalStopActive(), true, "stop survives process-memory loss");
    setDurableOperatorStop(false);
    assert.equal(isGlobalStopActive(), false);
    process.env.SPIKE_STOP = "1";
    setDurableOperatorStop(false);
    assert.equal(isGlobalStopActive(), true, "operator resume cannot clear external stop");

    process.env.SPIKE_STOP = "0";
    process.env.SPIKE_LIVE = "1";
    process.env.CALLE_API_KEY = "DUMMY_TEST_KEY";
    process.env.CALLE_BASE_URL = "https://api.heycall-e.com";
    process.env.CALLE_LIVE_EXPERIMENT = "ADAPTER_CAP_TEST";
    process.env.CALLE_LIVE_CONFIRMATION =
      "CONFIRM_ADAPTER_CAP_TEST_ONE_ALLOWLISTED_CALL";
    process.env.CALLE_LIVE_ALLOWLIST = "+491111111111";
    process.env.CALLE_LIVE_CONSENT = "1";
    process.env.CALLE_LIVE_MAX_CALLS = "1";
    process.env.CALLE_LIVE_BUDGET_REMAINING = "1";
    process.env.CALLE_LIVE_TIMEZONE = "UTC";
    const hour = new Date().getUTCHours();
    process.env.CALLE_LIVE_WINDOW_START = String(hour);
    process.env.CALLE_LIVE_WINDOW_END = String((hour + 1) % 24);
    process.env.CALLE_LIVE_RESERVATION_FILE = join(root, "adapter-cap.lock");

    let posts = 0;
    let reads = 0;
    globalThis.fetch = (async (_input, init = {}) => {
      if ((init.method ?? "GET") === "POST") posts += 1;
      else reads += 1;
      return new Response(
        JSON.stringify({ id: "stub_call", status: "completed" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const adapter = new LiveCalleAdapter({
      experiment_id: "ADAPTER_CAP_TEST",
      budget_remaining: 1,
    });
    const livePayload: CanonicalCallPayload = {
      ...payload("adapter cap"),
      recipients: [{ phones: ["+491111111111"], region: "DE" }],
    };
    await adapter.createCall({ idempotency_key: "cap:first", payload: livePayload });
    await assert.rejects(
      () =>
        adapter.createCall({
          idempotency_key: "cap:second",
          payload: livePayload,
        }),
      (error: unknown) =>
        (error as { code?: string }).code === "LIVE_DISPATCH_ALREADY_RESERVED",
    );
    assert.equal(posts, 1);
    process.env.SPIKE_STOP = "1";
    await adapter.getCall("stub_call");
    assert.equal(reads, 1, "read-only status remains available after stop");
  } finally {
    globalThis.fetch = originalFetch;
    setDurableOperatorStop(false);
    for (const key of managedKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  assert.throws(() => canonicalize([undefined]));
  assert.throws(() => canonicalize({ bad: Number.NaN }));
  assert.throws(() => canonicalize(new Date()));

  const root = mkdtempSync(join(tmpdir(), "continuum-runtime-hardening-"));
  try {
    await durableMissionAndSnapshotProof(root);
    await providerOwnershipAndResumeProof();
    await outcomeAndResultConflictProof();
    await frozenDagProof();
    await durableStopAndLiveCapProof(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
  console.log(
    JSON.stringify({
      ok: true,
      mode: "mock_and_stubbed_network",
      live_calls: 0,
      regressions: 11,
    }),
  );
}

main().catch((error) => {
  console.error("runtime hardening FAIL", error);
  process.exit(1);
});
