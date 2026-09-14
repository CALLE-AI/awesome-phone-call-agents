import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline/promises";

import { Pool } from "pg";

import type {
  LiveSimulatorAuthorizationRecord,
  LiveSimulatorAuthorizationRepository,
  LiveSimulatorCleanupBlockedReason,
  LiveSimulatorCleanupState,
} from "@muster/application";
import { OrganizationId } from "@muster/domain";
import {
  createDisposablePostgresOwner,
  createPostgresPersistence,
  type DisposablePostgresOwner,
} from "@muster/infrastructure-postgres";
import {
  calculateLiveSmokeProjectionTimeoutMs,
  createLiveSmokeCleanup,
  createLiveSmokeRunGate,
  createRunAuthorizationReservationBoundary,
  createTwilioLiveSmokeControl,
  createTwilioLiveSmokeControlTransport,
  type LiveSmokePreRestorationBarrierDecision,
  type TwilioLiveSmokeControlTransport,
} from "@muster/infrastructure-twilio-simulator";
import { createSimulatorHostObservability } from "@muster/observability/simulator-host";

import { loadSimulatorHostConfiguration } from "../configuration.js";
import {
  createGuardedLiveSmokeProcess,
  type GuardedLiveSmokeCleanupContext,
} from "../cli/guarded-live-smoke-process.js";
import {
  createLiveDemoBrowserHandoff,
  launchSystemBrowser,
} from "../cli/live-demo-browser-handoff.js";
import {
  createRuntimeLiveSmokePreflight,
  persistentWebhookEnabled,
} from "../cli/live-smoke-preflight-runtime.js";
import {
  createLiveDemoReviewCheckpointStore,
  discoverLiveDemoReviewCheckpoints,
} from "../live-runs/live-demo-review-checkpoint-store.js";
import {
  establishLiveDemoReviewLease,
  type LiveDemoReviewCleanupResult,
  type LiveDemoReviewCleanupTrigger,
  type LiveDemoReviewCleanupCheckpoint,
  type LiveDemoReviewRecoveryIdentity,
  type LiveDemoReviewOwnershipAttestation,
} from "../live-runs/live-demo-review-session.js";
import { authorizeLiveSimulatorRun } from "./authorize-live-simulator-run.js";
import {
  createLiveDemoReviewProtectedCleanupBinding,
  type LiveDemoReviewProtectedCleanupBinding,
} from "./live-demo-review-boundary.js";
import { startBoundLiveDemoReviewRuntime } from "./live-demo-review-runtime-binding.js";
import {
  restoreLiveDemoReviewProjection,
  type LiveDemoReviewProjection,
  type LiveDemoReviewRuntime,
} from "./start-live-demo-review-runtime.js";
import { startGuardedSimulatorHostRuntime } from "./start-simulator-host-runtime.js";

type Runtime = Awaited<ReturnType<typeof startGuardedSimulatorHostRuntime>>;
type Control = ReturnType<typeof createTwilioLiveSmokeControl>;
type SimulatorHostObservability = ReturnType<typeof createSimulatorHostObservability>;

export function classifyGuardedLiveSmokeTerminalOutcome(
  terminalOutcome: unknown,
): "completed" | "failed" {
  return terminalOutcome === "provider_failed" || terminalOutcome === "evidence_unavailable"
    ? "failed"
    : "completed";
}

export function guardedLiveSmokeResultRequiresFailureExit(result: unknown): boolean {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return true;
  const value = result as Readonly<Record<string, unknown>>;
  return (
    value["outcome"] === "blocked" ||
    value["outcome"] === "manual_stop_required" ||
    value["outcome"] === "review_startup_release_failed" ||
    value["status"] === "blocked" ||
    value["status"] === "failed"
  );
}

interface GuardedRuntimeCleanupInput {
  readonly closeRunGate: () => void;
  readonly awaitPreRestorationBarrier: () => Promise<LiveSmokePreRestorationBarrierDecision>;
  readonly restoreTwilio: () => Promise<unknown>;
  readonly verifyTwilioResting: () => Promise<boolean>;
  readonly clearRuntimeSecrets: () => void;
  readonly stopTunnel: () => Promise<unknown>;
  readonly stopHost: () => Promise<unknown>;
  readonly teardownPersistence: () => Promise<unknown>;
}

export type RecordingSafeReviewTransitionResult<TReview> =
  | Readonly<{ outcome: "blocked"; hostAndTunnelMustRemainUp: true }>
  | Readonly<{ outcome: "restored"; hostAndTunnelMustRemainUp: false }>
  | Readonly<{
      outcome: "manual_stop_required";
      hostAndTunnelMustRemainUp: false;
      hostStopped: true;
      tunnelStopRequired: true;
    }>
  | Readonly<{
      outcome: "review_ready";
      message: "External call capability closed—review available for 30 minutes";
      review: TReview;
    }>
  | Readonly<{
      outcome: "review_startup_cleaned";
      message: "Review startup failed; protected demo result deleted";
    }>
  | Readonly<{
      outcome: "review_cleanup_blocked";
      message: "Cleanup requires attention";
      recoveryIdentity: LiveDemoReviewRecoveryIdentity;
    }>
  | Readonly<{
      outcome: "review_startup_release_failed";
      message: "Review startup failed; protected demo result deleted; local resource close requires attention";
      protectedStateRevoked: true;
      closeFailures: readonly ReviewStartupCloseFailure[];
    }>;

export type ReviewStartupCloseFailure = "runtime" | "observability";

export type ReviewStartupResourceReleaseResult =
  | Readonly<{ outcome: "released"; protectedStateRevoked: true }>
  | Readonly<{
      outcome: "close_failed";
      protectedStateRevoked: true;
      closeFailures: readonly ReviewStartupCloseFailure[];
    }>;

export function releaseFailedReviewStartupResources(
  input: Readonly<{
    revokeProtectedState: () => void;
    detachRuntime: () => Readonly<{ close(): Promise<void> }> | undefined;
    detachObservability: () => Readonly<{ close(): Promise<void> }> | undefined;
  }>,
): Promise<ReviewStartupResourceReleaseResult> {
  const runtime = input.detachRuntime();
  const observability = input.detachObservability();
  input.revokeProtectedState();
  const attempts: ReadonlyArray<readonly [ReviewStartupCloseFailure, () => Promise<void>]> = [
    ...(runtime === undefined
      ? []
      : [["runtime" as const, async () => await runtime.close()] as const]),
    ...(observability === undefined
      ? []
      : [["observability" as const, async () => await observability.close()] as const]),
  ];
  return Promise.allSettled(attempts.map(async ([, close]) => await close())).then((results) => {
    const closeFailures = attempts.flatMap(([resource], index) =>
      results[index]?.status === "rejected" ? [resource] : [],
    );
    return closeFailures.length === 0
      ? Object.freeze({ outcome: "released" as const, protectedStateRevoked: true as const })
      : Object.freeze({
          outcome: "close_failed" as const,
          protectedStateRevoked: true as const,
          closeFailures: Object.freeze(closeFailures),
        });
  });
}

export interface RecordingSafeReviewTransition<TReview, TContext = void> {
  execute(context?: TContext): Promise<RecordingSafeReviewTransitionResult<TReview>>;
}

export interface GuardedRuntimeSecretOwner<TSecrets extends object> {
  access(): TSecrets;
  clear(): void;
}

export function createGuardedRuntimeSecretOwner<TSecrets extends object>(
  secrets: TSecrets,
): GuardedRuntimeSecretOwner<TSecrets> {
  let current: TSecrets | undefined = secrets;
  return Object.freeze({
    access(): TSecrets {
      if (current === undefined) throw new Error("Live-smoke runtime is unavailable");
      return current;
    },
    clear(): void {
      current = undefined;
    },
  });
}

export function createGuardedRuntimeCleanupOwner(input: GuardedRuntimeCleanupInput) {
  return createLiveSmokeCleanup(input);
}

export function createRecordingSafeReviewTransition<TReview, TContext = void>(
  input: (
    | Omit<GuardedRuntimeCleanupInput, "teardownPersistence">
    | Readonly<{
        executeExternalCleanup: (
          context: TContext,
        ) => Promise<
          Exclude<
            RecordingSafeReviewTransitionResult<TReview>,
            { readonly outcome: "review_ready" }
          >
        >;
      }>
  ) & {
    readonly retainReviewResources: () => void | Promise<void>;
    readonly startReviewRuntime: () => Promise<TReview>;
    readonly cleanupFailedReview?: (context: TContext) => Promise<LiveDemoReviewCleanupResult>;
    readonly releaseFailedReviewResources?: () =>
      | void
      | ReviewStartupResourceReleaseResult
      | Promise<void | ReviewStartupResourceReleaseResult>;
  },
): RecordingSafeReviewTransition<TReview, TContext> {
  const executeExternalCleanup =
    "executeExternalCleanup" in input
      ? input.executeExternalCleanup
      : async () =>
          await createLiveSmokeCleanup({
            ...input,
            // Custody and disposable persistence deliberately survive this external-cleanup boundary.
            teardownPersistence: async () => undefined,
          }).execute();
  let execution: Promise<RecordingSafeReviewTransitionResult<TReview>> | undefined;
  return Object.freeze({
    execute(context?: TContext): Promise<RecordingSafeReviewTransitionResult<TReview>> {
      execution ??= (async () => {
        const externalCleanup = await executeExternalCleanup(context as TContext);
        if (externalCleanup.outcome !== "restored") return externalCleanup;
        try {
          await input.retainReviewResources();
          const review = await input.startReviewRuntime();
          return Object.freeze({
            outcome: "review_ready" as const,
            message: "External call capability closed—review available for 30 minutes" as const,
            review,
          });
        } catch {
          if (input.cleanupFailedReview === undefined) {
            return Object.freeze({ outcome: "blocked" as const, hostAndTunnelMustRemainUp: true });
          }
          try {
            const cleanup = await input.cleanupFailedReview(context as TContext);
            if (cleanup.outcome !== "deleted") {
              return Object.freeze({
                outcome: "review_cleanup_blocked" as const,
                message: cleanup.message,
                recoveryIdentity: cleanup.recoveryIdentity,
              });
            }
            const released = await input.releaseFailedReviewResources?.();
            if (released?.outcome === "close_failed") {
              return Object.freeze({
                outcome: "review_startup_release_failed" as const,
                message:
                  "Review startup failed; protected demo result deleted; local resource close requires attention" as const,
                protectedStateRevoked: true as const,
                closeFailures: released.closeFailures,
              });
            }
            return Object.freeze({
              outcome: "review_startup_cleaned" as const,
              message: "Review startup failed; protected demo result deleted" as const,
            });
          } catch {
            return Object.freeze({ outcome: "blocked" as const, hostAndTunnelMustRemainUp: true });
          }
        }
      })();
      return execution;
    },
  });
}

export function createGuardedReviewLifecycle<TDiscovery>(input: {
  readonly discoverPendingReview: () => Promise<
    Readonly<{ outcome: "none" }> | Readonly<{ outcome: "pending"; review?: TDiscovery }>
  >;
  readonly recoverPendingReview: (
    discovery: TDiscovery | undefined,
  ) => Promise<LiveDemoReviewCleanupResult & Readonly<Record<string, unknown>>>;
}): Readonly<{
  recoverBeforePreflight(): Promise<
    | Readonly<{ outcome: "none" }>
    | (LiveDemoReviewCleanupResult & Readonly<Record<string, unknown>>)
  >;
  retainCleanupHandle(
    cleanup: (
      trigger: Extract<LiveDemoReviewCleanupTrigger, "interrupt" | "restart">,
    ) => Promise<LiveDemoReviewCleanupResult & Readonly<Record<string, unknown>>>,
  ): void;
  shutdown(): Promise<
    | Readonly<{ outcome: "none" }>
    | (LiveDemoReviewCleanupResult & Readonly<Record<string, unknown>>)
  >;
}> {
  let cleanupHandle:
    | ((
        trigger: Extract<LiveDemoReviewCleanupTrigger, "interrupt" | "restart">,
      ) => Promise<LiveDemoReviewCleanupResult & Readonly<Record<string, unknown>>>)
    | undefined;
  return Object.freeze({
    async recoverBeforePreflight() {
      const discovery = await input.discoverPendingReview();
      return discovery.outcome === "none"
        ? Object.freeze({ outcome: "none" as const })
        : await input.recoverPendingReview(discovery.review);
    },
    retainCleanupHandle(cleanup): void {
      cleanupHandle = cleanup;
    },
    async shutdown() {
      return cleanupHandle === undefined
        ? Object.freeze({ outcome: "none" as const })
        : await cleanupHandle("interrupt");
    },
  });
}

export function createGuardedRuntimePreRestorationBarrier(input: {
  readonly readProcessState: () => Readonly<{
    callMayBeActive: boolean;
    activeRunStartedAt?: string;
    activeOperationId?: string;
  }>;
  readonly findProviderDispatchIdentity: (
    operationId: string,
  ) => Promise<string | null | undefined>;
  readonly awaitExactCallQuiescence: (input: {
    readonly startedAt: string;
    readonly boundCallDigest: string;
  }) => Promise<"quiescent" | "blocked">;
}): () => Promise<LiveSmokePreRestorationBarrierDecision> {
  return async (): Promise<LiveSmokePreRestorationBarrierDecision> => {
    try {
      const state = input.readProcessState();
      if (
        !state.callMayBeActive ||
        state.activeRunStartedAt === undefined ||
        state.activeOperationId === undefined
      ) {
        return Object.freeze({
          outcome: "blocked" as const,
          reason: "dispatch_ambiguous" as const,
        });
      }
      const boundCallDigest = await input.findProviderDispatchIdentity(state.activeOperationId);
      if (boundCallDigest === undefined) {
        return Object.freeze({
          outcome: "blocked" as const,
          reason: "operation_unavailable" as const,
        });
      }
      if (boundCallDigest === null) {
        return Object.freeze({ outcome: "blocked" as const, reason: "identity_deadline" as const });
      }
      if (!/^[0-9a-f]{64}$/u.test(boundCallDigest)) {
        return Object.freeze({
          outcome: "blocked" as const,
          reason: "operation_unavailable" as const,
        });
      }
      if (
        (await input.awaitExactCallQuiescence({
          startedAt: state.activeRunStartedAt,
          boundCallDigest,
        })) !== "quiescent"
      ) {
        return Object.freeze({
          outcome: "blocked" as const,
          reason: "observation_failed" as const,
        });
      }
      return Object.freeze({
        outcome: "ready" as const,
        proof: "exact_call_quiescent" as const,
      });
    } catch {
      return Object.freeze({
        outcome: "blocked" as const,
        reason: "observation_failed" as const,
      });
    }
  };
}

export function createManualTunnelStopOwner(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly acknowledgeStopped: () => Promise<boolean>;
}) {
  // Environment PIDs are deliberately ignored: they do not prove process ownership.
  void input.environment;
  return Object.freeze({
    async stop(): Promise<"stopped" | "manual_stop_required"> {
      return (await input.acknowledgeStopped()) ? "stopped" : "manual_stop_required";
    },
  });
}

type DurableCleanupResult =
  | Readonly<{ outcome: "restored"; hostAndTunnelMustRemainUp: false }>
  | Readonly<{ outcome: "blocked"; hostAndTunnelMustRemainUp: true }>
  | Readonly<{
      outcome: "manual_stop_required";
      hostAndTunnelMustRemainUp: false;
      hostStopped: true;
      tunnelStopRequired: true;
    }>;

type DurableCleanupControl = Pick<
  Control,
  "observeExactCall" | "readConfigurationState" | "restore"
>;

const preRestorationStates = new Set<LiveSimulatorCleanupState>([
  "barrier_pending",
  "awaiting_identity",
  "awaiting_arrival",
  "awaiting_terminal",
  "awaiting_grace",
]);

export function createDurableGuardedRuntimeCleanupCoordinator(input: {
  readonly organizationId: OrganizationId;
  readonly authorizations: Pick<
    LiveSimulatorAuthorizationRepository,
    "closeDispatchAndBeginCleanup" | "findByOperationId" | "takeOverCleanup" | "transitionCleanup"
  >;
  readonly control: DurableCleanupControl;
  /** Explicit session-owned receiver policy; terminal/quiescence barriers still apply. */
  readonly keepWebhook?: boolean;
  readonly createOwnerDigest: () => string;
  readonly now: () => string;
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly cleanupTimeoutMs: number;
  readonly trailingCallbackGraceMs: number;
  readonly closeRunGate: () => void;
  readonly clearRuntimeSecrets: () => void | Promise<void>;
  readonly stopHost: () => Promise<unknown>;
  readonly stopTunnel: () => Promise<unknown>;
  readonly teardownPersistence: () => Promise<unknown>;
}) {
  const ownerDigest = input.createOwnerDigest();
  if (
    !/^[0-9a-f]{64}$/u.test(ownerDigest) ||
    !Number.isSafeInteger(input.cleanupTimeoutMs) ||
    input.cleanupTimeoutMs < 1 ||
    input.cleanupTimeoutMs > 120_000 ||
    !Number.isSafeInteger(input.trailingCallbackGraceMs) ||
    input.trailingCallbackGraceMs < 0 ||
    input.trailingCallbackGraceMs > 10_000 ||
    input.trailingCallbackGraceMs > input.cleanupTimeoutMs
  ) {
    throw new Error("Live-smoke cleanup configuration is invalid");
  }
  const blocked = (): DurableCleanupResult =>
    Object.freeze({ outcome: "blocked" as const, hostAndTunnelMustRemainUp: true as const });
  let execution: Promise<DurableCleanupResult> | undefined;

  const execute = async (
    context: GuardedLiveSmokeCleanupContext,
  ): Promise<DurableCleanupResult> => {
    input.closeRunGate();
    let row: LiveSimulatorAuthorizationRecord | undefined;
    let state: LiveSimulatorCleanupState = "restoration_ready";
    const operationId = context.operationId;
    let previousObservedAt: number | undefined;
    let positiveWaitScheduled = false;
    let nextPollMs = 250;

    const currentInstant = ():
      { readonly iso: string; readonly milliseconds: number } | undefined => {
      const iso = input.now();
      const milliseconds = Date.parse(iso);
      return Number.isFinite(milliseconds) ? Object.freeze({ iso, milliseconds }) : undefined;
    };
    const durableTime = (
      record: LiveSimulatorAuthorizationRecord,
      enforceDeadline: boolean,
    ):
      | { readonly iso: string; readonly milliseconds: number; readonly deadlineAt: number }
      | undefined => {
      // A restart must inherit the persisted safety window; backward or stalled time cannot
      // silently extend cleanup past the deadline established by the first owner.
      const sampled = currentInstant();
      const closedAt = Date.parse(record.dispatchClosedAt ?? "");
      const stateChangedAt = Date.parse(record.cleanupStateChangedAt ?? "");
      const deadlineAt = Date.parse(record.cleanupDeadlineAt ?? "");
      if (
        sampled === undefined ||
        !Number.isFinite(closedAt) ||
        !Number.isFinite(stateChangedAt) ||
        !Number.isFinite(deadlineAt) ||
        sampled.milliseconds < closedAt ||
        sampled.milliseconds < stateChangedAt ||
        (previousObservedAt !== undefined && sampled.milliseconds < previousObservedAt) ||
        (positiveWaitScheduled && sampled.milliseconds === previousObservedAt) ||
        (enforceDeadline && sampled.milliseconds > deadlineAt)
      ) {
        return undefined;
      }
      previousObservedAt = sampled.milliseconds;
      positiveWaitScheduled = false;
      return Object.freeze({ ...sampled, deadlineAt });
    };
    const transitionAt = (): string => {
      const sampled = currentInstant();
      const durableChangedAt = row?.cleanupStateChangedAt;
      if (sampled === undefined) return durableChangedAt ?? "1970-01-01T00:00:00.000Z";
      if (durableChangedAt === null || durableChangedAt === undefined) return sampled.iso;
      return sampled.milliseconds >= Date.parse(durableChangedAt) ? sampled.iso : durableChangedAt;
    };
    const advance = async (
      to: LiveSimulatorCleanupState,
      detail: Readonly<{
        blockedReason?: LiveSimulatorCleanupBlockedReason;
        graceUntilAt?: string;
        terminalStatus?: "completed" | "busy" | "failed" | "no-answer" | "canceled";
      }> = {},
    ): Promise<boolean> => {
      if (row === undefined || operationId === undefined) {
        state = to;
        return true;
      }
      const result = await input.authorizations.transitionCleanup({
        organizationId: input.organizationId,
        operationId,
        ownerDigest,
        from: state,
        to,
        changedAt: transitionAt(),
        ...detail,
      });
      if (result.outcome !== "advanced" && result.outcome !== "replayed") return false;
      row = result.authorization;
      if (row.cleanupState === null) return false;
      state = row.cleanupState;
      return state === to;
    };
    const block = async (
      reason: LiveSimulatorCleanupBlockedReason,
    ): Promise<DurableCleanupResult> => {
      if (
        row !== undefined &&
        state !== "blocked" &&
        state !== "complete" &&
        (preRestorationStates.has(state) ||
          state === "restoration_ready" ||
          state === "restoration_started")
      ) {
        try {
          await advance("blocked", { blockedReason: reason });
        } catch {
          return blocked();
        }
      }
      return blocked();
    };
    const refresh = async (): Promise<boolean> => {
      if (row === undefined || operationId === undefined) return false;
      if (durableTime(row, true) === undefined) return false;
      let established: LiveSimulatorAuthorizationRecord | undefined;
      try {
        established = await input.authorizations.findByOperationId(
          input.organizationId,
          operationId,
        );
      } catch {
        return false;
      }
      if (established === undefined || established.cleanupState === null) return false;
      row = established;
      state = established.cleanupState;
      return durableTime(row, true) !== undefined;
    };
    const schedule = async (boundaryAt?: number): Promise<boolean> => {
      if (row === undefined) return false;
      const sampled = durableTime(row, true);
      if (sampled === undefined) return false;
      const limit = Math.min(sampled.deadlineAt, boundaryAt ?? sampled.deadlineAt);
      const delay = Math.min(nextPollMs, limit - sampled.milliseconds);
      if (!Number.isFinite(delay) || delay <= 0) return false;
      try {
        await input.wait(delay);
      } catch {
        return false;
      }
      positiveWaitScheduled = true;
      nextPollMs = Math.min(nextPollMs * 2, 2_000);
      return true;
    };

    if (operationId === undefined) {
      if (context.admission !== "not_started" || context.previousOwnerStopped) return blocked();
    } else {
      const started = currentInstant();
      if (started === undefined) return blocked();
      let ownership: Awaited<
        ReturnType<LiveSimulatorAuthorizationRepository["closeDispatchAndBeginCleanup"]>
      >;
      try {
        ownership = await input.authorizations.closeDispatchAndBeginCleanup({
          organizationId: input.organizationId,
          operationId,
          ownerDigest,
          startedAt: started.iso,
          deadlineAt: new Date(started.milliseconds + input.cleanupTimeoutMs).toISOString(),
        });
      } catch {
        return blocked();
      }
      if (ownership.outcome === "missing" || ownership.outcome === "conflict") return blocked();
      if (ownership.outcome === "in_progress") {
        if (!context.previousOwnerStopped) return blocked();
        try {
          const takeover = await input.authorizations.takeOverCleanup({
            organizationId: input.organizationId,
            operationId,
            ownerDigest,
            previousOwnerStopped: true,
            changedAt: started.iso,
          });
          if (takeover.outcome !== "acquired" && takeover.outcome !== "terminal") {
            return blocked();
          }
          row = takeover.authorization;
        } catch {
          return blocked();
        }
      } else {
        if (
          ownership.outcome !== "acquired" &&
          ownership.outcome !== "replayed" &&
          ownership.outcome !== "terminal"
        ) {
          return blocked();
        }
        row = ownership.authorization;
      }
      const established = row;
      if (established === undefined || established.cleanupState === null) return blocked();
      state = established.cleanupState;
      if (state === "blocked") return blocked();
      if (state === "complete") {
        return Object.freeze({ outcome: "restored" as const, hostAndTunnelMustRemainUp: false });
      }
      if (preRestorationStates.has(state) && durableTime(established, true) === undefined) {
        return await block("time_invalid");
      }
    }

    while (preRestorationStates.has(state)) {
      if (row === undefined) return blocked();
      if (state === "barrier_pending") {
        if (row.dispatchClaimedAt === null) {
          if (!(await advance("restoration_ready"))) return await block("operation_unavailable");
          continue;
        }
        if (row.providerDispatchIdentity === null) {
          if (!(await advance("awaiting_identity"))) return await block("operation_unavailable");
          nextPollMs = 250;
          continue;
        }
        if (!/^[0-9a-f]{64}$/u.test(row.providerDispatchIdentity)) {
          return await block("operation_unavailable");
        }
        if (!(await advance("awaiting_arrival"))) return await block("operation_unavailable");
        nextPollMs = 250;
        continue;
      }
      if (state === "awaiting_identity") {
        if (!(await refresh())) return await block("time_invalid");
        if (row.providerDispatchIdentity !== null) {
          if (!/^[0-9a-f]{64}$/u.test(row.providerDispatchIdentity)) {
            return await block("operation_unavailable");
          }
          if (!(await advance("awaiting_arrival"))) return await block("operation_unavailable");
          nextPollMs = 250;
          continue;
        }
        const sampled = durableTime(row, true);
        if (sampled === undefined || sampled.milliseconds >= sampled.deadlineAt) {
          return await block("identity_deadline");
        }
        if (!(await schedule())) return await block("identity_deadline");
        continue;
      }
      const dispatchClaimedAt = row.dispatchClaimedAt;
      const boundCallDigest = row.providerDispatchIdentity;
      if (
        dispatchClaimedAt === null ||
        boundCallDigest === null ||
        !/^[0-9a-f]{64}$/u.test(boundCallDigest)
      ) {
        return await block("operation_unavailable");
      }
      const observationStarted = durableTime(row, true);
      if (observationStarted === undefined) return await block("time_invalid");
      let observation: Awaited<ReturnType<DurableCleanupControl["observeExactCall"]>>;
      try {
        observation = await input.control.observeExactCall({
          startedAt: dispatchClaimedAt,
          endedAt: observationStarted.iso,
          boundCallDigest,
        });
      } catch {
        return await block("observation_failed");
      }
      const observed = durableTime(row, true);
      if (observed === undefined) return await block("deadline_exhausted");
      if (observation.outcome === "zero_calls") {
        if (state !== "awaiting_arrival") return await block("call_disappeared");
        if (observed.milliseconds >= observed.deadlineAt) return await block("arrival_deadline");
        if (!(await schedule())) return await block("arrival_deadline");
        continue;
      }
      if (observation.outcome === "call_mismatch") return await block("call_mismatch");
      if (observation.outcome === "multiple_calls") return await block("multiple_calls");
      if (observation.outcome === "unsupported_status") return await block("unsupported_status");
      if (observation.outcome === "exact_active") {
        if (state === "awaiting_grace") return await block("status_regressed");
        if (state === "awaiting_arrival") {
          if (!(await advance("awaiting_terminal"))) return await block("operation_unavailable");
          nextPollMs = 250;
        }
        if (observed.milliseconds >= observed.deadlineAt) return await block("deadline_exhausted");
        if (!(await schedule())) return await block("deadline_exhausted");
        continue;
      }
      if (state !== "awaiting_grace") {
        const graceUntilAt = observed.milliseconds + input.trailingCallbackGraceMs;
        if (graceUntilAt > observed.deadlineAt || observed.milliseconds >= observed.deadlineAt) {
          return await block("deadline_exhausted");
        }
        if (
          !(await advance("awaiting_grace", {
            graceUntilAt: new Date(graceUntilAt).toISOString(),
            terminalStatus: observation.status,
          }))
        ) {
          return await block("operation_unavailable");
        }
        nextPollMs = 250;
        if (graceUntilAt === observed.milliseconds) continue;
        if (!(await schedule(graceUntilAt))) return await block("deadline_exhausted");
        continue;
      }
      const graceUntilAt = Date.parse(row.cleanupGraceUntilAt ?? "");
      if (
        !Number.isFinite(graceUntilAt) ||
        row.cleanupTerminalStatus !== observation.status ||
        graceUntilAt > observed.deadlineAt
      ) {
        return await block("status_regressed");
      }
      if (observed.milliseconds >= graceUntilAt) {
        if (!(await advance("restoration_ready"))) return await block("operation_unavailable");
        continue;
      }
      if (!(await schedule(graceUntilAt))) return await block("deadline_exhausted");
    }

    if (state === "restoration_ready") {
      let configurationState: "resting" | "live" | "ambiguous";
      try {
        configurationState = await input.control.readConfigurationState();
      } catch {
        configurationState = "ambiguous";
      }
      if (input.keepWebhook === true) {
        // The configured resting state is the same exact webhook, read back by the control.
        // Never issue a Reject update or accept configuration drift for a persistent session.
        if (configurationState !== "resting") return await block("restoration_ambiguous");
        if (!(await advance("restoration_started"))) return await block("restoration_ambiguous");
      } else if (configurationState === "live") {
        if (!(await advance("restoration_started"))) return await block("restoration_ambiguous");
        try {
          await input.control.restore();
        } catch {
          // The durable intent marker requires read-back reconciliation, never a second update.
        }
      } else if (configurationState === "resting" && row?.dispatchClaimedAt === null) {
        // A viewer handoff can fail before Twilio is armed. Durable zero-dispatch proof plus
        // resting read-back is sufficient to continue cleanup without issuing a provider update.
        if (!(await advance("restoration_started"))) return await block("restoration_ambiguous");
      } else {
        return await block("restoration_ambiguous");
      }
    }
    if (state === "restoration_started") {
      let configurationState: "resting" | "live" | "ambiguous";
      try {
        configurationState = await input.control.readConfigurationState();
      } catch {
        configurationState = "ambiguous";
      }
      if (configurationState !== "resting") return await block("restoration_ambiguous");
      if (!(await advance("restored"))) return blocked();
    }
    if (state === "restored") {
      try {
        await input.clearRuntimeSecrets();
      } catch {
        return blocked();
      }
      if (!(await advance("secrets_revoked"))) return blocked();
    }
    if (state === "secrets_revoked") {
      try {
        await input.stopHost();
      } catch {
        return blocked();
      }
      if (!(await advance("host_stopped"))) return blocked();
    }
    if (state === "host_stopped") {
      let tunnel: unknown;
      try {
        tunnel = await input.stopTunnel();
      } catch {
        return Object.freeze({
          outcome: "manual_stop_required" as const,
          hostAndTunnelMustRemainUp: false as const,
          hostStopped: true as const,
          tunnelStopRequired: true as const,
        });
      }
      if (tunnel === "manual_stop_required") {
        return Object.freeze({
          outcome: "manual_stop_required" as const,
          hostAndTunnelMustRemainUp: false as const,
          hostStopped: true as const,
          tunnelStopRequired: true as const,
        });
      }
      if (!(await advance("tunnel_stopped"))) return blocked();
    }
    if (state === "tunnel_stopped") {
      if (!(await advance("complete"))) return blocked();
      try {
        await input.teardownPersistence();
      } catch {
        return blocked();
      }
    }
    return (state as LiveSimulatorCleanupState) === "complete" || row === undefined
      ? Object.freeze({ outcome: "restored" as const, hostAndTunnelMustRemainUp: false as const })
      : blocked();
  };

  return Object.freeze({
    execute(context: GuardedLiveSmokeCleanupContext): Promise<DurableCleanupResult> {
      execution ??= execute(context);
      return execution;
    },
  });
}

function secretFile(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const path = environment[name]?.trim();
  if (path === undefined || path.length === 0) throw new Error("Live-smoke runtime is unavailable");
  const value = readFileSync(path, "utf8");
  if (value.length === 0 || value.trim() !== value || value.includes("\n")) {
    throw new Error("Live-smoke runtime is unavailable");
  }
  return value;
}

function requiredHttpsUrl(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0)
    throw new Error("Live-smoke runtime is unavailable");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Live-smoke runtime is unavailable");
  }
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("Live-smoke runtime is unavailable");
  }
  return parsed.href;
}

async function explicitConfirmation(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      'Type exactly "AUTHORIZE ONE POTENTIALLY BILLABLE SYNTHETIC CALL" to continue: ',
    );
    return answer === "AUTHORIZE ONE POTENTIALLY BILLABLE SYNTHETIC CALL";
  } finally {
    prompt.close();
  }
}

async function acknowledgeOwnedTunnelStopped(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      'After stopping and verifying the retained $ngrokProcess object, type exactly "I STOPPED THE OWNED NGROK PROCESS": ',
    );
    return answer === "I STOPPED THE OWNED NGROK PROCESS";
  } finally {
    prompt.close();
  }
}

function traceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}

async function waitForAbortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const custodyOwnershipMarkerName = ".live-demo-review-ownership.json";

export async function writeCustodyOwnershipMarker(input: {
  readonly custodyRoot: string;
  readonly sessionId: string;
  readonly operationId: string;
  readonly ownershipDigest: string;
}): Promise<void> {
  await mkdir(input.custodyRoot, { recursive: true, mode: 0o700 });
  await writeFile(
    join(input.custodyRoot, custodyOwnershipMarkerName),
    `${JSON.stringify({
      sessionId: input.sessionId,
      operationId: input.operationId,
      ownershipDigest: input.ownershipDigest,
    })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

async function attestCustodyOwnershipMarker(input: {
  readonly custodyRoot: string;
  readonly sessionId: string;
  readonly operationId: string;
  readonly ownershipDigest: string;
}): Promise<LiveDemoReviewOwnershipAttestation> {
  try {
    const parsed = JSON.parse(
      await readFile(join(input.custodyRoot, custodyOwnershipMarkerName), "utf8"),
    ) as Readonly<Record<string, unknown>>;
    if (
      parsed["sessionId"] !== input.sessionId ||
      parsed["operationId"] !== input.operationId ||
      parsed["ownershipDigest"] !== input.ownershipDigest
    ) {
      return Object.freeze({ outcome: "mismatch" as const });
    }
    return Object.freeze({
      outcome: "owned" as const,
      sessionId: input.sessionId,
      ownershipDigest: input.ownershipDigest,
      exclusive: true as const,
    });
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? Object.freeze({ outcome: "missing" as const })
      : Object.freeze({ outcome: "indeterminate" as const });
  }
}

export function createGuardedTwilioWebhookPolicy(
  environment: Readonly<Record<string, string | undefined>>,
  publicOrigin: string,
  stopOwnedTunnel: () => Promise<unknown>,
) {
  const keepWebhook = persistentWebhookEnabled(environment);
  const liveConfiguration = Object.freeze({
    voiceUrl: `${publicOrigin}/twilio/voice`,
    statusCallbackUrl: `${publicOrigin}/twilio/status`,
  });
  return Object.freeze({
    keepWebhook,
    liveConfiguration,
    restingConfiguration: keepWebhook
      ? liveConfiguration
      : Object.freeze({
          voiceUrl: requiredHttpsUrl(environment, "TWILIO_RESTING_REJECT_URL"),
          statusCallbackUrl: null,
        }),
    // The long-lived receiver owns its tunnel. A per-call runner can release only its host.
    stopTunnel: keepWebhook ? async () => "session_retained" as const : stopOwnedTunnel,
  });
}

export function createGuardedTerminalPersistenceCleanup(input: {
  readonly keepWebhook: boolean;
  readonly closeRunGate: () => void;
  readonly cleanupLiveSmoke: () => Promise<unknown>;
}): () => Promise<unknown> {
  if (!input.keepWebhook) return input.cleanupLiveSmoke;
  return async () => {
    // The job must return before its host can drain the job runner. The outer process owns
    // full cleanup after retaining the terminal projection; this hook makes no cleanup claim.
    input.closeRunGate();
  };
}

export function createDefaultGuardedLiveSmokeProcess(
  environment: Readonly<Record<string, string | undefined>>,
  ownership: Readonly<{
    stopTunnel: () => Promise<unknown>;
    disposableDatabaseOwner: DisposablePostgresOwner;
  }>,
  browser: Readonly<{ launchBrowser?: (url: string) => Promise<void> }> = {},
) {
  // Validate opt-in before creating pools or resolving provider resources.
  persistentWebhookEnabled(environment);
  const runtimeSecrets = createGuardedRuntimeSecretOwner(
    loadSimulatorHostConfiguration(environment),
  );
  const pool = new Pool({ connectionString: runtimeSecrets.access().connectionString, max: 2 });
  const persistence = createPostgresPersistence(pool, { probeTimeoutMs: 500 });
  const organizationId = OrganizationId.create(runtimeSecrets.access().organizationId);
  const reviewOwnershipKey = randomBytes(32);
  const reviewConfiguration = Object.freeze({
    host: runtimeSecrets.access().listenHost === "::1" ? ("::1" as const) : ("127.0.0.1" as const),
    port: runtimeSecrets.access().listenPort,
    allowedBrowserOrigin: runtimeSecrets.access().demoOrigin,
    custodyRoot: runtimeSecrets.access().custodyRoot,
    checkpointDirectory: `${runtimeSecrets.access().custodyRoot}.review-checkpoints`,
    custodyOwnershipScope: createHmac("sha256", reviewOwnershipKey)
      .update(runtimeSecrets.access().custodyRoot, "utf8")
      .digest("hex"),
    databaseOwnershipScope: createHmac("sha256", reviewOwnershipKey)
      .update(runtimeSecrets.access().connectionString, "utf8")
      .digest("hex"),
  });
  const webhookPolicy = createGuardedTwilioWebhookPolicy(
    environment,
    runtimeSecrets.access().publicBaseUrl,
    ownership.stopTunnel,
  );
  const { restingConfiguration, liveConfiguration } = webhookPolicy;
  let control: Control | undefined;
  let runtime: Runtime | undefined;
  let reviewRuntime: LiveDemoReviewRuntime | undefined;
  let reviewObservability: SimulatorHostObservability | undefined;
  let terminalProjection: LiveDemoReviewProjection | undefined;
  let reviewCleanupBinding: LiveDemoReviewProtectedCleanupBinding | undefined;
  let reviewRecoveryIdentity: LiveDemoReviewRecoveryIdentity | undefined;
  let closeActiveRunGate: (() => void) | undefined;
  const browserHandoff = createLiveDemoBrowserHandoff({
    launchBrowser: browser.launchBrowser ?? launchSystemBrowser,
  });

  const createTransport = (): TwilioLiveSmokeControlTransport => {
    const configuration = runtimeSecrets.access();
    return createTwilioLiveSmokeControlTransport({
      accountSid: secretFile(environment, "TWILIO_ACCOUNT_SID_FILE"),
      numberSid: secretFile(environment, "TWILIO_NUMBER_SID_FILE"),
      authToken: configuration.twilioAuthToken,
    });
  };

  const ensureControl = (createdTransport?: TwilioLiveSmokeControlTransport): Control => {
    runtimeSecrets.access();
    if (control !== undefined) return control;
    const ownedTransport = createdTransport ?? createTransport();
    control = createTwilioLiveSmokeControl({
      transport: ownedTransport,
      digestProviderCall: (identifier) =>
        createHmac("sha256", runtimeSecrets.access().callbackIdentityHmacKey)
          .update(identifier, "utf8")
          .digest("hex"),
      restingConfiguration,
      liveConfiguration,
    });
    return control;
  };
  const cleanupCoordinator = createDurableGuardedRuntimeCleanupCoordinator({
    keepWebhook: webhookPolicy.keepWebhook,
    organizationId,
    authorizations: persistence.liveSimulatorAuthorizations,
    control: {
      observeExactCall: async (window) => await ensureControl().observeExactCall(window),
      readConfigurationState: async () => await ensureControl().readConfigurationState(),
      restore: async () => await ensureControl().restore(),
    },
    createOwnerDigest: () => randomBytes(32).toString("hex"),
    now: () => new Date().toISOString(),
    wait: async (milliseconds) =>
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    cleanupTimeoutMs: 60_000,
    trailingCallbackGraceMs: 5_000,
    closeRunGate: () => closeActiveRunGate?.(),
    clearRuntimeSecrets: () => {
      control = undefined;
      runtimeSecrets.clear();
    },
    stopHost: async () => await runtime?.close(),
    stopTunnel: webhookPolicy.stopTunnel,
    // Review custody and disposable persistence survive only this external-cleanup boundary.
    teardownPersistence: async () => undefined,
  });
  const createReviewRecoveryIdentity = (identity: {
    readonly operationId: string;
    readonly scenarioId: string;
    readonly scenarioRevision: number;
  }): Readonly<{
    session: LiveDemoReviewRecoveryIdentity;
    lease: ReturnType<typeof establishLiveDemoReviewLease>;
  }> => {
    const lease = establishLiveDemoReviewLease({
      identity,
      reviewReadyAt: new Date().toISOString(),
    });
    const sessionId = `review-${randomBytes(24).toString("base64url")}`;
    return Object.freeze({
      lease,
      session: Object.freeze({
        sessionId,
        ...identity,
        reviewReadyAt: lease.reviewReadyAt,
        reviewExpiresAt: lease.reviewExpiresAt,
        custodyOwnershipDigest: createHmac("sha256", reviewOwnershipKey)
          .update(`${reviewConfiguration.custodyOwnershipScope}\u0000${sessionId}`, "utf8")
          .digest("hex"),
        databaseOwnershipDigest: createHmac("sha256", reviewOwnershipKey)
          .update(`${reviewConfiguration.databaseOwnershipScope}\u0000${sessionId}`, "utf8")
          .digest("hex"),
      }),
    });
  };
  const createReviewCleanupBinding = (input: {
    readonly session: LiveDemoReviewRecoveryIdentity;
    readonly cleanupOwnerDigest: string;
    readonly checkpointStore: ReturnType<typeof createLiveDemoReviewCheckpointStore>;
    readonly previousOwnerStopped: boolean;
  }): LiveDemoReviewProtectedCleanupBinding => {
    let exactProvisioningOwnershipDigest: string | undefined;
    return createLiveDemoReviewProtectedCleanupBinding({
      cleanupOwner: {
        session: input.session,
        cleanupOwnerDigest: input.cleanupOwnerDigest,
        loadCheckpoint: input.checkpointStore.load,
        compareAndSetCheckpoint: input.checkpointStore.compareAndSet,
        attestCustodyOwnership: async () =>
          await attestCustodyOwnershipMarker({
            custodyRoot: reviewConfiguration.custodyRoot,
            sessionId: input.session.sessionId,
            operationId: input.session.operationId,
            ownershipDigest: input.session.custodyOwnershipDigest,
          }),
        attestDatabaseOwnership: async () => {
          const provisioningAttestation = await ownership.disposableDatabaseOwner.attestOwnership();
          if (provisioningAttestation.outcome !== "owned") return provisioningAttestation;
          const attestation =
            await persistence.liveSimulatorAuthorizations.attestReviewDatabaseOwnership({
              organizationId,
              operationId: input.session.operationId,
              sessionId: input.session.sessionId,
              databaseOwnershipDigest: input.session.databaseOwnershipDigest,
              databaseProvisioningOwnershipDigest:
                provisioningAttestation.provisioningOwnershipDigest,
            });
          if (attestation.outcome !== "owned") return attestation;
          exactProvisioningOwnershipDigest = provisioningAttestation.provisioningOwnershipDigest;
          return Object.freeze({
            outcome: "owned" as const,
            sessionId: input.session.sessionId,
            ownershipDigest: input.session.databaseOwnershipDigest,
            exclusive: true as const,
          });
        },
        deleteCustodyRoot: async () => {
          await rm(reviewConfiguration.custodyRoot, { recursive: true, force: true });
        },
        teardownDisposableDatabase: async () =>
          await ownership.disposableDatabaseOwner.teardown({
            closeConnections: async () => {
              await persistence.disconnect();
              await pool.end();
            },
            expectedProvisioningOwnershipDigest: exactProvisioningOwnershipDigest ?? "invalid",
          }),
        verifyDisposableDatabaseDeleted: async () =>
          await ownership.disposableDatabaseOwner.verifyDeleted({
            expectedProvisioningOwnershipDigest: exactProvisioningOwnershipDigest ?? "invalid",
          }),
        authorizeStaleOwnerTakeover: async (checkpoint) =>
          input.previousOwnerStopped ||
          Date.now() >= Date.parse(checkpoint.session.reviewExpiresAt),
        removeRecoveryCheckpoint: input.checkpointStore.removeExactRecoveryIdentity,
      },
      readReviewCleanupState: async () => {
        const authorization = await persistence.liveSimulatorAuthorizations.findByOperationId(
          organizationId,
          input.session.operationId,
        );
        return authorization?.reviewCleanupState;
      },
      transitionReviewCleanup: async (from, to) =>
        await persistence.liveSimulatorAuthorizations.transitionReviewCleanup({
          organizationId,
          operationId: input.session.operationId,
          sessionId: input.session.sessionId,
          from,
          to,
          changedAt: new Date().toISOString(),
        }),
    });
  };

  const reviewLifecycle = createGuardedReviewLifecycle<LiveDemoReviewCleanupCheckpoint>({
    discoverPendingReview: async () => {
      const checkpoints = await discoverLiveDemoReviewCheckpoints({
        rootDirectory: reviewConfiguration.checkpointDirectory,
      });
      const pending = checkpoints.filter(({ state }) => state !== "review_deleted");
      return pending.length === 1
        ? Object.freeze({ outcome: "pending" as const, review: pending[0] })
        : pending.length === 0
          ? Object.freeze({ outcome: "none" as const })
          : Object.freeze({ outcome: "pending" as const });
    },
    recoverPendingReview: async (checkpoint) => {
      if (checkpoint === undefined || Date.now() < Date.parse(checkpoint.session.reviewExpiresAt)) {
        throw new Error("Live demo review recovery requires stopped-owner or expired-lease proof");
      }
      const checkpointStore = createLiveDemoReviewCheckpointStore({
        rootDirectory: reviewConfiguration.checkpointDirectory,
        sessionId: checkpoint.session.sessionId,
        operationId: checkpoint.session.operationId,
      });
      const cleanupBinding = createReviewCleanupBinding({
        session: checkpoint.session,
        cleanupOwnerDigest: randomBytes(32).toString("hex"),
        checkpointStore,
        previousOwnerStopped: false,
      });
      cleanupBinding.establishDatabaseLease();
      return await cleanupBinding.cleanup("restart");
    },
  });
  const basePreflight = createRuntimeLiveSmokePreflight({ environment });
  const preflight = Object.freeze({
    run: async () => {
      try {
        const recovery = await reviewLifecycle.recoverBeforePreflight();
        if (recovery.outcome === "blocked") return Object.freeze({ outcome: "BLOCKED" as const });
      } catch {
        return Object.freeze({ outcome: "BLOCKED" as const });
      }
      const databaseOwnership = await ownership.disposableDatabaseOwner.attestOwnership();
      if (databaseOwnership.outcome !== "owned") {
        return Object.freeze({ outcome: "BLOCKED" as const });
      }
      return await basePreflight.run();
    },
  });
  const reviewTransition = createRecordingSafeReviewTransition<
    LiveDemoReviewRuntime,
    GuardedLiveSmokeCleanupContext
  >({
    executeExternalCleanup: async (context) => await cleanupCoordinator.execute(context),
    retainReviewResources: async () => {
      if (terminalProjection === undefined) {
        throw new Error("Exact terminal review projection is unavailable");
      }
    },
    startReviewRuntime: async () => {
      const projection = terminalProjection;
      if (projection === undefined)
        throw new Error("Exact terminal review projection is unavailable");
      const { lease, session } = createReviewRecoveryIdentity({
        operationId: projection.operationId,
        scenarioId: projection.scenarioId,
        scenarioRevision: projection.scenarioRevision,
      });
      reviewRecoveryIdentity = session;
      const checkpointStore = createLiveDemoReviewCheckpointStore({
        rootDirectory: reviewConfiguration.checkpointDirectory,
        sessionId: session.sessionId,
        operationId: session.operationId,
      });
      const cleanupOwnerDigest = randomBytes(32).toString("hex");
      const initialCheckpoint = await checkpointStore.compareAndSet({
        expectedVersion: null,
        cleanupOwnerDigest,
        checkpoint: {
          session,
          state: "review_ready",
          trigger: "restart",
          custodyDeleted: false,
          databaseDeleted: false,
          recoveryIdentity: session,
        },
      });
      if (initialCheckpoint.outcome !== "updated") {
        throw new Error("Live demo review lease persistence is unavailable");
      }
      const cleanupBinding = createReviewCleanupBinding({
        session,
        cleanupOwnerDigest,
        checkpointStore,
        previousOwnerStopped: false,
      });
      reviewCleanupBinding = cleanupBinding;
      reviewLifecycle.retainCleanupHandle(cleanupBinding.cleanup);
      await writeCustodyOwnershipMarker({
        custodyRoot: reviewConfiguration.custodyRoot,
        sessionId: session.sessionId,
        operationId: session.operationId,
        ownershipDigest: session.custodyOwnershipDigest,
      });
      const databaseProvisioningAttestation =
        await ownership.disposableDatabaseOwner.attestOwnership();
      if (databaseProvisioningAttestation.outcome !== "owned") {
        throw new Error("Disposable PostgreSQL provisioning ownership is unavailable");
      }
      const established = await persistence.liveSimulatorAuthorizations.establishReviewLease({
        organizationId,
        operationId: session.operationId,
        sessionId: session.sessionId,
        reviewReadyAt: session.reviewReadyAt,
        reviewExpiresAt: session.reviewExpiresAt,
        custodyOwnershipDigest: session.custodyOwnershipDigest,
        databaseOwnershipDigest: session.databaseOwnershipDigest,
        databaseProvisioningOwnershipDigest:
          databaseProvisioningAttestation.provisioningOwnershipDigest,
      });
      if (established.outcome !== "established" && established.outcome !== "replayed") {
        throw new Error("Live demo review database lease persistence is unavailable");
      }
      cleanupBinding.establishDatabaseLease();
      const observability = createSimulatorHostObservability();
      reviewObservability = observability;
      reviewRuntime = await startBoundLiveDemoReviewRuntime({
        host: reviewConfiguration.host,
        port: reviewConfiguration.port,
        allowedBrowserOrigin: reviewConfiguration.allowedBrowserOrigin,
        sessionId: session.sessionId,
        lease,
        identity: session,
        now: () => new Date(),
        readRetainedProjection: () => terminalProjection,
        protectedCleanup: cleanupBinding,
        revokeProjection: () => {
          terminalProjection = undefined;
        },
        closeObservability: async () => await observability.close(),
        runCleanupSpan: async (_span, operation) => await observability.runJobSpan(operation),
        establishTraceContext: (headers) => observability.establishTraceContext(headers),
        runRequestSpan: async (span, operation) => await observability.runRestSpan(span, operation),
        recordHttpRequest: (request) => observability.recordHttpRequest(request),
      });
      return reviewRuntime;
    },
    cleanupFailedReview: async (context) => {
      if (reviewCleanupBinding !== undefined) {
        return await reviewCleanupBinding.cleanup("restart");
      }
      let recovery = reviewRecoveryIdentity;
      if (recovery === undefined) {
        if (context.operationId === undefined) {
          throw new Error("Exact review startup recovery identity is unavailable");
        }
        const authorization = await persistence.liveSimulatorAuthorizations.findByOperationId(
          organizationId,
          context.operationId,
        );
        if (authorization === undefined) {
          throw new Error("Exact review startup recovery identity is unavailable");
        }
        recovery = createReviewRecoveryIdentity({
          operationId: authorization.operationId,
          scenarioId: authorization.scenarioId,
          scenarioRevision: authorization.scenarioRevision,
        }).session;
        reviewRecoveryIdentity = recovery;
      }
      const checkpointStore = createLiveDemoReviewCheckpointStore({
        rootDirectory: reviewConfiguration.checkpointDirectory,
        sessionId: recovery.sessionId,
        operationId: recovery.operationId,
      });
      const current = await checkpointStore.load();
      if (current === undefined) {
        const persisted = await checkpointStore.compareAndSet({
          expectedVersion: null,
          cleanupOwnerDigest: randomBytes(32).toString("hex"),
          checkpoint: {
            session: recovery,
            state: "review_cleanup_blocked",
            trigger: "restart",
            custodyDeleted: false,
            databaseDeleted: false,
            recoveryIdentity: recovery,
          },
        });
        if (persisted.outcome !== "updated") {
          throw new Error("Review startup recovery checkpoint persistence failed");
        }
      }
      return Object.freeze({
        outcome: "blocked" as const,
        message: "Cleanup requires attention" as const,
        recoveryIdentity: recovery,
      });
    },
    releaseFailedReviewResources: () =>
      releaseFailedReviewStartupResources({
        revokeProtectedState: () => {
          terminalProjection = undefined;
        },
        detachRuntime: () => {
          const detached = reviewRuntime;
          reviewRuntime = undefined;
          return detached;
        },
        detachObservability: () => {
          const detached = reviewObservability;
          reviewObservability = undefined;
          return detached;
        },
      }),
  });
  const cleanup = async (context: GuardedLiveSmokeCleanupContext) => {
    const result = await reviewTransition.execute(context);
    if (result.outcome === "review_ready" || result.outcome === "review_startup_cleaned") {
      return Object.freeze({
        outcome: "restored" as const,
        hostAndTunnelMustRemainUp: false as const,
      });
    }
    if (result.outcome === "review_cleanup_blocked") {
      return Object.freeze({
        outcome: "blocked" as const,
        hostAndTunnelMustRemainUp: true as const,
      });
    }
    if (result.outcome === "review_startup_release_failed") {
      return Object.freeze({
        outcome: result.outcome,
        message: result.message,
        hostAndTunnelMustRemainUp: false as const,
        protectedStateRevoked: true as const,
        closeFailures: result.closeFailures,
      });
    }
    return result;
  };

  const processPath = createGuardedLiveSmokeProcess({
    preflight,
    confirm: explicitConfirmation,
    createRunGate: () => createLiveSmokeRunGate("CLOSED"),
    createControlTransport: createTransport,
    createControl: (createdTransport) => ensureControl(createdTransport),
    startGuardedRuntime: async ({ runGate, reconcileLiveSmoke, cleanupLiveSmoke }) => {
      closeActiveRunGate = () => runGate.close();
      runtime = await startGuardedSimulatorHostRuntime({
        configuration: runtimeSecrets.access(),
        assertRuntimeSecretsAvailable: () => {
          runtimeSecrets.access();
        },
        runGate,
        reconcileLiveSmoke: async (input) => await reconcileLiveSmoke(input),
        cleanupLiveSmoke: createGuardedTerminalPersistenceCleanup({
          keepWebhook: webhookPolicy.keepWebhook,
          closeRunGate: () => runGate.close(),
          cleanupLiveSmoke,
        }),
        observeViewerReadiness: browserHandoff.observe,
      });
      return runtime;
    },
    cleanup,
    attachViewer: async ({ identity }) =>
      (
        await browserHandoff.attach({
          simulatorUrl: new URL("/simulator.html", runtimeSecrets.access().demoOrigin).href,
          identity,
        })
      ).outcome,
    shutdownAfterRun: async () => await reviewLifecycle.shutdown(),
    mintAndReserve: async (run) => {
      const configuration = runtimeSecrets.access();
      const output: string[] = [];
      await authorizeLiveSimulatorRun({
        argv: [
          "--scenario",
          run.scenarioId,
          ...(run.predecessorOperationId === undefined
            ? []
            : ["--predecessor", run.predecessorOperationId]),
        ],
        configuration,
        authorizationIssuer: persistence.liveSimulatorAuthorizations,
        predecessorLookup: {
          find: async (operationId) => {
            const [authorization, operation] = await Promise.all([
              persistence.liveSimulatorAuthorizations.findByOperationId(
                organizationId,
                operationId,
              ),
              persistence.observations.findOperation(organizationId, operationId),
            ]);
            if (authorization === undefined || operation === undefined) return undefined;
            return Object.freeze({
              scenarioId: authorization.scenarioId,
              scenarioRevision: authorization.scenarioRevision,
              terminal: operation.terminal,
              hasEvidence: operation.evidence !== null,
              provenance: operation.attempt.provenance,
            });
          },
        },
        writeOutput: (value) => output.push(value),
      });
      const issued = JSON.parse(output[0] ?? "") as { operationId?: unknown; permit?: unknown };
      if (typeof issued.operationId !== "string" || typeof issued.permit !== "string") {
        throw new Error("Live-smoke authorization failed");
      }
      const boundary = createRunAuthorizationReservationBoundary({
        organizationId,
        signingKey: configuration.authorizationSigningKey,
        audience: configuration.authorizationAudience,
        endpointAlias: configuration.endpointAlias,
        authorizationReservations: persistence.liveSimulatorAuthorizations,
        authorizedTargetDigest: configuration.authorizedTargetDigest,
        publicOrigin: configuration.publicBaseUrl,
        nowEpochSeconds: () => Math.floor(Date.now() / 1_000),
      });
      const reservation = await boundary.reserve({
        token: issued.permit,
        runId: issued.operationId,
        scenarioId: run.scenarioId,
        scenarioRevision: run.scenarioRevision,
        audience: configuration.authorizationAudience,
        endpointAlias: configuration.endpointAlias,
        ...(run.predecessorOperationId === undefined
          ? {}
          : { predecessorOperationId: run.predecessorOperationId }),
      });
      if (reservation !== "reserved") throw new Error("Live-smoke authorization failed");
      return Object.freeze({ operationId: issued.operationId, permit: issued.permit });
    },
    submitAndWait: async (run) => {
      const configuration = runtimeSecrets.access();
      const accepted = await fetch(`${run.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: { "content-type": "application/json", traceparent: traceparent() },
        body: JSON.stringify({
          scenarioId: run.scenarioId,
          scenarioRevision: run.scenarioRevision,
          permit: run.permit,
        }),
        signal: AbortSignal.any([run.signal, AbortSignal.timeout(5_000)]),
      });
      if (accepted.status !== 202) throw new Error("Live-smoke admission failed");
      const deadline =
        Date.now() +
        calculateLiveSmokeProjectionTimeoutMs({
          callbackDeadlineMs: configuration.timeoutMs,
          providerTerminalTimeoutMs: configuration.providerTerminalTimeoutMs,
        });
      while (Date.now() < deadline) {
        const response = await fetch(
          `${run.baseUrl}/api/v1/live-simulator/operations/${encodeURIComponent(run.operationId)}`,
          {
            method: "GET",
            signal: AbortSignal.any([run.signal, AbortSignal.timeout(2_000)]),
          },
        );
        if (response.ok) {
          const projection = (await response.json()) as {
            terminal?: unknown;
            terminalOutcome?: unknown;
          };
          if (projection.terminal === true) {
            terminalProjection = restoreLiveDemoReviewProjection(projection, {
              operationId: run.operationId,
              scenarioId: run.scenarioId,
              scenarioRevision: run.scenarioRevision,
            });
            if (terminalProjection === undefined) {
              throw new Error("Live-smoke terminal projection is invalid");
            }
            return Object.freeze({
              status: classifyGuardedLiveSmokeTerminalOutcome(projection.terminalOutcome),
              operationId: run.operationId,
            });
          }
        }
        await waitForAbortableDelay(250, run.signal);
      }
      throw new Error("Live-smoke terminal deadline exceeded");
    },
  });
  return processPath;
}

function parseRun(argv: readonly string[]) {
  const scenarioIndex = argv.indexOf("--scenario");
  const predecessorIndex = argv.indexOf("--predecessor");
  const scenarioId = scenarioIndex < 0 ? undefined : argv[scenarioIndex + 1];
  const predecessorOperationId = predecessorIndex < 0 ? undefined : argv[predecessorIndex + 1];
  if (scenarioId === undefined) throw new Error("Live-smoke scenario is required");
  return Object.freeze({
    scenarioId,
    scenarioRevision: 2,
    ...(predecessorOperationId === undefined ? {} : { predecessorOperationId }),
  });
}

export function parseInterruptedCleanupInput(argv: readonly string[]): Readonly<{
  operationId: string;
  previousOwnerStopped: true;
}> {
  if (argv.length !== 3 || argv[0] !== "--operation" || argv[2] !== "--previous-owner-stopped") {
    if (argv.length === 0) throw new Error("Live-smoke cleanup operation is required");
    throw new Error("Live-smoke cleanup arguments are invalid");
  }
  const operationId = argv[1];
  if (operationId === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationId)) {
    throw new Error("Live-smoke cleanup operation is required");
  }
  return Object.freeze({ operationId, previousOwnerStopped: true as const });
}

export async function runGuardedLiveSmokeProcessCli(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const action = argv[0];
  if (action !== "prepare" && action !== "run" && action !== "cleanup") {
    throw new Error("Live-smoke action must be prepare, run, or cleanup");
  }
  if (action === "prepare") {
    const result = await createRuntimeLiveSmokePreflight({ environment }).run();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.outcome === "BLOCKED") process.exitCode = 1;
    return;
  }
  const interruptedCleanup =
    action === "cleanup" ? parseInterruptedCleanupInput(argv.slice(1)) : undefined;
  const tunnelOwner = createManualTunnelStopOwner({
    environment,
    acknowledgeStopped: acknowledgeOwnedTunnelStopped,
  });
  const disposableDatabaseOwner = createDisposablePostgresOwner(
    loadSimulatorHostConfiguration(environment).connectionString,
    {
      loadProvisioningAttestation: async () => {
        const path = environment["LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE"]?.trim();
        if (path === undefined || !isAbsolute(path)) {
          throw new Error("Disposable PostgreSQL provisioning ownership is unavailable");
        }
        return JSON.parse(await readFile(path, "utf8")) as unknown;
      },
    },
  );
  const processPath = createDefaultGuardedLiveSmokeProcess(environment, {
    stopTunnel: async () => await tunnelOwner.stop(),
    disposableDatabaseOwner,
  });
  let shutdownPromise: Promise<unknown> | undefined;
  const shutdown = (): void => {
    shutdownPromise ??= processPath.shutdown();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  let result:
    Awaited<ReturnType<typeof processPath.cleanup>> | Awaited<ReturnType<typeof processPath.run>>;
  try {
    result =
      action === "cleanup"
        ? await processPath.cleanup({
            operationId: interruptedCleanup!.operationId,
            admission: "indeterminate",
            previousOwnerStopped: interruptedCleanup!.previousOwnerStopped,
          })
        : await processPath.run(parseRun(argv.slice(1)));
    if (shutdownPromise !== undefined) await shutdownPromise;
  } finally {
    if (action === "cleanup") {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (guardedLiveSmokeResultRequiresFailureExit(result)) process.exitCode = 1;
}
