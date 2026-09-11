import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";

const organizationId = OrganizationId.create("org-phase6-evidence");
const operationId = "operation-phase6-evidence";
const providerCallDigest = "c".repeat(64);
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

async function loadFactory(): Promise<CallableFunction> {
  const api = (await import("./index.js")) as Readonly<Record<string, unknown>>;
  expect(api["createLiveSmokeEvidenceCoordinator"]).toBeTypeOf("function");
  return api["createLiveSmokeEvidenceCoordinator"] as CallableFunction;
}

function fact(
  phase: "voice" | "canary" | "status" | "calle_terminal" | "reconciliation",
  outcome: string,
  occurredAt: string,
  appendOrdinal?: number,
) {
  const defaultOrdinal = {
    voice: 1,
    canary: 2,
    status: 3,
    calle_terminal: 4,
    reconciliation: 5,
  }[phase];
  return Object.freeze({
    organizationId,
    operationId,
    phase,
    providerCallDigest,
    semanticDigest: phase.charCodeAt(0).toString(16).padStart(64, "0"),
    outcome,
    occurredAt,
    traceId,
    signatureValidated: phase === "voice" || phase === "canary" || phase === "status",
    actionsObserved: phase === "canary" ? 0 : null,
    inboundCallCount: phase === "reconciliation" ? 1 : null,
    appendOrdinal: appendOrdinal ?? defaultOrdinal,
  });
}

describe("Phase 6 evidence coordinator", () => {
  it("AC-HAPPY-6 admits interpretation only after ordered callback, terminal, and reconciliation facts", async () => {
    const createCoordinator = await loadFactory();
    const facts = [
      fact("voice", "accepted", "2026-08-24T20:00:01.000Z"),
      fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z"),
      fact("status", "completed", "2026-08-24T20:00:03.000Z"),
      fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z"),
      fact("reconciliation", "one_matching_call", "2026-08-24T20:00:05.000Z"),
    ];
    const coordinator = createCoordinator({
      providerFacts: { listForOperation: vi.fn(async () => facts) },
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });

    await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "ready",
      dtmfActions: 0,
      twilioReconciliation: "1 matching call",
    });
  });

  it("AC-HAPPY-6 fails closed when reconciliation is zero, mismatched, multiple, or precedes evidence", async () => {
    const createCoordinator = await loadFactory();
    for (const facts of [
      [fact("voice", "accepted", "2026-08-24T20:00:01.000Z")],
      [
        fact("reconciliation", "one_matching_call", "2026-08-24T20:00:00.000Z", 0),
        fact("voice", "accepted", "2026-08-24T20:00:01.000Z"),
        fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z"),
        fact("status", "completed", "2026-08-24T20:00:03.000Z"),
        fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z"),
      ],
      [
        fact("voice", "accepted", "2026-08-24T20:00:01.000Z"),
        fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z"),
        fact("status", "completed", "2026-08-24T20:00:03.000Z"),
        fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z"),
        fact("reconciliation", "multiple_calls", "2026-08-24T20:00:05.000Z"),
      ],
    ]) {
      const coordinator = createCoordinator({
        providerFacts: { listForOperation: vi.fn(async () => facts) },
        terminalAttempts: { recordFailure: vi.fn() },
        closeRunGate: vi.fn(),
        startTimer: vi.fn(),
      });
      await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toMatchObject(
        { outcome: "blocked" },
      );
    }
  });

  it("reports provider-fact readiness persistence failure separately from terminal evidence", async () => {
    const createCoordinator = await loadFactory();
    const coordinator = createCoordinator({
      providerFacts: {
        listForOperation: vi.fn(async () => {
          throw new Error("protected readiness repository detail");
        }),
      },
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });

    await expect(coordinator.waitUntilReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "persistence_unavailable",
    });
  });

  it("wraps CALL-E terminal fact append failures without exposing repository detail", async () => {
    const createCoordinator = await loadFactory();
    const coordinator = createCoordinator({
      organizationId,
      providerFacts: {
        append: vi.fn(async () => {
          throw new Error("protected provider fact repository detail");
        }),
        listForOperation: vi.fn(async () => []),
      },
      admitCalleEvidence: vi.fn(async () => ({ outcome: "admissible" as const })),
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });

    const failure = await coordinator
      .recordCalleTerminal({
        operationId,
        providerOutput: { terminalStatus: "completed" },
        traceId,
        providerCallDigest,
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "LiveSmokeEvidencePersistenceError",
      message: "Live smoke evidence persistence is unavailable",
    });
    expect(JSON.stringify(failure)).not.toContain("protected provider fact repository detail");
  });

  it.each(["reconciliationAppend", "finalRead"] as const)(
    "reports %s provider-fact persistence failure as unavailable",
    async (failedOperation) => {
      const createCoordinator = await loadFactory();
      const facts = [
        fact("voice", "accepted", "2026-08-24T20:00:01.000Z"),
        fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z"),
        fact("status", "completed", "2026-08-24T20:00:03.000Z"),
        fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z"),
      ];
      const listForOperation = vi
        .fn()
        .mockResolvedValueOnce(facts)
        .mockImplementationOnce(async () => {
          if (failedOperation === "finalRead") {
            throw new Error("protected final provider fact read detail");
          }
          return facts;
        });
      const coordinator = createCoordinator({
        providerFacts: {
          append: vi.fn(async () => {
            if (failedOperation === "reconciliationAppend") {
              throw new Error("protected reconciliation append detail");
            }
            return { outcome: "appended" as const };
          }),
          listForOperation,
        },
        reconcile: vi.fn(async () => ({
          outcome: "one_matching_call" as const,
          inboundCallCount: 1,
        })),
        terminalAttempts: { recordFailure: vi.fn() },
        closeRunGate: vi.fn(),
        startTimer: vi.fn(),
        now: () => "2026-08-24T20:00:05.000Z",
      });

      await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
        outcome: "blocked",
        reason: "persistence_unavailable",
      });
    },
  );

  it("does not relabel reconciliation transport failure as provider-fact persistence", async () => {
    const createCoordinator = await loadFactory();
    const coordinator = createCoordinator({
      providerFacts: {
        append: vi.fn(),
        listForOperation: vi.fn(async () => [
          fact("voice", "accepted", "2026-08-24T20:00:01.000Z"),
          fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z"),
          fact("status", "completed", "2026-08-24T20:00:03.000Z"),
          fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z"),
        ]),
      },
      reconcile: vi.fn(async () => {
        throw new Error("protected reconciliation transport detail");
      }),
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });

    await expect(coordinator.assertReady({ organizationId, operationId })).rejects.toThrow(
      "protected reconciliation transport detail",
    );
    await expect(coordinator.waitUntilReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "terminal",
    });
  });

  it("transfers terminal persistence to the runner before the coordinator deadline wins", async () => {
    vi.useFakeTimers();
    try {
      const createCoordinator = await loadFactory();
      const recordFailure = vi.fn(async () => undefined);
      const closeRunGate = vi.fn();
      const cleanup = vi.fn(async () => undefined);
      const coordinator = createCoordinator({
        providerFacts: { listForOperation: vi.fn(async () => []) },
        terminalAttempts: { recordFailure },
        closeRunGate,
        cleanup,
      });
      const terminalSignals: string[] = [];
      expect(coordinator.claimTerminalPersistence({ organizationId, operationId })).toBe("runner");
      const unsubscribe = coordinator.onTerminal(
        { organizationId, operationId },
        (reason: string) => terminalSignals.push(reason),
      );
      coordinator.begin({ organizationId, operationId, deadlineMs: 1_000 });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(terminalSignals).toEqual(["provider_failed"]);
      expect(recordFailure).not.toHaveBeenCalled();
      expect(closeRunGate).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(coordinator.settle({ organizationId, operationId })).toBe("runner");
      await coordinator.completeTerminalPersistence({ organizationId, operationId });
      expect(closeRunGate).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      unsubscribe();
      await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
        outcome: "blocked",
        reason: "provider_failed",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not return ready when the deadline wins while a complete five-fact read is pending", async () => {
    const createCoordinator = await loadFactory();
    let deadline: (() => void) | undefined;
    const completeFacts = [
      fact("voice", "accepted", "2026-08-24T20:00:01.000Z"),
      fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z"),
      fact("status", "completed", "2026-08-24T20:00:03.000Z"),
      fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z"),
      fact("reconciliation", "one_matching_call", "2026-08-24T20:00:05.000Z"),
    ];
    const coordinator = createCoordinator({
      providerFacts: {
        listForOperation: vi.fn(async () => {
          deadline?.();
          return completeFacts;
        }),
      },
      terminalAttempts: { recordFailure: vi.fn(async () => undefined) },
      closeRunGate: vi.fn(),
      startTimer: vi.fn((callback: () => void) => {
        deadline = callback;
        return { unref: vi.fn() };
      }),
      now: () => "2026-08-24T20:00:00.000Z",
    });
    const signals: string[] = [];
    coordinator.claimTerminalPersistence({ organizationId, operationId });
    coordinator.onTerminal({ organizationId, operationId }, (reason: string) =>
      signals.push(reason),
    );
    coordinator.begin({ organizationId, operationId, deadlineMs: 1_000 });

    await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "provider_failed",
    });
    expect(signals).toEqual(["provider_failed"]);
  });

  it("latches signed callback persistence failure as evidence unavailable for the runner", async () => {
    const createCoordinator = await loadFactory();
    const recordFailure = vi.fn(async () => undefined);
    const coordinator = createCoordinator({
      providerFacts: { listForOperation: vi.fn(async () => []) },
      terminalAttempts: { recordFailure },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(() => ({ unref: vi.fn() })),
      now: () => "2026-08-24T20:00:00.000Z",
    });
    const signals: string[] = [];
    coordinator.claimTerminalPersistence({ organizationId, operationId });
    coordinator.onTerminal({ organizationId, operationId }, (reason: string) =>
      signals.push(reason),
    );
    coordinator.begin({ organizationId, operationId, deadlineMs: 1_000 });

    coordinator.recordProviderFactPersistenceFailure({ organizationId, operationId });

    expect(signals).toEqual(["persistence_unavailable"]);
    expect(recordFailure).not.toHaveBeenCalled();
    await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "persistence_unavailable",
    });
  });

  it("AC-ASYNC-5 terminalizes at 120 seconds without callbacks and rejects late reopening", async () => {
    vi.useFakeTimers();
    try {
      const createCoordinator = await loadFactory();
      const recordFailure = vi.fn(async () => undefined);
      const closeRunGate = vi.fn();
      const cleanup = vi.fn(async () => undefined);
      const coordinator = createCoordinator({
        providerFacts: { listForOperation: vi.fn(async () => []) },
        terminalAttempts: { recordFailure },
        closeRunGate,
        cleanup,
      });

      coordinator.begin({
        organizationId,
        operationId,
        deadlineMs: 120_000,
        terminalDeadlineMs: 305_000,
      });
      await vi.advanceTimersByTimeAsync(119_999);
      expect(recordFailure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(recordFailure).toHaveBeenCalledWith({
        operationId,
        outcome: "provider_failed",
        retryable: false,
      });
      expect(closeRunGate).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
        outcome: "blocked",
        reason: "provider_failed",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs coordinator-owned cleanup even when the terminal write rejects", async () => {
    vi.useFakeTimers();
    try {
      const createCoordinator = await loadFactory();
      const closeRunGate = vi.fn();
      const cleanup = vi.fn(async () => undefined);
      const coordinator = createCoordinator({
        providerFacts: { listForOperation: vi.fn(async () => []) },
        terminalAttempts: {
          recordFailure: vi.fn(async () => {
            throw new Error("protected terminal persistence detail");
          }),
        },
        closeRunGate,
        cleanup,
      });

      coordinator.begin({ organizationId, operationId, deadlineMs: 1 });
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());

      expect(closeRunGate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels only the no-callback timer after a signed callback fact is durable", async () => {
    vi.useFakeTimers();
    try {
      const createCoordinator = await loadFactory();
      const recordFailure = vi.fn(async () => undefined);
      const closeRunGate = vi.fn();
      const cleanup = vi.fn(async () => undefined);
      const coordinator = createCoordinator({
        providerFacts: { listForOperation: vi.fn(async () => []) },
        terminalAttempts: { recordFailure },
        closeRunGate,
        cleanup,
      });

      coordinator.begin({
        organizationId,
        operationId,
        deadlineMs: 120_000,
        terminalDeadlineMs: 300_000,
      });
      await vi.advanceTimersByTimeAsync(119_000);
      coordinator.recordCallbackActivity({ organizationId, operationId });
      await vi.advanceTimersByTimeAsync(120_000);

      expect(recordFailure).not.toHaveBeenCalled();
      expect(closeRunGate).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
        outcome: "blocked",
        reason: "incomplete",
      });
      await vi.advanceTimersByTimeAsync(61_000);
      expect(recordFailure).toHaveBeenCalledOnce();
      expect(closeRunGate).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses durable append ordinals when every fact shares one TIMESTAMPTZ(3) millisecond", async () => {
    const createCoordinator = await loadFactory();
    const sameMillisecond = "2026-08-24T20:00:00.000Z";
    const ordered = [
      fact("voice", "accepted", sameMillisecond, 10),
      fact("canary", "zero_dtmf", sameMillisecond, 11),
      fact("status", "completed", sameMillisecond, 12),
      fact("calle_terminal", "admissible", sameMillisecond, 13),
      fact("reconciliation", "one_matching_call", sameMillisecond, 14),
    ];
    const coordinator = createCoordinator({
      providerFacts: { listForOperation: vi.fn(async () => ordered) },
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });
    await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toMatchObject({
      outcome: "ready",
    });

    const wrongOrder = [
      fact("reconciliation", "one_matching_call", sameMillisecond, 20),
      fact("voice", "accepted", sameMillisecond, 21),
      fact("canary", "zero_dtmf", sameMillisecond, 22),
      fact("status", "completed", sameMillisecond, 23),
      fact("calle_terminal", "admissible", sameMillisecond, 24),
    ];
    const blocked = createCoordinator({
      providerFacts: { listForOperation: vi.fn(async () => wrongOrder) },
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });
    await expect(blocked.assertReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "invalid_order",
    });
  });

  it("AC-ERROR-4 rejects individually valid callback facts when canary or status precedes voice", async () => {
    const createCoordinator = await loadFactory();
    for (const unordered of [
      [
        fact("canary", "zero_dtmf", "2026-08-24T20:00:01.000Z", 1),
        fact("voice", "accepted", "2026-08-24T20:00:02.000Z", 2),
        fact("status", "completed", "2026-08-24T20:00:03.000Z", 3),
        fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z", 4),
        fact("reconciliation", "one_matching_call", "2026-08-24T20:00:05.000Z", 5),
      ],
      [
        fact("voice", "accepted", "2026-08-24T20:00:01.000Z", 1),
        fact("status", "completed", "2026-08-24T20:00:02.000Z", 2),
        fact("canary", "zero_dtmf", "2026-08-24T20:00:03.000Z", 3),
        fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z", 4),
        fact("reconciliation", "one_matching_call", "2026-08-24T20:00:05.000Z", 5),
      ],
    ]) {
      const coordinator = createCoordinator({
        providerFacts: { listForOperation: vi.fn(async () => unordered) },
        terminalAttempts: { recordFailure: vi.fn() },
        closeRunGate: vi.fn(),
        startTimer: vi.fn(),
      });
      await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
        outcome: "blocked",
        reason: "invalid_order",
      });
    }
  });

  it("AC-ERROR-4 keeps CALL-E terminal-before-status lifecycle evidence result-free", async () => {
    const createCoordinator = await loadFactory();
    const terminalBeforeStatus = [
      fact("calle_terminal", "admissible", "2026-08-24T20:00:01.000Z", 1),
      fact("voice", "accepted", "2026-08-24T20:00:02.000Z", 2),
      fact("canary", "zero_dtmf", "2026-08-24T20:00:03.000Z", 3),
      fact("status", "completed", "2026-08-24T20:00:04.000Z", 4),
      fact("reconciliation", "one_matching_call", "2026-08-24T20:00:05.000Z", 5),
    ];
    const coordinator = createCoordinator({
      providerFacts: { listForOperation: vi.fn(async () => terminalBeforeStatus) },
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });

    await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "invalid_order",
    });
  });

  it("AC-ERROR-4 rejects callback lifecycle facts whose signed callback identity drifts", async () => {
    const createCoordinator = await loadFactory();
    const facts = [
      fact("voice", "accepted", "2026-08-24T20:00:01.000Z", 1),
      {
        ...fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z", 2),
        providerCallDigest: "d".repeat(64),
      },
      fact("status", "completed", "2026-08-24T20:00:03.000Z", 3),
      fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z", 4),
      fact("reconciliation", "one_matching_call", "2026-08-24T20:00:05.000Z", 5),
    ];
    const coordinator = createCoordinator({
      providerFacts: { listForOperation: vi.fn(async () => facts) },
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });

    await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "invalid_order",
    });
  });

  it("AC-ERROR-4 rejects ambiguous callback order when distinct phases share an append ordinal", async () => {
    const createCoordinator = await loadFactory();
    const sameOrdinal = [
      fact("voice", "accepted", "2026-08-24T20:00:01.000Z", 1),
      fact("canary", "zero_dtmf", "2026-08-24T20:00:02.000Z", 2),
      fact("status", "completed", "2026-08-24T20:00:03.000Z", 2),
      fact("calle_terminal", "admissible", "2026-08-24T20:00:04.000Z", 4),
      fact("reconciliation", "one_matching_call", "2026-08-24T20:00:05.000Z", 5),
    ];
    const coordinator = createCoordinator({
      providerFacts: { listForOperation: vi.fn(async () => sameOrdinal) },
      terminalAttempts: { recordFailure: vi.fn() },
      closeRunGate: vi.fn(),
      startTimer: vi.fn(),
    });

    await expect(coordinator.assertReady({ organizationId, operationId })).resolves.toEqual({
      outcome: "blocked",
      reason: "invalid_order",
    });
  });

  it("delegates no-callback timeout to the same memoized cleanup owner", async () => {
    vi.useFakeTimers();
    try {
      const api = (await import("./index.js")) as Readonly<Record<string, CallableFunction>>;
      const restoreTwilio = vi.fn(async () => undefined);
      const stopHost = vi.fn(async () => undefined);
      const stopTunnel = vi.fn(async () => undefined);
      const cleanup = api["createLiveSmokeCleanup"]!({
        closeRunGate: vi.fn(),
        awaitPreRestorationBarrier: async () => ({
          outcome: "ready" as const,
          proof: "zero_dispatch" as const,
        }),
        restoreTwilio,
        verifyTwilioResting: vi.fn(async () => false),
        clearRuntimeSecrets: vi.fn(),
        stopHost,
        stopTunnel,
      });
      const coordinator = (await loadFactory())({
        providerFacts: { listForOperation: vi.fn(async () => []) },
        terminalAttempts: { recordFailure: vi.fn(async () => undefined) },
        closeRunGate: vi.fn(),
        cleanup: async () => await cleanup.execute(),
      });

      coordinator.begin({ organizationId, operationId: `${operationId}-cleanup`, deadlineMs: 1 });
      await vi.advanceTimersByTimeAsync(1);
      await cleanup.execute();
      expect(restoreTwilio).toHaveBeenCalledOnce();
      expect(stopHost).not.toHaveBeenCalled();
      expect(stopTunnel).not.toHaveBeenCalled();
      await expect(cleanup.execute()).resolves.toEqual({
        outcome: "blocked",
        hostAndTunnelMustRemainUp: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
