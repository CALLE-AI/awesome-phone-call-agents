import { createHash } from "node:crypto";

import type {
  LiveSimulatorProviderFact,
  LiveSimulatorProviderFactRepository,
} from "@muster/application";
import type { OrganizationId } from "@muster/domain";

export type LiveSmokeEvidenceReadiness =
  | Readonly<{
      outcome: "ready";
      dtmfActions: 0;
      twilioReconciliation: "1 matching call";
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        "incomplete" | "invalid_order" | "terminal" | "provider_failed" | "persistence_unavailable";
    }>;

export class LiveSmokeEvidencePersistenceError extends Error {
  public constructor() {
    super("Live smoke evidence persistence is unavailable");
    this.name = "LiveSmokeEvidencePersistenceError";
  }
}

export type LiveSmokeTerminalPersistenceOwner = "runner" | "coordinator";
export type LiveSmokeTerminalSignalReason = "provider_failed" | "persistence_unavailable";

export interface LiveSmokeEvidenceCoordinator {
  begin(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly deadlineMs: number;
    readonly terminalDeadlineMs?: number;
  }): void;
  recordCallbackActivity(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): void;
  recordProviderFactPersistenceFailure(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): void;
  recordCalleTerminal(input: {
    readonly operationId: string;
    readonly providerOutput: unknown;
    readonly traceId: string;
    readonly providerCallDigest?: string;
  }): Promise<void>;
  assertReady(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): Promise<LiveSmokeEvidenceReadiness>;
  waitUntilReady(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): Promise<LiveSmokeEvidenceReadiness>;
  claimTerminalPersistence(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): LiveSmokeTerminalPersistenceOwner;
  onTerminal(
    input: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
    },
    listener: (reason: LiveSmokeTerminalSignalReason) => void,
  ): () => void;
  settle(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): LiveSmokeTerminalPersistenceOwner;
  completeTerminalPersistence(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): Promise<void>;
}

type BeginInput = Parameters<LiveSmokeEvidenceCoordinator["begin"]>[0];
type TerminalInput = Parameters<LiveSmokeEvidenceCoordinator["recordCalleTerminal"]>[0];
type ReadinessInput = Parameters<LiveSmokeEvidenceCoordinator["assertReady"]>[0];

type TimerHandle = ReturnType<typeof setTimeout>;

function operationKey(organizationId: OrganizationId, operationId: string): string {
  return `${organizationId.toString()}:${operationId}`;
}

function isAdmissibleSet(facts: readonly LiveSimulatorProviderFact[]): boolean {
  const byPhase = new Map(facts.map((fact) => [fact.phase, fact] as const));
  const voice = byPhase.get("voice");
  const canary = byPhase.get("canary");
  const status = byPhase.get("status");
  const calle = byPhase.get("calle_terminal");
  const reconciliation = byPhase.get("reconciliation");
  // Append ordinals are the durable ordering source: callback timestamps can collide at
  // PostgreSQL's millisecond precision, so a tie must fail closed rather than imply an order.
  const appendOrdinals = facts.map(({ appendOrdinal }) => appendOrdinal);
  const appendOrdinalsAreUnambiguous =
    appendOrdinals.every((appendOrdinal) => appendOrdinal !== undefined) &&
    new Set(appendOrdinals).size === facts.length;
  const callbackLifecycleIsStrictlyOrdered =
    voice?.appendOrdinal !== undefined &&
    canary?.appendOrdinal !== undefined &&
    status?.appendOrdinal !== undefined &&
    calle?.appendOrdinal !== undefined &&
    voice.appendOrdinal < canary.appendOrdinal &&
    canary.appendOrdinal < status.appendOrdinal &&
    status.appendOrdinal < calle.appendOrdinal;
  const reconciliationOrdinal = reconciliation?.appendOrdinal;
  const reconciliationIsLast =
    reconciliationOrdinal !== undefined &&
    facts
      .filter(({ phase }) => phase !== "reconciliation")
      .every(
        ({ appendOrdinal }) => appendOrdinal !== undefined && appendOrdinal < reconciliationOrdinal,
      );
  const callbackIdentityIsStable =
    voice !== undefined &&
    canary?.providerCallDigest === voice.providerCallDigest &&
    status?.providerCallDigest === voice.providerCallDigest &&
    reconciliation?.providerCallDigest === voice.providerCallDigest;
  return (
    facts.length === 5 &&
    voice?.outcome === "accepted" &&
    voice.signatureValidated &&
    canary?.outcome === "zero_dtmf" &&
    canary.signatureValidated &&
    canary.actionsObserved === 0 &&
    status?.outcome === "completed" &&
    status.signatureValidated &&
    calle?.outcome === "admissible" &&
    reconciliation?.outcome === "one_matching_call" &&
    reconciliation.inboundCallCount === 1 &&
    appendOrdinalsAreUnambiguous &&
    callbackLifecycleIsStrictlyOrdered &&
    reconciliationIsLast &&
    callbackIdentityIsStable
  );
}

export function createLiveSmokeEvidenceCoordinator(input: {
  readonly providerFacts: Pick<LiveSimulatorProviderFactRepository, "append" | "listForOperation">;
  readonly terminalAttempts: {
    recordFailure(input: {
      readonly operationId: string;
      readonly outcome: "provider_failed" | "evidence_unavailable";
      readonly retryable: false;
    }): Promise<void>;
  };
  readonly closeRunGate: () => void;
  readonly cleanup?: () => Promise<void>;
  readonly admitCalleEvidence?: (
    providerOutput: unknown,
  ) =>
    | Readonly<{ outcome: "admissible" | "inadmissible" }>
    | Promise<Readonly<{ outcome: "admissible" | "inadmissible" }>>;
  readonly reconcile?: (input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly providerCallDigest: string;
  }) => Promise<
    Readonly<{
      outcome: "one_matching_call" | "zero_calls" | "mismatched_call" | "multiple_calls";
      inboundCallCount: number;
    }>
  >;
  readonly waitForFact?: (notify: () => void) => () => void;
  readonly startTimer?: (callback: () => void, deadlineMs: number) => TimerHandle;
  readonly organizationId?: OrganizationId;
  readonly now?: () => string;
}): LiveSmokeEvidenceCoordinator {
  const terminal = new Set<string>();
  const terminalReadinessReasons = new Map<string, "terminal" | LiveSmokeTerminalSignalReason>();
  const runnerOwnedTerminalPersistence = new Set<string>();
  const runnerTerminalCompletion = new Set<string>();
  const coordinatorTerminalCompletions = new Map<string, Promise<void>>();
  const terminalListeners = new Map<string, Set<(reason: LiveSmokeTerminalSignalReason) => void>>();
  const timers = new Map<string, TimerHandle>();
  const runWindows = new Map<
    string,
    {
      readonly run: BeginInput;
      readonly startedAtMs: number;
      readonly terminalDeadlineMs: number;
      callbackObserved: boolean;
    }
  >();
  const startTimer =
    input.startTimer ?? ((callback, deadlineMs) => setTimeout(callback, deadlineMs));
  const now = input.now ?? (() => new Date().toISOString());
  const appendProviderFact: LiveSimulatorProviderFactRepository["append"] = async (fact) => {
    try {
      return await input.providerFacts.append(fact);
    } catch {
      throw new LiveSmokeEvidencePersistenceError();
    }
  };
  const listProviderFacts: LiveSimulatorProviderFactRepository["listForOperation"] = async (
    factOrganizationId,
    factOperationId,
  ) => {
    try {
      return await input.providerFacts.listForOperation(factOrganizationId, factOperationId);
    } catch {
      throw new LiveSmokeEvidencePersistenceError();
    }
  };

  const terminalPersistenceOwner = (key: string): LiveSmokeTerminalPersistenceOwner =>
    runnerOwnedTerminalPersistence.has(key) ? "runner" : "coordinator";
  const terminalReadiness = (key: string): LiveSmokeEvidenceReadiness | undefined =>
    terminal.has(key)
      ? Object.freeze({
          outcome: "blocked" as const,
          reason: terminalReadinessReasons.get(key) ?? "terminal",
        })
      : undefined;
  const settleWindow = (
    key: string,
    readinessReason: "terminal" | LiveSmokeTerminalSignalReason = "terminal",
  ): Readonly<{ owner: LiveSmokeTerminalPersistenceOwner; acquired: boolean }> => {
    let acquired = false;
    if (!terminal.has(key)) {
      const timer = timers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      terminal.add(key);
      terminalReadinessReasons.set(key, readinessReason);
      timers.delete(key);
      runWindows.delete(key);
      acquired = true;
    }
    return Object.freeze({ owner: terminalPersistenceOwner(key), acquired });
  };

  const terminalize = (
    key: string,
    operationId: string,
    reason: LiveSmokeTerminalSignalReason,
  ): void => {
    if (terminal.has(key)) return;
    const owner = terminalPersistenceOwner(key);
    settleWindow(key, reason);
    if (owner === "runner") {
      for (const listener of terminalListeners.get(key) ?? []) {
        try {
          listener(reason);
        } catch {
          // A runner listener cannot change terminal ownership or break terminalization.
        }
      }
      return;
    }
    const completion = (async (): Promise<void> => {
      try {
        await input.terminalAttempts.recordFailure({
          operationId,
          outcome:
            reason === "persistence_unavailable" ? "evidence_unavailable" : "provider_failed",
          retryable: false,
        });
      } catch {
        // The durable write is best effort for the coordinator-owned fail-safe path.
      } finally {
        try {
          input.closeRunGate();
        } catch {
          // Gate closure cannot prevent the remaining cleanup attempt.
        }
        try {
          await input.cleanup?.();
        } catch {
          // Cleanup failure is surfaced by the cleanup owner and cannot reopen the run.
        }
      }
    })();
    coordinatorTerminalCompletions.set(key, completion);
    void completion.finally(() => {
      if (coordinatorTerminalCompletions.get(key) === completion) {
        coordinatorTerminalCompletions.delete(key);
      }
      terminalListeners.delete(key);
    });
  };

  const appendReconciliationIfReady = async (
    run: ReadinessInput,
    facts: readonly LiveSimulatorProviderFact[],
  ): Promise<
    | Readonly<{ outcome: "facts"; facts: readonly LiveSimulatorProviderFact[] }>
    | Readonly<{ outcome: "terminal"; readiness: LiveSmokeEvidenceReadiness }>
  > => {
    const key = operationKey(run.organizationId, run.operationId);
    if (facts.some(({ phase }) => phase === "reconciliation") || input.reconcile === undefined) {
      return Object.freeze({ outcome: "facts", facts });
    }
    const phases = new Set(facts.map(({ phase }) => phase));
    const requiredPhases: readonly LiveSimulatorProviderFact["phase"][] = [
      "voice",
      "canary",
      "status",
      "calle_terminal",
    ];
    if (!requiredPhases.every((phase) => phases.has(phase))) {
      return Object.freeze({ outcome: "facts", facts });
    }
    const voice = facts.find(({ phase }) => phase === "voice");
    if (voice === undefined) return Object.freeze({ outcome: "facts", facts });
    const result = await input.reconcile({
      organizationId: run.organizationId,
      operationId: run.operationId,
      providerCallDigest: voice.providerCallDigest,
    });
    const afterReconciliation = terminalReadiness(key);
    if (afterReconciliation !== undefined) {
      return Object.freeze({ outcome: "terminal", readiness: afterReconciliation });
    }
    const semanticDigest = createHash("sha256")
      .update(
        JSON.stringify([
          run.operationId,
          "reconciliation",
          voice.providerCallDigest,
          result.outcome,
          result.inboundCallCount,
        ]),
        "utf8",
      )
      .digest("hex");
    await appendProviderFact({
      organizationId: run.organizationId,
      operationId: run.operationId,
      phase: "reconciliation",
      providerCallDigest: voice.providerCallDigest,
      semanticDigest,
      outcome: result.outcome,
      occurredAt: now(),
      traceId: voice.traceId,
      signatureValidated: false,
      actionsObserved: null,
      inboundCallCount: result.inboundCallCount,
    });
    const afterAppend = terminalReadiness(key);
    if (afterAppend !== undefined) {
      return Object.freeze({ outcome: "terminal", readiness: afterAppend });
    }
    const reconciledFacts = await listProviderFacts(run.organizationId, run.operationId);
    const afterFinalRead = terminalReadiness(key);
    return afterFinalRead === undefined
      ? Object.freeze({ outcome: "facts", facts: reconciledFacts })
      : Object.freeze({ outcome: "terminal", readiness: afterFinalRead });
  };

  const readReadiness = async (run: ReadinessInput): Promise<LiveSmokeEvidenceReadiness> => {
    const key = operationKey(run.organizationId, run.operationId);
    const beforeRead = terminalReadiness(key);
    if (beforeRead !== undefined) return beforeRead;
    let facts = await listProviderFacts(run.organizationId, run.operationId);
    const afterRead = terminalReadiness(key);
    if (afterRead !== undefined) return afterRead;
    const reconciliation = await appendReconciliationIfReady(run, facts);
    const afterReconciliation = terminalReadiness(key);
    if (afterReconciliation !== undefined) return afterReconciliation;
    if (reconciliation.outcome === "terminal") return reconciliation.readiness;
    facts = reconciliation.facts;
    if (facts.length !== 5) return Object.freeze({ outcome: "blocked", reason: "incomplete" });
    if (!isAdmissibleSet(facts)) {
      return Object.freeze({ outcome: "blocked", reason: "invalid_order" });
    }
    const settlement = settleWindow(key);
    if (!settlement.acquired) return terminalReadiness(key)!;
    return Object.freeze({
      outcome: "ready",
      dtmfActions: 0,
      twilioReconciliation: "1 matching call",
    });
  };

  return Object.freeze({
    claimTerminalPersistence(run: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
    }): LiveSmokeTerminalPersistenceOwner {
      const key = operationKey(run.organizationId, run.operationId);
      if (terminal.has(key)) return terminalPersistenceOwner(key);
      runnerOwnedTerminalPersistence.add(key);
      return "runner";
    },

    onTerminal(
      run: {
        readonly organizationId: OrganizationId;
        readonly operationId: string;
      },
      listener: (reason: LiveSmokeTerminalSignalReason) => void,
    ): () => void {
      const key = operationKey(run.organizationId, run.operationId);
      let listeners = terminalListeners.get(key);
      if (listeners === undefined) {
        listeners = new Set();
        terminalListeners.set(key, listeners);
      }
      listeners.add(listener);
      const terminalReason = terminalReadinessReasons.get(key);
      if (terminalReason === "provider_failed" || terminalReason === "persistence_unavailable") {
        listener(terminalReason);
      }
      return () => {
        listeners?.delete(listener);
        if (listeners?.size === 0) terminalListeners.delete(key);
      };
    },

    settle(run: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
    }): LiveSmokeTerminalPersistenceOwner {
      return settleWindow(operationKey(run.organizationId, run.operationId)).owner;
    },

    async completeTerminalPersistence(run: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
    }): Promise<void> {
      const key = operationKey(run.organizationId, run.operationId);
      if (terminalPersistenceOwner(key) === "coordinator") {
        await coordinatorTerminalCompletions.get(key);
        return;
      }
      if (runnerTerminalCompletion.has(key)) {
        return;
      }
      runnerTerminalCompletion.add(key);
      try {
        input.closeRunGate();
      } catch {
        // Closing and cleanup are fail-safe best effort after the sole terminal write attempt.
      }
      try {
        await input.cleanup?.();
      } catch {
        // Cleanup cannot change the cached, nonretryable terminal result.
      } finally {
        terminalListeners.delete(key);
      }
    },

    begin(run: BeginInput): void {
      const terminalDeadlineMs = run.terminalDeadlineMs ?? run.deadlineMs;
      if (!Number.isSafeInteger(run.deadlineMs) || run.deadlineMs < 1 || run.deadlineMs > 120_000) {
        throw new Error("Live-smoke callback deadline must be between 1 and 120000ms");
      }
      if (
        !Number.isSafeInteger(terminalDeadlineMs) ||
        terminalDeadlineMs < run.deadlineMs ||
        terminalDeadlineMs > 305_000
      ) {
        throw new Error(
          "Live-smoke terminal deadline must be between callback deadline and 305000ms",
        );
      }
      const key = operationKey(run.organizationId, run.operationId);
      if (terminal.has(key) || timers.has(key)) return;
      const startedAtMs = Date.parse(now());
      if (!Number.isFinite(startedAtMs)) {
        throw new Error("Live-smoke deadline clock is invalid");
      }
      runWindows.set(key, {
        run,
        startedAtMs,
        terminalDeadlineMs,
        callbackObserved: false,
      });
      const timer = startTimer(
        () => terminalize(key, run.operationId, "provider_failed"),
        run.deadlineMs,
      );
      timers.set(key, timer);
    },

    recordCallbackActivity(run: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
    }): void {
      const key = operationKey(run.organizationId, run.operationId);
      if (terminal.has(key)) return;
      const window = runWindows.get(key);
      if (window === undefined || window.callbackObserved) return;
      window.callbackObserved = true;
      const timer = timers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      const elapsedMs = Date.parse(now()) - window.startedAtMs;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        terminalize(key, window.run.operationId, "provider_failed");
        return;
      }
      const remainingMs = window.terminalDeadlineMs - elapsedMs;
      if (remainingMs <= 0) {
        terminalize(key, window.run.operationId, "provider_failed");
        return;
      }
      timers.set(
        key,
        startTimer(() => terminalize(key, window.run.operationId, "provider_failed"), remainingMs),
      );
    },

    recordProviderFactPersistenceFailure(run: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
    }): void {
      terminalize(
        operationKey(run.organizationId, run.operationId),
        run.operationId,
        "persistence_unavailable",
      );
    },

    async recordCalleTerminal(record: TerminalInput): Promise<void> {
      if (input.organizationId === undefined) {
        throw new Error("Live-smoke evidence organization is unavailable");
      }
      const key = operationKey(input.organizationId, record.operationId);
      if (terminalReadiness(key) !== undefined) return;
      const admission =
        (await input.admitCalleEvidence?.(record.providerOutput)) ??
        Object.freeze({ outcome: "inadmissible" as const });
      if (terminalReadiness(key) !== undefined) return;
      const semanticDigest = createHash("sha256")
        .update(
          JSON.stringify([record.operationId, "calle_terminal", record.providerOutput]),
          "utf8",
        )
        .digest("hex");
      await appendProviderFact({
        organizationId: input.organizationId,
        operationId: record.operationId,
        phase: "calle_terminal",
        providerCallDigest: record.providerCallDigest ?? "0".repeat(64),
        semanticDigest,
        outcome: admission.outcome,
        occurredAt: now(),
        traceId: record.traceId,
        signatureValidated: false,
        actionsObserved: null,
        inboundCallCount: null,
      });
      if (terminalReadiness(key) !== undefined) return;
    },

    async assertReady(run: ReadinessInput): Promise<LiveSmokeEvidenceReadiness> {
      try {
        return await readReadiness(run);
      } catch (error: unknown) {
        if (!(error instanceof LiveSmokeEvidencePersistenceError)) throw error;
        return Object.freeze({ outcome: "blocked", reason: "persistence_unavailable" });
      }
    },

    async waitUntilReady(run: ReadinessInput): Promise<LiveSmokeEvidenceReadiness> {
      return await new Promise<LiveSmokeEvidenceReadiness>((resolve) => {
        let checking = false;
        let settled = false;
        let unsubscribe = (): void => undefined;
        const lifecycle: { poll?: ReturnType<typeof setInterval> } = {};
        const finish = (result: LiveSmokeEvidenceReadiness): void => {
          if (settled) return;
          settled = true;
          if (lifecycle.poll !== undefined) clearInterval(lifecycle.poll);
          unsubscribe();
          resolve(result);
        };
        const check = (): void => {
          if (checking || settled) return;
          checking = true;
          void readReadiness(run)
            .then((result) => {
              if (
                result.outcome === "ready" ||
                result.reason === "terminal" ||
                result.reason === "provider_failed" ||
                result.reason === "persistence_unavailable"
              ) {
                finish(result);
              }
            })
            .catch((error: unknown) =>
              finish(
                Object.freeze({
                  outcome: "blocked",
                  reason:
                    error instanceof LiveSmokeEvidencePersistenceError
                      ? "persistence_unavailable"
                      : "terminal",
                }),
              ),
            )
            .finally(() => {
              checking = false;
            });
        };
        unsubscribe = input.waitForFact?.(check) ?? (() => undefined);
        lifecycle.poll = setInterval(check, 10);
        lifecycle.poll.unref?.();
        check();
      });
    },
  });
}
