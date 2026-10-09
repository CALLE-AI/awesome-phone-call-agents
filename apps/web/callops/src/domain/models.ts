export const CALL_RUN_STATES = [
  'DRAFT',
  'WAITING_FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'QUEUED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type CallRunState = (typeof CALL_RUN_STATES)[number];
export type MockScenario = 'NOMINAL' | 'AMBIGUOUS' | 'CONFLICTING' | 'FAILED';
export type ProviderType = 'MOCK' | 'CALLE';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';
export type RiskEstimate = 'LOW' | 'MEDIUM' | 'HIGH';
export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SupportCase {
  readonly id: string;
  readonly organization: string;
  readonly syntheticReference: string;
  readonly category: string;
  readonly context: string;
  readonly desiredOutcome: string;
  readonly authorizedInformation: readonly string[];
  readonly forbiddenInformation: readonly string[];
  readonly createdAt: string;
  readonly status: CallRunState;
}

export interface CallPlan {
  readonly id: string;
  readonly caseId: string;
  readonly objectiveSummary: string;
  readonly proposedScript: readonly string[];
  readonly plannedQuestions: readonly string[];
  readonly transmittedData: readonly string[];
  readonly prohibitedBehaviors: readonly string[];
  readonly stopConditions: readonly string[];
  readonly riskEstimate: RiskEstimate;
  readonly provider: ProviderType;
  readonly createdAt: string;
}

export interface HumanApproval {
  readonly decision: ApprovalDecision;
  readonly decidedAt: string;
  readonly planFingerprint: string;
  readonly confirmedTransmittedData: readonly string[];
  readonly comment: string | null;
}

export interface CallRun {
  readonly id: string;
  readonly caseId: string;
  readonly planId: string;
  readonly scenario: MockScenario;
  readonly provider: ProviderType;
  readonly state: CallRunState;
  readonly providerRunId: string | null;
  readonly transcript: readonly string[];
  readonly retryScheduled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StructuredOutcome {
  readonly confirmedFacts: readonly string[];
  readonly unconfirmedFacts: readonly string[];
  readonly commitmentsMade: readonly string[];
  readonly commitmentsRefused: readonly string[];
  readonly announcedDelay: string | null;
  readonly contactOrService: string | null;
  readonly nextActions: readonly string[];
  readonly humanDecisionRequired: boolean;
  readonly confidence: ConfidenceLevel;
  readonly citations: readonly string[];
  readonly securitySignals: readonly string[];
}

export interface AuditEvent {
  readonly id: string;
  readonly event: string;
  readonly at: string;
  readonly caseId: string;
  readonly previousState: CallRunState | null;
  readonly newState: CallRunState;
  readonly reason: string;
  readonly planFingerprint: string | null;
  readonly providerType: ProviderType;
  readonly humanDecision: ApprovalDecision | null;
}

export interface CallOpsSnapshot {
  readonly supportCase: SupportCase | null;
  readonly plan: CallPlan | null;
  readonly approval: HumanApproval | null;
  readonly run: CallRun | null;
  readonly outcome: StructuredOutcome | null;
  readonly audit: readonly AuditEvent[];
}

export interface CreateSupportCaseInput {
  readonly organization: string;
  readonly syntheticReference: string;
  readonly category: string;
  readonly context: string;
  readonly desiredOutcome: string;
  readonly authorizedInformation: readonly string[];
  readonly forbiddenInformation: readonly string[];
}

export const EMPTY_SNAPSHOT: CallOpsSnapshot = Object.freeze({
  supportCase: null,
  plan: null,
  approval: null,
  run: null,
  outcome: null,
  audit: Object.freeze([]),
});
