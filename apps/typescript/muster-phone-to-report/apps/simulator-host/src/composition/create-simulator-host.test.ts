import { describe, expect, it, vi } from "vitest";

async function loadCompositionApi(): Promise<Record<string, unknown>> {
  try {
    return (await import("./create-simulator-host.js")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe("dedicated simulator host composition", () => {
  it("validates configuration before constructing any CALL-E provider", async () => {
    const api = await loadCompositionApi();
    expect(api["createSimulatorHost"]).toBeTypeOf("function");
    const createProvider = vi.fn();

    expect(() =>
      (api["createSimulatorHost"] as CallableFunction)({
        environment: { RUNTIME_PROFILE: "production" },
        createProvider,
      }),
    ).toThrowError(/Simulator host configuration is invalid/u);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("constructs and dispatches once only after reservation, then replays the stable operation", async () => {
    const api = await loadCompositionApi();
    expect(api["createSimulatorHost"]).toBeTypeOf("function");
    const order: string[] = [];
    const reserve = vi.fn(async () => {
      order.push("reserved");
      return "reserved";
    });
    const dispatch = vi.fn(async () => {
      order.push("dispatched");
      return {
        providerCallId: "provider-call-opaque",
        terminalStatus: "evidence_unavailable",
        observedAt: "2026-08-10T12:00:00.000Z",
        evidence: null,
      };
    });
    const createProvider = vi.fn(() => {
      order.push("constructed");
      return { dispatch };
    });
    const host = (api["createSimulatorHost"] as CallableFunction)({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        killSwitch: { assertDispatchAllowed: vi.fn() },
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 60_000,
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        apiToken: "test-only-provider-key",
        targetAddress: "test-only-target",
      },
      authorizationBoundary: { reserve },
      terminalAttempts: { recordFailure: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async () => ({
          providerDispatchIdentity: "provider-dispatch-db",
          adapterVersionId: "adapter-version-db",
        })),
      },
      dtmfSafetyStop: {
        observe: () => ({ status: "clear", actionsObserved: 0, compatibility: "simulator-tested" }),
        isBlocked: () => false,
        assertDispatchAllowed: vi.fn(),
      },
      evidencePersistence: { persistAdmission: vi.fn() },
      reviewedConfidenceTokens: ["provider-observed"],
      observability: {
        establishTraceContext: () => ({
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        }),
        record: vi.fn(),
      },
      createProvider,
    }) as { execute(input: unknown): Promise<unknown> };
    const input = {
      operationId: "operation-live-001",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      runAuthorization: "test-only-permit",
    };

    const first = await host.execute(input);
    const replay = await host.execute(input);

    expect(first).toEqual(replay);
    expect(order).toEqual(["reserved", "constructed", "dispatched"]);
    expect(reserve).toHaveBeenCalledOnce();
    expect(createProvider).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(first).toMatchObject({
      status: "completed",
      mapped: { result: { kind: "terminal_failure", outcome: "evidence_unavailable" } },
    });
  });

  it("wires durable reconciliation to the provider read path without dispatch", async () => {
    const api = await loadCompositionApi();
    const dispatch = vi.fn();
    const reconcile = vi.fn(async () => ({
      providerCallId: "provider-call-existing",
      terminalStatus: "evidence_unavailable",
      observedAt: "2026-08-10T12:00:00.000Z",
      evidence: null,
    }));
    const host = (api["createSimulatorHost"] as CallableFunction)({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        killSwitch: { assertDispatchAllowed: vi.fn() },
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 60_000,
        providerTerminalTimeoutMs: 180_000,
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        apiToken: "test-only-provider-key",
        targetAddress: "test-only-target",
      },
      authorizationBoundary: { reserve: vi.fn(async () => "replayed") },
      terminalAttempts: { recordFailure: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async () => ({
          outcome: "reconcile",
          providerDispatchIdentity: "provider-dispatch-db",
          adapterVersionId: "adapter-version-db",
        })),
      },
      dtmfSafetyStop: {
        observe: () => ({ status: "clear", actionsObserved: 0, compatibility: "simulator-tested" }),
        isBlocked: () => false,
        assertDispatchAllowed: vi.fn(),
      },
      evidencePersistence: { persistAdmission: vi.fn() },
      reviewedConfidenceTokens: ["provider-observed"],
      observability: {
        establishTraceContext: () => ({
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        }),
        record: vi.fn(),
      },
      createProvider: vi.fn(() => ({ dispatch, reconcile })),
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(
      host.execute({
        operationId: "operation-live-reconcile",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        runAuthorization: "test-only-permit",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
