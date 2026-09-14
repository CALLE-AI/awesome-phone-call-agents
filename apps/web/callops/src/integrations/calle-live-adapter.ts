import { fingerprintPlan } from '../domain/canonical';
import type { CallPlan, HumanApproval } from '../domain/models';
import { assertSyntheticData, sameStringList } from '../domain/synthetic-data';
import type { Clock } from '../ports/clock';
import {
  asCalleConfirmToken,
  asCallePlanId,
  asCalleRunId,
  CalleOneShotRunGate,
  InMemoryCallePlanCapabilityVault,
} from './calle-live-capability-vault';
import {
  CalleLiveAdapterError,
  CalleRemoteExecutionUncertainError,
  CalleRunRejectedBeforeExecutionError,
} from './calle-live-errors';
import { sanitizeCalleRemoteEvidence } from './calle-live-evidence';
import { assertCalleLiveTransition, isCalleLiveTerminal } from './calle-live-state-machine';
import {
  CALLE_LIVE_TOOL_ALLOWLIST,
  type CalleLiveAuditEvent,
  type CalleLiveSessionView,
  type CalleLiveState,
  type CalleLiveToolName,
  type CalleLiveTransport,
  type CallePlanCapabilityVault,
  type CallePollingOptions,
  type CallePollingRuntime,
  type CalleRunCheckpointPhase,
  type CalleRunCheckpointRecord,
  type CalleRunCheckpointStore,
  type CalleRunId,
  type PrepareCalleLivePlanRequest,
} from './calle-live-types';
import type { CallePlanContractResult } from './calle-plan-response-types';
import { classifyCallePlanResponse, destroyCallePlanOpaqueValues } from './calle-plan-response';

const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

function safeReasonCode(value: string): string {
  return SAFE_REASON_CODE.test(value) ? value : 'REMOTE_REASON_REDACTED';
}

function explicitStructuredPayload(
  response: unknown,
  path: CallePlanContractResult['observation']['structuredPayloadPath'],
): Record<string, unknown> | null {
  if (response === null || typeof response !== 'object' || path === null) return null;
  const root = response as Record<string, unknown>;
  if (path === 'result.structuredContent') {
    const value = root.structuredContent;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
  if (path === 'result.structured_content') {
    const value = root.structured_content;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
  return root;
}

function validatePollingOptions(options: CallePollingOptions): void {
  const integers = [
    options.initialDelayMs,
    options.intervalMs,
    options.timeoutMs,
    options.maxPolls,
  ];
  if (integers.some((value) => !Number.isSafeInteger(value))) {
    throw new CalleLiveAdapterError('Polling options must be safe integers.', 'INVALID_POLLING_OPTIONS');
  }
  if (
    options.initialDelayMs < 0 ||
    options.initialDelayMs > 60_000 ||
    options.intervalMs < 1 ||
    options.intervalMs > 30_000 ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 600_000 ||
    options.maxPolls < 1 ||
    options.maxPolls > 100
  ) {
    throw new CalleLiveAdapterError('Polling options are outside local safety bounds.', 'INVALID_POLLING_OPTIONS');
  }
}

export function assertCalleLiveToolCatalog(toolNames: readonly string[]): void {
  const allowlist = new Set<string>(CALLE_LIVE_TOOL_ALLOWLIST);
  if (toolNames.length !== CALLE_LIVE_TOOL_ALLOWLIST.length || new Set(toolNames).size !== toolNames.length) {
    throw new CalleLiveAdapterError('The MCP tool catalog is not the exact allowlist.', 'INVALID_MCP_TOOL_CATALOG');
  }
  const unexpected = toolNames.find((name) => !allowlist.has(name));
  if (unexpected !== undefined) {
    throw new CalleLiveAdapterError('An unsupported MCP tool was present.', 'UNSUPPORTED_MCP_TOOL');
  }
  for (const required of CALLE_LIVE_TOOL_ALLOWLIST) {
    if (!toolNames.includes(required)) {
      throw new CalleLiveAdapterError('The required MCP tool catalog is incomplete.', 'INCOMPLETE_MCP_TOOL_CATALOG');
    }
  }
}

export class CalleLiveAdapter {
  private state: CalleLiveState = 'DRAFT';
  private reviewPlan: CallPlan | null = null;
  private planFingerprint: string | null = null;
  private planObservation: CallePlanContractResult | null = null;
  private approval: HumanApproval | null = null;
  private gate: CalleOneShotRunGate | null = null;
  private checkpointPresent = false;
  private checkpointPhase: CalleRunCheckpointPhase | null = null;
  private checkpointRevision = 0;
  private transcript: readonly string[] = Object.freeze([]);
  private summary: string | null = null;
  private failureReason: string | null = null;
  private securitySignals: readonly string[] = Object.freeze([]);
  private readonly audit: CalleLiveAuditEvent[] = [];
  private runStartInFlight = false;
  private pollInFlight = false;

  public constructor(
    private readonly sessionId: string,
    private readonly transport: CalleLiveTransport,
    private readonly checkpoints: CalleRunCheckpointStore,
    private readonly clock: Clock,
    private readonly vault: CallePlanCapabilityVault = new InMemoryCallePlanCapabilityVault(),
  ) {
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(sessionId)) {
      throw new CalleLiveAdapterError('The local live-session identifier is invalid.', 'INVALID_SESSION_ID');
    }
    this.record('LIVE_SESSION_CREATED', null, 'DRAFT', 'LOCAL_SESSION_CREATED', null);
  }

  public async preparePlan(request: PrepareCalleLivePlanRequest): Promise<CalleLiveSessionView> {
    if (this.state !== 'DRAFT') {
      throw new CalleLiveAdapterError('Planning is allowed only from DRAFT.', 'PLAN_STATE_REFUSED');
    }
    if (request.reviewPlan.provider !== 'CALLE') {
      throw new CalleLiveAdapterError('The review plan must name CALL-E.', 'PLAN_PROVIDER_MISMATCH');
    }
    assertSyntheticData(request.reviewPlan);
    assertSyntheticData(request.payload);
    const fingerprint = await fingerprintPlan(request.reviewPlan);
    let response: unknown = null;
    try {
      response = await this.transport.planCall(request.payload);
      const classified = classifyCallePlanResponse(response);
      this.planObservation = structuredClone(classified);
      this.reviewPlan = structuredClone(request.reviewPlan);
      this.planFingerprint = fingerprint;

      if (classified.kind === 'NEEDS_DETAILS') {
        this.move('NEEDS_DETAILS', 'PLAN_NEEDS_DETAILS', 'PLAN_NEEDS_DETAILS', null);
        return this.view();
      }
      if (classified.kind !== 'READY_TO_RUN') {
        throw new CalleLiveAdapterError(
          'The planning response cannot enter the execution workflow.',
          `PLAN_${classified.kind}`,
        );
      }
      const payload = explicitStructuredPayload(response, classified.observation.structuredPayloadPath);
      if (payload === null) {
        throw new CalleLiveAdapterError('The ready capability envelope is unavailable.', 'READY_CAPABILITY_MISSING');
      }
      this.vault.store(fingerprint, {
        planId: asCallePlanId(payload.plan_id),
        confirmToken: asCalleConfirmToken(payload.confirm_token),
      });
      this.move('READY_FOR_REVIEW', 'PLAN_READY_FOR_REVIEW', 'READY_CAPABILITY_CAPTURED', null);
      return this.view();
    } finally {
      if (response !== null) destroyCallePlanOpaqueValues(response);
    }
  }

  public beginApprovalReview(): CalleLiveSessionView {
    if (this.state !== 'READY_FOR_REVIEW' || this.planFingerprint === null) {
      throw new CalleLiveAdapterError('A ready reviewed plan is required.', 'REVIEW_STATE_REFUSED');
    }
    this.move('WAITING_FOR_APPROVAL', 'HUMAN_REVIEW_OPENED', 'EXPLICIT_REVIEW_REQUIRED', null);
    return this.view();
  }

  public async approve(approval: HumanApproval): Promise<CalleLiveSessionView> {
    if (
      this.state !== 'WAITING_FOR_APPROVAL' ||
      this.reviewPlan === null ||
      this.planFingerprint === null
    ) {
      throw new CalleLiveAdapterError('Approval is not accepted in this state.', 'APPROVAL_STATE_REFUSED');
    }
    const currentFingerprint = await fingerprintPlan(this.reviewPlan);
    if (
      approval.decision !== 'APPROVED' ||
      approval.planFingerprint !== currentFingerprint ||
      currentFingerprint !== this.planFingerprint ||
      !sameStringList(approval.confirmedTransmittedData, this.reviewPlan.transmittedData)
    ) {
      throw new CalleLiveAdapterError('The human approval does not bind the exact plan.', 'APPROVAL_MISMATCH');
    }
    if (!this.vault.has(currentFingerprint)) {
      throw new CalleLiveAdapterError('No ephemeral plan capability is available.', 'CAPABILITY_MISSING');
    }
    this.approval = structuredClone(approval);
    this.gate = new CalleOneShotRunGate(currentFingerprint);
    this.move('APPROVED', 'HUMAN_APPROVAL_GRANTED', 'EXACT_PLAN_APPROVED', 'APPROVED');
    return this.view();
  }

  public async rejectApproval(comment: string | null = null): Promise<CalleLiveSessionView> {
    if (
      this.state !== 'WAITING_FOR_APPROVAL' ||
      this.reviewPlan === null ||
      this.planFingerprint === null
    ) {
      throw new CalleLiveAdapterError('Rejection is not accepted in this state.', 'REJECTION_STATE_REFUSED');
    }
    if (comment !== null) assertSyntheticData(comment);
    this.approval = {
      decision: 'REJECTED',
      decidedAt: this.clock.now(),
      planFingerprint: await fingerprintPlan(this.reviewPlan),
      confirmedTransmittedData: [],
      comment,
    };
    this.vault.delete(this.planFingerprint);
    this.gate = null;
    this.move(
      'CANCELLED_LOCAL',
      'HUMAN_APPROVAL_REJECTED',
      'HUMAN_REJECTED_NO_REMOTE_ACTION',
      'REJECTED',
    );
    return this.view();
  }

  public returnToDraftForReplan(): CalleLiveSessionView {
    if (this.state !== 'NEEDS_DETAILS' || this.planFingerprint === null) {
      throw new CalleLiveAdapterError('Only a needs-details plan can be replanned.', 'REPLAN_STATE_REFUSED');
    }
    this.vault.delete(this.planFingerprint);
    this.planObservation = null;
    this.reviewPlan = null;
    this.planFingerprint = null;
    this.approval = null;
    this.gate = null;
    this.move('DRAFT', 'EXPLICIT_REPLAN_REQUESTED', 'MISSING_DETAILS_TO_BE_REVIEWED', null);
    return this.view();
  }

  public async reviseReviewPlan(revised: CallPlan): Promise<CalleLiveSessionView> {
    if (
      this.reviewPlan === null ||
      this.planFingerprint === null ||
      !['READY_FOR_REVIEW', 'WAITING_FOR_APPROVAL', 'APPROVED'].includes(this.state)
    ) {
      throw new CalleLiveAdapterError('The plan cannot be revised in this state.', 'PLAN_REVISION_REFUSED');
    }
    if (
      revised.id !== this.reviewPlan.id ||
      revised.caseId !== this.reviewPlan.caseId ||
      revised.provider !== 'CALLE'
    ) {
      throw new CalleLiveAdapterError('Live plan identity is immutable.', 'PLAN_IDENTITY_CHANGED');
    }
    const revisedFingerprint = await fingerprintPlan(revised);
    if (revisedFingerprint === this.planFingerprint) return this.view();
    const oldFingerprint = this.planFingerprint;
    this.vault.delete(oldFingerprint);
    this.approval = null;
    this.gate = null;
    this.planObservation = null;
    this.reviewPlan = structuredClone(revised);
    this.planFingerprint = revisedFingerprint;
    this.move('DRAFT', 'APPROVAL_INVALIDATED', 'PLAN_CONTENT_CHANGED', null);
    return this.view();
  }

  public async startRun(): Promise<CalleLiveSessionView> {
    if (this.runStartInFlight) {
      throw new CalleLiveAdapterError('A run request is already in progress.', 'RUN_ALREADY_IN_FLIGHT');
    }
    this.runStartInFlight = true;
    try {
      return await this.startRunOnce();
    } finally {
      this.runStartInFlight = false;
    }
  }

  private async startRunOnce(): Promise<CalleLiveSessionView> {
    if (
      this.state !== 'APPROVED' ||
      this.reviewPlan === null ||
      this.planFingerprint === null ||
      this.approval === null ||
      this.gate === null
    ) {
      throw new CalleLiveAdapterError('The live run gate is closed.', 'RUN_GATE_CLOSED');
    }
    const fingerprint = await fingerprintPlan(this.reviewPlan);
    if (
      this.approval.decision !== 'APPROVED' ||
      this.approval.planFingerprint !== fingerprint ||
      fingerprint !== this.planFingerprint ||
      !sameStringList(this.approval.confirmedTransmittedData, this.reviewPlan.transmittedData)
    ) {
      throw new CalleLiveAdapterError('The approval no longer matches the plan.', 'APPROVAL_STALE');
    }
    if (!this.vault.has(fingerprint)) {
      throw new CalleLiveAdapterError('The ephemeral capability is absent.', 'CAPABILITY_MISSING');
    }

    this.gate.consume(fingerprint);
    const capability = this.vault.take(fingerprint);
    if (capability === null) {
      throw new CalleLiveAdapterError('The one-shot capability was unavailable.', 'CAPABILITY_MISSING');
    }
    this.move('RUN_REQUESTED', 'RUN_GATE_CONSUMED', 'ONE_SHOT_CONSUMED_BEFORE_TRANSPORT', 'APPROVED');

    try {
      await this.persistCheckpoint({
        phase: 'RUN_REQUESTED',
        runId: null,
        remoteState: null,
        terminalState: null,
        reasonCode: 'ONE_SHOT_CONSUMED_BEFORE_TRANSPORT',
      });
    } catch {
      this.move(
        'FAILED',
        'RUN_CHECKPOINT_PREPARE_FAILED',
        'NO_REMOTE_EXECUTION_ATTEMPTED',
        'APPROVED',
      );
      return this.view();
    }

    try {
      const result = await this.transport.runCall(capability);
      if (result.kind === 'REJECTED_BEFORE_EXECUTION') {
        await this.persistTerminalFailure(safeReasonCode(result.reasonCode));
        this.move(
          'FAILED',
          'RUN_REJECTED',
          safeReasonCode(result.reasonCode),
          'APPROVED',
        );
        return this.view();
      }
      const runId = asCalleRunId(result.runId);
      try {
        await this.persistCheckpoint({
          phase: result.initialState === 'STATUS_UNKNOWN' ? 'STATUS_UNKNOWN' : 'RUN_ID_RECEIVED',
          runId,
          remoteState: result.initialState === 'STATUS_UNKNOWN' ? null : result.initialState,
          terminalState: null,
          reasonCode:
            result.initialState === 'STATUS_UNKNOWN'
              ? 'RUN_ID_STORED_INITIAL_STATUS_UNKNOWN'
              : 'RUN_ID_STORED_BEFORE_STATUS',
        });
      } catch {
        await this.persistRemoteUncertainty('RUN_ID_DURABILITY_FAILED');
        this.move(
          'REMOTE_EXECUTION_UNCERTAIN',
          'REMOTE_EXECUTION_UNCERTAIN',
          'RUN_ID_DURABILITY_FAILED',
          'APPROVED',
        );
        return this.view();
      }
      this.move(
        result.initialState,
        'RUN_CHECKPOINT_SAVED',
        result.initialState === 'STATUS_UNKNOWN'
          ? 'RUN_ID_STORED_INITIAL_STATUS_UNKNOWN'
          : 'RUN_ID_STORED_BEFORE_STATUS',
        'APPROVED',
      );
      return this.view();
    } catch (error) {
      if (error instanceof CalleRunRejectedBeforeExecutionError) {
        await this.persistTerminalFailure(safeReasonCode(error.reasonCode));
        this.move('FAILED', 'RUN_REJECTED', safeReasonCode(error.reasonCode), 'APPROVED');
        return this.view();
      }
      const reason =
        error instanceof CalleRemoteExecutionUncertainError
          ? error.code
          : 'RUN_TRANSPORT_OUTCOME_UNKNOWN';
      await this.persistRemoteUncertainty(reason);
      this.move(
        'REMOTE_EXECUTION_UNCERTAIN',
        'REMOTE_EXECUTION_UNCERTAIN',
        reason,
        'APPROVED',
      );
      return this.view();
    }
  }

  public async restoreCheckpoint(): Promise<CalleLiveSessionView> {
    if (this.state !== 'DRAFT') {
      throw new CalleLiveAdapterError('Checkpoint restore requires a fresh adapter.', 'RESTORE_STATE_REFUSED');
    }
    const checkpoint = await this.checkpoints.load(this.sessionId);
    if (checkpoint === null) {
      throw new CalleLiveAdapterError('No run checkpoint exists.', 'RUN_CHECKPOINT_MISSING');
    }
    this.acceptLoadedCheckpoint(checkpoint);
    if (checkpoint.phase === 'RUN_REQUESTED') {
      await this.persistRemoteUncertainty('LOCAL_RESTART_AFTER_RUN_REQUESTED');
      this.move(
        'REMOTE_EXECUTION_UNCERTAIN',
        'RUN_CHECKPOINT_RESTORED',
        'LOCAL_RESTART_AFTER_RUN_REQUESTED',
        null,
      );
      return this.view();
    }
    if (checkpoint.phase === 'REMOTE_EXECUTION_UNCERTAIN') {
      this.move(
        'REMOTE_EXECUTION_UNCERTAIN',
        'RUN_CHECKPOINT_RESTORED',
        checkpoint.reasonCode ?? 'LOCAL_RESTART_REMOTE_UNCERTAIN',
        null,
      );
      return this.view();
    }
    if (checkpoint.phase === 'LOCAL_TRACKING_STOPPED') {
      this.move('CANCELLED_LOCAL', 'RUN_CHECKPOINT_RESTORED', 'LOCAL_TRACKING_REMAINS_STOPPED', null);
      return this.view();
    }
    if (checkpoint.phase === 'TERMINAL') {
      this.move(
        checkpoint.terminalState ?? 'FAILED',
        'RUN_CHECKPOINT_RESTORED',
        checkpoint.reasonCode ?? 'LOCAL_TERMINAL_CHECKPOINT',
        null,
      );
      return this.view();
    }
    this.move('STATUS_UNKNOWN', 'RUN_CHECKPOINT_RESTORED', 'LOCAL_RESTART_RECOVERY', null);
    return this.view();
  }

  public async pollUntilTerminal(
    options: CallePollingOptions,
    runtime: CallePollingRuntime,
  ): Promise<CalleLiveSessionView> {
    validatePollingOptions(options);
    if (this.pollInFlight) {
      throw new CalleLiveAdapterError('A status poll is already running.', 'POLL_ALREADY_IN_FLIGHT');
    }
    if (!['QUEUED', 'IN_PROGRESS', 'STATUS_UNKNOWN'].includes(this.state)) {
      throw new CalleLiveAdapterError('Status polling is refused in this state.', 'POLL_STATE_REFUSED');
    }
    const checkpoint = await this.checkpoints.load(this.sessionId);
    if (checkpoint === null || checkpoint.runId === null) {
      throw new CalleLiveAdapterError('Status polling requires a saved run checkpoint.', 'RUN_CHECKPOINT_MISSING');
    }
    if (!['RUN_ID_RECEIVED', 'STATUS_UNKNOWN'].includes(checkpoint.phase)) {
      throw new CalleLiveAdapterError('The durable checkpoint does not allow status polling.', 'RUN_CHECKPOINT_POLL_REFUSED');
    }
    this.acceptLoadedCheckpoint(checkpoint);
    const runId = checkpoint.runId;
    this.pollInFlight = true;
    const startedAt = runtime.nowMs();
    try {
      if (options.initialDelayMs > 0) await runtime.wait(options.initialDelayMs);
      for (let poll = 0; poll < options.maxPolls; poll += 1) {
        if (runtime.nowMs() - startedAt >= options.timeoutMs) {
          await this.markStatusUnknown('POLL_TIMEOUT', runId);
          break;
        }
        let observation;
        try {
          observation = await this.transport.getCallRun(runId);
        } catch {
          await this.markStatusUnknown('STATUS_TRANSPORT_FAILED', runId);
          break;
        }
        const evidence = sanitizeCalleRemoteEvidence(observation);
        this.transcript = evidence.transcript;
        this.summary = evidence.summary;
        this.failureReason = evidence.failureReason;
        this.securitySignals = evidence.securitySignals;

        if (
          !['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'UNKNOWN'].includes(
            observation.state,
          )
        ) {
          await this.markStatusUnknown('REMOTE_STATUS_INVALID', runId);
          break;
        }
        if (observation.state === 'UNKNOWN') {
          await this.markStatusUnknown('REMOTE_STATUS_UNKNOWN', runId);
          break;
        }
        await this.observeStatus(observation.state, runId);
        if (isCalleLiveTerminal(this.state)) break;
        if (poll + 1 < options.maxPolls) await runtime.wait(options.intervalMs);
      }
      if (!isCalleLiveTerminal(this.state) && this.state !== 'STATUS_UNKNOWN') {
        await this.markStatusUnknown('POLL_LIMIT_REACHED', runId);
      }
      return this.view();
    } finally {
      this.pollInFlight = false;
    }
  }

  public async cancelLocalTracking(): Promise<CalleLiveSessionView> {
    if (!['APPROVED', 'QUEUED', 'IN_PROGRESS', 'STATUS_UNKNOWN'].includes(this.state)) {
      throw new CalleLiveAdapterError('Local cancellation is refused in this state.', 'LOCAL_CANCEL_REFUSED');
    }
    if (this.state !== 'APPROVED') {
      const checkpoint = await this.checkpoints.load(this.sessionId);
      if (checkpoint === null || checkpoint.runId === null) {
        throw new CalleLiveAdapterError(
          'Local tracking cannot stop without a durable run checkpoint.',
          'RUN_CHECKPOINT_MISSING',
        );
      }
      this.acceptLoadedCheckpoint(checkpoint);
      await this.persistCheckpoint({
        phase: 'LOCAL_TRACKING_STOPPED',
        runId: checkpoint.runId,
        remoteState: null,
        terminalState: null,
        reasonCode: 'NO_REMOTE_CANCEL_CLAIMED',
      });
    }
    this.move('CANCELLED_LOCAL', 'LOCAL_TRACKING_CANCELLED', 'NO_REMOTE_CANCEL_CLAIMED', null);
    return this.view();
  }

  public view(): CalleLiveSessionView {
    return this.snapshot();
  }

  private snapshot(): CalleLiveSessionView {
    return Object.freeze({
      sessionId: this.sessionId,
      state: this.state,
      provider: 'CALLE' as const,
      planFingerprint: this.planFingerprint,
      planObservation:
        this.planObservation === null ? null : structuredClone(this.planObservation),
      approvalDecision: this.approval?.decision ?? null,
      gateState: this.gate?.state() ?? 'ABSENT',
      capabilityPresent:
        this.planFingerprint !== null && this.vault.has(this.planFingerprint),
      checkpointPresent: this.checkpointPresent,
      checkpointPhase: this.checkpointPhase,
      transcript: Object.freeze([...this.transcript]),
      summary: this.summary,
      failureReason: this.failureReason,
      securitySignals: Object.freeze([...this.securitySignals]),
      audit: Object.freeze(this.audit.map((event) => Object.freeze({ ...event }))),
    });
  }

  private async observeStatus(
    next: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED',
    runId: CalleRunId,
  ): Promise<void> {
    try {
      await this.persistCheckpoint({
        phase: next === 'COMPLETED' || next === 'FAILED' ? 'TERMINAL' : 'RUN_ID_RECEIVED',
        runId,
        remoteState: next === 'QUEUED' || next === 'IN_PROGRESS' ? next : null,
        terminalState: next === 'COMPLETED' || next === 'FAILED' ? next : null,
        reasonCode: `STATUS_${next}`,
      });
    } catch {
      this.markStatusUnknownWithoutPersistence('RUN_CHECKPOINT_UPDATE_FAILED');
      return;
    }
    if (next === this.state) {
      this.record('REMOTE_STATUS_OBSERVED', this.state, this.state, `STATUS_${next}`, null);
      return;
    }
    this.move(next, 'REMOTE_STATUS_CHANGED', `STATUS_${next}`, null);
  }

  private async markStatusUnknown(reasonCode: string, runId: CalleRunId): Promise<void> {
    try {
      await this.persistCheckpoint({
        phase: 'STATUS_UNKNOWN',
        runId,
        remoteState: null,
        terminalState: null,
        reasonCode,
      });
    } catch {
      this.markStatusUnknownWithoutPersistence('RUN_CHECKPOINT_UPDATE_FAILED');
      return;
    }
    this.markStatusUnknownWithoutPersistence(reasonCode);
  }

  private markStatusUnknownWithoutPersistence(reasonCode: string): void {
    if (this.state === 'STATUS_UNKNOWN') {
      this.record('STATUS_UNKNOWN_CONFIRMED', this.state, this.state, reasonCode, null);
      return;
    }
    this.move('STATUS_UNKNOWN', 'STATUS_UNKNOWN', reasonCode, null);
  }

  private async persistTerminalFailure(reasonCode: string): Promise<void> {
    try {
      await this.persistCheckpoint({
        phase: 'TERMINAL',
        runId: null,
        remoteState: null,
        terminalState: 'FAILED',
        reasonCode,
      });
    } catch {
      this.record(
        'RUN_CHECKPOINT_UPDATE_FAILED',
        this.state,
        this.state,
        'RUN_CHECKPOINT_UPDATE_FAILED',
        null,
      );
    }
  }

  private async persistRemoteUncertainty(reasonCode: string): Promise<void> {
    try {
      await this.persistCheckpoint({
        phase: 'REMOTE_EXECUTION_UNCERTAIN',
        runId: null,
        remoteState: null,
        terminalState: null,
        reasonCode,
      });
    } catch {
      this.record(
        'RUN_CHECKPOINT_UPDATE_FAILED',
        this.state,
        this.state,
        'RUN_CHECKPOINT_UPDATE_FAILED',
        null,
      );
    }
  }

  private async persistCheckpoint(
    checkpoint: Omit<CalleRunCheckpointRecord, 'schemaVersion' | 'revision' | 'updatedAt'>,
  ): Promise<void> {
    const record: CalleRunCheckpointRecord = Object.freeze({
      schemaVersion: 1,
      revision: this.checkpointRevision + 1,
      updatedAt: this.clock.now(),
      ...checkpoint,
      reasonCode:
        checkpoint.reasonCode === null ? null : safeReasonCode(checkpoint.reasonCode),
    });
    await this.checkpoints.save(this.sessionId, record);
    this.acceptLoadedCheckpoint(record);
  }

  private acceptLoadedCheckpoint(checkpoint: CalleRunCheckpointRecord): void {
    this.checkpointPresent = true;
    this.checkpointPhase = checkpoint.phase;
    this.checkpointRevision = checkpoint.revision;
  }

  private move(
    nextState: CalleLiveState,
    event: string,
    reasonCode: string,
    humanDecision: 'APPROVED' | 'REJECTED' | null,
  ): void {
    const previous = this.state;
    assertCalleLiveTransition(previous, nextState);
    this.state = nextState;
    this.record(event, previous, nextState, reasonCode, humanDecision);
  }

  private record(
    event: string,
    previousState: CalleLiveState | null,
    newState: CalleLiveState,
    reasonCode: string,
    humanDecision: 'APPROVED' | 'REJECTED' | null,
  ): void {
    this.audit.push(
      Object.freeze({
        sequence: this.audit.length + 1,
        at: this.clock.now(),
        event,
        previousState,
        newState,
        reasonCode: safeReasonCode(reasonCode),
        planFingerprint: this.planFingerprint,
        checkpointPresent: this.checkpointPresent,
        checkpointPhase: this.checkpointPhase,
        humanDecision,
      }),
    );
  }
}

export type { CalleLiveToolName };
