export const LIVE_DEMO_REVIEW_TTL_MS = 30 * 60 * 1_000;

export const LIVE_DEMO_REVIEW_LIFECYCLE_STATES = Object.freeze([
  "prepared",
  "viewer_attached",
  "dispatch_reserved",
  "call_terminal",
  "external_cleanup_pending",
  "external_cleanup_complete",
  "review_ready",
  "review_cleanup_pending",
  "review_deleted",
  "review_cleanup_blocked",
] as const);

export interface LiveDemoReviewIdentity {
  readonly operationId: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
}

export interface LiveDemoViewerReadinessObservation {
  readonly source: string;
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly projectionIdentity: LiveDemoReviewIdentity;
}

export interface LiveDemoReviewLease {
  readonly identity: LiveDemoReviewIdentity;
  readonly reviewReadyAt: string;
  readonly reviewExpiresAt: string;
}

export type LiveDemoReviewCleanupTrigger = "finish" | "ttl" | "interrupt" | "restart";

export interface LiveDemoReviewRecoveryIdentity {
  readonly sessionId: string;
  readonly operationId: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly reviewReadyAt: string;
  readonly reviewExpiresAt: string;
  readonly custodyOwnershipDigest: string;
  readonly databaseOwnershipDigest: string;
}

export interface LiveDemoReviewCleanupCheckpoint {
  readonly session: LiveDemoReviewRecoveryIdentity;
  readonly version: number;
  readonly cleanupOwnerDigest: string;
  readonly state:
    "review_ready" | "review_cleanup_pending" | "review_cleanup_blocked" | "review_deleted";
  readonly trigger: LiveDemoReviewCleanupTrigger;
  readonly custodyDeleted: boolean;
  readonly databaseDeleted: boolean;
  readonly recoveryIdentity: LiveDemoReviewRecoveryIdentity | null;
}

export interface LiveDemoReviewCleanupCheckpointUpdate {
  readonly expectedVersion: number | null;
  readonly cleanupOwnerDigest: string;
  readonly checkpoint: Omit<LiveDemoReviewCleanupCheckpoint, "version" | "cleanupOwnerDigest">;
}

export type LiveDemoReviewCleanupCheckpointUpdateResult =
  | Readonly<{ outcome: "updated"; checkpoint: LiveDemoReviewCleanupCheckpoint }>
  | Readonly<{
      outcome: "conflict";
      checkpoint: LiveDemoReviewCleanupCheckpoint | undefined;
    }>;

export type LiveDemoReviewCleanupResult =
  | Readonly<{ outcome: "deleted"; message: "Protected demo result deleted" }>
  | Readonly<{
      outcome: "blocked";
      message: "Cleanup requires attention";
      recoveryIdentity: LiveDemoReviewRecoveryIdentity;
    }>;

export type LiveDemoReviewOwnershipAttestation =
  | Readonly<{
      outcome: "owned";
      sessionId: string;
      ownershipDigest: string;
      exclusive: true;
    }>
  | Readonly<{ outcome: "shared" | "mismatch" | "missing" | "indeterminate" }>;

export interface LiveDemoReviewCleanupOwnerInput {
  readonly session: LiveDemoReviewRecoveryIdentity;
  readonly cleanupOwnerDigest: string;
  readonly loadCheckpoint: () => Promise<LiveDemoReviewCleanupCheckpoint | undefined>;
  readonly compareAndSetCheckpoint: (
    update: LiveDemoReviewCleanupCheckpointUpdate,
  ) => Promise<LiveDemoReviewCleanupCheckpointUpdateResult>;
  readonly attestCustodyOwnership: () => Promise<LiveDemoReviewOwnershipAttestation>;
  readonly attestDatabaseOwnership: () => Promise<LiveDemoReviewOwnershipAttestation>;
  readonly deleteCustodyRoot: () => Promise<void>;
  readonly teardownDisposableDatabase: () => Promise<Readonly<{ outcome: "deleted" }>>;
  readonly verifyDisposableDatabaseDeleted: () => Promise<boolean>;
  readonly authorizeStaleOwnerTakeover: (
    checkpoint: LiveDemoReviewCleanupCheckpoint,
  ) => Promise<boolean>;
  readonly removeRecoveryCheckpoint: () => Promise<void>;
}

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function exactIdentity(left: LiveDemoReviewIdentity, right: LiveDemoReviewIdentity): boolean {
  return (
    left.operationId === right.operationId &&
    left.scenarioId === right.scenarioId &&
    left.scenarioRevision === right.scenarioRevision
  );
}

function freezeIdentity(identity: LiveDemoReviewIdentity): LiveDemoReviewIdentity {
  if (
    !opaqueIdPattern.test(identity.operationId) ||
    !opaqueIdPattern.test(identity.scenarioId) ||
    !Number.isSafeInteger(identity.scenarioRevision) ||
    identity.scenarioRevision < 1
  ) {
    throw new Error("Live demo review identity is invalid");
  }
  return Object.freeze({ ...identity });
}

function exactInstant(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Live demo review ${field} is invalid`);
  }
  return timestamp;
}

export function isExactLiveDemoViewerReadiness(
  expected: LiveDemoReviewIdentity,
  observation: LiveDemoViewerReadinessObservation,
): boolean {
  return (
    observation.source === "server_http_runtime" &&
    observation.method === "GET" &&
    observation.route ===
      `/api/v1/live-simulator/operations/${encodeURIComponent(expected.operationId)}` &&
    observation.statusCode === 200 &&
    exactIdentity(expected, observation.projectionIdentity)
  );
}

export function establishLiveDemoReviewLease(input: {
  readonly identity: LiveDemoReviewIdentity;
  readonly reviewReadyAt: string;
}): LiveDemoReviewLease {
  const reviewReadyAt = exactInstant(input.reviewReadyAt, "readiness");
  const identity = freezeIdentity(input.identity);
  return Object.freeze({
    identity,
    reviewReadyAt: input.reviewReadyAt,
    reviewExpiresAt: new Date(reviewReadyAt + LIVE_DEMO_REVIEW_TTL_MS).toISOString(),
  });
}

export function restoreLiveDemoReviewLease(input: LiveDemoReviewLease): LiveDemoReviewLease {
  const lease = establishLiveDemoReviewLease({
    identity: input.identity,
    reviewReadyAt: input.reviewReadyAt,
  });
  exactInstant(input.reviewExpiresAt, "expiry");
  if (lease.reviewExpiresAt !== input.reviewExpiresAt) {
    throw new Error("Live demo review expiry is invalid");
  }
  return lease;
}

export function isLiveDemoReviewExpired(lease: LiveDemoReviewLease, now: Date): boolean {
  const exactLease = restoreLiveDemoReviewLease(lease);
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(nowTimestamp)) throw new Error("Live demo review clock is invalid");
  return nowTimestamp >= Date.parse(exactLease.reviewExpiresAt);
}

function freezeRecoveryIdentity(
  identity: LiveDemoReviewRecoveryIdentity,
): LiveDemoReviewRecoveryIdentity {
  if (
    !opaqueIdPattern.test(identity.sessionId) ||
    !opaqueIdPattern.test(identity.operationId) ||
    !opaqueIdPattern.test(identity.scenarioId) ||
    !Number.isSafeInteger(identity.scenarioRevision) ||
    identity.scenarioRevision < 1 ||
    !/^[0-9a-f]{64}$/u.test(identity.custodyOwnershipDigest) ||
    !/^[0-9a-f]{64}$/u.test(identity.databaseOwnershipDigest)
  ) {
    throw new Error("Live demo review recovery identity is invalid");
  }
  restoreLiveDemoReviewLease({
    identity: {
      operationId: identity.operationId,
      scenarioId: identity.scenarioId,
      scenarioRevision: identity.scenarioRevision,
    },
    reviewReadyAt: identity.reviewReadyAt,
    reviewExpiresAt: identity.reviewExpiresAt,
  });
  return Object.freeze({ ...identity });
}

function sameRecoveryIdentity(
  left: LiveDemoReviewRecoveryIdentity,
  right: LiveDemoReviewRecoveryIdentity,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.operationId === right.operationId &&
    left.scenarioId === right.scenarioId &&
    left.scenarioRevision === right.scenarioRevision &&
    left.reviewReadyAt === right.reviewReadyAt &&
    left.reviewExpiresAt === right.reviewExpiresAt &&
    left.custodyOwnershipDigest === right.custodyOwnershipDigest &&
    left.databaseOwnershipDigest === right.databaseOwnershipDigest
  );
}

function isExactOwnedResource(
  attestation: LiveDemoReviewOwnershipAttestation,
  sessionId: string,
  ownershipDigest: string,
): boolean {
  return (
    attestation.outcome === "owned" &&
    attestation.exclusive === true &&
    attestation.sessionId === sessionId &&
    attestation.ownershipDigest === ownershipDigest
  );
}

function restoreCleanupCheckpoint(
  checkpoint: LiveDemoReviewCleanupCheckpoint,
): LiveDemoReviewCleanupCheckpoint {
  const session = freezeRecoveryIdentity(checkpoint.session);
  if (
    !Number.isSafeInteger(checkpoint.version) ||
    checkpoint.version < 1 ||
    !/^[0-9a-f]{64}$/u.test(checkpoint.cleanupOwnerDigest) ||
    (checkpoint.databaseDeleted && !checkpoint.custodyDeleted)
  ) {
    throw new Error("Live demo review cleanup checkpoint is invalid");
  }
  if (checkpoint.state === "review_deleted") {
    if (
      !checkpoint.custodyDeleted ||
      !checkpoint.databaseDeleted ||
      checkpoint.recoveryIdentity !== null
    ) {
      throw new Error("Live demo review cleanup checkpoint is invalid");
    }
  } else if (
    checkpoint.recoveryIdentity === null ||
    !sameRecoveryIdentity(session, freezeRecoveryIdentity(checkpoint.recoveryIdentity))
  ) {
    throw new Error("Live demo review cleanup checkpoint is invalid");
  }
  if (
    checkpoint.state === "review_ready" &&
    (checkpoint.custodyDeleted || checkpoint.databaseDeleted)
  ) {
    throw new Error("Live demo review cleanup checkpoint is invalid");
  }
  return Object.freeze({ ...checkpoint, session });
}

export function createLiveDemoReviewCleanupOwner(input: LiveDemoReviewCleanupOwnerInput): Readonly<{
  cleanup(trigger: LiveDemoReviewCleanupTrigger): Promise<LiveDemoReviewCleanupResult>;
}> {
  const session = freezeRecoveryIdentity(input.session);
  if (!/^[0-9a-f]{64}$/u.test(input.cleanupOwnerDigest)) {
    throw new Error("Live demo review cleanup owner is invalid");
  }
  let execution: Promise<LiveDemoReviewCleanupResult> | undefined;

  const compareAndSet = async (
    expectedVersion: number | null,
    checkpoint: Omit<LiveDemoReviewCleanupCheckpoint, "session" | "version" | "cleanupOwnerDigest">,
  ): Promise<LiveDemoReviewCleanupCheckpoint | undefined> => {
    const result = await input.compareAndSetCheckpoint({
      expectedVersion,
      cleanupOwnerDigest: input.cleanupOwnerDigest,
      checkpoint: Object.freeze({ ...checkpoint, session }),
    });
    if (result.outcome !== "updated") return undefined;
    const restored = restoreCleanupCheckpoint(result.checkpoint);
    if (
      restored.version !== (expectedVersion ?? 0) + 1 ||
      restored.cleanupOwnerDigest !== input.cleanupOwnerDigest ||
      !sameRecoveryIdentity(restored.session, session)
    ) {
      throw new Error("Live demo review cleanup checkpoint read-back is invalid");
    }
    return restored;
  };
  const blockedResult = (): LiveDemoReviewCleanupResult =>
    Object.freeze({
      outcome: "blocked" as const,
      message: "Cleanup requires attention" as const,
      recoveryIdentity: session,
    });
  const persistBlocked = async (
    trigger: LiveDemoReviewCleanupTrigger,
    checkpoint: LiveDemoReviewCleanupCheckpoint | undefined,
    custodyDeleted: boolean,
    databaseDeleted: boolean,
  ): Promise<LiveDemoReviewCleanupResult> => {
    if (checkpoint?.cleanupOwnerDigest === input.cleanupOwnerDigest) {
      try {
        await compareAndSet(checkpoint.version, {
          state: "review_cleanup_blocked",
          trigger,
          custodyDeleted,
          databaseDeleted,
          recoveryIdentity: session,
        });
      } catch {
        // The external supervisor checkpoint remains authoritative; never claim deletion.
      }
    }
    return blockedResult();
  };

  const execute = async (
    trigger: LiveDemoReviewCleanupTrigger,
  ): Promise<LiveDemoReviewCleanupResult> => {
    let checkpoint: LiveDemoReviewCleanupCheckpoint | undefined;
    try {
      const loaded = await input.loadCheckpoint();
      checkpoint = loaded === undefined ? undefined : restoreCleanupCheckpoint(loaded);
    } catch {
      return blockedResult();
    }
    if (checkpoint !== undefined && !sameRecoveryIdentity(checkpoint.session, session)) {
      return blockedResult();
    }
    if (checkpoint?.state === "review_deleted") {
      try {
        await input.removeRecoveryCheckpoint();
        return Object.freeze({
          outcome: "deleted" as const,
          message: "Protected demo result deleted" as const,
        });
      } catch {
        return blockedResult();
      }
    }
    if (checkpoint !== undefined && checkpoint.cleanupOwnerDigest !== input.cleanupOwnerDigest) {
      if (trigger !== "restart") return blockedResult();
      try {
        if (!(await input.authorizeStaleOwnerTakeover(checkpoint))) return blockedResult();
      } catch {
        return blockedResult();
      }
    }

    let custodyDeleted = checkpoint?.custodyDeleted ?? false;
    let databaseDeleted = checkpoint?.databaseDeleted ?? false;
    try {
      checkpoint = await compareAndSet(checkpoint?.version ?? null, {
        state: "review_cleanup_pending",
        trigger,
        custodyDeleted,
        databaseDeleted,
        recoveryIdentity: session,
      });
      if (checkpoint === undefined) return blockedResult();
      if (!custodyDeleted) {
        const custody = await input.attestCustodyOwnership();
        if (!isExactOwnedResource(custody, session.sessionId, session.custodyOwnershipDigest)) {
          return await persistBlocked(trigger, checkpoint, custodyDeleted, databaseDeleted);
        }
        await input.deleteCustodyRoot();
        custodyDeleted = true;
        checkpoint = await compareAndSet(checkpoint.version, {
          state: "review_cleanup_pending",
          trigger,
          custodyDeleted,
          databaseDeleted,
          recoveryIdentity: session,
        });
        if (checkpoint === undefined) return blockedResult();
      }
      if (!databaseDeleted) {
        const database = await input.attestDatabaseOwnership();
        if (!isExactOwnedResource(database, session.sessionId, session.databaseOwnershipDigest)) {
          return await persistBlocked(trigger, checkpoint, custodyDeleted, databaseDeleted);
        }
        const teardown = await input.teardownDisposableDatabase();
        if (teardown.outcome !== "deleted" || !(await input.verifyDisposableDatabaseDeleted())) {
          return await persistBlocked(trigger, checkpoint, custodyDeleted, databaseDeleted);
        }
        databaseDeleted = true;
        checkpoint = await compareAndSet(checkpoint.version, {
          state: "review_cleanup_pending",
          trigger,
          custodyDeleted,
          databaseDeleted,
          recoveryIdentity: session,
        });
        if (checkpoint === undefined) return blockedResult();
      }
      checkpoint = await compareAndSet(checkpoint.version, {
        state: "review_deleted",
        trigger,
        custodyDeleted,
        databaseDeleted,
        recoveryIdentity: null,
      });
      if (checkpoint === undefined) return blockedResult();
      await input.removeRecoveryCheckpoint();
      return Object.freeze({
        outcome: "deleted" as const,
        message: "Protected demo result deleted" as const,
      });
    } catch {
      return await persistBlocked(trigger, checkpoint, custodyDeleted, databaseDeleted);
    }
  };

  return Object.freeze({
    cleanup(trigger: LiveDemoReviewCleanupTrigger): Promise<LiveDemoReviewCleanupResult> {
      if (execution !== undefined) return execution;
      execution = execute(trigger).then((result) => {
        if (result.outcome === "blocked") execution = undefined;
        return result;
      });
      return execution;
    },
  });
}
