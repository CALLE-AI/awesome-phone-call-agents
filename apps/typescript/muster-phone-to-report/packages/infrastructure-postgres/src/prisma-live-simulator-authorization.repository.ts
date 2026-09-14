import {
  ApplicationError,
  type BindLiveSimulatorAuthorizationInput,
  type IssueLiveSimulatorAuthorizationInput,
  type LiveDemoReviewCleanupState,
  type LiveSimulatorAuthorizationBindingResult,
  type LiveSimulatorAuthorizationIssueResult,
  type LiveSimulatorAuthorizationRecord,
  type LiveSimulatorAuthorizationRepository,
  type LiveSimulatorAuthorizationReservationResult,
  type LiveSimulatorCleanupBlockedReason,
  type LiveSimulatorCleanupState,
  type ReserveLiveSimulatorAuthorizationInput,
} from "@muster/application";
import { OrganizationId } from "@muster/domain";

import type { PrismaClient } from "./generated/prisma/client.js";

interface PersistedAuthorization {
  readonly authorizationVersion: number;
  readonly organizationId: string;
  readonly operationId: string;
  readonly nonceDigest: string;
  readonly semanticDigest: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly audience: string;
  readonly endpointAlias: string;
  readonly expectedCallerDigest: string | null;
  readonly authorizedTargetDigest: string | null;
  readonly publicOrigin: string | null;
  readonly purpose: string | null;
  readonly callBudget: number | null;
  readonly concurrency: number | null;
  readonly retryBudget: number | null;
  readonly dtmfPolicy: string | null;
  readonly terminalDeadlineSeconds: number | null;
  readonly predecessorOperationId: string | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly state: "issued" | "reserved" | "bound";
  readonly reservedAt: Date | null;
  readonly providerDispatchIdentity: string | null;
  readonly boundAt: Date | null;
  readonly dispatchClaimedAt: Date | null;
  readonly dispatchDisposition: string | null;
  readonly dispatchClosedAt: Date | null;
  readonly cleanupState: LiveSimulatorCleanupState | null;
  readonly cleanupDeadlineAt: Date | null;
  readonly cleanupOwnerDigest: string | null;
  readonly cleanupBlockedReason: string | null;
  readonly cleanupStateChangedAt: Date | null;
  readonly cleanupGraceUntilAt: Date | null;
  readonly cleanupTerminalStatus: string | null;
  readonly reviewSessionId: string | null;
  readonly reviewReadyAt: Date | null;
  readonly reviewExpiresAt: Date | null;
  readonly reviewCleanupState: LiveDemoReviewCleanupState | null;
  readonly reviewCleanupStateChangedAt: Date | null;
  readonly reviewCustodyOwnershipDigest: string | null;
  readonly reviewDatabaseOwnershipDigest: string | null;
}

const digestPattern = /^[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const aliasPattern = /^[a-z][a-z0-9-]{0,127}$/u;
const terminalStatuses = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
const blockedReasons = new Set<LiveSimulatorCleanupBlockedReason>([
  "dispatch_ambiguous",
  "operation_unavailable",
  "identity_deadline",
  "arrival_deadline",
  "call_disappeared",
  "call_mismatch",
  "multiple_calls",
  "status_regressed",
  "unsupported_status",
  "deadline_exhausted",
  "time_invalid",
  "observation_failed",
  "restoration_ambiguous",
]);
const terminalCleanupStates = new Set<LiveSimulatorCleanupState>(["blocked", "complete"]);
const legalReviewCleanupTransitions: Readonly<
  Record<LiveDemoReviewCleanupState, ReadonlySet<LiveDemoReviewCleanupState>>
> = {
  ready: new Set(["cleanup_pending"]),
  cleanup_pending: new Set(["cleanup_blocked", "deleted"]),
  cleanup_blocked: new Set(["cleanup_pending"]),
  deleted: new Set(),
};
// Enforcing the state machine at the persistence boundary prevents a restarted or competing
// owner from skipping or replaying destructive cleanup effects.
const legalCleanupTransitions: Readonly<
  Record<LiveSimulatorCleanupState, ReadonlySet<LiveSimulatorCleanupState>>
> = {
  barrier_pending: new Set([
    "awaiting_identity",
    "awaiting_arrival",
    "restoration_ready",
    "blocked",
  ]),
  awaiting_identity: new Set(["awaiting_arrival", "blocked"]),
  awaiting_arrival: new Set(["awaiting_terminal", "awaiting_grace", "blocked"]),
  awaiting_terminal: new Set(["awaiting_grace", "blocked"]),
  awaiting_grace: new Set(["restoration_ready", "blocked"]),
  restoration_ready: new Set(["restoration_started", "blocked"]),
  restoration_started: new Set(["restored", "blocked"]),
  restored: new Set(["secrets_revoked"]),
  secrets_revoked: new Set(["host_stopped"]),
  host_stopped: new Set(["tunnel_stopped"]),
  tunnel_stopped: new Set(["complete"]),
  complete: new Set(),
  blocked: new Set(),
};

function requireIdentifier(value: string): void {
  if (!identifierPattern.test(value)) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
}

function requireAlias(value: string): void {
  if (!aliasPattern.test(value)) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
}

function requireDigest(value: string): void {
  if (!digestPattern.test(value)) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
}

function requireInstant(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
  return parsed;
}

function validateIssue(input: IssueLiveSimulatorAuthorizationInput): {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
} {
  requireIdentifier(input.operationId);
  requireDigest(input.nonceDigest);
  requireDigest(input.semanticDigest);
  requireAlias(input.scenarioId);
  requireIdentifier(input.audience);
  requireAlias(input.endpointAlias);
  requireDigest(input.authorizedTargetDigest);
  if (
    !/^https:\/\/[^/?#]+$/u.test(input.publicOrigin) ||
    input.purpose !== "non-production-synthetic-live-smoke" ||
    input.callBudget !== 1 ||
    input.concurrency !== 1 ||
    input.retryBudget !== 0 ||
    input.dtmfPolicy !== "forbidden" ||
    !Number.isSafeInteger(input.terminalDeadlineSeconds) ||
    input.terminalDeadlineSeconds < 1 ||
    input.terminalDeadlineSeconds > 120
  ) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
  if (input.predecessorOperationId !== null) requireIdentifier(input.predecessorOperationId);
  if (!Number.isSafeInteger(input.scenarioRevision) || input.scenarioRevision < 1) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
  const issuedAt = requireInstant(input.issuedAt);
  const expiresAt = requireInstant(input.expiresAt);
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
  return { issuedAt, expiresAt };
}

function toRecord(record: PersistedAuthorization): LiveSimulatorAuthorizationRecord {
  if (
    record.authorizationVersion !== 2 ||
    record.authorizedTargetDigest === null ||
    record.publicOrigin === null ||
    record.purpose !== "non-production-synthetic-live-smoke" ||
    record.callBudget !== 1 ||
    record.concurrency !== 1 ||
    record.retryBudget !== 0 ||
    record.dtmfPolicy !== "forbidden" ||
    record.terminalDeadlineSeconds === null ||
    (record.dispatchDisposition !== null &&
      record.dispatchDisposition !== "provider_returned" &&
      record.dispatchDisposition !== "provider_failed") ||
    (record.dispatchClosedAt === null) !== (record.cleanupState === null) ||
    (record.cleanupState === null) !== (record.cleanupDeadlineAt === null) ||
    (record.cleanupState === null) !== (record.cleanupOwnerDigest === null) ||
    (record.cleanupState === null) !== (record.cleanupStateChangedAt === null) ||
    (record.cleanupState === "blocked") !== (record.cleanupBlockedReason !== null) ||
    (record.cleanupGraceUntilAt === null) !== (record.cleanupTerminalStatus === null) ||
    (record.cleanupTerminalStatus !== null &&
      !terminalStatuses.has(record.cleanupTerminalStatus)) ||
    (record.cleanupBlockedReason !== null &&
      !blockedReasons.has(record.cleanupBlockedReason as LiveSimulatorCleanupBlockedReason)) ||
    (record.reviewSessionId === null) !== (record.reviewReadyAt === null) ||
    (record.reviewSessionId === null) !== (record.reviewExpiresAt === null) ||
    (record.reviewSessionId === null) !== (record.reviewCleanupState === null) ||
    (record.reviewSessionId === null) !== (record.reviewCleanupStateChangedAt === null) ||
    (record.reviewSessionId === null) !== (record.reviewCustodyOwnershipDigest === null) ||
    (record.reviewSessionId === null) !== (record.reviewDatabaseOwnershipDigest === null)
  ) {
    throw ApplicationError.validation("live_authorization_invalid");
  }
  return Object.freeze({
    organizationId: OrganizationId.create(record.organizationId),
    operationId: record.operationId,
    nonceDigest: record.nonceDigest,
    semanticDigest: record.semanticDigest,
    scenarioId: record.scenarioId,
    scenarioRevision: record.scenarioRevision,
    audience: record.audience,
    endpointAlias: record.endpointAlias,
    callerDigest: record.expectedCallerDigest,
    authorizedTargetDigest: record.authorizedTargetDigest,
    publicOrigin: record.publicOrigin,
    purpose: "non-production-synthetic-live-smoke",
    callBudget: 1,
    concurrency: 1,
    retryBudget: 0,
    dtmfPolicy: "forbidden",
    terminalDeadlineSeconds: record.terminalDeadlineSeconds,
    predecessorOperationId: record.predecessorOperationId,
    issuedAt: record.issuedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    state: record.state,
    reservedAt: record.reservedAt?.toISOString() ?? null,
    providerDispatchIdentity: record.providerDispatchIdentity,
    boundAt: record.boundAt?.toISOString() ?? null,
    dispatchClaimedAt: record.dispatchClaimedAt?.toISOString() ?? null,
    dispatchDisposition: record.dispatchDisposition,
    dispatchClosedAt: record.dispatchClosedAt?.toISOString() ?? null,
    cleanupState: record.cleanupState,
    cleanupDeadlineAt: record.cleanupDeadlineAt?.toISOString() ?? null,
    cleanupBlockedReason: record.cleanupBlockedReason as LiveSimulatorCleanupBlockedReason | null,
    cleanupStateChangedAt: record.cleanupStateChangedAt?.toISOString() ?? null,
    cleanupGraceUntilAt: record.cleanupGraceUntilAt?.toISOString() ?? null,
    cleanupTerminalStatus: record.cleanupTerminalStatus as
      "completed" | "busy" | "failed" | "no-answer" | "canceled" | null,
    reviewSessionId: record.reviewSessionId,
    reviewReadyAt: record.reviewReadyAt?.toISOString() ?? null,
    reviewExpiresAt: record.reviewExpiresAt?.toISOString() ?? null,
    reviewCleanupState: record.reviewCleanupState,
    reviewCleanupStateChangedAt: record.reviewCleanupStateChangedAt?.toISOString() ?? null,
    reviewCustodyOwnershipDigest: record.reviewCustodyOwnershipDigest,
    reviewDatabaseOwnershipDigest: record.reviewDatabaseOwnershipDigest,
  });
}

function isIssueReplay(
  record: PersistedAuthorization,
  input: IssueLiveSimulatorAuthorizationInput,
): boolean {
  return (
    record.organizationId === input.organizationId.value &&
    record.operationId === input.operationId &&
    record.nonceDigest === input.nonceDigest &&
    record.semanticDigest === input.semanticDigest &&
    record.scenarioId === input.scenarioId &&
    record.scenarioRevision === input.scenarioRevision &&
    record.audience === input.audience &&
    record.endpointAlias === input.endpointAlias &&
    record.authorizedTargetDigest === input.authorizedTargetDigest &&
    record.publicOrigin === input.publicOrigin &&
    record.purpose === input.purpose &&
    record.callBudget === input.callBudget &&
    record.concurrency === input.concurrency &&
    record.retryBudget === input.retryBudget &&
    record.dtmfPolicy === input.dtmfPolicy &&
    record.terminalDeadlineSeconds === input.terminalDeadlineSeconds &&
    record.predecessorOperationId === input.predecessorOperationId &&
    record.issuedAt.toISOString() === input.issuedAt &&
    record.expiresAt.toISOString() === input.expiresAt
  );
}

function matchesReservation(
  record: PersistedAuthorization,
  input: ReserveLiveSimulatorAuthorizationInput,
): boolean {
  return (
    record.organizationId === input.organizationId.value &&
    record.operationId === input.operationId &&
    record.nonceDigest === input.nonceDigest &&
    record.semanticDigest === input.semanticDigest &&
    record.scenarioId === input.scenarioId &&
    record.scenarioRevision === input.scenarioRevision &&
    record.audience === input.audience &&
    record.endpointAlias === input.endpointAlias &&
    record.authorizedTargetDigest === input.authorizedTargetDigest &&
    record.publicOrigin === input.publicOrigin &&
    record.purpose === input.purpose &&
    record.callBudget === input.callBudget &&
    record.concurrency === input.concurrency &&
    record.retryBudget === input.retryBudget &&
    record.dtmfPolicy === input.dtmfPolicy &&
    record.terminalDeadlineSeconds === input.terminalDeadlineSeconds &&
    record.predecessorOperationId === input.predecessorOperationId
  );
}

export class PrismaLiveSimulatorAuthorizationRepository implements LiveSimulatorAuthorizationRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async issue(
    input: IssueLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationIssueResult> {
    const timestamps = validateIssue(input);
    try {
      await this.client.liveSimulatorAuthorization.create({
        data: {
          authorizationVersion: 2,
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          nonceDigest: input.nonceDigest,
          semanticDigest: input.semanticDigest,
          scenarioId: input.scenarioId,
          scenarioRevision: input.scenarioRevision,
          audience: input.audience,
          endpointAlias: input.endpointAlias,
          authorizedTargetDigest: input.authorizedTargetDigest,
          publicOrigin: input.publicOrigin,
          purpose: input.purpose,
          callBudget: input.callBudget,
          concurrency: input.concurrency,
          retryBudget: input.retryBudget,
          dtmfPolicy: input.dtmfPolicy,
          terminalDeadlineSeconds: input.terminalDeadlineSeconds,
          predecessorOperationId: input.predecessorOperationId,
          issuedAt: timestamps.issuedAt,
          expiresAt: timestamps.expiresAt,
        },
      });
      return Object.freeze({ outcome: "issued", operationId: input.operationId });
    } catch {
      let established: readonly PersistedAuthorization[];
      try {
        established = await this.findEstablished(input);
      } catch {
        throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
      }
      if (established.length === 1 && isIssueReplay(established[0]!, input)) {
        return Object.freeze({ outcome: "replayed", operationId: input.operationId });
      }
      if (established.length > 0) {
        throw ApplicationError.idempotencyConflict("live_authorization_conflict");
      }
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async reserve(
    input: ReserveLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationReservationResult> {
    try {
      requireIdentifier(input.operationId);
      requireDigest(input.nonceDigest);
      requireDigest(input.semanticDigest);
      requireAlias(input.scenarioId);
      if (input.predecessorOperationId !== null) requireIdentifier(input.predecessorOperationId);
      const now = requireInstant(input.now);
      const established = await this.client.liveSimulatorAuthorization.findUnique({
        where: { nonceDigest: input.nonceDigest },
      });
      if (established === null) return Object.freeze({ outcome: "missing" });
      if (established.authorizationVersion !== 2) return Object.freeze({ outcome: "expired" });
      if (!matchesReservation(established, input)) return Object.freeze({ outcome: "conflict" });
      if (established.state !== "issued") {
        return Object.freeze({ outcome: "replayed", operationId: established.operationId });
      }
      if (established.expiresAt.getTime() <= now.getTime()) {
        return Object.freeze({ outcome: "expired" });
      }
      if (!(await this.hasValidPredecessor(input))) {
        return Object.freeze({ outcome: "invalid_predecessor" });
      }
      // The database transition, not the preceding read, decides which caller consumes
      // the one-use authorization; the follow-up read classifies an identical loser as replay.
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          nonceDigest: input.nonceDigest,
          semanticDigest: input.semanticDigest,
          audience: input.audience,
          endpointAlias: input.endpointAlias,
          authorizationVersion: 2,
          state: "issued",
          expiresAt: { gt: now },
        },
        data: { state: "reserved", reservedAt: now },
      });
      if (update.count === 1) {
        return Object.freeze({ outcome: "reserved", operationId: input.operationId });
      }
      const current = await this.client.liveSimulatorAuthorization.findUnique({
        where: { nonceDigest: input.nonceDigest },
      });
      if (current !== null && matchesReservation(current, input) && current.state !== "issued") {
        return Object.freeze({ outcome: "replayed", operationId: current.operationId });
      }
      return Object.freeze({ outcome: "conflict" });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async bind(
    input: BindLiveSimulatorAuthorizationInput,
  ): Promise<LiveSimulatorAuthorizationBindingResult> {
    try {
      requireIdentifier(input.operationId);
      requireIdentifier(input.providerDispatchIdentity);
      requireDigest(input.nonceDigest);
      const boundAt = requireInstant(input.boundAt);
      const established = await this.client.liveSimulatorAuthorization.findUnique({
        where: { nonceDigest: input.nonceDigest },
      });
      if (established === null) return Object.freeze({ outcome: "missing" });
      if (
        established.organizationId !== input.organizationId.value ||
        established.operationId !== input.operationId ||
        established.state === "issued"
      ) {
        return Object.freeze({ outcome: "conflict" });
      }
      if (established.state === "bound") {
        return established.providerDispatchIdentity === input.providerDispatchIdentity
          ? Object.freeze({ outcome: "replayed", operationId: established.operationId })
          : Object.freeze({ outcome: "conflict" });
      }
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          nonceDigest: input.nonceDigest,
          state: "reserved",
          providerDispatchIdentity: null,
        },
        data: {
          state: "bound",
          providerDispatchIdentity: input.providerDispatchIdentity,
          boundAt,
        },
      });
      if (update.count === 1) {
        return Object.freeze({ outcome: "bound", operationId: input.operationId });
      }
      const current = await this.client.liveSimulatorAuthorization.findUnique({
        where: { nonceDigest: input.nonceDigest },
      });
      if (
        current?.state === "bound" &&
        current.operationId === input.operationId &&
        current.providerDispatchIdentity === input.providerDispatchIdentity
      ) {
        return Object.freeze({ outcome: "replayed", operationId: current.operationId });
      }
      return Object.freeze({ outcome: "conflict" });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      try {
        const current = await this.client.liveSimulatorAuthorization.findUnique({
          where: { nonceDigest: input.nonceDigest },
        });
        if (current === null) return Object.freeze({ outcome: "missing" });
        if (
          current.organizationId !== input.organizationId.value ||
          current.operationId !== input.operationId ||
          current.state === "issued"
        ) {
          return Object.freeze({ outcome: "conflict" });
        }
        if (current.state === "bound") {
          return current.providerDispatchIdentity === input.providerDispatchIdentity
            ? Object.freeze({ outcome: "replayed", operationId: current.operationId })
            : Object.freeze({ outcome: "conflict" });
        }
      } catch {
        throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
      }
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async findByOperationId(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<LiveSimulatorAuthorizationRecord | undefined> {
    try {
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: { organizationId: organizationId.value, operationId },
        },
      });
      return record === null || record.authorizationVersion !== 2 ? undefined : toRecord(record);
    } catch {
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async claimInitialCallback(input: {
    readonly organizationId: OrganizationId;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
    readonly boundAt: string;
  }) {
    try {
      requireAlias(input.endpointAlias);
      requireIdentifier(input.audience);
      requireDigest(input.providerCallDigest);
      requireDigest(input.callerDigest);
      requireDigest(input.authorizedTargetDigest);
      const boundAt = requireInstant(input.boundAt);
      const replay = await this.client.liveSimulatorAuthorization.findFirst({
        where: {
          organizationId: input.organizationId.value,
          endpointAlias: input.endpointAlias,
          audience: input.audience,
          authorizationVersion: 2,
          state: "bound",
          providerDispatchIdentity: input.providerCallDigest,
        },
      });
      if (replay !== null) {
        if (
          replay.expectedCallerDigest !== input.callerDigest ||
          replay.authorizedTargetDigest !== input.authorizedTargetDigest
        ) {
          return Object.freeze({ outcome: "unmatched" as const });
        }
        return Object.freeze({ outcome: "replayed" as const, authorization: toRecord(replay) });
      }
      const candidates = await this.client.liveSimulatorAuthorization.findMany({
        where: {
          organizationId: input.organizationId.value,
          endpointAlias: input.endpointAlias,
          audience: input.audience,
          authorizationVersion: 2,
          state: "reserved",
          expectedCallerDigest: null,
          authorizedTargetDigest: input.authorizedTargetDigest,
          providerDispatchIdentity: null,
          dispatchClaimedAt: { not: null },
          expiresAt: { gt: boundAt },
        },
        take: 2,
        orderBy: { reservedAt: "asc" },
      });
      if (candidates.length === 0) return Object.freeze({ outcome: "missing" as const });
      if (candidates.length !== 1) return Object.freeze({ outcome: "conflict" as const });
      const candidate = candidates[0]!;
      if (
        candidate.expectedCallerDigest !== null ||
        candidate.authorizedTargetDigest !== input.authorizedTargetDigest
      ) {
        return Object.freeze({ outcome: "unmatched" as const });
      }
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: candidate.operationId,
          nonceDigest: candidate.nonceDigest,
          expectedCallerDigest: null,
          authorizedTargetDigest: input.authorizedTargetDigest,
          authorizationVersion: 2,
          state: "reserved",
          providerDispatchIdentity: null,
        },
        data: {
          state: "bound",
          expectedCallerDigest: input.callerDigest,
          providerDispatchIdentity: input.providerCallDigest,
          boundAt,
        },
      });
      if (update.count !== 1) return Object.freeze({ outcome: "conflict" as const });
      return Object.freeze({
        outcome: "bound" as const,
        authorization: toRecord({
          ...candidate,
          state: "bound",
          expectedCallerDigest: input.callerDigest,
          providerDispatchIdentity: input.providerCallDigest,
          boundAt,
        }),
      });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async authenticateBoundCallback(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
  }) {
    try {
      requireIdentifier(input.operationId);
      requireAlias(input.endpointAlias);
      requireIdentifier(input.audience);
      requireDigest(input.providerCallDigest);
      requireDigest(input.callerDigest);
      requireDigest(input.authorizedTargetDigest);
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
        },
      });
      if (record === null || record.authorizationVersion !== 2) {
        return Object.freeze({ outcome: "missing" as const });
      }
      if (
        record.state !== "bound" ||
        record.endpointAlias !== input.endpointAlias ||
        record.audience !== input.audience ||
        record.providerDispatchIdentity !== input.providerCallDigest
      ) {
        return Object.freeze({ outcome: "conflict" as const });
      }
      if (
        record.expectedCallerDigest !== input.callerDigest ||
        record.authorizedTargetDigest !== input.authorizedTargetDigest
      ) {
        return Object.freeze({ outcome: "unmatched" as const });
      }
      return Object.freeze({ outcome: "replayed" as const, authorization: toRecord(record) });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async authenticateStatusCallback(input: {
    readonly organizationId: OrganizationId;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
  }) {
    try {
      requireAlias(input.endpointAlias);
      requireIdentifier(input.audience);
      requireDigest(input.providerCallDigest);
      requireDigest(input.callerDigest);
      requireDigest(input.authorizedTargetDigest);
      const record = await this.client.liveSimulatorAuthorization.findFirst({
        where: {
          organizationId: input.organizationId.value,
          endpointAlias: input.endpointAlias,
          audience: input.audience,
          authorizationVersion: 2,
          state: "bound",
          providerDispatchIdentity: input.providerCallDigest,
        },
      });
      if (record === null) return Object.freeze({ outcome: "missing" as const });
      if (
        record.expectedCallerDigest !== input.callerDigest ||
        record.authorizedTargetDigest !== input.authorizedTargetDigest
      ) {
        return Object.freeze({ outcome: "unmatched" as const });
      }
      return Object.freeze({ outcome: "replayed" as const, authorization: toRecord(record) });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async claimDispatch(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly claimedAt: string;
  }) {
    requireIdentifier(input.operationId);
    const claimedAt = requireInstant(input.claimedAt);
    try {
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          authorizationVersion: 2,
          state: "reserved",
          dispatchClaimedAt: null,
          dispatchClosedAt: null,
          expiresAt: { gt: claimedAt },
        },
        data: { dispatchClaimedAt: claimedAt },
      });
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
        },
      });
      if (record === null || record.authorizationVersion !== 2) {
        return Object.freeze({ outcome: "missing" as const });
      }
      return update.count === 1
        ? Object.freeze({ outcome: "claimed" as const, authorization: toRecord(record) })
        : record.dispatchClaimedAt !== null
          ? Object.freeze({ outcome: "reconcile" as const, authorization: toRecord(record) })
          : record.dispatchClosedAt !== null
            ? Object.freeze({ outcome: "closed" as const, authorization: toRecord(record) })
            : Object.freeze({ outcome: "conflict" as const });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async closeDispatchAndBeginCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly ownerDigest: string;
    readonly startedAt: string;
    readonly deadlineAt: string;
  }) {
    requireIdentifier(input.operationId);
    requireDigest(input.ownerDigest);
    const startedAt = requireInstant(input.startedAt);
    const deadlineAt = requireInstant(input.deadlineAt);
    if (deadlineAt.getTime() <= startedAt.getTime()) {
      throw ApplicationError.validation("live_authorization_invalid");
    }
    try {
      // One conditional row update makes cleanup closure and dispatch claim serialize without
      // a second lock whose ownership could drift away from the authorization record.
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          authorizationVersion: 2,
          state: { in: ["reserved", "bound"] },
          dispatchClosedAt: null,
          cleanupState: null,
        },
        data: {
          dispatchClosedAt: startedAt,
          cleanupState: "barrier_pending",
          cleanupDeadlineAt: deadlineAt,
          cleanupOwnerDigest: input.ownerDigest,
          cleanupStateChangedAt: startedAt,
        },
      });
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
        },
      });
      if (record === null || record.authorizationVersion !== 2) {
        return Object.freeze({ outcome: "missing" as const });
      }
      if (update.count === 1) {
        return Object.freeze({ outcome: "acquired" as const, authorization: toRecord(record) });
      }
      if (record.cleanupState === null || record.dispatchClosedAt === null) {
        return Object.freeze({ outcome: "conflict" as const });
      }
      if (
        record.cleanupOwnerDigest === input.ownerDigest &&
        record.cleanupDeadlineAt?.toISOString() === input.deadlineAt
      ) {
        return Object.freeze({ outcome: "replayed" as const, authorization: toRecord(record) });
      }
      return Object.freeze({
        outcome: terminalCleanupStates.has(record.cleanupState)
          ? ("terminal" as const)
          : ("in_progress" as const),
        authorization: toRecord(record),
      });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async transitionCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly ownerDigest: string;
    readonly from: LiveSimulatorCleanupState;
    readonly to: LiveSimulatorCleanupState;
    readonly changedAt: string;
    readonly graceUntilAt?: string;
    readonly terminalStatus?: "completed" | "busy" | "failed" | "no-answer" | "canceled";
    readonly blockedReason?: LiveSimulatorCleanupBlockedReason;
  }) {
    requireIdentifier(input.operationId);
    requireDigest(input.ownerDigest);
    const changedAt = requireInstant(input.changedAt);
    if (!legalCleanupTransitions[input.from].has(input.to)) {
      return Object.freeze({ outcome: "conflict" as const });
    }
    let graceUntilAt: Date | undefined;
    if (input.to === "awaiting_grace") {
      if (
        input.graceUntilAt === undefined ||
        input.terminalStatus === undefined ||
        !terminalStatuses.has(input.terminalStatus)
      ) {
        throw ApplicationError.validation("live_authorization_invalid");
      }
      graceUntilAt = requireInstant(input.graceUntilAt);
      if (graceUntilAt.getTime() <= changedAt.getTime()) {
        throw ApplicationError.validation("live_authorization_invalid");
      }
    } else if (input.graceUntilAt !== undefined || input.terminalStatus !== undefined) {
      throw ApplicationError.validation("live_authorization_invalid");
    }
    if (input.to === "blocked") {
      if (input.blockedReason === undefined || !blockedReasons.has(input.blockedReason)) {
        throw ApplicationError.validation("live_authorization_invalid");
      }
    } else if (input.blockedReason !== undefined) {
      throw ApplicationError.validation("live_authorization_invalid");
    }
    try {
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          authorizationVersion: 2,
          cleanupOwnerDigest: input.ownerDigest,
          cleanupState: input.from,
          cleanupStateChangedAt: { lte: changedAt },
        },
        data: {
          cleanupState: input.to,
          cleanupStateChangedAt: changedAt,
          ...(graceUntilAt === undefined
            ? {}
            : {
                cleanupGraceUntilAt: graceUntilAt,
                cleanupTerminalStatus: input.terminalStatus,
              }),
          ...(input.blockedReason === undefined
            ? {}
            : { cleanupBlockedReason: input.blockedReason }),
        },
      });
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
        },
      });
      if (record === null || record.authorizationVersion !== 2) {
        return Object.freeze({ outcome: "missing" as const });
      }
      if (update.count === 1) {
        return Object.freeze({ outcome: "advanced" as const, authorization: toRecord(record) });
      }
      const replayed =
        record.cleanupOwnerDigest === input.ownerDigest &&
        record.cleanupState === input.to &&
        record.cleanupStateChangedAt?.toISOString() === input.changedAt &&
        (input.to !== "awaiting_grace" ||
          (record.cleanupGraceUntilAt?.toISOString() === input.graceUntilAt &&
            record.cleanupTerminalStatus === input.terminalStatus)) &&
        (input.to !== "blocked" || record.cleanupBlockedReason === input.blockedReason);
      return replayed
        ? Object.freeze({ outcome: "replayed" as const, authorization: toRecord(record) })
        : Object.freeze({ outcome: "conflict" as const });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async takeOverCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly ownerDigest: string;
    readonly previousOwnerStopped: true;
    readonly changedAt: string;
  }) {
    requireIdentifier(input.operationId);
    requireDigest(input.ownerDigest);
    if (input.previousOwnerStopped !== true) {
      throw ApplicationError.validation("live_authorization_invalid");
    }
    const changedAt = requireInstant(input.changedAt);
    try {
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          authorizationVersion: 2,
          cleanupState: { notIn: ["blocked", "complete"] },
          cleanupOwnerDigest: { not: null },
          cleanupStateChangedAt: { lte: changedAt },
        },
        data: {
          cleanupOwnerDigest: input.ownerDigest,
          cleanupStateChangedAt: changedAt,
        },
      });
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
        },
      });
      if (record === null || record.authorizationVersion !== 2) {
        return Object.freeze({ outcome: "missing" as const });
      }
      if (update.count === 1) {
        return Object.freeze({ outcome: "acquired" as const, authorization: toRecord(record) });
      }
      return record.cleanupState !== null && terminalCleanupStates.has(record.cleanupState)
        ? Object.freeze({ outcome: "terminal" as const, authorization: toRecord(record) })
        : Object.freeze({ outcome: "conflict" as const });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async establishReviewLease(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly sessionId: string;
    readonly reviewReadyAt: string;
    readonly reviewExpiresAt: string;
    readonly custodyOwnershipDigest: string;
    readonly databaseOwnershipDigest: string;
    readonly databaseProvisioningOwnershipDigest: string;
  }) {
    requireIdentifier(input.operationId);
    requireIdentifier(input.sessionId);
    requireDigest(input.custodyOwnershipDigest);
    requireDigest(input.databaseOwnershipDigest);
    requireDigest(input.databaseProvisioningOwnershipDigest);
    const reviewReadyAt = requireInstant(input.reviewReadyAt);
    const reviewExpiresAt = requireInstant(input.reviewExpiresAt);
    if (reviewExpiresAt.getTime() !== reviewReadyAt.getTime() + 30 * 60 * 1_000) {
      throw ApplicationError.validation("live_authorization_invalid");
    }
    try {
      return await this.client.$transaction(async (transaction) => {
        const marker = await transaction.liveDemoReviewDatabaseOwnership.findUnique({
          where: { singleton: true },
        });
        const update =
          marker === null
            ? await transaction.liveSimulatorAuthorization.updateMany({
                where: {
                  organizationId: input.organizationId.value,
                  operationId: input.operationId,
                  authorizationVersion: 2,
                  cleanupState: "complete",
                  reviewSessionId: null,
                },
                data: {
                  reviewSessionId: input.sessionId,
                  reviewReadyAt,
                  reviewExpiresAt,
                  reviewCleanupState: "ready",
                  reviewCleanupStateChangedAt: reviewReadyAt,
                  reviewCustodyOwnershipDigest: input.custodyOwnershipDigest,
                  reviewDatabaseOwnershipDigest: input.databaseOwnershipDigest,
                },
              })
            : { count: 0 };
        if (update.count === 1) {
          await transaction.liveDemoReviewDatabaseOwnership.create({
            data: {
              singleton: true,
              sessionId: input.sessionId,
              operationId: input.operationId,
              ownershipDigest: input.databaseOwnershipDigest,
              provisioningOwnershipDigest: input.databaseProvisioningOwnershipDigest,
              createdAt: reviewReadyAt,
            },
          });
        }
        const record = await transaction.liveSimulatorAuthorization.findUnique({
          where: {
            organizationId_operationId: {
              organizationId: input.organizationId.value,
              operationId: input.operationId,
            },
          },
        });
        if (record === null || record.authorizationVersion !== 2) {
          return Object.freeze({ outcome: "missing" as const });
        }
        if (update.count === 1) {
          return Object.freeze({
            outcome: "established" as const,
            authorization: toRecord(record),
          });
        }
        const exactReplay =
          record.reviewSessionId === input.sessionId &&
          record.reviewReadyAt?.toISOString() === input.reviewReadyAt &&
          record.reviewExpiresAt?.toISOString() === input.reviewExpiresAt &&
          record.reviewCleanupState === "ready" &&
          record.reviewCustodyOwnershipDigest === input.custodyOwnershipDigest &&
          record.reviewDatabaseOwnershipDigest === input.databaseOwnershipDigest &&
          marker?.sessionId === input.sessionId &&
          marker.operationId === input.operationId &&
          marker.ownershipDigest === input.databaseOwnershipDigest &&
          marker.provisioningOwnershipDigest === input.databaseProvisioningOwnershipDigest;
        return exactReplay
          ? Object.freeze({ outcome: "replayed" as const, authorization: toRecord(record) })
          : Object.freeze({ outcome: "conflict" as const });
      });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      if ((error as { readonly code?: unknown }).code === "P2002") {
        return Object.freeze({ outcome: "conflict" as const });
      }
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async transitionReviewCleanup(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly sessionId: string;
    readonly from: LiveDemoReviewCleanupState;
    readonly to: LiveDemoReviewCleanupState;
    readonly changedAt: string;
  }) {
    requireIdentifier(input.operationId);
    requireIdentifier(input.sessionId);
    const changedAt = requireInstant(input.changedAt);
    if (!legalReviewCleanupTransitions[input.from].has(input.to)) {
      return Object.freeze({ outcome: "conflict" as const });
    }
    try {
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          authorizationVersion: 2,
          reviewSessionId: input.sessionId,
          reviewCleanupState: input.from,
          reviewCleanupStateChangedAt: { lte: changedAt },
        },
        data: {
          reviewCleanupState: input.to,
          reviewCleanupStateChangedAt: changedAt,
        },
      });
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
        },
      });
      if (record === null || record.authorizationVersion !== 2) {
        return Object.freeze({ outcome: "missing" as const });
      }
      if (update.count === 1) {
        return Object.freeze({ outcome: "advanced" as const, authorization: toRecord(record) });
      }
      return record.reviewSessionId === input.sessionId &&
        record.reviewCleanupState === input.to &&
        record.reviewCleanupStateChangedAt?.toISOString() === input.changedAt
        ? Object.freeze({ outcome: "replayed" as const, authorization: toRecord(record) })
        : Object.freeze({ outcome: "conflict" as const });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  public async attestReviewDatabaseOwnership(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly sessionId: string;
    readonly databaseOwnershipDigest: string;
    readonly databaseProvisioningOwnershipDigest: string;
  }) {
    requireIdentifier(input.operationId);
    requireIdentifier(input.sessionId);
    requireDigest(input.databaseOwnershipDigest);
    requireDigest(input.databaseProvisioningOwnershipDigest);
    try {
      const [authorization, markers] = await Promise.all([
        this.client.liveSimulatorAuthorization.findUnique({
          where: {
            organizationId_operationId: {
              organizationId: input.organizationId.value,
              operationId: input.operationId,
            },
          },
        }),
        this.client.liveDemoReviewDatabaseOwnership.findMany({ take: 2 }),
      ]);
      if (markers.length > 1) return Object.freeze({ outcome: "shared" as const });
      const marker = markers[0];
      if (authorization === null || marker === undefined) {
        return Object.freeze({ outcome: "missing" as const });
      }
      if (
        authorization.reviewSessionId !== input.sessionId ||
        authorization.reviewDatabaseOwnershipDigest !== input.databaseOwnershipDigest ||
        marker.sessionId !== input.sessionId ||
        marker.operationId !== input.operationId ||
        marker.ownershipDigest !== input.databaseOwnershipDigest ||
        marker.provisioningOwnershipDigest !== input.databaseProvisioningOwnershipDigest
      ) {
        return Object.freeze({ outcome: "mismatch" as const });
      }
      return Object.freeze({ outcome: "owned" as const, exclusive: true as const });
    } catch {
      return Object.freeze({ outcome: "indeterminate" as const });
    }
  }

  public async recordDispatchDisposition(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly outcome: "provider_returned" | "provider_failed";
  }) {
    requireIdentifier(input.operationId);
    try {
      const update = await this.client.liveSimulatorAuthorization.updateMany({
        where: {
          organizationId: input.organizationId.value,
          operationId: input.operationId,
          authorizationVersion: 2,
          dispatchClaimedAt: { not: null },
          dispatchDisposition: null,
        },
        data: { dispatchDisposition: input.outcome },
      });
      if (update.count === 1) return Object.freeze({ outcome: "recorded" as const });
      const record = await this.client.liveSimulatorAuthorization.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
        },
      });
      if (record === null || record.authorizationVersion !== 2) {
        return Object.freeze({ outcome: "missing" as const });
      }
      return record.dispatchDisposition === input.outcome
        ? Object.freeze({ outcome: "replayed" as const })
        : Object.freeze({ outcome: "conflict" as const });
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_authorization_repository_unavailable");
    }
  }

  private async findEstablished(
    input: IssueLiveSimulatorAuthorizationInput,
  ): Promise<readonly PersistedAuthorization[]> {
    return await this.client.liveSimulatorAuthorization.findMany({
      where: {
        OR: [
          {
            organizationId: input.organizationId.value,
            operationId: input.operationId,
          },
          { nonceDigest: input.nonceDigest },
        ],
      },
    });
  }

  private async hasValidPredecessor(
    input: ReserveLiveSimulatorAuthorizationInput,
  ): Promise<boolean> {
    if (input.scenarioId !== "synthetic-recovery") {
      return input.predecessorOperationId === null;
    }
    if (input.predecessorOperationId === null) return false;
    // Recovery authority is derived only from the durable authorization, terminal attempt,
    // and matching evidence lineage; a caller-provided predecessor ID is never sufficient.
    const predecessor = await this.client.liveSimulatorAuthorization.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: input.organizationId.value,
          operationId: input.predecessorOperationId,
        },
      },
    });
    if (
      predecessor === null ||
      predecessor.scenarioId !== "synthetic-abnormal" ||
      predecessor.scenarioRevision !== input.scenarioRevision ||
      predecessor.audience !== input.audience ||
      predecessor.endpointAlias !== input.endpointAlias ||
      predecessor.state !== "bound"
    ) {
      return false;
    }
    const attempt = await this.client.callAttempt.findUnique({
      where: {
        organizationId_id: {
          organizationId: input.organizationId.value,
          id: input.predecessorOperationId,
        },
      },
    });
    if (
      attempt === null ||
      attempt.provenance !== "simulated" ||
      attempt.stage !== "terminal" ||
      attempt.terminalOutcome !== "observationRecorded" ||
      attempt.latestEvidenceId === null
    ) {
      return false;
    }
    const evidence = await this.client.evidenceRecord.findUnique({
      where: {
        organizationId_id: {
          organizationId: input.organizationId.value,
          id: attempt.latestEvidenceId,
        },
      },
    });
    return (
      evidence !== null &&
      evidence.callAttemptId === input.predecessorOperationId &&
      evidence.adapterVersionId === attempt.adapterVersionId &&
      evidence.provenance === "simulated"
    );
  }
}
