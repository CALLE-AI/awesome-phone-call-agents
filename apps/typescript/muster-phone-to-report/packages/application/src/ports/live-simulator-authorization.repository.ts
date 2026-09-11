import type { OrganizationId } from "@muster/domain";

export type LiveSimulatorAuthorizationState = "issued" | "reserved" | "bound";

export type LiveSimulatorCleanupState =
  | "barrier_pending"
  | "awaiting_identity"
  | "awaiting_arrival"
  | "awaiting_terminal"
  | "awaiting_grace"
  | "restoration_ready"
  | "restoration_started"
  | "restored"
  | "secrets_revoked"
  | "host_stopped"
  | "tunnel_stopped"
  | "complete"
  | "blocked";

export type LiveSimulatorCleanupBlockedReason =
  | "dispatch_ambiguous"
  | "operation_unavailable"
  | "identity_deadline"
  | "arrival_deadline"
  | "call_disappeared"
  | "call_mismatch"
  | "multiple_calls"
  | "status_regressed"
  | "unsupported_status"
  | "deadline_exhausted"
  | "time_invalid"
  | "observation_failed"
  | "restoration_ambiguous";

export type LiveDemoReviewCleanupState =
  "ready" | "cleanup_pending" | "cleanup_blocked" | "deleted";

export interface LiveSimulatorAuthorizationRecord {
  readonly organizationId: OrganizationId;
  readonly operationId: string;
  readonly nonceDigest: string;
  readonly semanticDigest: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly audience: string;
  readonly endpointAlias: string;
  readonly callerDigest: string | null;
  readonly authorizedTargetDigest: string;
  readonly publicOrigin: string;
  readonly purpose: "non-production-synthetic-live-smoke";
  readonly callBudget: 1;
  readonly concurrency: 1;
  readonly retryBudget: 0;
  readonly dtmfPolicy: "forbidden";
  readonly terminalDeadlineSeconds: number;
  readonly predecessorOperationId: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly state: LiveSimulatorAuthorizationState;
  readonly reservedAt: string | null;
  readonly providerDispatchIdentity: string | null;
  readonly boundAt: string | null;
  readonly dispatchClaimedAt: string | null;
  readonly dispatchDisposition: "provider_returned" | "provider_failed" | null;
  readonly dispatchClosedAt: string | null;
  readonly cleanupState: LiveSimulatorCleanupState | null;
  readonly cleanupDeadlineAt: string | null;
  readonly cleanupBlockedReason: LiveSimulatorCleanupBlockedReason | null;
  readonly cleanupStateChangedAt: string | null;
  readonly cleanupGraceUntilAt: string | null;
  readonly cleanupTerminalStatus: "completed" | "busy" | "failed" | "no-answer" | "canceled" | null;
  readonly reviewSessionId: string | null;
  readonly reviewReadyAt: string | null;
  readonly reviewExpiresAt: string | null;
  readonly reviewCleanupState: LiveDemoReviewCleanupState | null;
  readonly reviewCleanupStateChangedAt: string | null;
  readonly reviewCustodyOwnershipDigest: string | null;
  readonly reviewDatabaseOwnershipDigest: string | null;
}

export interface IssueLiveSimulatorAuthorizationInput {
  readonly organizationId: OrganizationId;
  readonly operationId: string;
  readonly nonceDigest: string;
  readonly semanticDigest: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly audience: string;
  readonly endpointAlias: string;
  readonly authorizedTargetDigest: string;
  readonly publicOrigin: string;
  readonly purpose: "non-production-synthetic-live-smoke";
  readonly callBudget: 1;
  readonly concurrency: 1;
  readonly retryBudget: 0;
  readonly dtmfPolicy: "forbidden";
  readonly terminalDeadlineSeconds: number;
  readonly predecessorOperationId: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ReserveLiveSimulatorAuthorizationInput {
  readonly organizationId: OrganizationId;
  readonly operationId: string;
  readonly nonceDigest: string;
  readonly semanticDigest: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly audience: string;
  readonly endpointAlias: string;
  readonly authorizedTargetDigest: string;
  readonly publicOrigin: string;
  readonly purpose: "non-production-synthetic-live-smoke";
  readonly callBudget: 1;
  readonly concurrency: 1;
  readonly retryBudget: 0;
  readonly dtmfPolicy: "forbidden";
  readonly terminalDeadlineSeconds: number;
  readonly predecessorOperationId: string | null;
  readonly now: string;
}

export interface BindLiveSimulatorAuthorizationInput {
  readonly organizationId: OrganizationId;
  readonly operationId: string;
  readonly nonceDigest: string;
  readonly providerDispatchIdentity: string;
  readonly boundAt: string;
}

export type LiveSimulatorAuthorizationIssueResult = Readonly<{
  outcome: "issued" | "replayed";
  operationId: string;
}>;

export type LiveSimulatorAuthorizationReservationResult =
  | Readonly<{ outcome: "reserved" | "replayed"; operationId: string }>
  | Readonly<{ outcome: "missing" | "expired" | "conflict" | "invalid_predecessor" }>;

export type LiveSimulatorAuthorizationBindingResult =
  | Readonly<{ outcome: "bound" | "replayed"; operationId: string }>
  | Readonly<{ outcome: "missing" | "conflict" }>;

export interface LiveSimulatorAuthorizationRepository {
  issue(
    input: IssueLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationIssueResult>;
  reserve(
    input: ReserveLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationReservationResult>;
  bind(
    input: BindLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationBindingResult>;
  findByOperationId(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<LiveSimulatorAuthorizationRecord | undefined>;
  claimInitialCallback(input: {
    readonly organizationId: OrganizationId;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
    readonly boundAt: string;
  }): Promise<
    | Readonly<{
        outcome: "bound" | "replayed";
        authorization: LiveSimulatorAuthorizationRecord;
      }>
    | Readonly<{ outcome: "missing" | "unmatched" | "conflict" }>
  >;
  authenticateBoundCallback(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
  }): Promise<
    | Readonly<{ outcome: "replayed"; authorization: LiveSimulatorAuthorizationRecord }>
    | Readonly<{ outcome: "missing" | "unmatched" | "conflict" }>
  >;
  authenticateStatusCallback(input: {
    readonly organizationId: OrganizationId;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
  }): Promise<
    | Readonly<{ outcome: "replayed"; authorization: LiveSimulatorAuthorizationRecord }>
    | Readonly<{ outcome: "missing" | "unmatched" | "conflict" }>
  >;
  claimDispatch(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly claimedAt: string;
  }): Promise<
    | Readonly<{ outcome: "claimed"; authorization: LiveSimulatorAuthorizationRecord }>
    | Readonly<{ outcome: "reconcile"; authorization: LiveSimulatorAuthorizationRecord }>
    | Readonly<{ outcome: "missing" | "conflict" }>
    | Readonly<{ outcome: "closed"; authorization: LiveSimulatorAuthorizationRecord }>
  >;
  recordDispatchDisposition(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly outcome: "provider_returned" | "provider_failed";
  }): Promise<Readonly<{ outcome: "recorded" | "replayed" | "missing" | "conflict" }>>;
  closeDispatchAndBeginCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly ownerDigest: string;
    readonly startedAt: string;
    readonly deadlineAt: string;
  }): Promise<
    | Readonly<{
        outcome: "acquired" | "replayed" | "in_progress" | "terminal";
        authorization: LiveSimulatorAuthorizationRecord;
      }>
    | Readonly<{ outcome: "missing" | "conflict" }>
  >;
  transitionCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly ownerDigest: string;
    readonly from: LiveSimulatorCleanupState;
    readonly to: LiveSimulatorCleanupState;
    readonly changedAt: string;
    readonly graceUntilAt?: string;
    readonly terminalStatus?: "completed" | "busy" | "failed" | "no-answer" | "canceled";
    readonly blockedReason?: LiveSimulatorCleanupBlockedReason;
  }): Promise<
    | Readonly<{
        outcome: "advanced" | "replayed";
        authorization: LiveSimulatorAuthorizationRecord;
      }>
    | Readonly<{ outcome: "missing" | "conflict" }>
  >;
  takeOverCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly ownerDigest: string;
    readonly previousOwnerStopped: true;
    readonly changedAt: string;
  }): Promise<
    | Readonly<{ outcome: "acquired"; authorization: LiveSimulatorAuthorizationRecord }>
    | Readonly<{ outcome: "terminal"; authorization: LiveSimulatorAuthorizationRecord }>
    | Readonly<{ outcome: "missing" | "conflict" }>
  >;
  establishReviewLease(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly sessionId: string;
    readonly reviewReadyAt: string;
    readonly reviewExpiresAt: string;
    readonly custodyOwnershipDigest: string;
    readonly databaseOwnershipDigest: string;
    readonly databaseProvisioningOwnershipDigest: string;
  }): Promise<
    | Readonly<{
        outcome: "established" | "replayed";
        authorization: LiveSimulatorAuthorizationRecord;
      }>
    | Readonly<{ outcome: "missing" | "conflict" }>
  >;
  transitionReviewCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly sessionId: string;
    readonly from: LiveDemoReviewCleanupState;
    readonly to: LiveDemoReviewCleanupState;
    readonly changedAt: string;
  }): Promise<
    | Readonly<{
        outcome: "advanced" | "replayed";
        authorization: LiveSimulatorAuthorizationRecord;
      }>
    | Readonly<{ outcome: "missing" | "conflict" }>
  >;
  attestReviewDatabaseOwnership(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly sessionId: string;
    readonly databaseOwnershipDigest: string;
    readonly databaseProvisioningOwnershipDigest: string;
  }): Promise<
    | Readonly<{ outcome: "owned"; exclusive: true }>
    | Readonly<{ outcome: "shared" | "mismatch" | "missing" | "indeterminate" }>
  >;
}

export interface LiveSimulatorAuthorizationIssuerPort {
  issue(
    input: IssueLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationIssueResult>;
}

export interface LiveSimulatorAuthorizationReservationPort {
  reserve(
    input: ReserveLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationReservationResult>;
}

export interface LiveSimulatorAuthorizationBindingPort {
  bind(
    input: BindLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationBindingResult>;
}
