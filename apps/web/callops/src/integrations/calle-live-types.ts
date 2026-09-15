import type { CallPlan, HumanApproval } from '../domain/models';
import type { CallePlanContractResult, CallePlanPayload } from './calle-plan-only';

declare const CALLE_PLAN_ID: unique symbol;
declare const CALLE_CONFIRM_TOKEN: unique symbol;
declare const CALLE_RUN_ID: unique symbol;

export type CallePlanId = string & { readonly [CALLE_PLAN_ID]: true };
export type CalleConfirmToken = string & { readonly [CALLE_CONFIRM_TOKEN]: true };
export type CalleRunId = string & { readonly [CALLE_RUN_ID]: true };

export const CALLE_LIVE_TOOL_ALLOWLIST = Object.freeze([
  'plan_call',
  'run_call',
  'get_call_run',
] as const);

export type CalleLiveToolName = (typeof CALLE_LIVE_TOOL_ALLOWLIST)[number];

export interface CalleLivePlanRequest {
  readonly plan_id?: string | null;
  readonly to_phones?: readonly string[] | null;
  readonly region?: string | null;
  readonly language?: string | null;
  readonly goal?: string | null;
  readonly scheduled_at?: string | null;
  readonly retry_confirmation_action?:
    | 'confirm_suggested_time'
    | 'retry_now'
    | 'set_custom_time'
    | null;
  readonly user_input?: string | null;
  readonly ttl_seconds?: number | null;
}

export const CALLE_LIVE_STATES = Object.freeze([
  'DRAFT',
  'NEEDS_DETAILS',
  'READY_FOR_REVIEW',
  'WAITING_FOR_APPROVAL',
  'APPROVED',
  'RUN_REQUESTED',
  'REMOTE_EXECUTION_UNCERTAIN',
  'QUEUED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED_LOCAL',
  'STATUS_UNKNOWN',
] as const);

export type CalleLiveState = (typeof CALLE_LIVE_STATES)[number];

export interface CalleRunStartAccepted {
  readonly kind: 'ACCEPTED';
  readonly runId: CalleRunId;
  readonly initialState: 'QUEUED' | 'IN_PROGRESS' | 'STATUS_UNKNOWN';
}

export interface CalleRunStartRejected {
  readonly kind: 'REJECTED_BEFORE_EXECUTION';
  readonly reasonCode: string;
}

export type CalleRunStartResult = CalleRunStartAccepted | CalleRunStartRejected;

export interface CalleRunStatusObservation {
  readonly state: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
  readonly transcript: readonly unknown[];
  readonly summary: unknown;
  readonly failureReason: unknown;
}

export interface CalleLiveTransport {
  planCall(payload: CalleLivePlanRequest): Promise<unknown>;
  runCall(capability: {
    readonly planId: CallePlanId;
    readonly confirmToken: CalleConfirmToken;
  }): Promise<CalleRunStartResult>;
  getCallRun(runId: CalleRunId): Promise<CalleRunStatusObservation>;
}

export interface CalleRunCheckpointStore {
  save(sessionId: string, checkpoint: CalleRunCheckpointRecord): Promise<void>;
  load(sessionId: string): Promise<CalleRunCheckpointRecord | null>;
  has(sessionId: string): Promise<boolean>;
  clear(sessionId: string): Promise<void>;
}

export const CALLE_RUN_CHECKPOINT_PHASES = Object.freeze([
  'RUN_REQUESTED',
  'REMOTE_EXECUTION_UNCERTAIN',
  'RUN_ID_RECEIVED',
  'STATUS_UNKNOWN',
  'LOCAL_TRACKING_STOPPED',
  'TERMINAL',
] as const);

export type CalleRunCheckpointPhase = (typeof CALLE_RUN_CHECKPOINT_PHASES)[number];

export interface CalleRunCheckpointRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly phase: CalleRunCheckpointPhase;
  readonly runId: CalleRunId | null;
  readonly remoteState: 'QUEUED' | 'IN_PROGRESS' | null;
  readonly terminalState: 'COMPLETED' | 'FAILED' | null;
  readonly updatedAt: string;
  readonly reasonCode: string | null;
}

export interface CallePlanCapabilityVault {
  store(
    planFingerprint: string,
    capability: { readonly planId: CallePlanId; readonly confirmToken: CalleConfirmToken },
  ): void;
  take(planFingerprint: string): {
    readonly planId: CallePlanId;
    readonly confirmToken: CalleConfirmToken;
  } | null;
  has(planFingerprint: string): boolean;
  delete(planFingerprint: string): void;
  clear(): void;
}

export interface CalleLiveAuditEvent {
  readonly sequence: number;
  readonly at: string;
  readonly event: string;
  readonly previousState: CalleLiveState | null;
  readonly newState: CalleLiveState;
  readonly reasonCode: string;
  readonly planFingerprint: string | null;
  readonly checkpointPresent: boolean;
  readonly checkpointPhase: CalleRunCheckpointPhase | null;
  readonly humanDecision: 'APPROVED' | 'REJECTED' | null;
}

export interface CalleLiveSessionView {
  readonly sessionId: string;
  readonly state: CalleLiveState;
  readonly provider: 'CALLE';
  readonly planFingerprint: string | null;
  readonly planObservation: CallePlanContractResult | null;
  readonly approvalDecision: HumanApproval['decision'] | null;
  readonly gateState: 'ABSENT' | 'WAITING' | 'CONSUMED';
  readonly capabilityPresent: boolean;
  readonly checkpointPresent: boolean;
  readonly checkpointPhase: CalleRunCheckpointPhase | null;
  readonly transcript: readonly string[];
  readonly summary: string | null;
  readonly failureReason: string | null;
  readonly securitySignals: readonly string[];
  readonly audit: readonly CalleLiveAuditEvent[];
}

export interface PrepareCalleLivePlanRequest {
  readonly reviewPlan: CallPlan;
  readonly payload: CallePlanPayload;
}

export interface CallePollingOptions {
  readonly initialDelayMs: number;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly maxPolls: number;
}

export interface CallePollingRuntime {
  readonly nowMs: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
}
