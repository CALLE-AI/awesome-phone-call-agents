import { describe, expect, it, vi } from "vitest";

interface LifecycleModule {
  readonly createLiveSimulatorObservation: (options: Record<string, unknown>) => {
    getSnapshot(): Record<string, unknown>;
    run(permit: string): Promise<void>;
    retryStatus(): Promise<void>;
    attach(): () => void;
    dispose(): void;
  };
}

async function loadLifecycle(): Promise<Partial<LifecycleModule>> {
  const moduleUrl = new URL("./useLiveSimulatorObservation.ts", import.meta.url).href;
  try {
    return (await import(/* @vite-ignore */ moduleUrl)) as Partial<LifecycleModule>;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/iu.test(error.message)) {
      return {};
    }
    throw error;
  }
}

const accepted = {
  ok: true,
  status: 202,
  data: { operationId: "operation-live-001", resourceVersion: 0 },
  headers: {
    location: "/api/v1/live-simulator/operations/operation-live-001",
    retryAfterSeconds: 1,
  },
};

function projection(resourceVersion: number, stage: string, terminal = false) {
  return {
    ok: true,
    status: 200,
    data: {
      operationId: "operation-live-001",
      resourceVersion,
      stage,
      terminal,
      terminalOutcome: terminal ? "observation_recorded" : null,
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      provenance: "SIMULATED",
      transcript: [],
      evidence: terminal ? { quality: "complete", opaqueReference: "custody-ref-001" } : null,
      readings: [],
      reconciliation: [],
      predecessorOperationId: null,
    },
    headers: { location: null, retryAfterSeconds: 1 },
  };
}

describe("Simulator Lab live lifecycle", () => {
  it("synchronously latches one POST and accepts only strictly increasing server projections", async () => {
    const api = await loadLifecycle();
    expect(api.createLiveSimulatorObservation).toBeTypeOf("function");
    let resolvePost: ((value: typeof accepted) => void) | undefined;
    const requestLiveObservation = vi.fn(
      async () =>
        await new Promise<typeof accepted>((resolve) => {
          resolvePost = resolve;
        }),
    );
    const getLiveObservation = vi
      .fn()
      .mockResolvedValueOnce(projection(2, "calling"))
      .mockResolvedValueOnce(projection(1, "scheduled"))
      .mockResolvedValueOnce({
        ok: false,
        status: "transport_error",
        error: null,
        headers: { location: null, retryAfterSeconds: null },
      })
      .mockResolvedValueOnce(projection(3, "terminal", true));
    const scheduled: Array<() => void> = [];
    const clearPermit = vi.fn();
    const lifecycle = api.createLiveSimulatorObservation?.({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      client: { requestLiveObservation, getLiveObservation },
      scheduler: { schedule: (callback: () => void) => (scheduled.push(callback), () => {}) },
      onPermitAccepted: clearPermit,
    });

    const first = lifecycle?.run("one-use-permit");
    const duplicate = lifecycle?.run("one-use-permit");
    expect(requestLiveObservation).toHaveBeenCalledTimes(1);
    expect(lifecycle?.getSnapshot()).toMatchObject({ status: "submitting" });
    resolvePost?.(accepted);
    await Promise.all([first, duplicate]);
    expect(clearPermit).toHaveBeenCalledOnce();
    expect(lifecycle?.getSnapshot()).toMatchObject({
      status: "scheduled",
      operationId: "operation-live-001",
      resourceVersion: 0,
    });

    scheduled.shift()?.();
    await vi.waitFor(() =>
      expect(lifecycle?.getSnapshot()).toMatchObject({ status: "calling", resourceVersion: 2 }),
    );
    scheduled.shift()?.();
    await vi.waitFor(() => expect(getLiveObservation).toHaveBeenCalledTimes(2));
    expect(lifecycle?.getSnapshot()).toMatchObject({ status: "calling", resourceVersion: 2 });
    scheduled.shift()?.();
    await vi.waitFor(() =>
      expect(lifecycle?.getSnapshot()).toMatchObject({
        status: "status_error",
        resourceVersion: 2,
        canRetryStatus: true,
      }),
    );
    await lifecycle?.retryStatus();
    expect(lifecycle?.getSnapshot()).toMatchObject({ status: "complete", resourceVersion: 3 });
  });

  it("recovers a remounted operation with GET only and never reconstructs mutation intent", async () => {
    const api = await loadLifecycle();
    expect(api.createLiveSimulatorObservation).toBeTypeOf("function");
    const requestLiveObservation = vi.fn();
    const getLiveObservation = vi.fn().mockResolvedValue(projection(4, "terminal", true));
    const lifecycle = api.createLiveSimulatorObservation?.({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      resumeOperation: {
        operationId: "operation-live-001",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
      },
      client: { requestLiveObservation, getLiveObservation },
      scheduler: { schedule: (callback: () => void) => (queueMicrotask(callback), () => {}) },
    });
    const detach = lifecycle?.attach();

    await vi.waitFor(() =>
      expect(lifecycle?.getSnapshot()).toMatchObject({ status: "complete", resourceVersion: 4 }),
    );
    expect(requestLiveObservation).not.toHaveBeenCalled();
    expect(getLiveObservation).toHaveBeenCalledWith(
      "operation-live-001",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    detach?.();
  });
});
