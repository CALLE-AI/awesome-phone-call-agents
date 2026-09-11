type CleanupResult =
  | Readonly<{ outcome: "restored"; hostAndTunnelMustRemainUp: false }>
  | Readonly<{ outcome: "blocked"; hostAndTunnelMustRemainUp: true }>
  | Readonly<{
      outcome: "review_startup_release_failed";
      message: "Review startup failed; protected demo result deleted; local resource close requires attention";
      hostAndTunnelMustRemainUp: false;
      protectedStateRevoked: true;
      closeFailures: readonly ("runtime" | "observability")[];
    }>
  | Readonly<{
      outcome: "manual_stop_required";
      hostAndTunnelMustRemainUp: false;
      hostStopped: true;
      tunnelStopRequired: true;
    }>;
type BlockedResult = Readonly<{ status: "blocked"; hostAndTunnelMustRemainUp: true }>;
type ManualStopResult = Readonly<{
  outcome: "manual_stop_required";
  hostAndTunnelMustRemainUp: false;
  hostStopped: true;
  tunnelStopRequired: true;
}>;
type ReviewStartupReleaseFailedResult = Extract<
  CleanupResult,
  { readonly outcome: "review_startup_release_failed" }
>;

interface GuardedLiveSmokeRunGate {
  open(): void;
  close(): void;
  state(): "OPEN" | "CLOSED";
  assertOpen(): void;
}

export interface GuardedLiveSmokeCleanupContext {
  readonly operationId?: string;
  readonly admission: "not_started" | "indeterminate";
  readonly previousOwnerStopped: boolean;
}

export function createGuardedLiveSmokeProcess<TResult, TControlTransport>(input: {
  readonly preflight: { run(): Promise<Readonly<{ outcome: "PASS" | "BLOCKED" }>> };
  readonly confirm: () => Promise<boolean>;
  readonly createRunGate: () => GuardedLiveSmokeRunGate;
  readonly createControlTransport: () => TControlTransport;
  readonly createControl: (transport: TControlTransport) => {
    arm(): Promise<"armed" | "blocked">;
    reconcile(input: {
      readonly startedAt: string;
      readonly endedAt: string;
      readonly boundCallDigest: string;
    }): Promise<
      Readonly<{
        outcome: "one_matching_call" | "zero_calls" | "mismatched_call" | "multiple_calls";
        inboundCallCount: number;
      }>
    >;
  };
  readonly startGuardedRuntime: (input: {
    readonly runGate: GuardedLiveSmokeRunGate;
    readonly reconcileLiveSmoke: (run: { readonly providerCallDigest: string }) => Promise<
      Readonly<{
        outcome: "one_matching_call" | "zero_calls" | "mismatched_call" | "multiple_calls";
        inboundCallCount: number;
      }>
    >;
    readonly cleanupLiveSmoke: () => Promise<CleanupResult>;
  }) => Promise<Readonly<{ baseUrl: string; close(): Promise<void> }>>;
  readonly cleanup: (context: GuardedLiveSmokeCleanupContext) => Promise<CleanupResult>;
  readonly mintAndReserve: (run: {
    readonly scenarioId: string;
    readonly scenarioRevision: number;
    readonly predecessorOperationId?: string;
  }) => Promise<Readonly<{ operationId: string; permit: string }>>;
  readonly attachViewer: (input: {
    readonly baseUrl: string;
    readonly identity: Readonly<{
      operationId: string;
      scenarioId: string;
      scenarioRevision: number;
    }>;
  }) => Promise<"attached" | "blocked" | Readonly<{ outcome: "attached" | "blocked" }>>;
  readonly submitAndWait: (input: {
    readonly baseUrl: string;
    readonly scenarioId: string;
    readonly scenarioRevision: number;
    readonly operationId: string;
    readonly permit: string;
    readonly signal: AbortSignal;
  }) => Promise<TResult>;
  readonly shutdownAfterRun?: () => Promise<unknown>;
  readonly now?: () => string;
}) {
  let consumed = false;
  let runSettled = false;
  let activeAbortController: AbortController | undefined;
  let activeRunGate: GuardedLiveSmokeRunGate | undefined;
  let activeRuntimeStartup: ReturnType<typeof input.startGuardedRuntime> | undefined;
  let activeIdentityEstablishment:
    | Promise<
        Readonly<{
          operationId: string;
          permit: string;
        }>
      >
    | undefined;
  let activeArmSettlement: Promise<"armed" | "blocked"> | undefined;
  let cleanupExecution: Promise<CleanupResult> | undefined;
  let cleanupContext: GuardedLiveSmokeCleanupContext = Object.freeze({
    admission: "not_started",
    previousOwnerStopped: false,
  });
  const cleanupOwned = (): Promise<CleanupResult> =>
    (cleanupExecution ??= input.cleanup(cleanupContext));
  const blocked = (): BlockedResult =>
    Object.freeze({ status: "blocked" as const, hostAndTunnelMustRemainUp: true as const });
  return Object.freeze({
    prepare: async () => await input.preflight.run(),
    async run(run: {
      readonly scenarioId: string;
      readonly scenarioRevision: number;
      readonly predecessorOperationId?: string;
    }): Promise<TResult | BlockedResult | ManualStopResult | ReviewStartupReleaseFailedResult> {
      if (consumed) return blocked();
      consumed = true;
      const abortController = new AbortController();
      activeAbortController = abortController;
      try {
        const preflight = await input.preflight.run();
        if (
          abortController.signal.aborted ||
          preflight.outcome !== "PASS" ||
          !(await input.confirm()) ||
          abortController.signal.aborted
        ) {
          return blocked();
        }
        const runGate = input.createRunGate();
        activeRunGate = runGate;
        if (runGate.state() !== "CLOSED") return blocked();
        const startedAt = (input.now ?? (() => new Date().toISOString()))();
        const controlRef: { current?: ReturnType<typeof input.createControl> } = {};
        const runtimeStartup = input.startGuardedRuntime({
          runGate,
          cleanupLiveSmoke: cleanupOwned,
          reconcileLiveSmoke: async ({ providerCallDigest }) => {
            if (controlRef.current === undefined)
              throw new Error("Live-smoke control is unavailable");
            const result = await controlRef.current.reconcile({
              startedAt,
              endedAt: (input.now ?? (() => new Date().toISOString()))(),
              boundCallDigest: providerCallDigest,
            });
            return Object.freeze({
              outcome: result.outcome,
              inboundCallCount: result.inboundCallCount,
            });
          },
        });
        activeRuntimeStartup = runtimeStartup;
        const runtime = await runtimeStartup;
        if (activeRuntimeStartup === runtimeStartup) activeRuntimeStartup = undefined;
        if (abortController.signal.aborted) {
          runGate.close();
          await cleanupOwned();
          return blocked();
        }
        const identityEstablishment = input.mintAndReserve(run).then((authorization) => {
          cleanupContext = Object.freeze({
            operationId: authorization.operationId,
            admission: "not_started",
            previousOwnerStopped: false,
          });
          return authorization;
        });
        activeIdentityEstablishment = identityEstablishment;
        const authorization = await identityEstablishment;
        if (activeIdentityEstablishment === identityEstablishment) {
          activeIdentityEstablishment = undefined;
        }
        if (abortController.signal.aborted) {
          runGate.close();
          await cleanupOwned();
          return blocked();
        }
        const attachment = await input.attachViewer({
          baseUrl: runtime.baseUrl,
          identity: Object.freeze({
            operationId: authorization.operationId,
            scenarioId: run.scenarioId,
            scenarioRevision: run.scenarioRevision,
          }),
        });
        const attached =
          attachment === "attached" ||
          (typeof attachment === "object" && attachment.outcome === "attached");
        if (!attached || abortController.signal.aborted) {
          runGate.close();
          await cleanupOwned();
          return blocked();
        }
        const transport = input.createControlTransport();
        controlRef.current = input.createControl(transport);
        if (abortController.signal.aborted) {
          runGate.close();
          await cleanupOwned();
          return blocked();
        }
        const armSettlement = controlRef.current.arm();
        activeArmSettlement = armSettlement;
        let armOutcome: "armed" | "blocked";
        try {
          armOutcome = await armSettlement;
        } finally {
          if (activeArmSettlement === armSettlement) activeArmSettlement = undefined;
        }
        if (armOutcome !== "armed") {
          runGate.close();
          await cleanupOwned();
          return blocked();
        }
        if (abortController.signal.aborted) {
          runGate.close();
          await cleanupOwned();
          return blocked();
        }
        cleanupContext = Object.freeze({
          operationId: authorization.operationId,
          admission: "indeterminate",
          previousOwnerStopped: false,
        });
        runGate.open();
        const result = await input.submitAndWait({
          baseUrl: runtime.baseUrl,
          ...run,
          operationId: authorization.operationId,
          permit: authorization.permit,
          signal: abortController.signal,
        });
        runGate.close();
        const cleanup = await cleanupOwned();
        return cleanup.outcome === "restored"
          ? result
          : cleanup.outcome === "manual_stop_required" ||
              cleanup.outcome === "review_startup_release_failed"
            ? cleanup
            : blocked();
      } catch {
        activeRunGate?.close();
        const cleanup = await cleanupOwned();
        return cleanup.outcome === "manual_stop_required" ||
          cleanup.outcome === "review_startup_release_failed"
          ? cleanup
          : blocked();
      } finally {
        runSettled = true;
        if (activeAbortController === abortController) activeAbortController = undefined;
        activeRunGate = undefined;
      }
    },
    cleanup: async (context?: GuardedLiveSmokeCleanupContext): Promise<CleanupResult> =>
      await input.cleanup(context ?? cleanupContext),
    async shutdown(): Promise<unknown> {
      if (!runSettled && activeAbortController !== undefined) {
        activeRunGate?.close();
        activeAbortController.abort();
        try {
          await activeRuntimeStartup;
          await activeIdentityEstablishment;
          await activeArmSettlement;
        } catch {
          // The run path owns classification; shutdown still converges through cleanup.
        }
        return await cleanupOwned();
      }
      return input.shutdownAfterRun === undefined
        ? Object.freeze({ outcome: "none" as const })
        : await input.shutdownAfterRun();
    },
  });
}
