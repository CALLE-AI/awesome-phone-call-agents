import {
  assertFrozenPayload,
  canonicalSha256,
  newId,
  payloadSha256,
  providerIdempotencyKey,
} from "./crypto.js";
import { EventLog } from "./event-log.js";
import { isGlobalStopActive } from "./global-stop.js";
import type { MissionStore, MissionSnapshot } from "./store.js";
import {
  canCancelIntentDirectly,
  canTransitionIntent,
  canUnlockNextConflictingCandidate,
  requiresCancellationRequested,
} from "./transitions.js";
import type {
  Actor,
  BusinessOutcome,
  CallIntent,
  CallTask,
  CanonicalCallPayload,
  IntentState,
  Mission,
  MissionStatus,
  StructuredFact,
} from "./types.js";

export type CreateMissionInput = {
  client_request_id: string;
  mission_idempotency_key: string;
  template_id: string;
  template_version: number;
  graph_snapshot: Record<string, unknown>;
  prompt_version?: number;
  outcome_schema_version?: number;
};

function missionInputFingerprint(input: CreateMissionInput | Mission): string {
  return canonicalSha256({
    client_request_id: input.client_request_id,
    mission_idempotency_key: input.mission_idempotency_key,
    template_id: input.template_id,
    template_version: input.template_version,
    graph_snapshot: input.graph_snapshot,
    prompt_version: input.prompt_version ?? 1,
    outcome_schema_version: input.outcome_schema_version ?? 1,
  });
}

function graphNodes(
  graph: Record<string, unknown>,
): Record<string, { required_facts: string[] }> | null {
  const raw = graph.nodes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const nodes: Record<string, { required_facts: string[] }> = {};
  for (const [nodeId, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`invalid graph node ${nodeId}`);
    }
    const required = (value as Record<string, unknown>).required_facts;
    if (
      !Array.isArray(required) ||
      !required.every((fact) => typeof fact === "string" && fact.length > 0)
    ) {
      throw new Error(`invalid required_facts for graph node ${nodeId}`);
    }
    nodes[nodeId] = { required_facts: [...new Set(required)] };
  }
  return nodes;
}

function validateMissionGraph(input: CreateMissionInput): void {
  const nodes = graphNodes(input.graph_snapshot);
  if (input.template_id !== "dispatch-bridge") return;
  if (
    !nodes?.customer ||
    !nodes.practice ||
    nodes.customer.required_facts.length !== 0 ||
    nodes.practice.required_facts.length !== 1 ||
    nodes.practice.required_facts[0] !== "appointment_time"
  ) {
    const error = new Error(
      "dispatch-bridge requires frozen customer/practice DAG dependencies",
    ) as Error & { code: string };
    error.code = "INVALID_TEMPLATE_GRAPH";
    throw error;
  }
}

export class MissionRuntime {
  readonly events = new EventLog();
  private missions = new Map<string, Mission>();
  private tasks = new Map<string, CallTask>();
  private intents = new Map<string, CallIntent>();
  /** mission_id → facts */
  private facts = new Map<string, StructuredFact[]>();
  /** mission_idempotency_key → mission_id */
  private missionKeys = new Map<string, string>();
  /** mission_id → stop new dispatches */
  private stopDispatches = new Set<string>();
  /** task labels for ops UI rebuild */
  private taskLabels = new Map<string, string>();
  /** Optional durable store */
  private store: MissionStore | null = null;
  /** Extra snapshot fields for ops session */
  private sessionMeta = new Map<
    string,
    { proof: string; ledger_labels: string[]; handoff_json: string | null }
  >();
  /** Provider run exporter for store (set by session) */
  providerRunsExporter: (() => MissionSnapshot["provider_runs"]) | null = null;

  attachStore(store: MissionStore): void {
    this.store = store;
  }

  flushStore = (missionId: string): void => {
    if (!this.store) return;
    this.store.saveSnapshot(this.toSnapshot(missionId));
  };

  setSessionMeta(
    missionId: string,
    meta: { proof: string; ledger_labels: string[]; handoff_json: string | null },
  ): void {
    this.sessionMeta.set(missionId, meta);
  }

  toSnapshot(missionId: string): MissionSnapshot {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error("unknown mission");
    const meta = this.sessionMeta.get(missionId) ?? {
      proof: "",
      ledger_labels: [],
      handoff_json: null,
    };
    const task_labels: Record<string, string> = {};
    for (const [k, v] of this.taskLabels) {
      const task = this.tasks.get(k);
      if (task?.mission_id === missionId) task_labels[k] = v;
    }
    const intents = this.listIntents(missionId).map((i) => structuredClone(i));
    const missionIntentKeys = new Set(
      intents.map((intent) => intent.provider_idempotency_key),
    );
    const providerRuns = (this.providerRunsExporter?.() ?? []).filter((run) =>
      missionIntentKeys.has(run.idempotency_key),
    );
    return {
      mission: structuredClone(mission),
      tasks: [...this.tasks.values()].filter((t) => t.mission_id === missionId),
      intents,
      facts: this.getFacts(missionId),
      events: this.events.list(missionId),
      stop_dispatches: this.stopDispatches.has(missionId),
      provider_runs: providerRuns,
      task_labels,
      ledger_labels: meta.ledger_labels,
      proof: meta.proof,
      handoff_json: meta.handoff_json,
    };
  }

  /** Rebuild runtime from durable snapshot (simulates isolate restart). */
  static fromSnapshot(snap: MissionSnapshot, store?: MissionStore): MissionRuntime {
    const rt = new MissionRuntime();
    if (store) rt.attachStore(store);
    rt.importSnapshot(snap);
    return rt;
  }

  createMission(args: CreateMissionInput): Mission {
    validateMissionGraph(args);
    const existing = this.missionKeys.get(args.mission_idempotency_key);
    if (existing) {
      const existingMission = this.missions.get(existing)!;
      this.assertMissionInputMatches(existingMission, args);
      return structuredClone(existingMission);
    }
    const durableExisting = this.store?.loadSnapshotByIdempotencyKey(
      args.mission_idempotency_key,
    );
    if (durableExisting) {
      this.assertMissionInputMatches(durableExisting.mission, args);
      this.importSnapshot(durableExisting);
      return structuredClone(durableExisting.mission);
    }
    const mission: Mission = {
      mission_id: newId("msn"),
      mission_idempotency_key: args.mission_idempotency_key,
      client_request_id: args.client_request_id,
      status: "running",
      template_id: args.template_id,
      template_version: args.template_version,
      graph_snapshot: structuredClone(args.graph_snapshot),
      prompt_version: args.prompt_version ?? 1,
      outcome_schema_version: args.outcome_schema_version ?? 1,
      created_at: new Date().toISOString(),
    };
    this.missions.set(mission.mission_id, mission);
    this.missionKeys.set(args.mission_idempotency_key, mission.mission_id);
    this.events.append({
      mission_id: mission.mission_id,
      event_type: "mission_created",
      actor: "system",
      redacted_payload: {
        template_id: mission.template_id,
        template_version: mission.template_version,
      },
    });
    try {
      this.flushStore(mission.mission_id);
      return structuredClone(mission);
    } catch (error) {
      const winner = this.store?.loadSnapshotByIdempotencyKey(
        args.mission_idempotency_key,
      );
      if (!winner) throw error;
      this.assertMissionInputMatches(winner.mission, args);
      this.missions.delete(mission.mission_id);
      this.missionKeys.delete(args.mission_idempotency_key);
      this.events.replaceAll(
        this.events.list().filter((event) => event.mission_id !== mission.mission_id),
      );
      this.importSnapshot(winner);
      return structuredClone(winner.mission);
    }
  }

  addTask(
    missionId: string,
    goal: string,
    recipientLabel: string,
    options: { graph_node_id?: string; required_facts?: string[] } = {},
  ): CallTask {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error("unknown mission");
    const nodes = graphNodes(mission.graph_snapshot);
    let requiredFacts = [...new Set(options.required_facts ?? [])];
    if (nodes) {
      if (!options.graph_node_id || !nodes[options.graph_node_id]) {
        const error = new Error(
          "task must bind to a node in the frozen mission graph",
        ) as Error & { code: string };
        error.code = "GRAPH_NODE_REQUIRED";
        throw error;
      }
      const fromGraph = nodes[options.graph_node_id].required_facts;
      if (
        options.required_facts &&
        canonicalSha256(requiredFacts) !== canonicalSha256(fromGraph)
      ) {
        throw new Error("task required_facts differ from frozen graph node");
      }
      requiredFacts = [...fromGraph];
    }
    const task: CallTask = {
      call_task_id: newId("task"),
      mission_id: missionId,
      goal,
      recipient_label: recipientLabel,
      graph_node_id: options.graph_node_id,
      required_facts: requiredFacts,
    };
    this.tasks.set(task.call_task_id, task);
    this.taskLabels.set(task.call_task_id, recipientLabel);
    this.events.append({
      mission_id: missionId,
      event_type: "task_added",
      actor: "system",
      call_task_id: task.call_task_id,
      redacted_payload: {
        recipient_label: recipientLabel,
        graph_node_id: task.graph_node_id ?? null,
        required_facts: task.required_facts,
      },
    });
    this.flushStore(missionId);
    return structuredClone(task);
  }

  authorizeIntent(args: {
    call_task_id: string;
    attempt_no: number;
    payload: CanonicalCallPayload;
    consent_recorded: boolean;
    timezone: string;
  }): CallIntent {
    if (!args.consent_recorded) {
      throw new Error("consent_recorded must be true before authorizeIntent");
    }
    const task = this.tasks.get(args.call_task_id);
    if (!task) throw new Error("unknown call_task_id");
    if (
      [...this.intents.values()].some(
        (intent) =>
          intent.call_task_id === args.call_task_id &&
          intent.attempt_no === args.attempt_no,
      )
    ) {
      throw new Error(
        `attempt ${args.attempt_no} already authorized for task ${args.call_task_id}`,
      );
    }

    const call_intent_id = newId("intent");
    const payload = structuredClone(args.payload);
    const requiredFacts = (task.required_facts ?? []).map((factName) => {
      const fact = (this.facts.get(task.mission_id) ?? []).find(
        (candidate) => candidate.fact === factName,
      );
      if (!fact) {
        const error = new Error(
          `missing required fact ${factName} for task ${task.call_task_id}`,
        ) as Error & { code: string };
        error.code = "MISSING_REQUIRED_FACTS";
        throw error;
      }
      return fact;
    });
    payload.metadata = {
      ...payload.metadata,
      call_intent_id,
      call_task_id: args.call_task_id,
      attempt_no: args.attempt_no,
      continuum_fact_provenance: requiredFacts.map((fact) => ({
        fact: fact.fact,
        value: fact.value,
        source_run_id: fact.sourceRunId,
        source_call_intent_id: fact.sourceCallIntentId,
        source_attempt_no: fact.sourceAttemptNo,
      })),
    };
    const intent: CallIntent = {
      call_intent_id,
      call_task_id: args.call_task_id,
      attempt_no: args.attempt_no,
      state: "planned",
      canonical_call_payload: payload,
      payload_sha256: payloadSha256(payload),
      provider_idempotency_key: providerIdempotencyKey(call_intent_id, payload),
      provider_run_id: null,
      business_outcome: null,
      result_fingerprint: null,
      validated_facts: {},
      consent_recorded: true,
      timezone: args.timezone,
    };
    this.intents.set(call_intent_id, intent);
    this.events.append({
      mission_id: task.mission_id,
      event_type: "intent_authorized",
      actor: "system",
      call_task_id: args.call_task_id,
      call_intent_id,
      redacted_payload: {
        attempt_no: args.attempt_no,
        payload_sha256: intent.payload_sha256,
      },
    });
    this.flushStore(task.mission_id);
    return structuredClone(intent);
  }

  /** Mark dispatching — crash window. Does not place a real call. */
  beginDispatch(callIntentId: string, nextPayload?: CanonicalCallPayload): CallIntent {
    const intent = this.requireIntent(callIntentId);
    this.assertIntentPayloadIntegrity(callIntentId);
    const missionId = this.missionIdForIntent(callIntentId);
    const mission = this.missions.get(missionId)!;
    if (isGlobalStopActive()) {
      throw Object.assign(new Error("global stop is active"), {
        code: "GLOBAL_STOP",
      });
    }
    if (mission.status !== "running") {
      throw Object.assign(
        new Error(`mission status ${mission.status} cannot dispatch`),
        { code: "MISSION_NOT_RUNNING" },
      );
    }
    if (this.stopDispatches.has(missionId)) {
      throw Object.assign(new Error("operator stop_dispatches is active"), {
        code: "STOP_DISPATCHES",
      });
    }
    if (
      this.listStuckIntents(missionId).some(
        (candidate) => candidate.call_intent_id !== callIntentId,
      )
    ) {
      throw Object.assign(
        new Error("another intent has unresolved provider identity"),
        { code: "MISSION_HAS_STUCK_INTENT" },
      );
    }
    if (!canTransitionIntent(intent.state, "dispatching")) {
      throw new Error(`illegal intent transition ${intent.state} -> dispatching`);
    }
    if (nextPayload) {
      assertFrozenPayload(
        callIntentId,
        intent.canonical_call_payload,
        nextPayload,
      );
    }
    this.recordRequiredFactConsumption(intent);
    this.setIntentState(intent, "dispatching", "dispatch_begun");
    this.flushStore(missionId);
    return structuredClone(intent);
  }

  attachProviderRun(callIntentId: string, providerRunId: string): CallIntent {
    const intent = this.requireIntent(callIntentId);
    if (intent.provider_run_id && intent.provider_run_id !== providerRunId) {
      throw new Error("duplicate provider run for same call_intent_id");
    }
    this.assertProviderRunOwnership(callIntentId, providerRunId);
    if (!canTransitionIntent(intent.state, "run_known")) {
      throw new Error(`illegal intent transition ${intent.state} -> run_known`);
    }
    intent.provider_run_id = providerRunId;
    this.setIntentState(intent, "run_known", "provider_run_known", {
      provider_run_id: providerRunId,
    });
    this.flushStore(this.missionIdForIntent(callIntentId));
    return structuredClone(intent);
  }

  markAmbiguous(callIntentId: string, reason: string): CallIntent {
    const intent = this.requireIntent(callIntentId);
    this.setIntentState(intent, "ambiguous", "marked_ambiguous", { reason });
    const task = this.tasks.get(intent.call_task_id)!;
    const mission = this.missions.get(task.mission_id)!;
    if (
      mission.status === "running" ||
      mission.status === "blocked_needs_resolution"
    ) {
      this.setMissionStatus(task.mission_id, "blocked_needs_resolution", reason);
    }
    this.flushStore(task.mission_id);
    return structuredClone(intent);
  }

  /**
   * After lost-response recover: attach an existing provider run id.
   * Allowed from dispatching (normal) or ambiguous (recover). Never mints a new intent.
   */
  recoverProviderRun(callIntentId: string, providerRunId: string): CallIntent {
    const intent = this.requireIntent(callIntentId);
    if (intent.provider_run_id && intent.provider_run_id !== providerRunId) {
      throw new Error("duplicate provider run for same call_intent_id");
    }
    this.assertProviderRunOwnership(callIntentId, providerRunId);
    if (intent.state === "dispatching") {
      return this.attachProviderRun(callIntentId, providerRunId);
    }
    if (intent.state !== "ambiguous") {
      throw new Error(`recoverProviderRun from ${intent.state} not allowed`);
    }
    if (!canTransitionIntent(intent.state, "run_known")) {
      throw new Error(`illegal intent transition ${intent.state} -> run_known`);
    }
    intent.provider_run_id = providerRunId;
    this.setIntentState(intent, "run_known", "provider_run_recovered", {
      provider_run_id: providerRunId,
    });
    const task = this.tasks.get(intent.call_task_id)!;
    const mission = this.missions.get(task.mission_id)!;
    const unresolvedRemain = this.listStuckIntents(task.mission_id).some(
      (candidate) => candidate.call_intent_id !== callIntentId,
    );
    if (mission.status === "blocked_needs_resolution" && !unresolvedRemain) {
      mission.status = "running";
      this.events.append({
        mission_id: task.mission_id,
        event_type: "mission_status",
        actor: "system",
        redacted_payload: {
          status: "running",
          reason: "recovered_provider_run",
        },
      });
    }
    this.flushStore(task.mission_id);
    return structuredClone(intent);
  }

  completeIntent(
    callIntentId: string,
    outcome: BusinessOutcome,
    resultFingerprint: string,
    validatedFacts: Record<string, string> = {},
  ): CallIntent {
    const intent = this.requireIntent(callIntentId);
    if (intent.state === "terminal") {
      if (
        intent.business_outcome === outcome &&
        intent.result_fingerprint === resultFingerprint &&
        canonicalSha256(intent.validated_facts ?? {}) ===
          canonicalSha256(validatedFacts)
      ) {
        return structuredClone(intent);
      }
      throw new Error("conflicting terminal result for call_intent_id");
    }
    if (!canTransitionIntent(intent.state, "terminal")) {
      throw new Error(`illegal intent transition ${intent.state} -> terminal`);
    }
    intent.business_outcome = outcome;
    intent.result_fingerprint = resultFingerprint;
    intent.validated_facts = structuredClone(validatedFacts);
    this.setIntentState(intent, "terminal", "intent_terminal", {
      outcome,
      result_fingerprint: resultFingerprint,
      validated_facts_sha256: canonicalSha256(validatedFacts),
    });
    this.flushStore(this.missionIdForIntent(callIntentId));
    return structuredClone(intent);
  }

  recordDuplicateResultIgnored(callIntentId: string): CallIntent {
    const intent = this.requireIntent(callIntentId);
    if (intent.state !== "terminal" || !intent.business_outcome) {
      throw new Error("duplicate result can only be ignored after terminal ingest");
    }
    const missionId = this.missionIdForIntent(callIntentId);
    this.events.append({
      mission_id: missionId,
      event_type: "duplicate_result_ignored",
      actor: "system",
      call_task_id: intent.call_task_id,
      call_intent_id: intent.call_intent_id,
      provider_run_id: intent.provider_run_id ?? undefined,
      redacted_payload: {
        result_fingerprint: intent.result_fingerprint,
        outcome: intent.business_outcome,
      },
    });
    this.flushStore(missionId);
    return structuredClone(intent);
  }

  recordResultConflict(
    callIntentId: string,
    observedResultFingerprint: string,
  ): void {
    const intent = this.requireIntent(callIntentId);
    const missionId = this.missionIdForIntent(callIntentId);
    this.events.append({
      mission_id: missionId,
      event_type: "result_conflict",
      actor: "system",
      call_task_id: intent.call_task_id,
      call_intent_id: intent.call_intent_id,
      provider_run_id: intent.provider_run_id ?? undefined,
      redacted_payload: {
        stored_result_fingerprint: intent.result_fingerprint,
        observed_result_fingerprint: observedResultFingerprint,
      },
    });
    this.setMissionStatus(
      missionId,
      "blocked_needs_resolution",
      "conflicting provider terminal result",
    );
    this.flushStore(missionId);
  }

  recordFaultInjected(
    missionId: string,
    callIntentId: string,
    point: string,
    providerCallId: string,
  ): void {
    this.events.append({
      mission_id: missionId,
      event_type: "fault_injected",
      actor: "system",
      call_intent_id: callIntentId,
      redacted_payload: {
        point,
        provider_accepted_call_id: providerCallId,
        note: "provider_run_id not yet durable",
      },
    });
    this.flushStore(missionId);
  }

  requestCancel(missionId: string, reason: string): void {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error("unknown mission");
    for (const intent of this.intents.values()) {
      const task = this.tasks.get(intent.call_task_id);
      if (!task || task.mission_id !== missionId) continue;
      if (canCancelIntentDirectly(intent.state)) {
        this.setIntentState(intent, "cancelled", "intent_cancelled", {
          reason,
        }, "operator");
      } else if (requiresCancellationRequested(intent.state)) {
        this.events.append({
          mission_id: missionId,
          event_type: "cancellation_requested_inflight",
          actor: "operator",
          call_intent_id: intent.call_intent_id,
          redacted_payload: { reason, intent_state: intent.state },
        });
      }
    }
    this.stopDispatches.add(missionId);
    this.setMissionStatus(missionId, "cancellation_requested", reason, "operator");
    this.flushStore(missionId);
  }

  pauseMission(missionId: string, reason: string): void {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error("unknown mission");
    if (mission.status === "cancelled" || mission.status === "completed") {
      throw new Error(`cannot pause mission in status ${mission.status}`);
    }
    this.setMissionStatus(missionId, "paused", reason, "operator");
    this.flushStore(missionId);
  }

  resumeMission(missionId: string, reason: string): void {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error("unknown mission");
    if (mission.status !== "paused") {
      throw new Error(`resume only from paused, got ${mission.status}`);
    }
    const stuck = this.listStuckIntents(missionId);
    if (stuck.length > 0) {
      this.setMissionStatus(
        missionId,
        "blocked_needs_resolution",
        `resume refused: ${stuck.length} unresolved dispatch(es); ${reason}`,
        "operator",
      );
      this.flushStore(missionId);
      return;
    }
    this.setMissionStatus(missionId, "running", reason, "operator");
    this.flushStore(missionId);
  }

  stopAllDispatches(missionId: string, reason: string): void {
    if (!this.missions.has(missionId)) throw new Error("unknown mission");
    this.stopDispatches.add(missionId);
    this.events.append({
      mission_id: missionId,
      event_type: "stop_dispatches",
      actor: "operator",
      redacted_payload: { reason },
    });
    this.flushStore(missionId);
  }

  isDispatchesStopped(missionId: string): boolean {
    return this.stopDispatches.has(missionId);
  }

  providerRunCount(missionId: string): number {
    let n = 0;
    for (const intent of this.listIntents(missionId)) {
      if (intent.provider_run_id) n += 1;
    }
    return n;
  }

  /** Reserved dispatch slots, including lost-response/ambiguous attempts. */
  callBudgetUsed(missionId: string): number {
    return this.listIntents(missionId).filter(
      (intent) => intent.state !== "planned" && intent.state !== "cancelled",
    ).length;
  }

  getTaskLabel(taskId: string): string {
    return this.taskLabels.get(taskId) ?? taskId;
  }

  listStuckIntents(missionId: string): CallIntent[] {
    return this.listIntents(missionId).filter(
      (i) => i.state === "dispatching" || i.state === "ambiguous",
    );
  }

  recordGuardBlocked(missionId: string, callIntentId: string, code: string, reason: string): void {
    this.events.append({
      mission_id: missionId,
      event_type: "guard_blocked",
      actor: "system",
      call_intent_id: callIntentId,
      redacted_payload: { code, reason },
    });
    this.flushStore(missionId);
  }

  tryUnlockNext(args: {
    mission_id: string;
    upstream_intent_id: string;
  }): { ok: boolean; reason: string } {
    const upstream = this.requireIntent(args.upstream_intent_id);
    const mission = this.missions.get(args.mission_id);
    if (!mission) throw new Error("unknown mission");
    if (this.missionIdForIntent(args.upstream_intent_id) !== args.mission_id) {
      throw new Error("upstream intent does not belong to mission");
    }
    const decision = canUnlockNextConflictingCandidate({
      upstreamState: upstream.state,
      upstreamOutcome: upstream.business_outcome,
      missionStatus: mission.status,
    });
    this.events.append({
      mission_id: args.mission_id,
      event_type: decision.ok ? "unlock_allowed" : "unlock_blocked",
      actor: "system",
      call_intent_id: args.upstream_intent_id,
      redacted_payload: { reason: decision.reason },
    });
    if (!decision.ok && upstream.state === "ambiguous") {
      this.setMissionStatus(
        args.mission_id,
        "blocked_needs_resolution",
        decision.reason,
      );
    }
    this.flushStore(args.mission_id);
    return decision;
  }

  getIntent(id: string): CallIntent | undefined {
    const intent = this.intents.get(id);
    return intent ? structuredClone(intent) : undefined;
  }

  assertIntentPayloadIntegrity(callIntentId: string): void {
    const intent = this.requireIntent(callIntentId);
    const actualPayloadHash = payloadSha256(intent.canonical_call_payload);
    const actualProviderKey = providerIdempotencyKey(
      intent.call_intent_id,
      intent.canonical_call_payload,
    );
    if (
      actualPayloadHash !== intent.payload_sha256 ||
      actualProviderKey !== intent.provider_idempotency_key
    ) {
      const error = new Error(
        `frozen payload integrity failed for ${callIntentId}`,
      ) as Error & { code: string };
      error.code = "PAYLOAD_INTEGRITY_FAILED";
      throw error;
    }
  }

  missionIdForIntent(callIntentId: string): string {
    const intent = this.requireIntent(callIntentId);
    const task = this.tasks.get(intent.call_task_id);
    if (!task) throw new Error("unknown call_task_id");
    return task.mission_id;
  }

  getMission(id: string): Mission | undefined {
    const mission = this.missions.get(id);
    return mission ? structuredClone(mission) : undefined;
  }

  recordFact(args: {
    mission_id: string;
    fact: string;
    value: string;
    confirmedBy: string;
    source_intent_id: string;
  }): StructuredFact {
    const intent = this.requireIntent(args.source_intent_id);
    if (!this.missions.has(args.mission_id)) throw new Error("unknown mission");
    if (this.missionIdForIntent(args.source_intent_id) !== args.mission_id) {
      throw new Error("source intent does not belong to mission");
    }
    if (intent.state !== "terminal" || !intent.provider_run_id) {
      throw new Error("facts require terminal intent with provider_run_id");
    }
    if (
      intent.business_outcome !== "verbally_confirmed" &&
      intent.business_outcome !== "candidate_accepted" &&
      intent.business_outcome !== "practice_acknowledged"
    ) {
      throw new Error(
        `cannot record fact from outcome ${intent.business_outcome}`,
      );
    }
    if (intent.validated_facts?.[args.fact] !== args.value) {
      throw new Error(
        `fact ${args.fact} is not bound to the validated provider result`,
      );
    }
    const structured: StructuredFact = {
      fact: args.fact,
      value: args.value,
      confirmedBy: args.confirmedBy,
      sourceRunId: intent.provider_run_id,
      sourceCallIntentId: intent.call_intent_id,
      sourceAttemptNo: intent.attempt_no,
    };
    const list = this.facts.get(args.mission_id) ?? [];
    const existing = list.find((candidate) => candidate.fact === args.fact);
    if (existing) {
      if (
        existing.value === structured.value &&
        existing.sourceRunId === structured.sourceRunId &&
        existing.sourceCallIntentId === structured.sourceCallIntentId &&
        existing.sourceAttemptNo === structured.sourceAttemptNo
      ) {
        return structuredClone(existing);
      }
      throw new Error(`fact ${args.fact} is already bound to different provenance`);
    }
    list.push(structured);
    this.facts.set(args.mission_id, list);
    this.events.append({
      mission_id: args.mission_id,
      event_type: "fact_recorded",
      actor: "system",
      call_intent_id: intent.call_intent_id,
      provider_run_id: intent.provider_run_id,
      redacted_payload: {
        fact: structured.fact,
        value: structured.value,
        confirmedBy: structured.confirmedBy,
        sourceRunId: structured.sourceRunId,
      },
    });
    this.flushStore(args.mission_id);
    return structuredClone(structured);
  }

  getFacts(missionId: string): StructuredFact[] {
    return structuredClone(this.facts.get(missionId) ?? []);
  }

  listIntents(missionId: string): CallIntent[] {
    const out: CallIntent[] = [];
    for (const intent of this.intents.values()) {
      const task = this.tasks.get(intent.call_task_id);
      if (task?.mission_id === missionId) out.push(structuredClone(intent));
    }
    return out;
  }

  exportEvidencePack(missionId: string): import("./evidence.js").EvidencePack {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error("unknown mission");
    const intents = this.listIntents(missionId);
    return {
      version: 1,
      mission_id: missionId,
      mission_status: mission.status,
      exported_at: new Date().toISOString(),
      events: this.events.list(missionId),
      facts: this.getFacts(missionId),
      ledger_summary: intents.map((i) => ({
        call_intent_id: i.call_intent_id,
        attempt_no: i.attempt_no,
        state: i.state,
        outcome: i.business_outcome,
        provider_run_id: i.provider_run_id,
        provider_runs: i.provider_run_id ? 1 : 0,
        validated_facts: structuredClone(i.validated_facts ?? {}),
      })),
    };
  }

  requireFact(missionId: string, factName: string): StructuredFact {
    const found = this.getFacts(missionId).find((f) => f.fact === factName);
    if (!found) {
      throw new Error(`missing required fact ${factName}`);
    }
    return found;
  }

  canDispatchWithFacts(args: {
    mission_id: string;
    required_facts: string[];
  }): { ok: boolean; missing: string[] } {
    const have = new Set(this.getFacts(args.mission_id).map((f) => f.fact));
    const missing = args.required_facts.filter((f) => !have.has(f));
    return { ok: missing.length === 0, missing };
  }

  providerRunsPerIntent(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const intent of this.intents.values()) {
      counts.set(intent.call_intent_id, intent.provider_run_id ? 1 : 0);
    }
    return counts;
  }

  private assertMissionInputMatches(
    existing: Mission,
    requested: CreateMissionInput,
  ): void {
    if (missionInputFingerprint(existing) !== missionInputFingerprint(requested)) {
      const error = new Error(
        `mission idempotency key ${requested.mission_idempotency_key} was reused with different input`,
      ) as Error & { code: string };
      error.code = "MISSION_IDEMPOTENCY_CONFLICT";
      throw error;
    }
  }

  private importSnapshot(snap: MissionSnapshot): void {
    const missionId = snap.mission.mission_id;
    const existingMission = this.missions.get(missionId);
    if (existingMission) {
      if (
        missionInputFingerprint(existingMission) !==
        missionInputFingerprint(snap.mission)
      ) {
        throw new Error(`snapshot conflicts with loaded mission ${missionId}`);
      }
      return;
    }
    const ownerForKey = this.missionKeys.get(
      snap.mission.mission_idempotency_key,
    );
    if (ownerForKey && ownerForKey !== missionId) {
      throw new Error("snapshot mission idempotency key belongs to another mission");
    }

    const snapshotLog = new EventLog();
    snapshotLog.replaceAll(structuredClone(snap.events));
    const eventVerification = snapshotLog.verify(missionId);
    if (!eventVerification.ok) {
      const error = new Error(
        `snapshot event integrity failed: ${eventVerification.errors.join("; ")}`,
      ) as Error & { code: string };
      error.code = "SNAPSHOT_EVENT_INTEGRITY";
      throw error;
    }

    const taskIds = new Set<string>();
    for (const task of snap.tasks) {
      if (task.mission_id !== missionId) {
        throw new Error(`snapshot task ${task.call_task_id} has wrong mission`);
      }
      if (taskIds.has(task.call_task_id) || this.tasks.has(task.call_task_id)) {
        throw new Error(`duplicate snapshot task ${task.call_task_id}`);
      }
      taskIds.add(task.call_task_id);
    }

    const snapshotIntents = new Map<string, CallIntent>();
    const providerRunOwners = new Map<string, string>();
    for (const loadedIntent of this.intents.values()) {
      if (loadedIntent.provider_run_id) {
        providerRunOwners.set(
          loadedIntent.provider_run_id,
          loadedIntent.call_intent_id,
        );
      }
    }
    for (const intent of snap.intents) {
      if (!taskIds.has(intent.call_task_id)) {
        throw new Error(`snapshot intent ${intent.call_intent_id} has unknown task`);
      }
      if (snapshotIntents.has(intent.call_intent_id) || this.intents.has(intent.call_intent_id)) {
        throw new Error(`duplicate snapshot intent ${intent.call_intent_id}`);
      }
      const actualPayloadHash = payloadSha256(intent.canonical_call_payload);
      const actualProviderKey = providerIdempotencyKey(
        intent.call_intent_id,
        intent.canonical_call_payload,
      );
      if (
        actualPayloadHash !== intent.payload_sha256 ||
        actualProviderKey !== intent.provider_idempotency_key
      ) {
        const error = new Error(
          `snapshot payload integrity failed for ${intent.call_intent_id}`,
        ) as Error & { code: string };
        error.code = "SNAPSHOT_PAYLOAD_INTEGRITY";
        throw error;
      }
      if (intent.provider_run_id) {
        const owner = providerRunOwners.get(intent.provider_run_id);
        if (owner && owner !== intent.call_intent_id) {
          throw new Error(
            `snapshot provider run ${intent.provider_run_id} belongs to ${owner}`,
          );
        }
        providerRunOwners.set(intent.provider_run_id, intent.call_intent_id);
      }
      snapshotIntents.set(intent.call_intent_id, intent);
    }

    const providerKeys = new Set<string>();
    const providerIds = new Set<string>();
    for (const run of snap.provider_runs) {
      const intent = [...snapshotIntents.values()].find(
        (candidate) =>
          candidate.provider_idempotency_key === run.idempotency_key,
      );
      if (!intent) {
        throw new Error(
          `snapshot provider run ${run.call_id} has no owning intent`,
        );
      }
      if (
        providerKeys.has(run.idempotency_key) ||
        providerIds.has(run.call_id) ||
        (intent.provider_run_id !== null && intent.provider_run_id !== run.call_id)
      ) {
        throw new Error(`snapshot provider run ownership conflict ${run.call_id}`);
      }
      providerKeys.add(run.idempotency_key);
      providerIds.add(run.call_id);
    }

    for (const fact of snap.facts) {
      const source = snapshotIntents.get(fact.sourceCallIntentId);
      if (
        !source ||
        source.state !== "terminal" ||
        source.provider_run_id !== fact.sourceRunId ||
        source.attempt_no !== fact.sourceAttemptNo ||
        ![
          "candidate_accepted",
          "verbally_confirmed",
          "practice_acknowledged",
        ].includes(source.business_outcome ?? "")
      ) {
        throw new Error(`snapshot fact ${fact.fact} has invalid provenance`);
      }
    }

    const existingEventIds = new Set(
      this.events.list().map((event) => event.event_id),
    );
    for (const event of snap.events) {
      if (existingEventIds.has(event.event_id)) {
        throw new Error(`duplicate snapshot event_id ${event.event_id}`);
      }
      existingEventIds.add(event.event_id);
    }

    this.missions.set(missionId, structuredClone(snap.mission));
    this.missionKeys.set(snap.mission.mission_idempotency_key, missionId);
    for (const task of snap.tasks) {
      this.tasks.set(task.call_task_id, {
        ...structuredClone(task),
        required_facts: [...(task.required_facts ?? [])],
      });
      this.taskLabels.set(
        task.call_task_id,
        snap.task_labels[task.call_task_id] ?? task.recipient_label,
      );
    }
    for (const intent of snap.intents) {
      this.intents.set(intent.call_intent_id, {
        ...structuredClone(intent),
        result_fingerprint: intent.result_fingerprint ?? null,
        validated_facts: structuredClone(intent.validated_facts ?? {}),
      });
    }
    this.facts.set(missionId, structuredClone(snap.facts));
    if (snap.stop_dispatches) this.stopDispatches.add(missionId);
    this.events.replaceAll([...this.events.list(), ...structuredClone(snap.events)]);
    this.setSessionMeta(missionId, {
      proof: snap.proof,
      ledger_labels: snap.ledger_labels,
      handoff_json: snap.handoff_json,
    });
  }

  private requireIntent(id: string): CallIntent {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`unknown call_intent_id ${id}`);
    return intent;
  }

  private assertProviderRunOwnership(
    callIntentId: string,
    providerRunId: string,
  ): void {
    for (const candidate of this.intents.values()) {
      if (
        candidate.call_intent_id !== callIntentId &&
        candidate.provider_run_id === providerRunId
      ) {
        throw new Error(
          `provider_run_id ${providerRunId} already belongs to another call_intent_id`,
        );
      }
    }
  }

  private recordRequiredFactConsumption(intent: CallIntent): void {
    const task = this.tasks.get(intent.call_task_id);
    if (!task) throw new Error("intent task missing");
    const required = task.required_facts ?? [];
    if (required.length === 0) return;

    const bound = intent.canonical_call_payload.metadata
      .continuum_fact_provenance;
    if (!Array.isArray(bound)) {
      throw new Error("required fact provenance is missing from frozen payload");
    }

    for (const factName of required) {
      const fact = (this.facts.get(task.mission_id) ?? []).find(
        (candidate) => candidate.fact === factName,
      );
      const row = bound.find(
        (candidate): candidate is Record<string, unknown> =>
          candidate !== null &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          (candidate as Record<string, unknown>).fact === factName,
      );
      if (
        !fact ||
        !row ||
        row.value !== fact.value ||
        row.source_run_id !== fact.sourceRunId ||
        row.source_call_intent_id !== fact.sourceCallIntentId ||
        row.source_attempt_no !== fact.sourceAttemptNo
      ) {
        const error = new Error(
          `frozen payload fact provenance mismatch for ${factName}`,
        ) as Error & { code: string };
        error.code = "FACT_PROVENANCE_MISMATCH";
        throw error;
      }
      this.events.append({
        mission_id: task.mission_id,
        event_type: "fact_consumed",
        actor: "system",
        call_task_id: task.call_task_id,
        call_intent_id: intent.call_intent_id,
        provider_run_id: fact.sourceRunId,
        redacted_payload: {
          fact: fact.fact,
          value: fact.value,
          source_run_id: fact.sourceRunId,
          source_call_intent_id: fact.sourceCallIntentId,
          source_attempt_no: fact.sourceAttemptNo,
          consuming_payload_sha256: intent.payload_sha256,
        },
      });
    }
  }

  private setIntentState(
    intent: CallIntent,
    to: IntentState,
    eventType: string,
    extra: Record<string, unknown> = {},
    actor: Actor = "system",
  ): void {
    if (!canTransitionIntent(intent.state, to)) {
      throw new Error(`illegal intent transition ${intent.state} → ${to}`);
    }
    const from = intent.state;
    intent.state = to;
    const task = this.tasks.get(intent.call_task_id)!;
    this.events.append({
      mission_id: task.mission_id,
      event_type: eventType,
      actor,
      call_task_id: intent.call_task_id,
      call_intent_id: intent.call_intent_id,
      provider_run_id: intent.provider_run_id ?? undefined,
      redacted_payload: { from, to, ...extra },
    });
  }

  private setMissionStatus(
    missionId: string,
    status: MissionStatus,
    reason: string,
    actor: Actor = "system",
  ): void {
    const mission = this.missions.get(missionId)!;
    mission.status = status;
    this.events.append({
      mission_id: missionId,
      event_type: "mission_status",
      actor,
      redacted_payload: { status, reason },
    });
  }
}
