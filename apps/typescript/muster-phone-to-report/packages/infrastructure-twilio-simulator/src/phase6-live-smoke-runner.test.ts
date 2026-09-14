import { describe, expect, it, vi } from "vitest";

import { createDtmfSafetyStop } from "./dtmf-canary.js";
import {
  calculateLiveSmokeEvidenceTimeoutMs,
  calculateLiveSmokeProjectionTimeoutMs,
  calculateLiveSmokeProviderOperationTimeoutMs,
  calculateLiveSmokeRunnerTimeoutMs,
  calculateLiveSmokeWorkerTimeoutMs,
  createLiveSmokeRunner,
} from "./live-smoke-gate.js";

const execution = Object.freeze({
  operationId: "operation-phase6-runner",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
  runAuthorization: "opaque-one-use-permit",
  traceContext: Object.freeze({
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  }),
});

function dependencies(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    configuration: {
      runtimeProfile: "test" as const,
      enabled: true,
      callBudget: 1,
      concurrency: 1,
      timeoutMs: 120_000,
      providerTerminalTimeoutMs: 180_000,
      endpointAlias: "greenhouse-synthetic",
      authorizationAudience: "muster-live-simulator",
      requireCallbackEvidence: true,
    },
    resolvedSecrets: {
      calleApiToken: "test-only-calle-token",
      targetAddress: "test-only-target",
    },
    authorizationBoundary: { reserve: vi.fn(async () => "reserved") },
    evidencePersistence: { persistAdmission: vi.fn() },
    reviewedConfidenceTokens: ["provider-observed"],
    observability: {
      establishTraceContext: (value: unknown) => value,
      record: vi.fn(),
    },
    terminalAttempts: { recordFailure: vi.fn() },
    killSwitch: { assertDispatchAllowed: vi.fn() },
    runGate: { assertOpen: vi.fn() },
    dtmfSafetyStop: createDtmfSafetyStop(),
    dispatchAttempts: {
      claim: vi.fn(async () => ({
        providerDispatchIdentity: "provider-dispatch-phase6",
        adapterVersionId: "adapter-phase6",
      })),
    },
    evidenceCoordinator: {
      claimTerminalPersistence: vi.fn(() => "runner" as const),
      onTerminal: vi.fn(() => () => undefined),
      settle: vi.fn(() => "runner" as const),
      completeTerminalPersistence: vi.fn(async () => undefined),
      begin: vi.fn(),
      recordCalleTerminal: vi.fn(async () => undefined),
      assertReady: vi.fn(async () => ({
        outcome: "ready" as const,
        dtmfActions: 0 as const,
        twilioReconciliation: "1 matching call" as const,
      })),
    },
    dispatch: vi.fn(async () => ({
      providerCallId: "provider-call-opaque",
      terminalStatus: "evidence_unavailable",
      observedAt: "2026-08-24T20:00:05.000Z",
      evidence: null,
    })),
    ...overrides,
  };
}

describe("Phase 6 guarded runner join", () => {
  it("rejects callback-evidence mode unless every terminal-ownership hook is present", async () => {
    const hookNames = [
      "claimTerminalPersistence",
      "onTerminal",
      "settle",
      "completeTerminalPersistence",
      "begin",
    ] as const;
    const completeCoordinator = {
      claimTerminalPersistence: vi.fn(() => "runner" as const),
      onTerminal: vi.fn(() => () => undefined),
      settle: vi.fn(() => "runner" as const),
      completeTerminalPersistence: vi.fn(async () => undefined),
      begin: vi.fn(),
      recordCalleTerminal: vi.fn(async () => undefined),
      assertReady: vi.fn(async () => ({
        outcome: "ready" as const,
        dtmfActions: 0 as const,
        twilioReconciliation: "1 matching call" as const,
      })),
    };

    for (const missingHook of hookNames) {
      const dispatch = vi.fn();
      const evidenceCoordinator = { ...completeCoordinator } as Record<string, unknown>;
      delete evidenceCoordinator[missingHook];
      const runner = createLiveSmokeRunner(
        dependencies({ evidenceCoordinator, dispatch }) as never,
      );

      await expect(
        runner.execute({ ...execution, operationId: `${execution.operationId}-${missingHook}` }),
      ).resolves.toEqual({ status: "blocked", reason: "safety_configuration_invalid" });
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it("adds the callback window before the provider terminal watchdog and projection grace", async () => {
    const begin = vi.fn();
    const input = dependencies({
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(() => () => undefined),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin,
        recordCalleTerminal: vi.fn(async () => undefined),
        assertReady: vi.fn(async () => ({
          outcome: "ready" as const,
          dtmfActions: 0 as const,
          twilioReconciliation: "1 matching call" as const,
        })),
      },
    });
    const runner = createLiveSmokeRunner(input as never);

    await expect(runner.execute(execution)).resolves.toMatchObject({ status: "completed" });
    expect(begin).toHaveBeenCalledWith({
      operationId: execution.operationId,
      deadlineMs: 120_000,
      terminalDeadlineMs: 305_000,
    });
    expect(input.dispatch).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 300_000 }));
    expect(
      calculateLiveSmokeProviderOperationTimeoutMs({
        callbackDeadlineMs: 120_000,
        providerTerminalTimeoutMs: 180_000,
      }),
    ).toBe(300_000);
    expect(
      calculateLiveSmokeEvidenceTimeoutMs({
        callbackDeadlineMs: 120_000,
        providerTerminalTimeoutMs: 180_000,
      }),
    ).toBe(305_000);
    expect(
      calculateLiveSmokeRunnerTimeoutMs({
        callbackDeadlineMs: 120_000,
        providerTerminalTimeoutMs: 180_000,
      }),
    ).toBe(310_000);
    expect(
      calculateLiveSmokeWorkerTimeoutMs({
        callbackDeadlineMs: 120_000,
        providerTerminalTimeoutMs: 180_000,
      }),
    ).toBe(315_000);
    expect(
      calculateLiveSmokeProjectionTimeoutMs({
        callbackDeadlineMs: 120_000,
        providerTerminalTimeoutMs: 180_000,
      }),
    ).toBe(320_000);
  });

  it("AC-HAPPY-8 persists provider-terminal facts and proves callback readiness before interpretation", async () => {
    const order: string[] = [];
    const evidenceCoordinator = {
      claimTerminalPersistence: vi.fn(() => "runner" as const),
      onTerminal: vi.fn(() => () => undefined),
      settle: vi.fn(() => "runner" as const),
      completeTerminalPersistence: vi.fn(async () => undefined),
      begin: vi.fn(),
      recordCalleTerminal: vi.fn(async () => order.push("provider-fact")),
      assertReady: vi.fn(async () => {
        order.push("callbacks-reconciled");
        return {
          outcome: "ready" as const,
          dtmfActions: 0 as const,
          twilioReconciliation: "1 matching call" as const,
        };
      }),
    };
    const evidencePersistence = {
      persistAdmission: vi.fn(async () => order.push("evidence-admitted")),
    };
    const input = dependencies({ evidenceCoordinator, evidencePersistence });
    const runner = createLiveSmokeRunner(input as never);

    await expect(runner.execute(execution)).resolves.toMatchObject({ status: "completed" });
    expect(order).toEqual(["provider-fact", "callbacks-reconciled", "evidence-admitted"]);
  });

  it("AC-ERROR-7 and AC-HAPPY-8 reuse the consumed operation without another dispatch", async () => {
    const input = dependencies();
    const runner = createLiveSmokeRunner(input as never);
    const first = await runner.execute(execution);
    const replay = await runner.execute(execution);
    expect(replay).toEqual(first);
    expect(input.dispatch).toHaveBeenCalledOnce();
    expect(input.authorizationBoundary.reserve).toHaveBeenCalledOnce();
    expect(input.evidenceCoordinator.recordCalleTerminal).toHaveBeenCalledOnce();
  });

  it("AC-ERROR-6 fails closed before provider construction when run gate or coordinator is unavailable", async () => {
    const dispatch = vi.fn();
    const closedGate = dependencies({
      runGate: {
        assertOpen: () => {
          throw new Error("closed");
        },
      },
      dispatch,
    });
    await expect(
      createLiveSmokeRunner(closedGate as never).execute(execution),
    ).resolves.toMatchObject({ status: "blocked", reason: "run_gate_closed" });
    expect(dispatch).not.toHaveBeenCalled();

    const missingCoordinator = dependencies({ evidenceCoordinator: undefined, dispatch });
    await expect(
      createLiveSmokeRunner(missingCoordinator as never).execute(execution),
    ).resolves.toMatchObject({ status: "blocked" });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
