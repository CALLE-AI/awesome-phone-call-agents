import { describe, expect, it, vi } from "vitest";

import { createLiveSimulatorObservation } from "./useLiveSimulatorObservation.js";

type ResumableLifecycle = ReturnType<typeof createLiveSimulatorObservation> & {
  resume(): Promise<void>;
  finishReview(): Promise<void>;
};

const accepted = {
  ok: true as const,
  status: 202 as const,
  data: {
    operationId: "operation-live-001",
    resourceVersion: 0,
    statusLocation: "/api/v1/live-simulator/operations/operation-live-001",
  },
  headers: {
    location: "/api/v1/live-simulator/operations/operation-live-001",
    retryAfterSeconds: 1,
  },
};

function scheduledProjection() {
  return {
    ok: true as const,
    status: 200 as const,
    data: {
      operationId: "operation-live-001",
      resourceVersion: 1,
      stage: "scheduled" as const,
      terminal: false,
      terminalOutcome: null,
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      provenance: "SIMULATED" as const,
      transcript: [],
      evidence: null,
      readings: [],
      reconciliation: [],
      auxiliaryStatus: null,
      predecessorOperationId: null,
    },
    headers: { location: null, retryAfterSeconds: 1 },
  };
}

function terminalReviewProjection(reviewExpiresAt: string) {
  return {
    ...scheduledProjection(),
    data: {
      ...scheduledProjection().data,
      resourceVersion: 4,
      stage: "terminal" as const,
      terminal: true,
      terminalOutcome: "observation_recorded" as const,
      transcript: [{ speaker: "device" as const, text: "Synthetic protected transcript." }],
      evidence: { quality: "complete" as const, opaqueReference: "opaque-custody" },
      readings: ["1", "2", "3", "4"].map((zone) => ({
        zoneId: `zone-${zone}`,
        label: `Zone ${zone}`,
        value: "70",
        unit: "F",
        status: "OK" as const,
        disposition: "grounded" as const,
      })),
      reconciliation: ["1", "2", "3", "4"].map((zone) => ({
        zoneId: `zone-${zone}`,
        disposition: "matched" as const,
      })),
      auxiliaryStatus: {
        sound: "normal" as const,
        power: "mains_available" as const,
        battery: "normal" as const,
        output: "off" as const,
      },
    },
    headers: {
      location: null,
      retryAfterSeconds: null,
      review: {
        capabilityClosed: true as const,
        reviewReadyAt: "2026-09-02T12:00:00.000Z",
        reviewExpiresAt,
        cleanupPath: "/api/v1/live-demo-review/sessions/review-session-001",
      },
    },
  };
}

const scheduler = { schedule: vi.fn(() => () => undefined) };

describe("live lifecycle review regressions", () => {
  it("continues exact GET recovery after terminal until same-version review readiness arrives", async () => {
    const callbacks: Array<() => void> = [];
    const terminal = {
      ...scheduledProjection(),
      data: {
        ...scheduledProjection().data,
        resourceVersion: 4,
        stage: "terminal" as const,
        terminal: true,
        terminalOutcome: "provider_failed" as const,
      },
      headers: { location: null, retryAfterSeconds: 1 },
    };
    const review = {
      ...terminal,
      headers: {
        location: null,
        retryAfterSeconds: null,
        review: {
          capabilityClosed: true as const,
          reviewReadyAt: "2099-09-02T12:00:00.000Z",
          reviewExpiresAt: "2099-09-02T12:30:00.000Z",
          cleanupPath: "/api/v1/live-demo-review/sessions/review-session-001",
        },
      },
    };
    const getLiveObservation = vi
      .fn()
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(review);
    const requestLiveObservation = vi.fn();
    const lifecycle = createLiveSimulatorObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      resumeOperation: {
        operationId: "operation-live-001",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
      },
      awaitReviewMetadata: true,
      client: { requestLiveObservation, getLiveObservation },
      scheduler: {
        schedule: (callback) => {
          callbacks.push(callback);
          return () => undefined;
        },
      },
    }) as ResumableLifecycle;

    await lifecycle.resume();
    expect(lifecycle.getSnapshot()).toMatchObject({ status: "incomplete", review: null });
    callbacks.shift()?.();
    await vi.waitFor(() => expect(getLiveObservation).toHaveBeenCalledTimes(2));
    expect(lifecycle.getSnapshot()).toMatchObject({
      status: "incomplete",
      resourceVersion: 4,
      review: { capabilityClosed: true, reviewExpiresAt: "2099-09-02T12:30:00.000Z" },
    });
    expect(requestLiveObservation).not.toHaveBeenCalled();
  });

  it("accepts only increasing exact GET projections across retry and reconnect polling", async () => {
    const callbacks: Array<() => void> = [];
    const version = (resourceVersion: number) => ({
      ...scheduledProjection(),
      data: { ...scheduledProjection().data, resourceVersion },
    });
    const getLiveObservation = vi
      .fn()
      .mockResolvedValueOnce(version(3))
      .mockResolvedValueOnce(version(2))
      .mockResolvedValueOnce(version(4));
    const lifecycle = createLiveSimulatorObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      resumeOperation: {
        operationId: "operation-live-001",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
      },
      client: { requestLiveObservation: vi.fn(), getLiveObservation },
      scheduler: {
        schedule: (callback) => {
          callbacks.push(callback);
          return () => undefined;
        },
      },
    }) as ResumableLifecycle;

    await lifecycle.resume();
    expect(lifecycle.getSnapshot().resourceVersion).toBe(3);
    callbacks.shift()?.();
    await vi.waitFor(() => expect(getLiveObservation).toHaveBeenCalledTimes(2));
    expect(lifecycle.getSnapshot().resourceVersion).toBe(3);
    callbacks.shift()?.();
    await vi.waitFor(() => expect(getLiveObservation).toHaveBeenCalledTimes(3));
    expect(lifecycle.getSnapshot().resourceVersion).toBe(4);
    expect(getLiveObservation.mock.calls).toEqual([
      [
        "operation-live-001",
        expect.objectContaining({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
      ],
      [
        "operation-live-001",
        expect.objectContaining({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
      ],
      [
        "operation-live-001",
        expect.objectContaining({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
      ],
    ]);
  });

  it.each([
    ["deleted", "Protected demo result deleted", true],
    ["blocked", "Cleanup requires attention", false],
  ] as const)(
    "reports truthful %s Finish cleanup with protected state retained only when cleanup is blocked",
    async (outcome, message, deleted) => {
      const onReviewDeleted = vi.fn();
      const finishLiveDemoReview = vi.fn(async () =>
        outcome === "deleted"
          ? {
              ok: true as const,
              status: 200 as const,
              data: { outcome, message },
              headers: { location: null, retryAfterSeconds: null },
            }
          : {
              ok: false as const,
              status: 503 as const,
              error: { code: "dependency_unavailable" as const, message },
              headers: { location: null, retryAfterSeconds: null },
            },
      );
      const terminal = {
        ...scheduledProjection(),
        data: {
          ...scheduledProjection().data,
          resourceVersion: 4,
          stage: "terminal" as const,
          terminal: true,
          terminalOutcome: "provider_failed" as const,
        },
        headers: {
          location: null,
          retryAfterSeconds: null,
          review: {
            capabilityClosed: true as const,
            reviewReadyAt: "2099-09-02T12:00:00.000Z",
            reviewExpiresAt: "2099-09-02T12:30:00.000Z",
            cleanupPath: "/api/v1/live-demo-review/sessions/review-session-001",
          },
        },
      };
      const lifecycle = createLiveSimulatorObservation({
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        resumeOperation: {
          operationId: "operation-live-001",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
        },
        client: {
          requestLiveObservation: vi.fn(),
          getLiveObservation: vi.fn(async () => terminal),
          finishLiveDemoReview,
        },
        scheduler,
        onReviewDeleted,
      }) as ResumableLifecycle;

      await lifecycle.resume();
      await lifecycle.finishReview();

      expect(finishLiveDemoReview).toHaveBeenCalledWith(
        "/api/v1/live-demo-review/sessions/review-session-001",
      );
      expect(lifecycle.getSnapshot()).toMatchObject({
        operationId: deleted ? null : "operation-live-001",
        cleanup: { status: deleted ? "deleted" : "attention", message },
      });
      expect(onReviewDeleted).toHaveBeenCalledTimes(deleted ? 1 : 0);
    },
  );

  it("keeps construction side-effect free and begins resume GET only when mounted", async () => {
    const requestLiveObservation = vi.fn();
    const getLiveObservation = vi.fn().mockResolvedValue(scheduledProjection());
    const lifecycle = createLiveSimulatorObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      resumeOperation: {
        operationId: "operation-live-001",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
      },
      client: { requestLiveObservation, getLiveObservation },
      scheduler,
    }) as ResumableLifecycle;

    expect(getLiveObservation).not.toHaveBeenCalled();
    expect(lifecycle.getSnapshot()).toMatchObject({ status: "idle", operationId: null });
    await lifecycle.resume();
    expect(getLiveObservation).toHaveBeenCalledOnce();
    expect(requestLiveObservation).not.toHaveBeenCalled();
  });

  it("aborts a pending resume GET on actual disposal", async () => {
    let signal: AbortSignal | undefined;
    const getLiveObservation = vi.fn(
      async (_operationId: string, options?: { readonly signal?: AbortSignal }) => {
        signal = options?.signal;
        return await new Promise<ReturnType<typeof scheduledProjection>>(() => undefined);
      },
    );
    const lifecycle = createLiveSimulatorObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      resumeOperation: {
        operationId: "operation-live-001",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
      },
      client: { requestLiveObservation: vi.fn(), getLiveObservation },
      scheduler,
    }) as ResumableLifecycle;

    void lifecycle.resume();
    await vi.waitFor(() => expect(getLiveObservation).toHaveBeenCalledOnce());
    lifecycle.dispose();
    expect(signal?.aborted).toBe(true);
  });

  it("clears the accepted permit and stores server identity even when scenario selection changes", async () => {
    let resolvePost: ((value: typeof accepted) => void) | undefined;
    const clearPermit = vi.fn();
    const storeOperation = vi.fn();
    const lifecycle = createLiveSimulatorObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      client: {
        requestLiveObservation: vi.fn(
          async () =>
            await new Promise<typeof accepted>((resolve) => {
              resolvePost = resolve;
            }),
        ),
        getLiveObservation: vi.fn(),
      },
      scheduler,
      onPermitAccepted: clearPermit,
      onOperationEstablished: storeOperation,
    });

    const pending = lifecycle.run("one-use-permit");
    lifecycle.dispose();
    resolvePost?.(accepted);
    await pending;

    expect(clearPermit).toHaveBeenCalledOnce();
    expect(storeOperation).toHaveBeenCalledWith({
      operationId: "operation-live-001",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
    });
    expect(lifecycle.getSnapshot()).toMatchObject({ status: "submitting", operationId: null });
  });

  it("locks the admitted scenario and mode while a POST is pending", async () => {
    let resolvePost: ((value: typeof accepted) => void) | undefined;
    const requestLiveObservation = vi.fn(
      async () =>
        await new Promise<typeof accepted>((resolve) => {
          resolvePost = resolve;
        }),
    );
    const lifecycle = createLiveSimulatorObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      client: { requestLiveObservation, getLiveObservation: vi.fn() },
      scheduler,
    });

    const pending = lifecycle.run("one-use-permit");
    expect(lifecycle.getSnapshot()).toMatchObject({
      status: "submitting",
      admittedScenarioId: "synthetic-normal",
      admittedScenarioRevision: 2,
    });
    await lifecycle.run("second-permit");
    expect(requestLiveObservation).toHaveBeenCalledOnce();
    resolvePost?.(accepted);
    await pending;
  });

  it("revokes protected browser state exactly at the immutable review expiry boundary", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));
      const onReviewDeleted = vi.fn();
      const terminal = terminalReviewProjection("2026-09-02T12:30:00.000Z");
      const lifecycle = createLiveSimulatorObservation({
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        resumeOperation: {
          operationId: "operation-live-001",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
        },
        awaitReviewMetadata: true,
        client: {
          requestLiveObservation: vi.fn(),
          getLiveObservation: vi.fn(async () => terminal),
        },
        onReviewDeleted,
      }) as ResumableLifecycle;

      await lifecycle.resume();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1_000 - 1);
      expect(lifecycle.getSnapshot()).toMatchObject({
        status: "complete",
        operationId: "operation-live-001",
        review: { reviewExpiresAt: "2026-09-02T12:30:00.000Z" },
      });
      expect(lifecycle.getSnapshot().result?.transcript).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(lifecycle.getSnapshot()).toMatchObject({
        status: "expired",
        operationId: null,
        resourceVersion: null,
        result: null,
        review: null,
        admittedScenarioId: null,
        admittedScenarioRevision: null,
        cleanup: { status: "expired", message: "Protected demo result expired" },
      });
      expect(onReviewDeleted).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(lifecycle.getSnapshot().cleanup).toEqual({
        status: "expired",
        message: "Protected demo result expired",
      });
      expect(onReviewDeleted).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("converges a concurrent Finish request with TTL revocation without restoring protected state", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-02T12:29:59.999Z"));
      let resolveFinish!: (value: {
        readonly ok: true;
        readonly status: 200;
        readonly data: {
          readonly outcome: "deleted";
          readonly message: "Protected demo result deleted";
        };
        readonly headers: { readonly location: null; readonly retryAfterSeconds: null };
      }) => void;
      const finishLiveDemoReview = vi.fn(
        async () =>
          await new Promise<Parameters<typeof resolveFinish>[0]>((resolve) => {
            resolveFinish = resolve;
          }),
      );
      const onReviewDeleted = vi.fn();
      const lifecycle = createLiveSimulatorObservation({
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        resumeOperation: {
          operationId: "operation-live-001",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
        },
        awaitReviewMetadata: true,
        client: {
          requestLiveObservation: vi.fn(),
          getLiveObservation: vi.fn(async () =>
            terminalReviewProjection("2026-09-02T12:30:00.000Z"),
          ),
          finishLiveDemoReview,
        },
        onReviewDeleted,
      }) as ResumableLifecycle;

      await lifecycle.resume();
      const finishing = lifecycle.finishReview();
      expect(lifecycle.getSnapshot().cleanup?.status).toBe("deleting");
      await vi.advanceTimersByTimeAsync(1);
      expect(lifecycle.getSnapshot()).toMatchObject({
        status: "expired",
        operationId: null,
        result: null,
        review: null,
      });
      resolveFinish({
        ok: true,
        status: 200,
        data: { outcome: "deleted", message: "Protected demo result deleted" },
        headers: { location: null, retryAfterSeconds: null },
      });
      await finishing;

      expect(finishLiveDemoReview).toHaveBeenCalledOnce();
      expect(lifecycle.getSnapshot()).toMatchObject({
        status: "expired",
        operationId: null,
        result: null,
        review: null,
      });
      expect(onReviewDeleted).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("relatches after submission error, keeps one POST in flight, and bounds identity mismatch as a status error", async () => {
    let resolveRetry: ((value: typeof accepted) => void) | undefined;
    const requestLiveObservation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: {
          code: "authorization_invalid",
          message: "Permit rejected. Mint a fresh scenario-bound permit.",
        },
        headers: { location: null, retryAfterSeconds: null },
      })
      .mockImplementationOnce(
        async () =>
          await new Promise<typeof accepted>((resolve) => {
            resolveRetry = resolve;
          }),
      );
    const mismatch = scheduledProjection();
    const getLiveObservation = vi.fn().mockResolvedValue({
      ...mismatch,
      data: { ...mismatch.data, operationId: "operation-other-001" },
    });
    const scheduledCallbacks: Array<() => void> = [];
    const lifecycle = createLiveSimulatorObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      client: { requestLiveObservation, getLiveObservation },
      scheduler: {
        schedule: (callback) => {
          scheduledCallbacks.push(callback);
          return () => undefined;
        },
      },
    });

    await lifecycle.run("expired-permit");
    expect(lifecycle.getSnapshot().status).toBe("submission_error");
    const retry = lifecycle.run("fresh-permit");
    await lifecycle.run("duplicate-permit");
    expect(requestLiveObservation).toHaveBeenCalledTimes(2);
    resolveRetry?.(accepted);
    await retry;
    scheduledCallbacks.shift()?.();
    await vi.waitFor(() => expect(getLiveObservation).toHaveBeenCalledOnce());
    expect(lifecycle.getSnapshot()).toMatchObject({ status: "status_error", canRetryStatus: true });
  });
});
