import type {
  CallPlan,
  HumanApproval,
  MockScenario,
  ProviderType,
  SupportCase,
} from '../domain/models';

export type ProviderRunState = 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface PlanCallRequest {
  readonly supportCase: SupportCase;
  readonly scenario: MockScenario;
  readonly now: string;
}

export interface StartCallRequest {
  readonly plan: CallPlan;
  readonly approval: HumanApproval;
  readonly scenario: MockScenario;
  readonly now: string;
}

export interface ProviderRunStatus {
  readonly providerRunId: string;
  readonly scenario: MockScenario;
  readonly state: ProviderRunState;
  readonly transcript: readonly string[];
  readonly failureReason: string | null;
  readonly retryScheduled: boolean;
}

export interface CallProvider {
  readonly providerType: ProviderType;
  planCall(request: PlanCallRequest): Promise<CallPlan>;
  startCall(request: StartCallRequest): Promise<ProviderRunStatus>;
  getCallStatus(providerRunId: string): Promise<ProviderRunStatus>;
}
