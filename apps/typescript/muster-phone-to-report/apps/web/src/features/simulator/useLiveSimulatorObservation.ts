import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type {
  SimulatorLiveClient,
  SimulatorLiveProjection,
  SimulatorLiveReviewCleanupResult,
  SimulatorLiveReviewMetadata,
  SimulatorLiveRequestResult,
  SimulatorLiveStatusResult,
} from "@muster/api-client/simulator-live";

export type LiveSimulatorObservationStatus =
  | "idle"
  | "submitting"
  | "scheduled"
  | "calling"
  | "extracting"
  | "complete"
  | "incomplete"
  | "recovery"
  | "deleted"
  | "expired"
  | "submission_error"
  | "status_error";

export interface LiveSimulatorObservationSnapshot {
  readonly status: LiveSimulatorObservationStatus;
  readonly operationId: string | null;
  readonly resourceVersion: number | null;
  readonly message: string | null;
  readonly canRetryStatus: boolean;
  readonly focusBoundary: "none" | "submission" | "error" | "terminal" | "cleanup";
  readonly result: SimulatorLiveProjection | null;
  readonly admittedScenarioId: string | null;
  readonly admittedScenarioRevision: number | null;
  readonly review?: SimulatorLiveReviewMetadata | null;
  readonly cleanup?: Readonly<{
    status: "idle" | "deleting" | "deleted" | "expired" | "attention";
    message: string | null;
  }>;
}

export interface LiveSimulatorScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface LiveSimulatorObservation {
  getSnapshot(): LiveSimulatorObservationSnapshot;
  subscribe(listener: () => void): () => void;
  run(permit: string): Promise<void>;
  retryStatus(): Promise<void>;
  resume(): Promise<void>;
  finishReview(): Promise<void>;
  attach(): () => void;
  dispose(): void;
}

export interface LiveSimulatorOperationIdentity {
  readonly operationId: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
}

export interface LiveSimulatorObservationOptions {
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly client: Readonly<{
    requestLiveObservation: SimulatorLiveClient["requestLiveObservation"];
    getLiveObservation: SimulatorLiveClient["getLiveObservation"];
    readonly finishLiveDemoReview?: SimulatorLiveClient["finishLiveDemoReview"];
  }>;
  readonly scheduler?: LiveSimulatorScheduler;
  readonly resumeOperation?: LiveSimulatorOperationIdentity | null;
  readonly awaitReviewMetadata?: boolean;
  readonly onPermitAccepted?: () => void;
  readonly onOperationEstablished?: (identity: LiveSimulatorOperationIdentity) => void;
  readonly onReviewDeleted?: () => void;
}

const DEFAULT_DELAY_MS = 1_000;
const MAX_DELAY_MS = 10_000;

const browserScheduler: LiveSimulatorScheduler = Object.freeze({
  schedule(callback: () => void, delayMs: number) {
    const timer = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(timer);
  },
});

function initialSnapshot(): LiveSimulatorObservationSnapshot {
  return Object.freeze({
    status: "idle",
    operationId: null,
    resourceVersion: null,
    message: null,
    canRetryStatus: false,
    focusBoundary: "none",
    result: null,
    admittedScenarioId: null,
    admittedScenarioRevision: null,
    review: null,
    cleanup: Object.freeze({ status: "idle", message: null }),
  });
}

function delay(result: SimulatorLiveStatusResult | SimulatorLiveRequestResult): number {
  const seconds = result.headers.retryAfterSeconds;
  if (seconds === null) return DEFAULT_DELAY_MS;
  return Math.min(MAX_DELAY_MS, Math.max(DEFAULT_DELAY_MS, seconds * 1_000));
}

function stageMessage(stage: SimulatorLiveProjection["stage"]): string {
  switch (stage) {
    case "scheduled":
      return "Live observation queued";
    case "calling":
      return "Calling synthetic endpoint";
    case "extracting":
      return "Interpreting retained transcript evidence";
    case "terminal":
      return "Live observation finished";
  }
}

function terminalStatus(projection: SimulatorLiveProjection): LiveSimulatorObservationStatus {
  if (projection.terminalOutcome === "recovery_candidate") return "recovery";
  if (
    projection.terminalOutcome === "observation_recorded" &&
    projection.evidence?.quality === "complete"
  ) {
    return "complete";
  }
  return "incomplete";
}

function submissionMessage(result: Exclude<SimulatorLiveRequestResult, { ok: true }>): string {
  if (result.status === 400) {
    return result.error?.message ?? "Permit rejected. Mint a fresh scenario-bound permit.";
  }
  if (result.status === 409) return "This live observation request conflicts with its permit.";
  if (result.status === 503) return "The live observation dependency is temporarily unavailable.";
  return "Live observation could not be started safely.";
}

export function createLiveSimulatorObservation(
  options: LiveSimulatorObservationOptions,
): LiveSimulatorObservation {
  const scheduler = options.scheduler ?? browserScheduler;
  const listeners = new Set<() => void>();
  let snapshot = initialSnapshot();
  let disposed = false;
  let generation = 0;
  let pollInFlight = false;
  let operatorOwned = false;
  let cancelScheduled: (() => void) | null = null;
  let cancelReviewExpiry: (() => void) | null = null;
  let latchedReview: SimulatorLiveReviewMetadata | null = null;
  let reviewRevoked = false;
  let pollDelayMs = DEFAULT_DELAY_MS;
  let requestAbort: AbortController | null = null;
  let attachments = 0;
  let resumeStarted = false;

  const publish = (next: LiveSimulatorObservationSnapshot): void => {
    if (disposed) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const cancelPoll = (): void => {
    cancelScheduled?.();
    cancelScheduled = null;
  };

  const cancelExpiry = (): void => {
    cancelReviewExpiry?.();
    cancelReviewExpiry = null;
  };

  const revokeReview = (outcome: "deleted" | "expired"): void => {
    if (reviewRevoked) return;
    reviewRevoked = true;
    generation += 1;
    cancelPoll();
    cancelExpiry();
    requestAbort?.abort();
    requestAbort = null;
    latchedReview = null;
    const message =
      outcome === "deleted" ? "Protected demo result deleted" : "Protected demo result expired";
    publish({
      ...initialSnapshot(),
      status: outcome,
      message,
      focusBoundary: "cleanup",
      cleanup: Object.freeze({ status: outcome, message }),
    });
    options.onReviewDeleted?.();
  };

  const admitReview = (
    candidate: SimulatorLiveReviewMetadata | null | undefined,
  ): SimulatorLiveReviewMetadata | null => {
    if (candidate !== null && candidate !== undefined && latchedReview === null) {
      latchedReview = candidate;
    }
    return latchedReview;
  };

  const armReviewExpiry = (review: SimulatorLiveReviewMetadata | null): void => {
    if (review === null || cancelReviewExpiry !== null || reviewRevoked) return;
    const expiresAt = Date.parse(review.reviewExpiresAt);
    const remainingMs = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remainingMs <= 0) {
      revokeReview("expired");
      return;
    }
    cancelReviewExpiry = scheduler.schedule(
      () => {
        cancelReviewExpiry = null;
        revokeReview("expired");
      },
      Math.min(remainingMs, 30 * 60 * 1_000),
    );
  };

  const schedulePoll = (token: number): void => {
    cancelPoll();
    cancelScheduled = scheduler.schedule(() => {
      cancelScheduled = null;
      void poll(token);
    }, pollDelayMs);
  };

  const handleStatus = (result: SimulatorLiveStatusResult, token: number): void => {
    if (disposed || token !== generation) return;
    if (!result.ok) {
      if (
        options.awaitReviewMetadata === true &&
        resumeStarted &&
        snapshot.result?.terminal === true &&
        snapshot.review == null
      ) {
        publish({
          ...snapshot,
          message: "Review transition reconnecting; the exact live result is preserved.",
          canRetryStatus: true,
          focusBoundary: "none",
        });
        schedulePoll(token);
        return;
      }
      publish({
        ...snapshot,
        status: "status_error",
        message: "Status check interrupted. The last confirmed live result is preserved.",
        canRetryStatus: true,
        focusBoundary: "none",
      });
      return;
    }
    if (
      result.data.operationId !== snapshot.operationId ||
      (snapshot.admittedScenarioId !== null &&
        result.data.scenarioId !== snapshot.admittedScenarioId) ||
      (snapshot.admittedScenarioRevision !== null &&
        result.data.scenarioRevision !== snapshot.admittedScenarioRevision)
    ) {
      publish({
        ...snapshot,
        status: "status_error",
        message: "Status identity did not match the server-established live observation.",
        canRetryStatus: true,
        focusBoundary: "none",
      });
      return;
    }
    if (result.data.resourceVersion <= (snapshot.resourceVersion ?? -1)) {
      if (
        result.data.resourceVersion === snapshot.resourceVersion &&
        result.headers.review != null &&
        snapshot.result?.terminal === true
      ) {
        cancelPoll();
        const review = admitReview(result.headers.review);
        publish({
          ...snapshot,
          review,
          message: stageMessage("terminal"),
          canRetryStatus: false,
          focusBoundary: "none",
        });
        armReviewExpiry(review);
        return;
      }
      schedulePoll(token);
      return;
    }
    if (result.data.terminal || result.data.stage === "terminal") {
      if (options.awaitReviewMetadata === true && resumeStarted && result.headers.review == null)
        schedulePoll(token);
      else cancelPoll();
      const review = admitReview(result.headers.review);
      publish({
        ...snapshot,
        status: terminalStatus(result.data),
        resourceVersion: result.data.resourceVersion,
        message: stageMessage("terminal"),
        canRetryStatus: false,
        focusBoundary: operatorOwned ? "terminal" : "none",
        result: result.data,
        review,
      });
      armReviewExpiry(review);
      return;
    }
    pollDelayMs = delay(result);
    const review = admitReview(result.headers.review);
    publish({
      ...snapshot,
      status: result.data.stage,
      resourceVersion: result.data.resourceVersion,
      message: stageMessage(result.data.stage),
      canRetryStatus: false,
      focusBoundary: "none",
      result: result.data,
      review,
    });
    armReviewExpiry(review);
    schedulePoll(token);
  };

  async function poll(token: number): Promise<void> {
    if (disposed || token !== generation || pollInFlight || snapshot.operationId === null) return;
    pollInFlight = true;
    try {
      let result: SimulatorLiveStatusResult;
      try {
        requestAbort = new AbortController();
        result = await options.client.getLiveObservation(snapshot.operationId, {
          signal: requestAbort.signal,
          ...(snapshot.admittedScenarioId === null
            ? {}
            : { scenarioId: snapshot.admittedScenarioId }),
          ...(snapshot.admittedScenarioRevision === null
            ? {}
            : { scenarioRevision: snapshot.admittedScenarioRevision }),
        });
      } catch {
        result = {
          ok: false,
          status: "transport_error",
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        };
      }
      handleStatus(result, token);
    } finally {
      requestAbort = null;
      pollInFlight = false;
    }
  }

  const lifecycle: LiveSimulatorObservation = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async run(permit: string) {
      if (
        disposed ||
        (snapshot.status !== "idle" && snapshot.status !== "submission_error") ||
        permit.length === 0
      )
        return;
      operatorOwned = true;
      const token = ++generation;
      const admittedIdentity = Object.freeze({
        scenarioId: options.scenarioId,
        scenarioRevision: options.scenarioRevision,
      });
      publish({
        ...initialSnapshot(),
        status: "submitting",
        message: "Submitting live observation intent",
        focusBoundary: "submission",
        admittedScenarioId: options.scenarioId,
        admittedScenarioRevision: options.scenarioRevision,
      });
      reviewRevoked = false;
      latchedReview = null;
      cancelExpiry();
      let result: SimulatorLiveRequestResult;
      try {
        result = await options.client.requestLiveObservation({
          scenarioId: options.scenarioId,
          scenarioRevision: options.scenarioRevision,
          permit,
        });
      } catch {
        result = {
          ok: false,
          status: "transport_error",
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        };
      }
      if (result.ok) {
        options.onPermitAccepted?.();
        options.onOperationEstablished?.(
          Object.freeze({ operationId: result.data.operationId, ...admittedIdentity }),
        );
      }
      if (disposed || token !== generation) return;
      if (!result.ok) {
        publish({
          ...snapshot,
          status: "submission_error",
          message: submissionMessage(result),
          canRetryStatus: false,
          focusBoundary: "error",
        });
        return;
      }
      pollDelayMs = delay(result);
      publish({
        ...snapshot,
        status: "scheduled",
        operationId: result.data.operationId,
        resourceVersion: result.data.resourceVersion,
        message: stageMessage("scheduled"),
        focusBoundary: "none",
      });
      schedulePoll(token);
    },
    async retryStatus() {
      if (disposed || snapshot.status !== "status_error") return;
      operatorOwned = true;
      await poll(generation);
    },
    async resume() {
      if (
        disposed ||
        resumeStarted ||
        options.resumeOperation === undefined ||
        options.resumeOperation === null
      ) {
        return;
      }
      resumeStarted = true;
      operatorOwned = false;
      reviewRevoked = false;
      latchedReview = null;
      cancelExpiry();
      const token = ++generation;
      publish({
        ...initialSnapshot(),
        status: "scheduled",
        operationId: options.resumeOperation.operationId,
        resourceVersion: -1,
        message: "Recovering server-established live observation",
        admittedScenarioId: options.resumeOperation.scenarioId,
        admittedScenarioRevision: options.resumeOperation.scenarioRevision,
      });
      await poll(token);
    },
    async finishReview() {
      if (
        disposed ||
        snapshot.review == null ||
        options.client.finishLiveDemoReview === undefined ||
        snapshot.cleanup?.status === "deleting" ||
        snapshot.cleanup?.status === "deleted"
      ) {
        return;
      }
      publish({
        ...snapshot,
        cleanup: Object.freeze({ status: "deleting", message: null }),
        focusBoundary: "none",
      });
      const cleanupToken = generation;
      const cleanupPath = snapshot.review.cleanupPath;
      let result: SimulatorLiveReviewCleanupResult | undefined;
      try {
        result = await options.client.finishLiveDemoReview(cleanupPath);
      } catch {
        result = undefined;
      }
      if (disposed || cleanupToken !== generation) return;
      if (result?.ok === true && result.data.outcome === "deleted") {
        revokeReview("deleted");
        return;
      }
      publish({
        ...snapshot,
        cleanup: Object.freeze({
          status: "attention",
          message: "Cleanup requires attention",
        }),
        focusBoundary: "none",
      });
    },
    attach() {
      attachments += 1;
      void lifecycle.resume();
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        attachments -= 1;
        globalThis.queueMicrotask(() => {
          if (attachments === 0) lifecycle.dispose();
        });
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      cancelPoll();
      cancelExpiry();
      requestAbort?.abort();
      requestAbort = null;
      listeners.clear();
    },
  });

  return lifecycle;
}

export type UseLiveSimulatorObservationOptions = LiveSimulatorObservationOptions;

export function useLiveSimulatorObservation(options: UseLiveSimulatorObservationOptions): Readonly<{
  snapshot: LiveSimulatorObservationSnapshot;
  run(permit: string): Promise<void>;
  retryStatus(): Promise<void>;
  finishReview(): Promise<void>;
}> {
  const lifecycle = useMemo(
    () => createLiveSimulatorObservation(options),
    [
      options.client,
      options.scenarioId,
      options.scenarioRevision,
      options.awaitReviewMetadata,
      options.scheduler,
    ],
  );
  useRef(lifecycle).current = lifecycle;
  useEffect(() => lifecycle.attach(), [lifecycle]);
  return Object.freeze({
    snapshot: useSyncExternalStore(
      lifecycle.subscribe,
      lifecycle.getSnapshot,
      lifecycle.getSnapshot,
    ),
    run: lifecycle.run,
    retryStatus: lifecycle.retryStatus,
    finishReview: lifecycle.finishReview,
  });
}
