type PreflightResult = Readonly<{ outcome: "PASS" | "BLOCKED" }>;
type CleanupResult =
  | Readonly<{ outcome: "restored"; hostAndTunnelMustRemainUp: false }>
  | Readonly<{ outcome: "blocked"; hostAndTunnelMustRemainUp: true }>;

/**
 * The only runnable live-smoke action. Confirmation is requested inside `run`,
 * immediately after its fail-closed preflight, so a receipt cannot be minted or
 * replayed through a separate runnable path. This layer never receives secrets.
 */
export function createGuardedLiveSmokeOperator<
  TReceipt,
  TExecution extends Readonly<{ operationId: string }>,
  TResult,
>(input: {
  readonly preflight: { run(): Promise<PreflightResult> };
  readonly confirm: () => TReceipt;
  readonly arm: (receipt: TReceipt) => Promise<Readonly<{ outcome: "armed" | "blocked" }>>;
  readonly execute: (execution: TExecution) => Promise<TResult>;
  readonly cleanup: () => Promise<CleanupResult>;
}) {
  return Object.freeze({
    prepare: async (): Promise<PreflightResult> => await input.preflight.run(),
    async run(
      execution: TExecution,
    ): Promise<TResult | Readonly<{ status: "blocked"; hostAndTunnelMustRemainUp: boolean }>> {
      const preflight = await input.preflight.run();
      if (preflight.outcome !== "PASS") {
        return Object.freeze({ status: "blocked", hostAndTunnelMustRemainUp: true });
      }
      const receipt = input.confirm();
      const armed = await input.arm(receipt);
      if (armed.outcome !== "armed") {
        const cleanup = await input.cleanup();
        return Object.freeze({
          status: "blocked",
          hostAndTunnelMustRemainUp: cleanup.hostAndTunnelMustRemainUp,
        });
      }
      let result: TResult | undefined;
      let executionFailure: unknown;
      try {
        result = await input.execute(execution);
      } catch (error: unknown) {
        executionFailure = error;
      }
      const cleanup = await input.cleanup();
      if (cleanup.outcome === "blocked") {
        return Object.freeze({ status: "blocked", hostAndTunnelMustRemainUp: true });
      }
      if (executionFailure !== undefined) throw executionFailure;
      return result as TResult;
    },
    cleanup: async (): Promise<CleanupResult> => await input.cleanup(),
  });
}
