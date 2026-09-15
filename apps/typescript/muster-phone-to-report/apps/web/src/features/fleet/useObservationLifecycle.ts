import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
  FleetActiveManualOperation,
  FleetEndpoint,
  MusterApiClient,
  ObservationOperationResponse,
  ObservationRequestResult,
  ObservationStatusResult,
} from "@muster/api-client";

export const OBSERVATION_INCOMPLETE_MESSAGE = "Observation incomplete—no operational decision made";

export type ObservationLifecycleStatus =
  | "idle"
  | "admitting"
  | "scheduled"
  | "calling"
  | "extracting"
  | "complete"
  | "incomplete"
  | "admission_error"
  | "poll_error";

export interface ObservationLifecycleSnapshot {
  readonly status: ObservationLifecycleStatus;
  readonly message: string | null;
  readonly actionLabel: string;
  readonly canRun: boolean;
  readonly canRetryStatus: boolean;
  readonly operationId: string | null;
  readonly resourceVersion: number | null;
  readonly simulated: boolean;
  readonly focusRequested: boolean;
  readonly interactionSource: "idle" | "operator" | "resumed";
  readonly result: ObservationOperationResponse | null;
}

export interface ObservationLifecycleScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface ObservationLifecycle {
  getSnapshot(): ObservationLifecycleSnapshot;
  subscribe(listener: () => void): () => void;
  run(): Promise<void>;
  resume(operation: FleetActiveManualOperation): void;
  retryStatus(): Promise<void>;
  dispose(): void;
}

export interface ObservationLifecycleOptions {
  readonly endpointId: string;
  readonly client: MusterApiClient;
  readonly scheduler?: ObservationLifecycleScheduler;
  readonly createRequestIds?: () => Readonly<{
    idempotencyKey: string;
    pollWindowId: string;
  }>;
  readonly refreshEndpoint: () => Promise<FleetEndpoint | null>;
  readonly simulated?: boolean;
}

const DEFAULT_POLL_DELAY_MS = 5_000;
const MIN_POLL_DELAY_MS = 1_000;
const MAX_POLL_DELAY_MS = 30_000;

const browserScheduler: ObservationLifecycleScheduler = {
  schedule(callback, delayMs) {
    const timer = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(timer);
  },
};

function createRequestIds(): Readonly<{ idempotencyKey: string; pollWindowId: string }> {
  return {
    idempotencyKey: `fleet-observation-${globalThis.crypto.randomUUID()}`,
    pollWindowId: `fleet-poll-${globalThis.crypto.randomUUID()}`,
  };
}

function boundedDelay(seconds: number | null, fallbackMs: number): number {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
  return Math.min(MAX_POLL_DELAY_MS, Math.max(MIN_POLL_DELAY_MS, seconds * 1_000));
}

function stageMessage(stage: FleetActiveManualOperation["stage"]): string {
  switch (stage) {
    case "scheduled":
      return "Observation queued";
    case "calling":
      return "Calling endpoint";
    case "extracting":
      return "Interpreting evidence";
  }
}

function isSimulated(response: ObservationOperationResponse): boolean {
  return (
    response.attempt.provenance === "SIMULATED" ||
    response.evidence?.provenance === "SIMULATED" ||
    response.observation?.provenance === "SIMULATED"
  );
}

function admissionFailureMessage(result: Exclude<ObservationRequestResult, { ok: true }>): string {
  switch (result.status) {
    case 400:
      return "Observation request could not be started";
    case 404:
      return "Endpoint is unavailable or you no longer have access";
    case 409:
      return "Observation could not startâ€”checking current status";
    case 503:
      return "Observation service is temporarily unavailable";
    case 500:
      return "Observation request could not be confirmed";
    case "transport_error":
      return "Request status unknownâ€”checking Fleet Health";
  }
}

function initialSnapshot(simulated: boolean): ObservationLifecycleSnapshot {
  return Object.freeze({
    status: "idle",
    message: null,
    actionLabel: "Run observation",
    canRun: true,
    canRetryStatus: false,
    operationId: null,
    resourceVersion: null,
    simulated,
    focusRequested: false,
    interactionSource: "idle",
    result: null,
  });
}

export function createObservationLifecycle(
  options: ObservationLifecycleOptions,
): ObservationLifecycle {
  const scheduler = options.scheduler ?? browserScheduler;
  const requestIds = options.createRequestIds ?? createRequestIds;
  const listeners = new Set<() => void>();
  let snapshot = initialSnapshot(options.simulated ?? false);
  let cancelScheduled: (() => void) | null = null;
  let generation = 0;
  let disposed = false;
  let pollInFlight = false;
  let pollDelayMs = DEFAULT_POLL_DELAY_MS;

  const publish = (next: ObservationLifecycleSnapshot): void => {
    if (disposed) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const cancelTimer = (): void => {
    cancelScheduled?.();
    cancelScheduled = null;
  };

  const schedulePoll = (token: number): void => {
    cancelTimer();
    cancelScheduled = scheduler.schedule(() => {
      cancelScheduled = null;
      void poll(token);
    }, pollDelayMs);
  };

  const acceptTerminal = async (
    response: ObservationOperationResponse,
    token: number,
  ): Promise<void> => {
    const complete =
      response.terminalOutcome === "observation_recorded" &&
      response.observation?.quality === "complete";
    publish({
      ...snapshot,
      status: complete ? "complete" : "incomplete",
      message: complete ? "Observation complete" : OBSERVATION_INCOMPLETE_MESSAGE,
      actionLabel: "Run observation",
      canRun: false,
      canRetryStatus: false,
      resourceVersion: response.resourceVersion,
      simulated: snapshot.simulated || isSimulated(response),
      focusRequested: snapshot.interactionSource === "operator",
      result: response,
    });
    const refreshed = await options.refreshEndpoint();
    if (disposed || token !== generation) return;
    if (refreshed !== null && refreshed.activeManualOperation === null) {
      publish({ ...snapshot, canRun: true });
      return;
    }
    if (
      refreshed?.activeManualOperation !== null &&
      refreshed?.activeManualOperation !== undefined
    ) {
      // A newer server-projected operation is the only authority allowed to replace this identity.
      if (refreshed.activeManualOperation.operationId !== response.operationId) {
        lifecycle.resume(refreshed.activeManualOperation);
      }
    }
  };

  const handleStatus = async (
    result: ObservationStatusResult,
    operationId: string,
    token: number,
  ): Promise<void> => {
    if (disposed || token !== generation || snapshot.operationId !== operationId) return;
    if (!result.ok) {
      const transient = result.status === 503 || result.status === "transport_error";
      const message =
        result.status === 400
          ? "Observation status could not be read"
          : result.status === 404
            ? "Observation status unavailable"
            : result.status === 500
              ? "Observation status could not be updated"
              : "Status check interrupted. No new result has been confirmed.";
      publish({
        ...snapshot,
        status: "poll_error",
        message,
        actionLabel: "Observation in progress",
        canRun: false,
        canRetryStatus: transient || result.status === 500,
        focusRequested: false,
      });
      if (transient) {
        const backoffMs = Math.min(
          MAX_POLL_DELAY_MS,
          Math.max(DEFAULT_POLL_DELAY_MS, pollDelayMs * 2),
        );
        pollDelayMs = boundedDelay(result.headers.retryAfterSeconds, backoffMs);
        schedulePoll(token);
        return;
      }
      if (result.status === 400 || result.status === 404) {
        try {
          // Refresh Fleet facts without reattaching this failed status read; only a later
          // server-projected prop transition may establish an operation to resume.
          await options.refreshEndpoint();
        } catch {
          // The safe status error remains authoritative when Fleet reconciliation is unavailable.
        }
      }
      return;
    }
    const response = result.data;
    if (response.operationId !== operationId) return;
    const currentVersion = snapshot.resourceVersion ?? -1;
    if (response.resourceVersion <= currentVersion) {
      if (snapshot.status !== "complete" && snapshot.status !== "incomplete") schedulePoll(token);
      return;
    }
    if (response.stage === "terminal" || response.terminal) {
      cancelTimer();
      await acceptTerminal(response, token);
      return;
    }
    pollDelayMs = boundedDelay(result.headers.retryAfterSeconds, pollDelayMs);
    publish({
      ...snapshot,
      status: response.stage,
      message: stageMessage(response.stage),
      actionLabel: "Observation in progress",
      canRun: false,
      canRetryStatus: false,
      resourceVersion: response.resourceVersion,
      simulated: snapshot.simulated || isSimulated(response),
      focusRequested: false,
      result: response,
    });
    schedulePoll(token);
  };

  async function poll(token: number): Promise<void> {
    if (disposed || token !== generation || pollInFlight) return;
    const operationId = snapshot.operationId;
    if (
      operationId === null ||
      snapshot.status === "complete" ||
      snapshot.status === "incomplete"
    ) {
      return;
    }
    pollInFlight = true;
    try {
      let result: ObservationStatusResult;
      try {
        result = await options.client.getObservationOperation(operationId);
      } catch {
        result = {
          ok: false,
          status: "transport_error",
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        };
      }
      await handleStatus(result, operationId, token);
    } finally {
      pollInFlight = false;
    }
  }

  const lifecycle: ObservationLifecycle = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async run() {
      if (!snapshot.canRun || disposed) return;
      cancelTimer();
      const token = ++generation;
      const ids = requestIds();
      publish({
        ...snapshot,
        status: "admitting",
        message: "Starting observation…",
        actionLabel: "Starting observation…",
        canRun: false,
        canRetryStatus: false,
        operationId: null,
        resourceVersion: null,
        focusRequested: false,
        interactionSource: "operator",
        result: null,
      });
      let result: ObservationRequestResult;
      try {
        result = await options.client.requestObservation({
          endpointId: options.endpointId,
          ...ids,
        });
      } catch {
        result = {
          ok: false,
          status: "transport_error",
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        };
      }
      if (disposed || token !== generation) return;
      if (!result.ok) {
        publish({
          ...snapshot,
          status: "admission_error",
          message: admissionFailureMessage(result),
          actionLabel: "Observation unavailable",
          canRun: false,
          canRetryStatus: false,
          operationId: null,
          resourceVersion: null,
          focusRequested: true,
          result: null,
        });
        try {
          const refreshed = await options.refreshEndpoint();
          if (disposed || token !== generation) return;
          if (
            refreshed?.activeManualOperation !== null &&
            refreshed?.activeManualOperation !== undefined
          ) {
            lifecycle.resume(refreshed.activeManualOperation);
          } else if (refreshed !== null) {
            publish({
              ...snapshot,
              actionLabel: "Retry observation",
              canRun: true,
            });
          }
        } catch {
          // Admission stays latched when Fleet cannot establish that no operation exists.
        }
        return;
      }
      pollDelayMs = boundedDelay(result.headers.retryAfterSeconds, DEFAULT_POLL_DELAY_MS);
      publish({
        ...snapshot,
        status: "scheduled",
        message: "Observation queued",
        actionLabel: "Observation in progress",
        canRun: false,
        canRetryStatus: false,
        operationId: result.data.operationId,
        resourceVersion: 0,
        focusRequested: false,
        result: null,
      });
      schedulePoll(token);
    },
    resume(operation) {
      if (disposed) return;
      cancelTimer();
      const token = ++generation;
      pollInFlight = false;
      pollDelayMs = DEFAULT_POLL_DELAY_MS;
      publish({
        ...initialSnapshot(snapshot.simulated),
        status: operation.stage,
        message: stageMessage(operation.stage),
        actionLabel: "Observation in progress",
        canRun: false,
        operationId: operation.operationId,
        resourceVersion: operation.resourceVersion,
        interactionSource: "resumed",
      });
      void poll(token);
    },
    async retryStatus() {
      if (snapshot.status !== "poll_error" || disposed) return;
      cancelTimer();
      await poll(generation);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      cancelTimer();
      listeners.clear();
    },
  };
  return lifecycle;
}

export interface UseObservationLifecycleOptions extends ObservationLifecycleOptions {
  readonly activeManualOperation: FleetActiveManualOperation | null;
}

export interface ObservationLifecycleController {
  readonly snapshot: ObservationLifecycleSnapshot;
  readonly run: () => Promise<void>;
  readonly retryStatus: () => Promise<void>;
}

export function useObservationLifecycle(
  options: UseObservationLifecycleOptions,
): ObservationLifecycleController {
  const lifecycle = useMemo(
    () => createObservationLifecycle(options),
    [options.client, options.endpointId, options.refreshEndpoint, options.scheduler],
  );
  const currentLifecycle = useRef(lifecycle);
  const setupVersion = useRef(0);
  currentLifecycle.current = lifecycle;
  useEffect(() => {
    const active = options.activeManualOperation;
    if (active !== null) {
      const current = lifecycle.getSnapshot();
      if (
        current.operationId !== active.operationId ||
        (current.resourceVersion ?? -1) < active.resourceVersion
      ) {
        lifecycle.resume(active);
      }
    }
  }, [
    lifecycle,
    options.activeManualOperation?.operationId,
    options.activeManualOperation?.resourceVersion,
    options.activeManualOperation?.stage,
  ]);
  useEffect(() => {
    const version = ++setupVersion.current;
    return () => {
      globalThis.queueMicrotask(() => {
        if (currentLifecycle.current !== lifecycle || setupVersion.current === version) {
          lifecycle.dispose();
        }
      });
    };
  }, [lifecycle]);
  return {
    snapshot: useSyncExternalStore(
      lifecycle.subscribe,
      lifecycle.getSnapshot,
      lifecycle.getSnapshot,
    ),
    run: lifecycle.run,
    retryStatus: lifecycle.retryStatus,
  };
}
