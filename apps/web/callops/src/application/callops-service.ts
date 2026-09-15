import { fingerprintPlan } from '../domain/canonical';
import { ApprovalGateError, CallOpsError } from '../domain/errors';
import {
  EMPTY_SNAPSHOT,
  type ApprovalDecision,
  type AuditEvent,
  type CallOpsSnapshot,
  type CallPlan,
  type CallRun,
  type CallRunState,
  type CreateSupportCaseInput,
  type HumanApproval,
  type MockScenario,
  type SupportCase,
} from '../domain/models';
import { isTerminalState, transitionRun } from '../domain/state-machine';
import {
  assertPlanTransmitsNoForbiddenData,
  assertSyntheticData,
  sameStringList,
} from '../domain/synthetic-data';
import type { CallProvider, ProviderRunStatus } from '../ports/call-provider';
import type { CaseRepository } from '../ports/case-repository';
import type { Clock } from '../ports/clock';
import type { OutcomeExtractor } from '../ports/outcome-extractor';

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (normalized.length === 0) throw new CallOpsError('A synthetic reference is required.', 'INVALID_CASE');
  return normalized;
}

function requireNonEmpty(input: CreateSupportCaseInput): void {
  const values = [
    input.organization,
    input.syntheticReference,
    input.category,
    input.context,
    input.desiredOutcome,
  ];
  if (values.some((value) => value.trim().length === 0)) {
    throw new CallOpsError('Every support-case field is required.', 'INVALID_CASE');
  }
  if (input.authorizedInformation.length === 0 || input.forbiddenInformation.length === 0) {
    throw new CallOpsError('Authorized and forbidden information lists are required.', 'INVALID_CASE');
  }
}

function auditEvent(
  existing: readonly AuditEvent[],
  values: Omit<AuditEvent, 'id'>,
): AuditEvent {
  return {
    id: `audit-${String(existing.length + 1).padStart(3, '0')}`,
    ...values,
  };
}

function withCaseStatus(supportCase: SupportCase, status: CallRunState): SupportCase {
  return { ...supportCase, status };
}

function requireSnapshotParts(snapshot: CallOpsSnapshot): {
  supportCase: SupportCase;
  plan: CallPlan;
  run: CallRun;
} {
  if (snapshot.supportCase === null || snapshot.plan === null || snapshot.run === null) {
    throw new ApprovalGateError('A support case and call plan are required.');
  }
  return {
    supportCase: snapshot.supportCase,
    plan: snapshot.plan,
    run: snapshot.run,
  };
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+[1-9][0-9 .()-]{7,18}[0-9])|(?:\b0[1-9](?:[ .-]?\d{2}){4}\b)/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const SECRET_PATTERN = /\b(?:sk|pk|api|token|secret|password)[-_][A-Z0-9_-]{8,}\b/gi;

function sanitizeAuditText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(URL_PATTERN, '[REDACTED_URL]')
    .replace(SECRET_PATTERN, '[REDACTED_SECRET]');
}

export class CallOpsService {
  public constructor(
    private readonly repository: CaseRepository,
    private readonly provider: CallProvider,
    private readonly extractor: OutcomeExtractor,
    private readonly clock: Clock,
  ) {}

  public load(): Promise<CallOpsSnapshot> {
    return this.repository.load();
  }

  public async createSupportCase(input: CreateSupportCaseInput): Promise<CallOpsSnapshot> {
    requireNonEmpty(input);
    assertSyntheticData(input);
    const now = this.clock.now();
    const supportCase: SupportCase = {
      id: `case-${slug(input.syntheticReference)}`,
      organization: input.organization.trim(),
      syntheticReference: input.syntheticReference.trim(),
      category: input.category.trim(),
      context: input.context.trim(),
      desiredOutcome: input.desiredOutcome.trim(),
      authorizedInformation: input.authorizedInformation.map((item) => item.trim()),
      forbiddenInformation: input.forbiddenInformation.map((item) => item.trim()),
      createdAt: now,
      status: 'DRAFT',
    };
    const firstAudit = auditEvent([], {
      event: 'SUPPORT_CASE_CREATED',
      at: now,
      caseId: supportCase.id,
      previousState: null,
      newState: 'DRAFT',
      reason: 'Synthetic support case created locally.',
      planFingerprint: null,
      providerType: this.provider.providerType,
      humanDecision: null,
    });
    const snapshot: CallOpsSnapshot = {
      supportCase,
      plan: null,
      approval: null,
      run: null,
      outcome: null,
      audit: [firstAudit],
    };
    await this.repository.save(snapshot);
    return snapshot;
  }

  public async createPlan(scenario: MockScenario): Promise<CallOpsSnapshot> {
    const snapshot = await this.repository.load();
    const supportCase = snapshot.supportCase;
    if (supportCase === null || supportCase.status !== 'DRAFT') {
      throw new ApprovalGateError('A draft support case is required before planning.');
    }
    const now = this.clock.now();
    const plan = await this.provider.planCall({ supportCase, scenario, now });
    if (plan.provider !== this.provider.providerType) {
      throw new ApprovalGateError('Provider identity changed while creating the plan.');
    }
    assertPlanTransmitsNoForbiddenData(plan, supportCase);
    const planFingerprint = await fingerprintPlan(plan);
    const run: CallRun = {
      id: `run-${plan.id}`,
      caseId: supportCase.id,
      planId: plan.id,
      scenario,
      provider: plan.provider,
      state: 'WAITING_FOR_APPROVAL',
      providerRunId: null,
      transcript: [],
      retryScheduled: false,
      createdAt: now,
      updatedAt: now,
    };
    const nextAudit = auditEvent(snapshot.audit, {
      event: 'MOCK_CALL_PLAN_CREATED',
      at: now,
      caseId: supportCase.id,
      previousState: 'DRAFT',
      newState: 'WAITING_FOR_APPROVAL',
      reason: 'Mock plan created; no external service contacted.',
      planFingerprint,
      providerType: plan.provider,
      humanDecision: null,
    });
    const next: CallOpsSnapshot = {
      supportCase: withCaseStatus(supportCase, 'WAITING_FOR_APPROVAL'),
      plan,
      approval: null,
      run,
      outcome: null,
      audit: [...snapshot.audit, nextAudit],
    };
    await this.repository.save(next);
    return next;
  }

  public async revisePlan(
    revise: (current: CallPlan) => CallPlan,
  ): Promise<CallOpsSnapshot> {
    const snapshot = await this.repository.load();
    const { supportCase, plan, run } = requireSnapshotParts(snapshot);
    if (!['WAITING_FOR_APPROVAL', 'APPROVED', 'REJECTED'].includes(run.state)) {
      throw new ApprovalGateError('The plan can no longer be revised in the current state.');
    }
    const revised = revise(structuredClone(plan));
    if (
      revised.id !== plan.id ||
      revised.caseId !== plan.caseId ||
      revised.provider !== plan.provider
    ) {
      throw new ApprovalGateError('Plan identity and provider are immutable.');
    }
    assertPlanTransmitsNoForbiddenData(revised, supportCase);
    const [oldFingerprint, newFingerprint] = await Promise.all([
      fingerprintPlan(plan),
      fingerprintPlan(revised),
    ]);
    if (oldFingerprint === newFingerprint) return snapshot;

    const now = this.clock.now();
    const nextRun =
      run.state === 'WAITING_FOR_APPROVAL'
        ? { ...run, updatedAt: now }
        : transitionRun(run, 'WAITING_FOR_APPROVAL', now);
    const nextAudit = auditEvent(snapshot.audit, {
      event: snapshot.approval === null ? 'MOCK_CALL_PLAN_REVISED' : 'APPROVAL_INVALIDATED',
      at: now,
      caseId: supportCase.id,
      previousState: run.state,
      newState: 'WAITING_FOR_APPROVAL',
      reason:
        snapshot.approval === null
          ? 'Mock plan changed before approval.'
          : 'Plan content changed; prior approval fingerprint no longer applies.',
      planFingerprint: newFingerprint,
      providerType: revised.provider,
      humanDecision: snapshot.approval?.decision ?? null,
    });
    const next: CallOpsSnapshot = {
      ...snapshot,
      supportCase: withCaseStatus(supportCase, 'WAITING_FOR_APPROVAL'),
      plan: revised,
      approval: null,
      run: nextRun,
      outcome: null,
      audit: [...snapshot.audit, nextAudit],
    };
    await this.repository.save(next);
    return next;
  }

  public async recordApproval(
    decision: ApprovalDecision,
    confirmedTransmittedData: readonly string[],
    comment: string | null = null,
  ): Promise<CallOpsSnapshot> {
    const snapshot = await this.repository.load();
    const { supportCase, plan, run } = requireSnapshotParts(snapshot);
    if (run.state !== 'WAITING_FOR_APPROVAL') {
      throw new ApprovalGateError('Approval is only accepted from the review state.');
    }
    if (comment !== null) assertSyntheticData(comment);
    if (decision === 'APPROVED' && !sameStringList(confirmedTransmittedData, plan.transmittedData)) {
      throw new ApprovalGateError(
        'The exact transmitted-data list was not confirmed.',
        'TRANSMITTED_DATA_NOT_CONFIRMED',
      );
    }
    const now = this.clock.now();
    const planFingerprint = await fingerprintPlan(plan);
    const approval: HumanApproval = {
      decision,
      decidedAt: now,
      planFingerprint,
      confirmedTransmittedData:
        decision === 'APPROVED' ? [...confirmedTransmittedData] : [],
      comment,
    };
    const nextState = decision;
    const nextRun = transitionRun(run, nextState, now);
    const nextAudit = auditEvent(snapshot.audit, {
      event: decision === 'APPROVED' ? 'HUMAN_APPROVAL_GRANTED' : 'HUMAN_APPROVAL_REJECTED',
      at: now,
      caseId: supportCase.id,
      previousState: run.state,
      newState: nextState,
      reason:
        decision === 'APPROVED'
          ? 'Human explicitly approved the exact mock plan and transmitted data.'
          : 'Human rejected the mock simulation.',
      planFingerprint,
      providerType: plan.provider,
      humanDecision: decision,
    });
    const next: CallOpsSnapshot = {
      ...snapshot,
      supportCase: withCaseStatus(supportCase, nextState),
      approval,
      run: nextRun,
      outcome: null,
      audit: [...snapshot.audit, nextAudit],
    };
    await this.repository.save(next);
    return next;
  }

  public async startApprovedSimulation(): Promise<CallOpsSnapshot> {
    const snapshot = await this.repository.load();
    const { supportCase, plan, run } = requireSnapshotParts(snapshot);
    const approval = snapshot.approval;
    if (this.provider.providerType !== 'MOCK' || plan.provider !== 'MOCK' || run.provider !== 'MOCK') {
      throw new ApprovalGateError('Only MockCallProvider may start in this vertical slice.', 'LIVE_PROVIDER_REFUSED');
    }
    if (run.state !== 'APPROVED' || approval === null || approval.decision !== 'APPROVED') {
      throw new ApprovalGateError('An explicit approval is required before simulation.');
    }
    const currentFingerprint = await fingerprintPlan(plan);
    if (approval.planFingerprint !== currentFingerprint) {
      throw new ApprovalGateError('Approval fingerprint does not match the current plan.', 'FINGERPRINT_MISMATCH');
    }
    if (!sameStringList(approval.confirmedTransmittedData, plan.transmittedData)) {
      throw new ApprovalGateError('Approved transmitted data no longer matches the plan.');
    }
    assertSyntheticData(supportCase);
    assertPlanTransmitsNoForbiddenData(plan, supportCase);

    const now = this.clock.now();
    const providerStatus = await this.provider.startCall({
      plan,
      approval,
      scenario: run.scenario,
      now,
    });
    if (providerStatus.state !== 'QUEUED' || providerStatus.retryScheduled) {
      throw new ApprovalGateError('Mock provider returned an unsafe initial state.');
    }
    const queued = transitionRun(run, 'QUEUED', now);
    const nextRun: CallRun = {
      ...queued,
      providerRunId: providerStatus.providerRunId,
      transcript: [...providerStatus.transcript],
      retryScheduled: false,
    };
    const nextAudit = auditEvent(snapshot.audit, {
      event: 'MOCK_SIMULATION_QUEUED',
      at: now,
      caseId: supportCase.id,
      previousState: 'APPROVED',
      newState: 'QUEUED',
      reason: 'Approved local simulation queued in MockCallProvider.',
      planFingerprint: currentFingerprint,
      providerType: 'MOCK',
      humanDecision: 'APPROVED',
    });
    const next: CallOpsSnapshot = {
      ...snapshot,
      supportCase: withCaseStatus(supportCase, 'QUEUED'),
      run: nextRun,
      audit: [...snapshot.audit, nextAudit],
    };
    await this.repository.save(next);
    return next;
  }

  public async advanceSimulation(): Promise<CallOpsSnapshot> {
    const snapshot = await this.repository.load();
    const { supportCase, plan, run } = requireSnapshotParts(snapshot);
    if (this.provider.providerType !== 'MOCK' || run.provider !== 'MOCK') {
      throw new ApprovalGateError('Only MockCallProvider may advance in this vertical slice.');
    }
    if (run.providerRunId === null || !['QUEUED', 'IN_PROGRESS'].includes(run.state)) {
      throw new ApprovalGateError('The mock simulation cannot advance from the current state.');
    }
    const providerStatus = await this.provider.getCallStatus(run.providerRunId);
    if (providerStatus.providerRunId !== run.providerRunId || providerStatus.retryScheduled) {
      throw new ApprovalGateError('Mock provider returned an unsafe status.');
    }
    const now = this.clock.now();
    const nextRunBase = transitionRun(run, providerStatus.state, now);
    const nextRun: CallRun = {
      ...nextRunBase,
      transcript: [...providerStatus.transcript],
      retryScheduled: false,
    };
    const outcome = isTerminalState(providerStatus.state)
      ? this.extractor.extract(providerStatus, plan)
      : null;
    if (outcome !== null && outcome.commitmentsMade.length !== 0) {
      throw new ApprovalGateError('Mock outcomes may not record commitments as accepted.');
    }
    const planFingerprint = await fingerprintPlan(plan);
    const eventName =
      providerStatus.state === 'IN_PROGRESS'
        ? 'MOCK_SIMULATION_IN_PROGRESS'
        : providerStatus.state === 'COMPLETED'
          ? 'MOCK_SIMULATION_COMPLETED'
          : 'MOCK_SIMULATION_FAILED';
    const nextAudit = auditEvent(snapshot.audit, {
      event: eventName,
      at: now,
      caseId: supportCase.id,
      previousState: run.state,
      newState: providerStatus.state,
      reason:
        providerStatus.state === 'FAILED'
          ? 'Mock organization unreachable; no automatic retry scheduled.'
          : 'Deterministic local mock state transition.',
      planFingerprint,
      providerType: 'MOCK',
      humanDecision: snapshot.approval?.decision ?? null,
    });
    const next: CallOpsSnapshot = {
      ...snapshot,
      supportCase: withCaseStatus(supportCase, providerStatus.state),
      run: nextRun,
      outcome,
      audit: [...snapshot.audit, nextAudit],
    };
    await this.repository.save(next);
    return next;
  }

  public async runSimulationToCompletion(): Promise<CallOpsSnapshot> {
    let snapshot = await this.repository.load();
    for (let step = 0; step < 3; step += 1) {
      if (snapshot.run !== null && isTerminalState(snapshot.run.state)) return snapshot;
      snapshot = await this.advanceSimulation();
    }
    throw new ApprovalGateError('Mock simulation exceeded its deterministic step budget.');
  }

  public async exportSanitizedAudit(): Promise<string> {
    const snapshot = await this.repository.load();
    const sanitizedAudit = snapshot.audit.map((entry) => ({
      ...entry,
      reason: sanitizeAuditText(entry.reason),
    }));
    return JSON.stringify(
      {
        schemaVersion: 1,
        mode: 'LOCAL_MOCK_ONLY',
        exportedAt: this.clock.now(),
        notice: 'No real call was made.',
        audit: sanitizedAudit,
      },
      null,
      2,
    );
  }

  public async reset(): Promise<CallOpsSnapshot> {
    await this.repository.clear();
    return structuredClone(EMPTY_SNAPSHOT);
  }
}

export function providerStatusIsTerminal(status: ProviderRunStatus): boolean {
  return status.state === 'COMPLETED' || status.state === 'FAILED';
}
