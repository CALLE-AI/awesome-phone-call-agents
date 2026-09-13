import {
  createLiveSmokeRunner,
  type CalleEvidencePersistence,
  type LiveSmokeExecutionInput,
  type LiveSmokeObservability,
  type LiveSmokeResult,
  type RunAuthorizationReservationBoundary,
  type DtmfSafetyStop,
  type LiveSmokeDispatchAttemptPersistence,
  type LiveSmokeResultPersistence,
  type LiveSmokeTerminalAttemptPersistence,
  type LiveSmokeRunGate,
  type LiveSmokeRunnerEvidenceCoordinator,
} from "@muster/infrastructure-twilio-simulator";

import {
  loadSimulatorHostConfiguration,
  type SimulatorHostConfiguration,
} from "../configuration.js";

type LiveRunnerConfiguration = Readonly<
  Pick<
    SimulatorHostConfiguration,
    | "runtimeProfile"
    | "enabled"
    | "callBudget"
    | "concurrency"
    | "timeoutMs"
    | "providerTerminalTimeoutMs"
    | "endpointAlias"
    | "authorizationAudience"
    | "apiToken"
    | "targetAddress"
    | "killSwitch"
  >
>;

interface ProviderBoundary {
  dispatch(
    input: Parameters<Parameters<typeof createLiveSmokeRunner>[0]["dispatch"]>[0],
  ): Promise<unknown>;
  reconcile?(
    input: Parameters<NonNullable<Parameters<typeof createLiveSmokeRunner>[0]["reconcile"]>>[0],
  ): Promise<unknown>;
}

export interface SimulatorHost {
  execute(input: LiveSmokeExecutionInput): Promise<LiveSmokeResult>;
}

export function createSimulatorHost(input: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly configuration?: LiveRunnerConfiguration;
  readonly authorizationBoundary?: RunAuthorizationReservationBoundary;
  readonly evidencePersistence?: CalleEvidencePersistence;
  readonly reviewedConfidenceTokens?: readonly string[];
  readonly observability?: LiveSmokeObservability;
  readonly terminalAttempts?: LiveSmokeTerminalAttemptPersistence;
  readonly dispatchAttempts?: LiveSmokeDispatchAttemptPersistence;
  readonly resultPersistence?: LiveSmokeResultPersistence;
  readonly runGate?: LiveSmokeRunGate;
  readonly evidenceCoordinator?: LiveSmokeRunnerEvidenceCoordinator;
  readonly dtmfSafetyStop: DtmfSafetyStop;
  readonly createProvider: () => ProviderBoundary;
}): SimulatorHost {
  const configuration =
    input.configuration ??
    loadSimulatorHostConfiguration(
      input.environment ?? Object.freeze({ RUNTIME_PROFILE: "production" }),
    );
  let provider: ProviderBoundary | undefined;
  const runner = createLiveSmokeRunner({
    configuration: {
      runtimeProfile: configuration.runtimeProfile,
      enabled: configuration.enabled,
      callBudget: configuration.callBudget,
      concurrency: configuration.concurrency,
      timeoutMs: configuration.timeoutMs,
      providerTerminalTimeoutMs: configuration.providerTerminalTimeoutMs,
      endpointAlias: configuration.endpointAlias,
      authorizationAudience: configuration.authorizationAudience,
      requireCallbackEvidence:
        configuration.runtimeProfile === "development" || input.evidenceCoordinator !== undefined,
    },
    resolvedSecrets: {
      calleApiToken: configuration.apiToken,
      targetAddress: configuration.targetAddress,
    },
    ...(input.authorizationBoundary === undefined
      ? {}
      : { authorizationBoundary: input.authorizationBoundary }),
    ...(input.evidencePersistence === undefined
      ? {}
      : { evidencePersistence: input.evidencePersistence }),
    ...(input.reviewedConfidenceTokens === undefined
      ? {}
      : { reviewedConfidenceTokens: input.reviewedConfidenceTokens }),
    ...(input.observability === undefined ? {} : { observability: input.observability }),
    ...(input.terminalAttempts === undefined ? {} : { terminalAttempts: input.terminalAttempts }),
    ...(input.dispatchAttempts === undefined ? {} : { dispatchAttempts: input.dispatchAttempts }),
    ...(input.resultPersistence === undefined
      ? {}
      : { resultPersistence: input.resultPersistence }),
    ...(input.runGate === undefined ? {} : { runGate: input.runGate }),
    ...(input.evidenceCoordinator === undefined
      ? {}
      : { evidenceCoordinator: input.evidenceCoordinator }),
    killSwitch: configuration.killSwitch,
    dtmfSafetyStop: input.dtmfSafetyStop,
    dispatch: async (request) => {
      provider ??= input.createProvider();
      return await provider.dispatch(request);
    },
    reconcile: async (request) => {
      provider ??= input.createProvider();
      if (provider.reconcile === undefined) {
        throw new Error("CALL-E provider reconciliation is unavailable");
      }
      return await provider.reconcile(request);
    },
  });
  return Object.freeze({
    execute: async (execution: LiveSmokeExecutionInput): Promise<LiveSmokeResult> =>
      await runner.execute(execution),
  });
}
