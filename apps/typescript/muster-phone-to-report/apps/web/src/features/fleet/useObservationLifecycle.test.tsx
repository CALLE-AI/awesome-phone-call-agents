import type {
  FleetActiveManualOperation,
  FleetEndpoint,
  MusterApiClient,
  ObservationOperationResponse,
  ObservationRequestResult,
  ObservationStatusResult,
} from "@muster/api-client";
import { describe, expect, it, vi } from "vitest";

import {
  createObservationLifecycle,
  type ObservationLifecycle,
  type ObservationLifecycleScheduler,
} from "./useObservationLifecycle.js";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

class ControlledScheduler implements ObservationLifecycleScheduler {
  readonly delays: number[] = [];
  private readonly tasks: Array<{ cancelled: boolean; readonly callback: () => void }> = [];

  schedule(callback: () => void, delayMs: number): () => void {
    const task = { cancelled: false, callback };
    this.delays.push(delayMs);
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  runNext(): void {
    const task = this.tasks.shift();
    if (task !== undefined && !task.cancelled) task.callback();
  }
}

function accepted(operationId = "operation-server-1"): ObservationRequestResult {
  return {
    ok: true,
    status: 202,
    data: {
      contractVersion: "1",
      operationId,
      statusUrl: `/api/v1/observations/${operationId}`,
      stage: "scheduled",
      terminalOutcome: null,
      acceptedAt: "2026-08-08T20:00:00Z",
    },
    headers: { location: `/api/v1/observations/${operationId}`, retryAfterSeconds: 5 },
  };
}

function operation(
  resourceVersion: number,
  stage: ObservationOperationResponse["stage"],
  options: {
    readonly quality?: "complete" | "partial" | "unknown" | "invalid" | null;
    readonly provenance?: "SIMULATED" | "PROVIDER_OBSERVED";
    readonly terminalOutcome?: ObservationOperationResponse["terminalOutcome"];
  } = {},
): ObservationOperationResponse {
  const quality = options.quality === undefined ? null : options.quality;
  const provenance = options.provenance ?? "PROVIDER_OBSERVED";
  const terminal = stage === "terminal";
  return {
    contractVersion: "1",
    operationId: "operation-server-1",
    resourceVersion,
    stage,
    terminal,
    lastTransitionAt: `2026-08-08T20:00:0${String(Math.min(resourceVersion, 9))}Z`,
    latestRevisionAt: quality === null ? null : "2026-08-08T20:00:04Z",
    attempt: {
      trigger: "manual",
      provenance,
      acceptedAt: "2026-08-08T20:00:00Z",
      retryable: terminal ? false : null,
    },
    terminalOutcome: options.terminalOutcome ?? (terminal ? "observation_recorded" : null),
    evidence:
      quality === null
        ? null
        : {
            evidenceId: "evidence-safe-1",
            revision: 1,
            providerRunId: "provider-run-safe-1",
            provenance,
            sourceCompleteness: quality === "complete" ? "complete" : "unknown",
            retainedAt: "2026-08-08T20:00:03Z",
          },
    observation:
      quality === null
        ? null
        : {
            observationId: "observation-safe-1",
            version: 1,
            predecessorObservationId: null,
            quality,
            provenance,
            adapterVersionId: "adapter-safe-1",
            extractorVersionId: "extractor-safe-1",
            reconciliationPolicyVersion: "policy-safe-1",
            evidenceId: "evidence-safe-1",
            readings: [],
            createdAt: "2026-08-08T20:00:04Z",
          },
    recommendedAction: terminal
      ? quality === "complete"
        ? "none"
        : "review_incomplete_evidence"
      : "poll",
  };
}

function statusResult(
  response: ObservationOperationResponse,
  retryAfterSeconds: number | null = 2,
): ObservationStatusResult {
  return {
    ok: true,
    status: 200,
    data: response,
    headers: { location: null, retryAfterSeconds },
  };
}

function activeOperation(
  operationId = "operation-server-1",
  resourceVersion = 1,
  stage: FleetActiveManualOperation["stage"] = "scheduled",
): FleetActiveManualOperation {
  return {
    operationId,
    resourceVersion,
    stage,
    acceptedAt: "2026-08-08T20:00:00Z",
  };
}

function client(input: {
  readonly request?: () => Promise<ObservationRequestResult>;
  readonly status?: (operationId: string) => Promise<ObservationStatusResult>;
}): MusterApiClient {
  return {
    getSystemHealth: vi.fn(),
    getFleetHealth: vi.fn(),
    requestObservation: vi.fn(input.request ?? (async () => accepted())),
    getObservationOperation: vi.fn(
      input.status ?? (async () => statusResult(operation(2, "calling"))),
    ),
  };
}

function lifecycle(input: {
  readonly api: MusterApiClient;
  readonly scheduler?: ControlledScheduler;
  readonly refreshEndpoint?: () => Promise<FleetEndpoint | null>;
}): ObservationLifecycle {
  return createObservationLifecycle({
    endpointId: "endpoint-safe-1",
    client: input.api,
    scheduler: input.scheduler ?? new ControlledScheduler(),
    createRequestIds: () => ({
      idempotencyKey: "fleet-observation-idempotency-1",
      pollWindowId: "fleet-observation-poll-window-1",
    }),
    refreshEndpoint: input.refreshEndpoint ?? (async () => null),
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useObservationLifecycle", () => {
  it("synchronously latches one explicit activation and adopts the accepted server operation", async () => {
    const admission = deferred<ObservationRequestResult>();
    const api = client({ request: () => admission.promise });
    const scheduler = new ControlledScheduler();
    const subject = lifecycle({ api, scheduler });

    const first = subject.run();
    const repeated = subject.run();

    expect(subject.getSnapshot()).toMatchObject({
      status: "admitting",
      actionLabel: "Starting observation…",
      canRun: false,
      operationId: null,
    });
    expect(api.requestObservation).toHaveBeenCalledTimes(1);

    admission.resolve(accepted());
    await Promise.all([first, repeated]);

    expect(subject.getSnapshot()).toMatchObject({
      status: "scheduled",
      message: "Observation queued",
      operationId: "operation-server-1",
      canRun: false,
    });
    expect(scheduler.delays).toEqual([5_000]);
    await subject.run();
    expect(api.requestObservation).toHaveBeenCalledTimes(1);
  });

  it("uses bounded monotonic polling, keeps terminal sticky, and ignores cancelled late work", async () => {
    const responses: ObservationStatusResult[] = [
      statusResult(operation(3, "calling"), 99),
      statusResult(operation(2, "scheduled"), 1),
      statusResult(operation(4, "terminal", { quality: "complete" }), 1),
    ];
    const refreshEndpoint = vi.fn(async () => null);
    const api = client({ status: async () => responses.shift()! });
    const scheduler = new ControlledScheduler();
    const subject = lifecycle({ api, scheduler, refreshEndpoint });

    subject.resume(activeOperation());
    await flush();
    expect(subject.getSnapshot()).toMatchObject({
      status: "calling",
      message: "Calling endpoint",
      resourceVersion: 3,
    });
    expect(scheduler.delays).toEqual([30_000]);

    scheduler.runNext();
    await flush();
    expect(subject.getSnapshot()).toMatchObject({ status: "calling", resourceVersion: 3 });
    expect(scheduler.delays).toEqual([30_000, 30_000]);

    scheduler.runNext();
    await flush();
    expect(subject.getSnapshot()).toMatchObject({
      status: "complete",
      message: "Observation complete",
      resourceVersion: 4,
    });
    expect(refreshEndpoint).toHaveBeenCalledTimes(1);
    await subject.retryStatus();
    expect(api.getObservationOperation).toHaveBeenCalledTimes(3);

    const oldStatus = deferred<ObservationStatusResult>();
    const newStatus = deferred<ObservationStatusResult>();
    const lateApi = client({
      status: vi
        .fn()
        .mockImplementationOnce(() => oldStatus.promise)
        .mockImplementationOnce(() => newStatus.promise),
    });
    const lateRefresh = vi.fn(async () => null);
    const lateSubject = lifecycle({ api: lateApi, refreshEndpoint: lateRefresh });

    lateSubject.resume(activeOperation("operation-old", 1, "calling"));
    lateSubject.resume(activeOperation("operation-new", 5, "extracting"));
    oldStatus.resolve(
      statusResult({
        ...operation(99, "terminal", { quality: "complete" }),
        operationId: "operation-old",
      }),
    );
    await flush();
    expect(lateSubject.getSnapshot()).toMatchObject({
      operationId: "operation-new",
      status: "extracting",
      resourceVersion: 5,
    });

    lateSubject.dispose();
    newStatus.resolve(
      statusResult({
        ...operation(100, "terminal", { quality: "complete" }),
        operationId: "operation-new",
      }),
    );
    await flush();
    expect(lateRefresh).not.toHaveBeenCalled();
  });

  it("resumes the Fleet-projected operation through GET only without requesting focus", async () => {
    const status = deferred<ObservationStatusResult>();
    const api = client({ status: () => status.promise });
    const subject = lifecycle({ api });

    subject.resume(activeOperation("operation-server-1", 7, "calling"));

    expect(subject.getSnapshot()).toMatchObject({
      operationId: "operation-server-1",
      status: "calling",
      message: "Calling endpoint",
      canRun: false,
      focusRequested: false,
      interactionSource: "resumed",
    });
    expect(api.requestObservation).not.toHaveBeenCalled();
    expect(api.getObservationOperation).toHaveBeenCalledWith("operation-server-1");

    status.resolve(statusResult(operation(8, "extracting")));
    await flush();
    expect(subject.getSnapshot()).toMatchObject({
      status: "extracting",
      message: "Interpreting evidence",
      resourceVersion: 8,
      focusRequested: false,
    });
    expect(api.requestObservation).not.toHaveBeenCalled();
  });

  it("maps exact terminal and safe error feedback, preserves SIMULATED, refreshes facts, and never auto-POSTs", async () => {
    const completeRefresh = vi.fn(async () => null);
    const completeApi = client({
      status: async () =>
        statusResult(operation(2, "terminal", { quality: "complete", provenance: "SIMULATED" })),
    });
    const complete = lifecycle({ api: completeApi, refreshEndpoint: completeRefresh });
    complete.resume(activeOperation());
    await flush();
    expect(complete.getSnapshot()).toMatchObject({
      status: "complete",
      message: "Observation complete",
      simulated: true,
    });
    expect(completeRefresh).toHaveBeenCalledTimes(1);

    for (const quality of [null, "partial", "unknown", "invalid"] as const) {
      const api = client({
        status: async () => statusResult(operation(2, "terminal", { quality })),
      });
      const incomplete = lifecycle({ api });
      incomplete.resume(activeOperation());
      await flush();
      expect(incomplete.getSnapshot()).toMatchObject({
        status: "incomplete",
        message: "Observation incomplete—no operational decision made",
      });
    }
  });

  it("reconciles every admission failure before allowing another explicit POST", async () => {
    const cases: ReadonlyArray<readonly [ObservationRequestResult, string]> = [
      [
        {
          ok: false,
          status: 400,
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        },
        "Observation request could not be started",
      ],
      [
        {
          ok: false,
          status: 404,
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        },
        "Endpoint is unavailable or you no longer have access",
      ],
      [
        {
          ok: false,
          status: 409,
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        },
        "Observation could not startâ€”checking current status",
      ],
      [
        { ok: false, status: 503, error: null, headers: { location: null, retryAfterSeconds: 5 } },
        "Observation service is temporarily unavailable",
      ],
      [
        {
          ok: false,
          status: 500,
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        },
        "Observation request could not be confirmed",
      ],
      [
        {
          ok: false,
          status: "transport_error",
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        },
        "Request status unknownâ€”checking Fleet Health",
      ],
    ];

    for (const [failure, message] of cases) {
      const projection = deferred<FleetEndpoint | null>();
      const refreshEndpoint = vi.fn(() => projection.promise);
      const api = client({ request: async () => failure });
      const failed = lifecycle({ api, refreshEndpoint });
      const admission = failed.run();
      await flush();
      expect(failed.getSnapshot()).toMatchObject({
        status: "admission_error",
        message,
        canRun: false,
        focusRequested: true,
        operationId: null,
      });
      await failed.run();
      expect(api.requestObservation).toHaveBeenCalledTimes(1);
      expect(refreshEndpoint).toHaveBeenCalledTimes(1);
      projection.resolve({ activeManualOperation: null } as FleetEndpoint);
      await admission;
      expect(failed.getSnapshot()).toMatchObject({ canRun: true });
    }

    const projectedApi = client({
      request: async () => cases[0]![0],
      status: async () => statusResult(operation(4, "calling")),
    });
    const projected = lifecycle({
      api: projectedApi,
      refreshEndpoint: async () => ({ activeManualOperation: activeOperation() }) as FleetEndpoint,
    });
    await projected.run();
    await flush();
    expect(projectedApi.requestObservation).toHaveBeenCalledTimes(1);
    expect(projectedApi.getObservationOperation).toHaveBeenCalledWith("operation-server-1");
    expect(projected.getSnapshot()).toMatchObject({
      status: "calling",
      canRun: false,
      interactionSource: "resumed",
    });

    const unavailableProjectionApi = client({ request: async () => cases[3]![0] });
    const unavailableProjection = lifecycle({
      api: unavailableProjectionApi,
      refreshEndpoint: async () => Promise.reject(new Error("safe projection failure")),
    });
    await expect(unavailableProjection.run()).resolves.toBeUndefined();
    expect(unavailableProjection.getSnapshot()).toMatchObject({
      status: "admission_error",
      canRun: false,
    });
    await unavailableProjection.run();
    expect(unavailableProjectionApi.requestObservation).toHaveBeenCalledTimes(1);
  });

  it("branches poll failures without losing the accepted version or ever issuing POST", async () => {
    const scheduler = new ControlledScheduler();
    const transientResponses: ObservationStatusResult[] = [
      { ok: false, status: 503, error: null, headers: { location: null, retryAfterSeconds: 99 } },
      statusResult(operation(8, "extracting"), 2),
    ];
    const transientApi = client({ status: async () => transientResponses.shift()! });
    const transient = lifecycle({ api: transientApi, scheduler });
    transient.resume(activeOperation("operation-server-1", 7, "calling"));
    await flush();
    expect(transient.getSnapshot()).toMatchObject({
      status: "poll_error",
      resourceVersion: 7,
      canRun: false,
    });
    expect(scheduler.delays).toEqual([30_000]);
    scheduler.runNext();
    await flush();
    expect(transient.getSnapshot()).toMatchObject({
      status: "extracting",
      message: "Interpreting evidence",
      resourceVersion: 8,
    });
    expect(transientApi.requestObservation).not.toHaveBeenCalled();

    const terminalPollCases: ReadonlyArray<readonly [400 | 404 | 500, string, boolean]> = [
      [400, "Observation status could not be read", false],
      [404, "Observation status unavailable", false],
      [500, "Observation status could not be updated", true],
    ];
    for (const [status, message, canRetryStatus] of terminalPollCases) {
      const refreshEndpoint = vi.fn(async () => null);
      const api = client({
        status: async () => ({
          ok: false,
          status,
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        }),
      });
      const subject = lifecycle({ api, refreshEndpoint });
      subject.resume(activeOperation("operation-server-1", 11, "calling"));
      await flush();
      expect(subject.getSnapshot()).toMatchObject({
        status: "poll_error",
        message,
        resourceVersion: 11,
        canRetryStatus,
        canRun: false,
      });
      expect(refreshEndpoint).toHaveBeenCalledTimes(status === 500 ? 0 : 1);
      expect(api.requestObservation).not.toHaveBeenCalled();
    }

    for (const [status, message] of [
      [400, "Observation status could not be read"],
      [404, "Observation status unavailable"],
    ] as const) {
      const responses: ObservationStatusResult[] = [
        {
          ok: false,
          status,
          error: null,
          headers: { location: null, retryAfterSeconds: null },
        },
        statusResult(operation(12, "calling")),
      ];
      const api = client({ status: async () => responses.shift()! });
      const refreshEndpoint = vi.fn(
        async () =>
          ({
            activeManualOperation: activeOperation("operation-server-1", 11, "calling"),
          }) as FleetEndpoint,
      );
      const subject = lifecycle({ api, refreshEndpoint });

      subject.resume(activeOperation("operation-server-1", 11, "calling"));
      await flush();

      expect(subject.getSnapshot()).toMatchObject({
        status: "poll_error",
        message,
        resourceVersion: 11,
        canRetryStatus: false,
        canRun: false,
      });
      expect(refreshEndpoint).toHaveBeenCalledTimes(1);
      expect(api.getObservationOperation).toHaveBeenCalledTimes(1);
      expect(api.requestObservation).not.toHaveBeenCalled();
    }
  });

  it("requests focus only at an operator-owned terminal or admission-error boundary", async () => {
    const scheduler = new ControlledScheduler();
    const responses = [
      statusResult(operation(1, "calling")),
      statusResult(operation(2, "extracting")),
      statusResult(operation(3, "terminal", { quality: "complete" })),
    ];
    const api = client({ status: async () => responses.shift()! });
    const subject = lifecycle({ api, scheduler });
    await subject.run();
    expect(subject.getSnapshot()).toMatchObject({
      status: "scheduled",
      focusRequested: false,
      interactionSource: "operator",
    });
    scheduler.runNext();
    await flush();
    expect(subject.getSnapshot()).toMatchObject({ status: "calling", focusRequested: false });
    scheduler.runNext();
    await flush();
    expect(subject.getSnapshot()).toMatchObject({ status: "extracting", focusRequested: false });
    scheduler.runNext();
    await flush();
    expect(subject.getSnapshot()).toMatchObject({ status: "complete", focusRequested: true });

    const resumedApi = client({
      status: async () => statusResult(operation(8, "terminal", { quality: "complete" })),
    });
    const resumed = lifecycle({ api: resumedApi });
    resumed.resume(activeOperation("operation-server-1", 7, "extracting"));
    await flush();
    expect(resumed.getSnapshot()).toMatchObject({
      status: "complete",
      focusRequested: false,
      interactionSource: "resumed",
    });

    const rejectedApi = client({
      request: async () => ({
        ok: false,
        status: 400,
        error: null,
        headers: { location: null, retryAfterSeconds: null },
      }),
    });
    const rejected = lifecycle({ api: rejectedApi });
    await rejected.run();
    expect(rejected.getSnapshot()).toMatchObject({
      status: "admission_error",
      focusRequested: true,
    });
  });
});
