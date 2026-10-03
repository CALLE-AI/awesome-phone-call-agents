import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { MockCalleAdapter } from "../calle/mock-adapter.js";
import {
  IntentDispatcher,
  type DispatchResult,
} from "../runtime/dispatcher.js";
import {
  verifyEvidencePack,
  type EvidencePack,
  type EvidenceVerification,
} from "../runtime/evidence.js";
import { MissionReconciler } from "../runtime/reconciler.js";
import { MissionRuntime } from "../runtime/mission-runtime.js";
import { MissionStore } from "../runtime/store.js";
import { DEFAULT_GUARD_CONFIG } from "../runtime/guards.js";
import { freezeTemplate } from "../runtime/templates.js";
import type { CanonicalCallPayload, StructuredFact } from "../runtime/types.js";
import { setDurableOperatorStop } from "../runtime/global-stop.js";

/** Fixed noon Berlin so quiet-hours guards never flake overnight proofs. */
export const DEMO_GUARD_NOW = new Date("2026-08-03T12:00:00+02:00");

function requireDispatch(
  result: DispatchResult,
  label: string,
): Extract<DispatchResult, { ok: true }> {
  if (!result.ok) {
    const error = new Error(
      `${label} blocked: ${result.code ?? result.kind} (${result.reason})`,
    ) as Error & { code?: string };
    error.code = result.code ?? "PROOF_DISPATCH_FAILED";
    throw error;
  }
  return result;
}

export type LedgerRow = {
  label: string;
  call_intent_id: string | null;
  attempt_no: number | null;
  state: string;
  outcome: string | null;
  provider_run_id: string | null;
  provider_runs: number;
};

export type HandoffView = {
  fact: string;
  value: string;
  source_run_id: string;
  source_intent_id: string;
  used_by_run_id: string | null;
  used_by_label: string;
  practice_outcome: string | null;
};

export type DemoSnapshot = {
  mode: "mock";
  live_calls: 0;
  mission_id: string;
  mission_status: string;
  proof: string;
  ledger: LedgerRow[];
  handoff: HandoffView | null;
  facts: StructuredFact[];
  events: Array<{
    sequence_no: number;
    event_type: string;
    call_intent_id?: string;
    redacted_payload: Record<string, unknown>;
  }>;
  verify: {
    ok: boolean;
    chainIntact: boolean;
    eventCount: number;
    errors: string[];
    facts_traceable: string;
    evidence: EvidenceVerification;
    badge: EvidenceVerification["badge"];
  };
  evidence: EvidencePack;
  updated_at: string;
  dispatches_stopped: boolean;
  stuck_intents: number;
  durable: boolean;
  template: string;
  safety: {
    consent_recorded: boolean;
    timezone: string;
    quiet_hours: string;
    allowlist_label: string;
    max_calls_per_mission: number;
  };
};

export type OperatorAction =
  | "pause"
  | "resume"
  | "cancel_pending"
  | "stop_dispatches"
  | "global_stop"
  | "global_resume";

export type DemoSession = {
  runtime: MissionRuntime;
  dispatcher: IntentDispatcher;
  adapter: MockCalleAdapter;
  reconciler: MissionReconciler;
  store: MissionStore;
  mission_id: string;
  proof: ProofKind | "crash_runtime" | "operator_created";
  handoff: HandoffView | null;
  ledger_labels: string[];
};

let session: DemoSession | null = null;
let sharedStore: MissionStore | null = null;

function getStore(): MissionStore {
  if (!sharedStore) {
    const path =
      process.env.CONTINUUM_DB ??
      join(process.cwd(), ".data", "continuum-call.sqlite");
    mkdirSync(dirname(path), { recursive: true });
    sharedStore = new MissionStore(path);
  }
  return sharedStore;
}

export function getDemoSession(): DemoSession | null {
  return session;
}

function wireProviderExport(sess: {
  runtime: MissionRuntime;
  adapter: MockCalleAdapter;
}): void {
  sess.runtime.providerRunsExporter = () => sess.adapter.exportRuns();
}

function payload(label: string, extraTask = ""): CanonicalCallPayload {
  return {
    task: `Mock ${label}: ${extraTask || "exact confirmation for Friday 15:00 only. No booking."}`,
    recipients: [{ phones: ["+490000000000"], region: "DE", locale: "de-DE" }],
    metadata: { label, continuum: "ops-console" },
    recipient_result_schema: {
      type: "object",
      required: ["acceptance"],
      properties: {
        acceptance: {
          type: "string",
          enum: [
            "candidate_accepted",
            "declined",
            "unresolved",
            "practice_acknowledged",
          ],
        },
      },
    },
  };
}

export type ProofKind = "crash_recover" | "ambiguous_block" | "cross_party";

function row(
  label: string,
  intent: {
    call_intent_id: string;
    attempt_no: number;
    state: string;
    business_outcome: string | null;
    provider_run_id: string | null;
  } | null,
): LedgerRow {
  if (!intent) {
    return {
      label,
      call_intent_id: null,
      attempt_no: null,
      state: "pending",
      outcome: null,
      provider_run_id: null,
      provider_runs: 0,
    };
  }
  return {
    label,
    call_intent_id: intent.call_intent_id,
    attempt_no: intent.attempt_no,
    state: intent.state,
    outcome: intent.business_outcome,
    provider_run_id: intent.provider_run_id,
    provider_runs: intent.provider_run_id ? 1 : 0,
  };
}

function buildLedger(sess: DemoSession): LedgerRow[] {
  const intents = sess.runtime.listIntents(sess.mission_id);
  const byLabel = new Map<string, (typeof intents)[0]>();
  for (const intent of intents) {
    const label = sess.runtime.getTaskLabel(intent.call_task_id);
    byLabel.set(label, intent);
  }
  return sess.ledger_labels.map((label) => row(label, byLabel.get(label) ?? null));
}

export function snapshotFromSession(sess: DemoSession): DemoSnapshot {
  const facts = sess.runtime.getFacts(sess.mission_id);
  const pack = sess.runtime.exportEvidencePack(sess.mission_id);
  const evidenceVerify = verifyEvidencePack(pack);
  const verify = sess.runtime.events.verify(sess.mission_id);
  const events = sess.runtime.events.list(sess.mission_id).map((e) => ({
    sequence_no: e.sequence_no,
    event_type: e.event_type,
    call_intent_id: e.call_intent_id,
    redacted_payload: e.redacted_payload,
  }));
  const factsOk = facts.every((f) => Boolean(f.sourceRunId && f.sourceCallIntentId));
  const mission = sess.runtime.getMission(sess.mission_id)!;
  return {
    mode: "mock",
    live_calls: 0,
    mission_id: sess.mission_id,
    mission_status: mission.status,
    proof: sess.proof,
    ledger: buildLedger(sess),
    handoff: sess.handoff,
    facts,
    events,
    evidence: pack,
    dispatches_stopped: sess.runtime.isDispatchesStopped(sess.mission_id),
    stuck_intents: sess.runtime.listStuckIntents(sess.mission_id).length,
    durable: true,
    template: mission.template_id,
    safety: {
      consent_recorded: true,
      timezone: DEFAULT_GUARD_CONFIG.timezone,
      quiet_hours: `${String(DEFAULT_GUARD_CONFIG.quiet_hours_start).padStart(2, "0")}:00–${String(DEFAULT_GUARD_CONFIG.quiet_hours_end).padStart(2, "0")}:00`,
      allowlist_label: "+49 mock allowlist",
      max_calls_per_mission: DEFAULT_GUARD_CONFIG.max_calls_per_mission,
    },
    verify: {
      ok: verify.ok && factsOk && evidenceVerify.ok,
      chainIntact: verify.chainIntact,
      eventCount: verify.eventCount,
      errors: [...verify.errors, ...evidenceVerify.errors],
      facts_traceable: evidenceVerify.facts_traceable,
      evidence: evidenceVerify,
      badge: evidenceVerify.badge,
    },
    updated_at: new Date().toISOString(),
  };
}

function newDemoRuntime(): {
  runtime: MissionRuntime;
  adapter: MockCalleAdapter;
  dispatcher: IntentDispatcher;
  reconciler: MissionReconciler;
  store: MissionStore;
} {
  const store = getStore();
  const runtime = new MissionRuntime();
  runtime.attachStore(store);
  const adapter = new MockCalleAdapter();
  const dispatcher = new IntentDispatcher(runtime, adapter, {
    now: DEMO_GUARD_NOW,
  });
  const reconciler = new MissionReconciler(runtime, dispatcher);
  wireProviderExport({ runtime, adapter });
  return { runtime, adapter, dispatcher, reconciler, store };
}

function commitSession(
  parts: ReturnType<typeof newDemoRuntime>,
  missionId: string,
  proof: DemoSession["proof"],
  ledger_labels: string[],
  handoff: HandoffView | null,
): DemoSession {
  parts.runtime.setSessionMeta(missionId, {
    proof,
    ledger_labels,
    handoff_json: handoff ? JSON.stringify(handoff) : null,
  });
  parts.runtime.flushStore(missionId);
  session = {
    ...parts,
    mission_id: missionId,
    proof,
    handoff,
    ledger_labels,
  };
  return session;
}

async function runSlotProof(kind: "crash_recover" | "ambiguous_block") {
  const parts = newDemoRuntime();
  const { runtime: rt, adapter: mock, dispatcher } = parts;

  const tpl = freezeTemplate("slot-recovery");
  const mission = rt.createMission({
    client_request_id: `ops-${kind}-${Date.now()}`,
    mission_idempotency_key: `ops:${kind}:${Date.now()}`,
    template_id: tpl.template_id,
    template_version: tpl.template_version,
    graph_snapshot: { ...tpl.graph_snapshot, proof: kind },
    prompt_version: tpl.prompt_version,
    outcome_schema_version: tpl.outcome_schema_version,
  });

  const taskA = rt.addTask(mission.mission_id, "Waitlist A", "Waitlist A");
  const intentA = rt.authorizeIntent({
    call_task_id: taskA.call_task_id,
    attempt_no: 1,
    payload: payload("A"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intentA.provider_idempotency_key, "declined");
  requireDispatch(await dispatcher.dispatch(intentA.call_intent_id), "waitlist A");
  await dispatcher.ingestTerminal(intentA.call_intent_id);
  rt.tryUnlockNext({
    mission_id: mission.mission_id,
    upstream_intent_id: intentA.call_intent_id,
  });

  const taskB = rt.addTask(mission.mission_id, "Waitlist B", "Waitlist B");
  const intentB = rt.authorizeIntent({
    call_task_id: taskB.call_task_id,
    attempt_no: 1,
    payload: payload("B"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });

  if (kind === "crash_recover") {
    mock.scenarioByKey.set(intentB.provider_idempotency_key, "declined");
    mock.dropNextResponse = true;
    const lost = await dispatcher.dispatch(intentB.call_intent_id);
    if (lost.ok || lost.kind !== "ambiguous") {
      throw new Error(`waitlist B lost-response setup failed: ${lost.ok ? "unexpected success" : lost.reason}`);
    }
    requireDispatch(await dispatcher.recover(intentB.call_intent_id), "waitlist B recovery");
    await dispatcher.ingestTerminal(intentB.call_intent_id);
    rt.tryUnlockNext({
      mission_id: mission.mission_id,
      upstream_intent_id: intentB.call_intent_id,
    });
  } else {
    mock.scenarioByKey.set(
      intentB.provider_idempotency_key,
      "early_ja_unresolved",
    );
    mock.dropNextResponse = true;
    const lost = await dispatcher.dispatch(intentB.call_intent_id);
    if (lost.ok || lost.kind !== "ambiguous") {
      throw new Error(`waitlist B ambiguous setup failed: ${lost.ok ? "unexpected success" : lost.reason}`);
    }
    rt.tryUnlockNext({
      mission_id: mission.mission_id,
      upstream_intent_id: intentB.call_intent_id,
    });
  }

  commitSession(
    parts,
    mission.mission_id,
    kind,
    ["Waitlist A", "Waitlist B", "Waitlist C"],
    null,
  );
  return snapshotFromSession(session!);
}

async function runCrossPartyProof() {
  const parts = newDemoRuntime();
  const { runtime: rt, adapter: mock, dispatcher } = parts;

  const tpl = freezeTemplate("dispatch-bridge");
  const mission = rt.createMission({
    client_request_id: `ops-cross-${Date.now()}`,
    mission_idempotency_key: `ops:cross_party:${Date.now()}`,
    template_id: tpl.template_id,
    template_version: tpl.template_version,
    graph_snapshot: { ...tpl.graph_snapshot, proof: "cross_party" },
    prompt_version: tpl.prompt_version,
    outcome_schema_version: tpl.outcome_schema_version,
  });

  const taskCustomer = rt.addTask(
    mission.mission_id,
    "Customer confirm slot",
    "Customer",
    { graph_node_id: "customer" },
  );
  const intentCustomer = rt.authorizeIntent({
    call_task_id: taskCustomer.call_task_id,
    attempt_no: 1,
    payload: payload("Customer", "confirm Friday 15:00 after exact question"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(
    intentCustomer.provider_idempotency_key,
    "verbally_confirmed",
  );
  requireDispatch(
    await dispatcher.dispatch(intentCustomer.call_intent_id),
    "customer confirmation",
  );
  await dispatcher.ingestTerminal(intentCustomer.call_intent_id);

  const fact = rt.recordFact({
    mission_id: mission.mission_id,
    fact: "appointment_time",
    value: "2026-09-04T15:00:00+02:00",
    confirmedBy: "customer",
    source_intent_id: intentCustomer.call_intent_id,
  });

  const gate = rt.canDispatchWithFacts({
    mission_id: mission.mission_id,
    required_facts: ["appointment_time"],
  });
  if (!gate.ok) throw new Error(`missing facts ${gate.missing.join(",")}`);

  const required = rt.requireFact(mission.mission_id, "appointment_time");
  const taskPractice = rt.addTask(
    mission.mission_id,
    "Practice acknowledge slot",
    "Practice",
    {
      graph_node_id: "practice",
      required_facts: ["appointment_time"],
    },
  );
  const practicePayload = payload(
    "Practice",
    `Patient confirmed ${required.value}. Ask practice to acknowledge. No calendar writeback.`,
  );
  practicePayload.metadata = {
    ...practicePayload.metadata,
    uses_fact: required.fact,
    source_run_id: required.sourceRunId,
  };

  const intentPractice = rt.authorizeIntent({
    call_task_id: taskPractice.call_task_id,
    attempt_no: 1,
    payload: practicePayload,
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(
    intentPractice.provider_idempotency_key,
    "practice_acknowledged",
  );
  requireDispatch(
    await dispatcher.dispatch(intentPractice.call_intent_id),
    "practice acknowledgement",
  );
  const practiceTerm = await dispatcher.ingestTerminal(
    intentPractice.call_intent_id,
  );

  rt.recordFact({
    mission_id: mission.mission_id,
    fact: "practice_ack",
    value: "accepted",
    confirmedBy: "practice",
    source_intent_id: intentPractice.call_intent_id,
  });

  const practice = rt.getIntent(intentPractice.call_intent_id)!;

  const handoff: HandoffView = {
    fact: fact.fact,
    value: fact.value,
    source_run_id: fact.sourceRunId,
    source_intent_id: fact.sourceCallIntentId,
    used_by_run_id: practice.provider_run_id,
    used_by_label: "Practice call",
    practice_outcome: practiceTerm.outcome,
  };

  commitSession(parts, mission.mission_id, "cross_party", ["Customer", "Practice"], handoff);
  return snapshotFromSession(session!);
}

export async function runMockProof(kind: ProofKind): Promise<DemoSnapshot> {
  if (kind === "cross_party") return runCrossPartyProof();
  return runSlotProof(kind);
}

/**
 * CRASH RUNTIME: arm fault, dispatch waitlist B, drop in-memory session,
 * leave durable SQLite + provider runs. Jury must hit Reconcile.
 */
export async function runCrashRuntime(): Promise<DemoSnapshot> {
  const parts = newDemoRuntime();
  const { runtime: rt, adapter: mock, dispatcher } = parts;

  const tpl = freezeTemplate("slot-recovery");
  const mission = rt.createMission({
    client_request_id: `ops-crash-rt-${Date.now()}`,
    mission_idempotency_key: `ops:crash_runtime:${Date.now()}`,
    template_id: tpl.template_id,
    template_version: tpl.template_version,
    graph_snapshot: { ...tpl.graph_snapshot, jury: "CRASH RUNTIME" },
    prompt_version: tpl.prompt_version,
    outcome_schema_version: tpl.outcome_schema_version,
  });

  const taskA = rt.addTask(mission.mission_id, "Waitlist A", "Waitlist A");
  const intentA = rt.authorizeIntent({
    call_task_id: taskA.call_task_id,
    attempt_no: 1,
    payload: payload("A"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intentA.provider_idempotency_key, "declined");
  requireDispatch(await dispatcher.dispatch(intentA.call_intent_id), "crash proof waitlist A");
  await dispatcher.ingestTerminal(intentA.call_intent_id);
  rt.tryUnlockNext({
    mission_id: mission.mission_id,
    upstream_intent_id: intentA.call_intent_id,
  });

  const taskB = rt.addTask(mission.mission_id, "Waitlist B", "Waitlist B");
  const intentB = rt.authorizeIntent({
    call_task_id: taskB.call_task_id,
    attempt_no: 1,
    payload: payload("B"),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intentB.provider_idempotency_key, "declined");
  dispatcher.faultPoint = "after_create_before_persist";
  const faulted = await dispatcher.dispatch(intentB.call_intent_id);
  if (faulted.ok || faulted.kind !== "fault_injected") {
    throw new Error("expected fault_injected after create before persist");
  }

  rt.setSessionMeta(mission.mission_id, {
    proof: "crash_runtime",
    ledger_labels: ["Waitlist A", "Waitlist B", "Waitlist C"],
    handoff_json: null,
  });
  rt.flushStore(mission.mission_id);

  // Simulate isolate death: drop RAM, reload from SQLite
  const snap = parts.store.loadSnapshot(mission.mission_id);
  if (!snap) throw new Error("crash: snapshot missing");
  const runtime = MissionRuntime.fromSnapshot(snap, parts.store);
  const adapter = new MockCalleAdapter();
  adapter.importRuns(snap.provider_runs);
  const dispatcher2 = new IntentDispatcher(runtime, adapter, {
    now: DEMO_GUARD_NOW,
  });
  const reconciler = new MissionReconciler(runtime, dispatcher2);
  wireProviderExport({ runtime, adapter });

  session = {
    runtime,
    adapter,
    dispatcher: dispatcher2,
    reconciler,
    store: parts.store,
    mission_id: mission.mission_id,
    proof: "crash_runtime",
    handoff: null,
    ledger_labels: ["Waitlist A", "Waitlist B", "Waitlist C"],
  };
  return snapshotFromSession(session);
}

/** Reload active mission from SQLite (manual crash recovery entry). */
export function reloadFromStore(): DemoSnapshot {
  const store = getStore();
  const id = session?.mission_id ?? store.getActiveMissionId();
  if (!id) throw new Error("no durable mission to reload");
  const snap = store.loadSnapshot(id);
  if (!snap) throw new Error("snapshot missing");
  const runtime = MissionRuntime.fromSnapshot(snap, store);
  const adapter = new MockCalleAdapter();
  adapter.importRuns(snap.provider_runs);
  const dispatcher = new IntentDispatcher(runtime, adapter, {
    now: DEMO_GUARD_NOW,
  });
  const reconciler = new MissionReconciler(runtime, dispatcher);
  wireProviderExport({ runtime, adapter });
  session = {
    runtime,
    adapter,
    dispatcher,
    reconciler,
    store,
    mission_id: id,
    proof: (snap.proof as DemoSession["proof"]) || "crash_runtime",
    handoff: snap.handoff_json
      ? (JSON.parse(snap.handoff_json) as HandoffView)
      : null,
    ledger_labels: snap.ledger_labels,
  };
  return snapshotFromSession(session);
}

export async function reconcileSession(
  callIntentId?: string,
): Promise<DemoSnapshot> {
  if (!session) throw new Error("no active mission — run a proof first");
  if (callIntentId) {
    await session.reconciler.reconcileIntent(session.mission_id, callIntentId);
  } else {
    await session.reconciler.reconcileMission(session.mission_id);
  }
  session.runtime.flushStore(session.mission_id);
  return snapshotFromSession(session);
}

export function applyOperatorAction(
  action: OperatorAction,
  reason: string,
): DemoSnapshot | { ok: true; global_stop: boolean } {
  const why = reason.trim() || "operator";
  if (action === "global_stop") {
    setDurableOperatorStop(true);
    if (session) {
      session.runtime.events.append({
        mission_id: session.mission_id,
        event_type: "global_stop",
        actor: "operator",
        redacted_payload: { reason: why },
      });
      session.runtime.flushStore(session.mission_id);
      return snapshotFromSession(session);
    }
    return { ok: true, global_stop: true };
  }
  if (action === "global_resume") {
    setDurableOperatorStop(false);
    if (session) {
      session.runtime.events.append({
        mission_id: session.mission_id,
        event_type: "global_resume",
        actor: "operator",
        redacted_payload: { reason: why },
      });
      session.runtime.flushStore(session.mission_id);
      return snapshotFromSession(session);
    }
    return { ok: true, global_stop: false };
  }
  if (!session) throw new Error("no active mission — run a proof first");
  const { runtime, mission_id } = session;
  switch (action) {
    case "pause":
      runtime.pauseMission(mission_id, why);
      break;
    case "resume":
      runtime.resumeMission(mission_id, why);
      break;
    case "cancel_pending":
      runtime.requestCancel(mission_id, why);
      break;
    case "stop_dispatches":
      runtime.stopAllDispatches(mission_id, why);
      break;
    default: {
      const _exhaustive: never = action;
      throw new Error(`unknown action ${_exhaustive}`);
    }
  }
  return snapshotFromSession(session);
}

/** Start a live Slot Recovery mission from frozen template (not a canned proof). */
export async function createMissionFromTemplate(
  template: "slot-recovery" | "dispatch-bridge" = "slot-recovery",
): Promise<DemoSnapshot> {
  const parts = newDemoRuntime();
  const { runtime: rt } = parts;
  const tpl = freezeTemplate(template);
  const mission = rt.createMission({
    client_request_id: `ops-create-${Date.now()}`,
    mission_idempotency_key: `ops:create:${template}:${Date.now()}`,
    template_id: tpl.template_id,
    template_version: tpl.template_version,
    graph_snapshot: structuredClone(tpl.graph_snapshot),
    prompt_version: tpl.prompt_version,
    outcome_schema_version: tpl.outcome_schema_version,
  });

  const labels =
    template === "slot-recovery"
      ? ["Waitlist A", "Waitlist B", "Waitlist C"]
      : ["Customer", "Practice"];

  for (const label of labels) {
    rt.addTask(
      mission.mission_id,
      label,
      label,
      template === "dispatch-bridge"
        ? {
            graph_node_id: label === "Practice" ? "practice" : "customer",
            required_facts:
              label === "Practice" ? ["appointment_time"] : [],
          }
        : {},
    );
  }

  commitSession(parts, mission.mission_id, "operator_created", labels, null);
  return snapshotFromSession(session!);
}

export function armFault(point: "after_create_before_persist"): DemoSnapshot {
  if (!session) throw new Error("no active mission");
  session.dispatcher.faultPoint = point;
  session.runtime.events.append({
    mission_id: session.mission_id,
    event_type: "fault_armed",
    actor: "operator",
    redacted_payload: { point },
  });
  session.runtime.flushStore(session.mission_id);
  return snapshotFromSession(session);
}
