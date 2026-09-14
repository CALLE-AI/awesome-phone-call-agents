/**
 * Failure Matrix F1–F12 — mock/dry only. 0 live dials.
 * Target: 0 illegal unlocks, ≤1 provider run per intent.
 */
import { assertFrozenPayload } from "../../src/runtime/crypto.js";
import { IntentDispatcher } from "../../src/runtime/dispatcher.js";
import {
  assertMockCannotBurnLiveBudget,
  checkDispatchGuards,
} from "../../src/runtime/guards.js";
import { MissionRuntime } from "../../src/runtime/mission-runtime.js";
import { verifyEvidencePack } from "../../src/runtime/evidence.js";
import { MissionReconciler } from "../../src/runtime/reconciler.js";
import { MissionStore } from "../../src/runtime/store.js";
import { MockCalleAdapter } from "../../src/calle/mock-adapter.js";
import { parseCallePollResponse } from "../../src/calle/live-adapter.js";
import type { CalleAdapter, CallePollResult } from "../../src/calle/types.js";
import type { CanonicalCallPayload } from "../../src/runtime/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOON = new Date("2026-08-03T12:00:00+02:00");
const NIGHT = new Date("2026-08-03T23:30:00+02:00");

function payload(phone = "+490000000000"): CanonicalCallPayload {
  return {
    task: "Matrix dry: confirm Friday 15:00 only. No booking.",
    recipients: [{ phones: [phone], region: "DE", locale: "de-DE" }],
    metadata: { continuum: "failure-matrix" },
    recipient_result_schema: {
      type: "object",
      required: ["acceptance"],
      properties: {
        acceptance: {
          type: "string",
          enum: ["candidate_accepted", "declined", "unresolved"],
        },
      },
    },
  };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertRuns(rt: MissionRuntime, missionId: string): void {
  for (const intent of rt.listIntents(missionId)) {
    const runs = intent.provider_run_id ? 1 : 0;
    assert(runs <= 1, `intent ${intent.call_intent_id} has >1 run`);
  }
  const pack = rt.exportEvidencePack(missionId);
  const v = verifyEvidencePack(pack);
  assert(v.illegal_unresolved_unlocks === 0, `illegal unlocks: ${v.errors.join("; ")}`);
  assert(v.provider_runs_per_intent_ok, "provider runs per intent");
}

function harness(): {
  rt: MissionRuntime;
  mock: MockCalleAdapter;
  dispatcher: IntentDispatcher;
} {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const dispatcher = new IntentDispatcher(rt, mock, { now: NOON });
  return { rt, mock, dispatcher };
}

async function F1_lost_response_before_persist() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f1",
    mission_idempotency_key: "matrix:f1",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "B", "B");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.dropNextResponse = true;
  const lost = await dispatcher.dispatch(intent.call_intent_id);
  assert(lost.ok === false && lost.kind === "ambiguous", "F1 lost → ambiguous");
  const recovered = await dispatcher.recover(intent.call_intent_id);
  assert(recovered.ok, "F1 recover");
  await dispatcher.ingestTerminal(intent.call_intent_id);
  assert(mock.distinctCallCount() === 1, "F1 exactly one provider run");
  assertRuns(rt, m.mission_id);
  console.log("F1 PASS lost-response before persist");
}

async function F2_run_known_before_poll() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f2",
    mission_idempotency_key: "matrix:f2",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "A", "A");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intent.provider_idempotency_key, "declined");
  await dispatcher.dispatch(intent.call_intent_id);
  assert(rt.getIntent(intent.call_intent_id)!.state === "run_known", "F2 run_known");
  // "crash" then resume poll/ingest
  await dispatcher.ingestTerminal(intent.call_intent_id);
  assert(rt.getIntent(intent.call_intent_id)!.state === "terminal", "F2 terminal");
  assertRuns(rt, m.mission_id);
  console.log("F2 PASS run_known before poll");
}

async function F3_mid_ingest() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f3",
    mission_idempotency_key: "matrix:f3",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "A", "A");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intent.provider_idempotency_key, "declined");
  await dispatcher.dispatch(intent.call_intent_id);
  const a = await dispatcher.ingestTerminal(intent.call_intent_id);
  const duplicate = await dispatcher.ingestTerminal(intent.call_intent_id);
  assert(duplicate.outcome === a.outcome, "F3 duplicate result is a no-op");
  assert(
    rt.events
      .list(m.mission_id)
      .some((event) => event.event_type === "duplicate_result_ignored"),
    "F3 duplicate result is auditable",
  );
  assert(a.outcome === "declined", "F3 outcome");
  assertRuns(rt, m.mission_id);
  console.log("F3 PASS terminal ingest is idempotent");
}

async function F4_double_resume() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f4",
    mission_idempotency_key: "matrix:f4",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "B", "B");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.dropNextResponse = true;
  await dispatcher.dispatch(intent.call_intent_id);
  // Concurrent double-resume
  const [a, b] = await Promise.allSettled([
    dispatcher.recover(intent.call_intent_id),
    dispatcher.recover(intent.call_intent_id),
  ]);
  const oks = [a, b].filter(
    (r) => r.status === "fulfilled" && r.value.ok,
  );
  assert(oks.length >= 1, "F4 at least one recover ok");
  assert(mock.distinctCallCount() === 1, "F4 still one call id");
  assert(
    rt.getIntent(intent.call_intent_id)!.provider_run_id !== null,
    "F4 run known",
  );
  assertRuns(rt, m.mission_id);
  console.log("F4 PASS parallel double-resume");
}

async function F5_double_start() {
  const { rt } = harness();
  const a = rt.createMission({
    client_request_id: "f5a",
    mission_idempotency_key: "matrix:f5:same",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: { v: 1 },
  });
  const b = rt.createMission({
    client_request_id: "f5a",
    mission_idempotency_key: "matrix:f5:same",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: { v: 1 },
  });
  assert(a.mission_id === b.mission_id, "F5 same mission");
  let conflictRejected = false;
  try {
    rt.createMission({
      client_request_id: "f5a",
      mission_idempotency_key: "matrix:f5:same",
      template_id: "slot-recovery",
      template_version: 1,
      graph_snapshot: { v: 99 },
    });
  } catch (error) {
    conflictRejected =
      (error as { code?: string }).code === "MISSION_IDEMPOTENCY_CONFLICT";
  }
  assert(conflictRejected, "F5 changed mission input rejected");
  assert(
    JSON.stringify(a.graph_snapshot) === JSON.stringify({ v: 1 }),
    "F5 frozen graph",
  );
  console.log("F5 PASS double-start idempotency");
}

async function F6_ambiguous_blocks_unlock() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f6",
    mission_idempotency_key: "matrix:f6",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "B", "B");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intent.provider_idempotency_key, "early_ja_unresolved");
  mock.dropNextResponse = true;
  await dispatcher.dispatch(intent.call_intent_id);
  const unlock = rt.tryUnlockNext({
    mission_id: m.mission_id,
    upstream_intent_id: intent.call_intent_id,
  });
  assert(!unlock.ok, "F6 unlock refused");
  assertRuns(rt, m.mission_id);
  console.log("F6 PASS ambiguous blocks C");
}

async function F7_cancel_then_late_ingest() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f7",
    mission_idempotency_key: "matrix:f7",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const taskPlanned = rt.addTask(m.mission_id, "C", "C");
  rt.authorizeIntent({
    call_task_id: taskPlanned.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const taskInflight = rt.addTask(m.mission_id, "B", "B");
  const inflight = rt.authorizeIntent({
    call_task_id: taskInflight.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(inflight.provider_idempotency_key, "declined");
  await dispatcher.dispatch(inflight.call_intent_id);
  rt.requestCancel(m.mission_id, "operator cancel");
  assert(
    rt.getMission(m.mission_id)!.status === "cancellation_requested",
    "F7 mission cancel requested",
  );
  assert(
    rt.listIntents(m.mission_id).some((i) => i.state === "cancelled"),
    "F7 planned cancelled",
  );
  // Late ingest of in-flight is allowed (truth), but must not unlock downstream
  await dispatcher.ingestTerminal(inflight.call_intent_id);
  const unlock = rt.tryUnlockNext({
    mission_id: m.mission_id,
    upstream_intent_id: inflight.call_intent_id,
  });
  assert(!unlock.ok, "F7 no unlock after cancel");
  assertRuns(rt, m.mission_id);
  const pack = rt.exportEvidencePack(m.mission_id);
  assert(verifyEvidencePack(pack).no_cancelled_downstream_dispatch, "F7 no post-cancel dispatch");
  console.log("F7 PASS cancel + late ingest");
}

async function F8_late_after_downstream_unlocked() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f8",
    mission_idempotency_key: "matrix:f8",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const taskA = rt.addTask(m.mission_id, "A", "A");
  const intentA = rt.authorizeIntent({
    call_task_id: taskA.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intentA.provider_idempotency_key, "declined");
  await dispatcher.dispatch(intentA.call_intent_id);
  await dispatcher.ingestTerminal(intentA.call_intent_id);
  const u1 = rt.tryUnlockNext({
    mission_id: m.mission_id,
    upstream_intent_id: intentA.call_intent_id,
  });
  assert(u1.ok, "F8 first unlock ok");

  const taskB = rt.addTask(m.mission_id, "B", "B");
  const intentB = rt.authorizeIntent({
    call_task_id: taskB.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intentB.provider_idempotency_key, "declined");
  await dispatcher.dispatch(intentB.call_intent_id);
  await dispatcher.ingestTerminal(intentB.call_intent_id);

  // "Late" re-evaluation of A must not create a second illegal path;
  // unlock from A again is still ok (non-confirm) but must not mint runs.
  const uLate = rt.tryUnlockNext({
    mission_id: m.mission_id,
    upstream_intent_id: intentA.call_intent_id,
  });
  assert(uLate.ok, "F8 late unlock decision still non-confirm");
  assert(mock.distinctCallCount() === 2, "F8 still A+B only");
  assertRuns(rt, m.mission_id);
  console.log("F8 PASS late after downstream unlocked");
}

async function F9_reconciler_frozen_payload() {
  const dir = mkdtempSync(join(tmpdir(), "cc-f9-"));
  const dbPath = join(dir, "f9.sqlite");
  try {
    const store = new MissionStore(dbPath);
    const rt = new MissionRuntime();
    rt.attachStore(store);
    const mock = new MockCalleAdapter();
    rt.providerRunsExporter = () => mock.exportRuns();
    const dispatcher = new IntentDispatcher(rt, mock, { now: NOON });
    const m = rt.createMission({
      client_request_id: "f9",
      mission_idempotency_key: "matrix:f9",
      template_id: "slot-recovery",
      template_version: 1,
      graph_snapshot: {},
    });
    rt.setSessionMeta(m.mission_id, {
      proof: "f9",
      ledger_labels: ["B"],
      handoff_json: null,
    });
    const task = rt.addTask(m.mission_id, "B", "B");
    const intent = rt.authorizeIntent({
      call_task_id: task.call_task_id,
      attempt_no: 1,
      payload: payload(),
      consent_recorded: true,
      timezone: "Europe/Berlin",
    });
    mock.dropNextResponse = true;
    await dispatcher.dispatch(intent.call_intent_id);
    rt.flushStore(m.mission_id);

    // Isolate death: drop RAM, reload from SQLite
    const snap = store.loadSnapshot(m.mission_id)!;
    const rt2 = MissionRuntime.fromSnapshot(snap, store);
    const mock2 = new MockCalleAdapter();
    mock2.importRuns(snap.provider_runs);
    rt2.providerRunsExporter = () => mock2.exportRuns();
    const dispatcher2 = new IntentDispatcher(rt2, mock2, { now: NOON });
    const reconciler = new MissionReconciler(rt2, dispatcher2);
    const result = await reconciler.reconcileMission(m.mission_id);
    assert(result.recovered.length === 1, "F9 reconciled");
    assert(mock2.distinctCallCount() === 1, "F9 one provider run");
    assertRuns(rt2, m.mission_id);
    console.log("F9 PASS store reload + reconciler");
    store.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may keep WAL briefly */
    }
  }
}

async function F10_crash_runtime_jury() {
  const dir = mkdtempSync(join(tmpdir(), "cc-f10-"));
  const dbPath = join(dir, "f10.sqlite");
  try {
    const store = new MissionStore(dbPath);
    const rt = new MissionRuntime();
    rt.attachStore(store);
    const mock = new MockCalleAdapter();
    rt.providerRunsExporter = () => mock.exportRuns();
    const dispatcher = new IntentDispatcher(rt, mock, { now: NOON });
    const m = rt.createMission({
      client_request_id: "f10",
      mission_idempotency_key: "matrix:f10",
      template_id: "slot-recovery",
      template_version: 1,
      graph_snapshot: { jury: "CRASH RUNTIME" },
    });
    rt.setSessionMeta(m.mission_id, {
      proof: "crash_runtime",
      ledger_labels: ["B"],
      handoff_json: null,
    });
    const task = rt.addTask(m.mission_id, "B", "B");
    const intent = rt.authorizeIntent({
      call_task_id: task.call_task_id,
      attempt_no: 1,
      payload: payload(),
      consent_recorded: true,
      timezone: "Europe/Berlin",
    });
    mock.scenarioByKey.set(intent.provider_idempotency_key, "declined");
    dispatcher.faultPoint = "after_create_before_persist";
    const faulted = await dispatcher.dispatch(intent.call_intent_id);
    assert(
      faulted.ok === false && faulted.kind === "fault_injected",
      "F10 fault injected",
    );
    assert(
      rt.getIntent(intent.call_intent_id)!.state === "dispatching",
      "F10 stuck dispatching",
    );
    assert(
      rt.getIntent(intent.call_intent_id)!.provider_run_id === null,
      "F10 no durable run id yet",
    );

    const snap = store.loadSnapshot(m.mission_id)!;
    const rt2 = MissionRuntime.fromSnapshot(snap, store);
    const mock2 = new MockCalleAdapter();
    mock2.importRuns(snap.provider_runs);
    rt2.providerRunsExporter = () => mock2.exportRuns();
    const dispatcher2 = new IntentDispatcher(rt2, mock2, { now: NOON });
    const reconciler = new MissionReconciler(rt2, dispatcher2);
    const result = await reconciler.reconcileMission(m.mission_id);
    assert(result.recovered.length === 1, "F10 reconcile");
    await dispatcher2.ingestTerminal(intent.call_intent_id);
    assert(rt2.providerRunCount(m.mission_id) === 1, "F10 one run");
    assertRuns(rt2, m.mission_id);
    console.log("F10 PASS CRASH RUNTIME fault + SQLite reconcile");
    store.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may keep WAL briefly */
    }
  }
}

async function F11_payload_change_reject() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "f11",
    mission_idempotency_key: "matrix:f11",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "A", "A");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const changed = payload();
  changed.task = "CHANGED PAYLOAD";
  let code = "";
  try {
    assertFrozenPayload(
      intent.call_intent_id,
      intent.canonical_call_payload,
      changed,
    );
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
  }
  assert(code === "PAYLOAD_CHANGED", "F11 crypto reject");

  // Dispatcher gate: beginDispatch via dispatch path rejects changed payload
  let beginCode = "";
  try {
    rt.beginDispatch(intent.call_intent_id, changed);
  } catch (e) {
    beginCode = (e as { code?: string }).code ?? "";
  }
  assert(beginCode === "PAYLOAD_CHANGED", "F11 dispatcher beginDispatch reject");
  assert(rt.getIntent(intent.call_intent_id)!.state === "planned", "F11 stays planned");
  void mock;
  void dispatcher;
  console.log("F11 PASS payload change reject (crypto + dispatch gate)");
}

async function F12_sim_cannot_burn_live() {
  const blocked = assertMockCannotBurnLiveBudget("live");
  assert(!blocked.ok && blocked.code === "LIVE_REFUSED", "F12 live refused");
  const mockOk = assertMockCannotBurnLiveBudget("mock");
  assert(mockOk.ok, "F12 mock ok");

  const rt = new MissionRuntime();
  const fakeLive: CalleAdapter = {
    mode: "live",
    async createCall() {
      throw new Error("must not dial");
    },
    async getCall() {
      throw new Error("must not poll");
    },
  };
  const dispatcher = new IntentDispatcher(rt, fakeLive, { now: NOON });
  const m = rt.createMission({
    client_request_id: "f12",
    mission_idempotency_key: "matrix:f12",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "A", "A");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const res = await dispatcher.dispatch(intent.call_intent_id);
  assert(
    res.ok === false && res.kind === "guard_blocked" && res.code === "LIVE_REFUSED",
    "F12 dispatcher blocks live",
  );
  assert(rt.getIntent(intent.call_intent_id)!.state === "planned", "F12 no dispatch begun");
  console.log("F12 PASS sim cannot burn live budget");
}

async function guards_extra() {
  const quiet = checkDispatchGuards({
    consent_recorded: true,
    timezone: "Europe/Berlin",
    payload: payload(),
    provider_run_count: 0,
    mission_status: "running",
    dispatches_stopped: false,
    config: { now: NIGHT },
  });
  assert(!quiet.ok && quiet.code === "QUIET_HOURS", "quiet hours");

  const allow = checkDispatchGuards({
    consent_recorded: true,
    timezone: "Europe/Berlin",
    payload: payload("+499999999999"),
    provider_run_count: 0,
    mission_status: "running",
    dispatches_stopped: false,
    config: { now: NOON },
  });
  assert(!allow.ok && allow.code === "NOT_ALLOWLISTED", "allowlist");

  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "gmax",
    mission_idempotency_key: "matrix:gmax",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const limited = new IntentDispatcher(rt, mock, {
    now: NOON,
    max_calls_per_mission: 2,
  });
  for (let i = 0; i < 2; i++) {
    const task = rt.addTask(m.mission_id, `T${i}`, `T${i}`);
    const intent = rt.authorizeIntent({
      call_task_id: task.call_task_id,
      attempt_no: 1,
      payload: payload(),
      consent_recorded: true,
      timezone: "Europe/Berlin",
    });
    mock.scenarioByKey.set(intent.provider_idempotency_key, "declined");
    const d = await limited.dispatch(intent.call_intent_id);
    assert(d.ok, `max dispatch ${i}`);
    await limited.ingestTerminal(intent.call_intent_id);
  }
  const task3 = rt.addTask(m.mission_id, "T2", "T2");
  const intent3 = rt.authorizeIntent({
    call_task_id: task3.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const blocked = await limited.dispatch(intent3.call_intent_id);
  assert(
    blocked.ok === false && blocked.code === "MAX_CALLS",
    "max_calls_per_mission",
  );
  console.log("guards PASS quiet/allowlist/max_calls");
}

async function operator_pause_blocks_dispatch() {
  const { rt, mock, dispatcher } = harness();
  const m = rt.createMission({
    client_request_id: "op",
    mission_idempotency_key: "matrix:op",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(m.mission_id, "A", "A");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  rt.pauseMission(m.mission_id, "ops pause");
  const res = await dispatcher.dispatch(intent.call_intent_id);
  assert(res.ok === false && res.code === "MISSION_NOT_RUNNING", "pause blocks");
  rt.resumeMission(m.mission_id, "ops resume");
  mock.scenarioByKey.set(intent.provider_idempotency_key, "declined");
  const ok = await dispatcher.dispatch(intent.call_intent_id);
  assert(ok.ok, "resume allows");

  // stop_dispatches blocks further + recover
  const task2 = rt.addTask(m.mission_id, "B", "B");
  const intent2 = rt.authorizeIntent({
    call_task_id: task2.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  rt.stopAllDispatches(m.mission_id, "stop");
  const blocked = await dispatcher.dispatch(intent2.call_intent_id);
  assert(
    blocked.ok === false && blocked.code === "STOP_DISPATCHES",
    "stop_dispatches blocks",
  );

  // recover also respects guards
  mock.dropNextResponse = true;
  const task3 = rt.addTask(m.mission_id, "C", "C");
  // clear stop for setup then re-stop for recover test
  const rtClear = harness();
  const m2 = rtClear.rt.createMission({
    client_request_id: "op2",
    mission_idempotency_key: "matrix:op2",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const tAmb = rtClear.rt.addTask(m2.mission_id, "X", "X");
  const iAmb = rtClear.rt.authorizeIntent({
    call_task_id: tAmb.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  rtClear.mock.dropNextResponse = true;
  await rtClear.dispatcher.dispatch(iAmb.call_intent_id);
  rtClear.rt.pauseMission(m2.mission_id, "pause before recover");
  const rec = await rtClear.dispatcher.recover(iAmb.call_intent_id);
  assert(
    rec.ok === false && rec.code === "MISSION_NOT_RUNNING",
    "recover respects pause",
  );
  void intent2;
  void task3;
  console.log("operator PASS pause/resume/stop/recover-guards");
}

async function hardening_event_scope_and_ownership() {
  const rt = new MissionRuntime();
  const first = rt.createMission({
    client_request_id: "hard-event-a",
    mission_idempotency_key: "matrix:hard:event:a",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const second = rt.createMission({
    client_request_id: "hard-event-b",
    mission_idempotency_key: "matrix:hard:event:b",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const taskA = rt.addTask(first.mission_id, "A", "A");
  rt.addTask(second.mission_id, "B", "B");
  for (const missionId of [first.mission_id, second.mission_id]) {
    const events = rt.events.list(missionId);
    assert(events[0]?.sequence_no === 1, "mission chain starts at seq 1");
    assert(events[0]?.prev_hash === null, "mission chain starts at null hash");
    assert(rt.events.verify(missionId).ok, "independent mission chain verifies");
    assert(verifyEvidencePack(rt.exportEvidencePack(missionId)).ok, "mission pack verifies");
  }

  const leaked = rt.events.list(first.mission_id);
  leaked[0]!.actor = "operator";
  assert(rt.events.verify(first.mission_id).ok, "event list cannot mutate the live log");

  const source = rt.authorizeIntent({
    call_task_id: taskA.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  source.canonical_call_payload.task = "external mutation attempt";
  assert(
    rt.getIntent(source.call_intent_id)!.canonical_call_payload.task !==
      "external mutation attempt",
    "returned payload is not a mutable runtime reference",
  );
  rt.beginDispatch(source.call_intent_id);
  rt.attachProviderRun(source.call_intent_id, "run_hard_owner");
  rt.completeIntent(source.call_intent_id, "verbally_confirmed", "owner-result");

  let crossUnlockRejected = false;
  try {
    rt.tryUnlockNext({
      mission_id: second.mission_id,
      upstream_intent_id: source.call_intent_id,
    });
  } catch {
    crossUnlockRejected = true;
  }
  assert(crossUnlockRejected, "cross-mission unlock source rejected");

  let crossFactRejected = false;
  try {
    rt.recordFact({
      mission_id: second.mission_id,
      fact: "slot",
      value: "Friday 15:00",
      confirmedBy: "A",
      source_intent_id: source.call_intent_id,
    });
  } catch {
    crossFactRejected = true;
  }
  assert(crossFactRejected, "cross-mission fact source rejected");
  console.log("hardening PASS mission-local chains + ownership + immutable views");
}

async function hardening_recovery_guards() {
  const { rt, mock } = harness();
  const mission = rt.createMission({
    client_request_id: "hard-recover",
    mission_idempotency_key: "matrix:hard:recover",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const task = rt.addTask(mission.mission_id, "A", "A");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const limited = new IntentDispatcher(rt, mock, {
    now: NOON,
    max_calls_per_mission: 1,
  });
  mock.dropNextResponse = true;
  await limited.dispatch(intent.call_intent_id);
  assert(rt.callBudgetUsed(mission.mission_id) === 1, "lost response reserves budget");
  const recovered = await limited.recover(intent.call_intent_id);
  assert(recovered.ok, "hard-idempotent same-key recovery works at call limit");
  assert(mock.distinctCallCount() === 1, "recovery at limit creates no second run");

  let unverifiedCreates = 0;
  const unverified: CalleAdapter = {
    mode: "mock",
    idempotency_guarantee: "unverified",
    async createCall() {
      unverifiedCreates += 1;
      return { call_id: "must_not_exist", status: "accepted", reused: false };
    },
    async getCall() {
      throw new Error("must not poll");
    },
  };
  const rtUnverified = new MissionRuntime();
  const mUnverified = rtUnverified.createMission({
    client_request_id: "hard-unverified",
    mission_idempotency_key: "matrix:hard:unverified",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const tUnverified = rtUnverified.addTask(mUnverified.mission_id, "U", "U");
  const iUnverified = rtUnverified.authorizeIntent({
    call_task_id: tUnverified.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  rtUnverified.beginDispatch(iUnverified.call_intent_id);
  rtUnverified.markAmbiguous(iUnverified.call_intent_id, "lost");
  const refused = await new IntentDispatcher(rtUnverified, unverified, {
    now: NOON,
  }).recover(iUnverified.call_intent_id);
  assert(
    !refused.ok && refused.code === "RECOVERY_IDEMPOTENCY_UNVERIFIED",
    "unverified provider recovery fails closed",
  );
  assert(unverifiedCreates === 0, "unverified recovery never calls provider");

  const rtMulti = new MissionRuntime();
  const mMulti = rtMulti.createMission({
    client_request_id: "hard-multi-stuck",
    mission_idempotency_key: "matrix:hard:multi-stuck",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const stuck = ["A", "B"].map((label) => {
    const t = rtMulti.addTask(mMulti.mission_id, label, label);
    return rtMulti.authorizeIntent({
      call_task_id: t.call_task_id,
      attempt_no: 1,
      payload: payload(),
      consent_recorded: true,
      timezone: "Europe/Berlin",
    });
  });
  rtMulti.beginDispatch(stuck[0]!.call_intent_id);
  rtMulti.markAmbiguous(stuck[0]!.call_intent_id, "lost-a");
  let secondDispatchRejected = false;
  try {
    rtMulti.beginDispatch(stuck[1]!.call_intent_id);
  } catch (error) {
    secondDispatchRejected = [
      "MISSION_NOT_RUNNING",
      "MISSION_HAS_STUCK_INTENT",
    ].includes((error as { code?: string }).code ?? "");
  }
  assert(
    secondDispatchRejected,
    "a stuck intent must prevent a second new dispatch",
  );
  rtMulti.recoverProviderRun(stuck[0]!.call_intent_id, "run_stuck_a");
  assert(
    rtMulti.getMission(mMulti.mission_id)!.status === "running",
    "mission resumes only after its stuck intent is recovered",
  );
  console.log("hardening PASS recovery budget/idempotency/status guards");
}

async function hardening_result_contract_and_official_shape() {
  const basePoll: CallePollResult = {
    call_id: "fixture_call",
    status: "completed",
    provider_state: "completed",
    business_outcome: "candidate_accepted",
    transcript: [
      { speaker: "bot", text: "Can you take Friday at 15:00?" },
      { speaker: "user", text: "Yes." },
    ],
    structured: { acceptance: "candidate_accepted" },
    confirmation_question_asked: true,
    answer_after_question: true,
    slot_matches_offered: true,
    schema_valid: true,
    reliable_transcript: true,
    transcript_result_conflict: false,
  };
  const cases: Array<Partial<CallePollResult>> = [
    { confirmation_question_asked: false },
    { answer_after_question: false },
    { slot_matches_offered: false },
    { transcript_result_conflict: true },
  ];
  for (const [index, override] of cases.entries()) {
    const adapter: CalleAdapter = {
      mode: "mock",
      idempotency_guarantee: "hard",
      async createCall() {
        return { call_id: `fixture_${index}`, status: "accepted", reused: false };
      },
      async getCall(callId) {
        return { ...basePoll, ...override, call_id: callId };
      },
    };
    const rt = new MissionRuntime();
    const mission = rt.createMission({
      client_request_id: `hard-result-${index}`,
      mission_idempotency_key: `matrix:hard:result:${index}`,
      template_id: "slot-recovery",
      template_version: 1,
      graph_snapshot: {},
    });
    const task = rt.addTask(mission.mission_id, "R", "R");
    const intent = rt.authorizeIntent({
      call_task_id: task.call_task_id,
      attempt_no: 1,
      payload: payload(),
      consent_recorded: true,
      timezone: "Europe/Berlin",
    });
    const dispatcher = new IntentDispatcher(rt, adapter, { now: NOON });
    assert((await dispatcher.dispatch(intent.call_intent_id)).ok, "fixture dispatch");
    const terminal = await dispatcher.ingestTerminal(intent.call_intent_id);
    assert(terminal.outcome === "unresolved", `affirmative hard rule case ${index}`);
  }

  const official = parseCallePollResponse("official_fixture", {
    status: "completed",
    task_completed: true,
    completion_confidence: { score: 0.92, label: "high" },
    structured_result: { completed_count: 1 },
    recipients: [
      {
        structured_result: {
          can_attend: "yes",
          confirmation_question_asked: true,
          answer_after_question: true,
          slot_matches_offered: true,
          transcript_result_conflict: false,
        },
        attempts: [
          {
            transcript_turns: [
              { offset_seconds: 0, speaker: "bot", text: "Friday?" },
              { offset_seconds: 4, speaker: "user", text: "Yes." },
            ],
          },
        ],
      },
    ],
  });
  assert(official.transcript.length === 2, "official transcript_turns parsed");
  assert(official.business_outcome === "candidate_accepted", "recipient result parsed");
  assert(official.reliable_transcript, "official confidence parsed");
  assert(!official.transcript_result_conflict, "explicit conflict signal parsed");

  let polled = 0;
  const queuedAdapter: CalleAdapter = {
    mode: "mock",
    idempotency_guarantee: "hard",
    async createCall() {
      return { call_id: "queued_fixture", status: "accepted", reused: false };
    },
    async getCall(callId) {
      polled += 1;
      return {
        ...basePoll,
        call_id: callId,
        status: "queued",
        provider_state: "accepted",
        business_outcome: null,
      };
    },
  };
  const rtQueued = new MissionRuntime();
  const mQueued = rtQueued.createMission({
    client_request_id: "hard-queued",
    mission_idempotency_key: "matrix:hard:queued",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const tQueued = rtQueued.addTask(mQueued.mission_id, "Q", "Q");
  const iQueued = rtQueued.authorizeIntent({
    call_task_id: tQueued.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  const queuedDispatcher = new IntentDispatcher(rtQueued, queuedAdapter, { now: NOON });
  await queuedDispatcher.dispatch(iQueued.call_intent_id);
  let notTerminalCode = "";
  try {
    await queuedDispatcher.ingestTerminal(iQueued.call_intent_id);
  } catch (error) {
    notTerminalCode = (error as { code?: string }).code ?? "";
  }
  assert(notTerminalCode === "PROVIDER_NOT_TERMINAL", "queued poll not ingested");
  assert(polled === 1, "queued fixture polled once");
  assert(rtQueued.getIntent(iQueued.call_intent_id)!.state === "run_known", "state stays run_known");
  console.log("hardening PASS confirmation hard rule + official parser + poll state");
}

async function hardening_append_only_store() {
  const dir = mkdtempSync(join(tmpdir(), "cc-append-only-"));
  const dbPath = join(dir, "append-only.sqlite");
  try {
    const store = new MissionStore(dbPath);
    const rt = new MissionRuntime();
    rt.attachStore(store);
    const mission = rt.createMission({
      client_request_id: "hard-append",
      mission_idempotency_key: "matrix:hard:append",
      template_id: "slot-recovery",
      template_version: 1,
      graph_snapshot: {},
    });
    rt.addTask(mission.mission_id, "A", "A");
    const snap = store.loadSnapshot(mission.mission_id)!;
    snap.events[0]!.actor = "operator";
    let rejected = false;
    try {
      store.saveSnapshot(snap);
    } catch (error) {
      rejected = /APPEND_ONLY_EVENT_CONFLICT/.test(String(error));
    }
    assert(rejected, "durable event rewrite rejected");
    store.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may keep WAL briefly */
    }
  }
  console.log("hardening PASS durable event log is append-only");
}

async function main() {
  await F1_lost_response_before_persist();
  await F2_run_known_before_poll();
  await F3_mid_ingest();
  await F4_double_resume();
  await F5_double_start();
  await F6_ambiguous_blocks_unlock();
  await F7_cancel_then_late_ingest();
  await F8_late_after_downstream_unlocked();
  await F9_reconciler_frozen_payload();
  await F10_crash_runtime_jury();
  await F11_payload_change_reject();
  await F12_sim_cannot_burn_live();
  await guards_extra();
  await operator_pause_blocks_dispatch();
  await hardening_event_scope_and_ownership();
  await hardening_recovery_guards();
  await hardening_result_contract_and_official_shape();
  await hardening_append_only_store();
  console.log("\nFailure matrix: ALL PASS (F1–F12 + guards) · live_calls=0");
}

main().catch((e) => {
  console.error("Failure matrix FAIL", e);
  process.exit(1);
});
