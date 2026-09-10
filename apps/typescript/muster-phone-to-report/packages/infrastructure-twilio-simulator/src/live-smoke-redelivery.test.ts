import { describe, expect, it, vi } from "vitest";

import { createDtmfSafetyStop } from "./dtmf-canary.js";
import { createLiveSmokeRunner } from "./live-smoke-gate.js";

const execution = Object.freeze({
  operationId: "operation-redelivery-one",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
  runAuthorization: "transient-permit",
  traceContext: Object.freeze({
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  }),
});

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    configuration: {
      runtimeProfile: "test" as const,
      enabled: true,
      callBudget: 1,
      concurrency: 1,
      timeoutMs: 250,
      endpointAlias: "greenhouse-synthetic",
      authorizationAudience: "muster-live-simulator",
    },
    resolvedSecrets: {
      calleApiToken: "test-only-calle-token",
      targetAddress: "test-only-target",
    },
    killSwitch: { assertDispatchAllowed: vi.fn() },
    dtmfSafetyStop: createDtmfSafetyStop(),
    evidencePersistence: { persistAdmission: vi.fn() },
    terminalAttempts: { recordFailure: vi.fn() },
    dispatchAttempts: {
      claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
        providerDispatchIdentity: `provider-dispatch-${operationId}`,
        adapterVersionId: "adapter-version-db",
      })),
    },
    reviewedConfidenceTokens: ["provider-observed"],
    observability: {
      establishTraceContext: (value: unknown) => value,
      record: vi.fn(),
      runProviderSpan: async (operation: () => Promise<unknown>) => await operation(),
      runJobSpan: async (operation: () => Promise<unknown>) => await operation(),
    },
    ...overrides,
  };
}

describe("durable live dispatch redelivery", () => {
  it("does not cache a pre-reservation outage and reconciles a durable replay with the same operation identity", async () => {
    const reserve = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary authorization store outage"))
      .mockResolvedValueOnce("replayed");
    const dispatch = vi.fn().mockResolvedValue({
      providerCallId: "provider-call-opaque",
      terminalStatus: "evidence_unavailable",
      observedAt: "2026-08-10T12:00:00.000Z",
      evidence: null,
    });
    const runner = createLiveSmokeRunner(
      dependencies({ authorizationBoundary: { reserve }, dispatch }),
    );

    await expect(runner.execute(execution)).resolves.toMatchObject({
      status: "blocked",
      reason: "authorization_store_unavailable",
    });
    await expect(runner.execute(execution)).resolves.toMatchObject({ status: "completed" });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "operation-redelivery-one" }),
    );
  });

  it("persists every post-reservation provider failure before acknowledging a terminal result", async () => {
    const order: string[] = [];
    const runProviderSpan = vi.fn(async (operation: () => Promise<unknown>) => await operation());
    const runJobSpan = vi.fn(async (operation: () => Promise<unknown>) => await operation());
    const recordFailure = vi.fn(async () => {
      order.push("terminal-persisted");
    });
    const runner = createLiveSmokeRunner(
      dependencies({
        authorizationBoundary: { reserve: async () => "reserved" },
        terminalAttempts: { recordFailure },
        observability: {
          establishTraceContext: (value: unknown) => value,
          record: vi.fn(),
          runProviderSpan,
          runJobSpan,
        },
        dispatch: async () => {
          order.push("provider-failed");
          throw new Error("protected provider detail");
        },
      }),
    );

    const result = await runner.execute(execution);
    order.push("acknowledged");

    expect(result).toMatchObject({
      status: "failed",
      reason: "provider_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(order).toEqual(["provider-failed", "terminal-persisted", "acknowledged"]);
    expect(recordFailure).toHaveBeenCalledWith({
      operationId: "operation-redelivery-one",
      outcome: "provider_failed",
      retryable: false,
    });
    expect(JSON.stringify(recordFailure.mock.calls)).not.toContain("protected provider detail");
    expect(runJobSpan).toHaveBeenCalledOnce();
    expect(runProviderSpan).toHaveBeenCalledOnce();
  });

  it("shares one process DTMF stop across callback observation and both final dispatch gates", async () => {
    const safetyStop = createDtmfSafetyStop();
    const dispatch = vi.fn();
    const reserve = vi.fn(async () => {
      safetyStop.observe({ Digits: "7" });
      return "reserved";
    });
    const recordFailure = vi.fn();
    const runner = createLiveSmokeRunner(
      dependencies({
        authorizationBoundary: { reserve },
        dtmfSafetyStop: safetyStop,
        terminalAttempts: { recordFailure },
        dispatch,
      }),
    );

    await expect(runner.execute(execution)).resolves.toMatchObject({
      status: "failed",
      reason: "dtmf_safety_stop",
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledOnce();
  });

  it("aborts a pending dispatch on DTMF and persists no evidence or result before the safe terminal fact", async () => {
    const safetyStop = createDtmfSafetyStop();
    const evidencePersistence = { persistAdmission: vi.fn() };
    const resultPersistence = { commitAtomically: vi.fn() };
    const recordFailure = vi.fn();
    let providerSignal: AbortSignal | undefined;
    let releaseProvider: ((value: unknown) => void) | undefined;
    const providerResult = new Promise<unknown>((resolve) => {
      releaseProvider = resolve;
    });
    const dispatch = vi.fn(async (request: { readonly signal: AbortSignal }) => {
      providerSignal = request.signal;
      return await providerResult;
    });
    const reserve = vi.fn(async () => "reserved");
    const runner = createLiveSmokeRunner(
      dependencies({
        authorizationBoundary: { reserve },
        dtmfSafetyStop: safetyStop,
        evidencePersistence,
        resultPersistence,
        terminalAttempts: { recordFailure },
        dispatch,
      }),
    );

    const pending = runner.execute(execution);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    safetyStop.observe({ Digits: "8" });
    expect(providerSignal?.aborted).toBe(true);
    releaseProvider?.({
      providerCallId: "provider-call-after-dtmf",
      terminalStatus: "evidence_unavailable",
      observedAt: "2026-08-10T12:00:00.000Z",
      evidence: null,
    });

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      reason: "dtmf_safety_stop",
    });
    expect(recordFailure).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "blocked",
      retryable: false,
    });
    expect(evidencePersistence.persistAdmission).not.toHaveBeenCalled();
    expect(resultPersistence.commitAtomically).not.toHaveBeenCalled();
    await expect(
      runner.execute({ ...execution, operationId: "operation-after-dtmf" }),
    ).resolves.toMatchObject({ status: "blocked" });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("caches a safe application failure when terminal persistence rejects and never redelivers", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const recordFailure = vi.fn(async () => {
      throw new Error("protected terminal repository detail");
    });
    const claim = vi.fn(async () => ({
      providerDispatchIdentity: "provider-dispatch-stable",
      adapterVersionId: "adapter-version-db",
    }));
    const dispatch = vi.fn().mockResolvedValue({
      providerCallId: "provider-call-opaque",
      terminalStatus: "evidence_unavailable",
      observedAt: "2026-08-10T12:00:00.000Z",
      evidence: null,
    });
    const runner = createLiveSmokeRunner(
      dependencies({
        authorizationBoundary: { reserve: async () => "replayed" },
        dispatchAttempts: { claim },
        terminalAttempts: { recordFailure },
        dispatch,
      }),
    );

    try {
      const first = await runner.execute(execution);
      await new Promise((resolve) => setImmediate(resolve));
      await expect(runner.execute(execution)).resolves.toEqual(first);
      expect(first).toEqual({
        status: "failed",
        reason: "application_persistence_failed",
        retryable: false,
        authorizationConsumed: true,
      });
      expect(unhandled).toEqual([]);
      expect(claim).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(recordFailure).toHaveBeenCalledOnce();
      expect(JSON.stringify(first)).not.toContain("protected terminal repository detail");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("terminalizes kill-switch, authorization, concurrency, and budget pre-dispatch blocks without provider construction", async () => {
    const terminal = vi.fn(async () => undefined);
    const dispatch = vi.fn();
    const blockedByKillSwitch = createLiveSmokeRunner(
      dependencies({
        killSwitch: {
          assertDispatchAllowed: () => {
            throw new Error("blocked");
          },
        },
        authorizationBoundary: { reserve: vi.fn() },
        terminalAttempts: { recordFailure: terminal },
        dispatch,
      }),
    );
    await expect(
      blockedByKillSwitch.execute({ ...execution, operationId: "operation-kill" }),
    ).resolves.toMatchObject({ status: "blocked", reason: "kill_switch_blocked" });

    const rejected = createLiveSmokeRunner(
      dependencies({
        authorizationBoundary: { reserve: async () => "invalid_predecessor" },
        terminalAttempts: { recordFailure: terminal },
        dispatch,
      }),
    );
    await expect(
      rejected.execute({ ...execution, operationId: "operation-auth" }),
    ).resolves.toMatchObject({ status: "blocked", reason: "authorization_rejected" });

    let releaseReserve: (() => void) | undefined;
    const occupied = createLiveSmokeRunner(
      dependencies({
        authorizationBoundary: {
          reserve: async () =>
            await new Promise<"reserved">((resolve) => {
              releaseReserve = () => resolve("reserved");
            }),
        },
        terminalAttempts: { recordFailure: terminal },
        dispatch: async () => ({
          providerCallId: "provider",
          terminalStatus: "evidence_unavailable",
          observedAt: "2026-08-10T12:00:00.000Z",
          evidence: null,
        }),
      }),
    );
    const first = occupied.execute({ ...execution, operationId: "operation-first" });
    await vi.waitFor(() => expect(releaseReserve).toBeTypeOf("function"));
    await expect(
      occupied.execute({ ...execution, operationId: "operation-concurrent" }),
    ).resolves.toMatchObject({ status: "blocked", reason: "concurrency_slot_occupied" });
    releaseReserve?.();
    await first;
    await expect(
      occupied.execute({ ...execution, operationId: "operation-budget" }),
    ).resolves.toMatchObject({ status: "blocked", reason: "call_budget_exhausted" });

    expect(terminal.mock.calls.map(([value]) => value.operationId)).toEqual(
      expect.arrayContaining([
        "operation-kill",
        "operation-auth",
        "operation-concurrent",
        "operation-budget",
      ]),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});
