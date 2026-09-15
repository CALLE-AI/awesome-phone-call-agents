import {
  createLiveSmokePreflight,
  type LiveSmokePreflightProbe,
  type LiveSmokePreflightProbes,
} from "./live-smoke-preflight-orchestration.js";

const probeNames = Object.freeze([
  "runtimeSecretReferences",
  "durableRepositories",
  "runGateAndKillSwitch",
  "publicOrigin",
  "twilioRestingConfiguration",
  "providerAccounts",
  "ngrokCapturePolicy",
  "traceAndSignatureConfiguration",
  "authorizedIdentities",
  "productionExclusion",
] as const satisfies readonly (keyof LiveSmokePreflightProbes)[]);

const probeContractIds = Object.freeze(
  probeNames.map(
    (_name, index) => `injected-preflight-probe-${String(index + 1).padStart(2, "0")}` as const,
  ),
);

export async function runLocalProviderFreePreflightOrchestration() {
  const probeExecutions: Record<keyof LiveSmokePreflightProbes, number> = {
    runtimeSecretReferences: 0,
    durableRepositories: 0,
    runGateAndKillSwitch: 0,
    publicOrigin: 0,
    twilioRestingConfiguration: 0,
    providerAccounts: 0,
    ngrokCapturePolicy: 0,
    traceAndSignatureConfiguration: 0,
    authorizedIdentities: 0,
    productionExclusion: 0,
  };
  const pass = Object.freeze({ outcome: "PASS" as const });
  const deterministicPassProbe = (
    name: keyof LiveSmokePreflightProbes,
  ): LiveSmokePreflightProbe => {
    return async () => {
      probeExecutions[name] += 1;
      return pass;
    };
  };
  const probes: LiveSmokePreflightProbes = Object.freeze({
    runtimeSecretReferences: deterministicPassProbe("runtimeSecretReferences"),
    durableRepositories: deterministicPassProbe("durableRepositories"),
    runGateAndKillSwitch: deterministicPassProbe("runGateAndKillSwitch"),
    publicOrigin: deterministicPassProbe("publicOrigin"),
    twilioRestingConfiguration: deterministicPassProbe("twilioRestingConfiguration"),
    providerAccounts: deterministicPassProbe("providerAccounts"),
    ngrokCapturePolicy: deterministicPassProbe("ngrokCapturePolicy"),
    traceAndSignatureConfiguration: deterministicPassProbe("traceAndSignatureConfiguration"),
    authorizedIdentities: deterministicPassProbe("authorizedIdentities"),
    productionExclusion: deterministicPassProbe("productionExclusion"),
  });

  const result = await createLiveSmokePreflight({ probes }).run();
  const passed = result.checks.filter((check) => check.outcome === "PASS").length;
  const totalProbeExecutions = probeNames.reduce((total, name) => total + probeExecutions[name], 0);
  const probesExecutedExactlyOnce = probeNames.every((name) => probeExecutions[name] === 1);
  const probesEvidence = Object.freeze(
    result.checks.map((check, index) =>
      Object.freeze({
        contractId: probeContractIds[index]!,
        executionOutcome: check.outcome,
      }),
    ),
  );

  if (
    result.outcome !== "PASS" ||
    result.runGateLabel !== "Run gate: CLOSED" ||
    result.checks.length !== 10 ||
    passed !== 10 ||
    totalProbeExecutions !== 10 ||
    !probesExecutedExactlyOnce
  ) {
    throw new Error("Local preflight orchestration invariant failed");
  }

  return Object.freeze({
    contract: "createLiveSmokePreflight" as const,
    outcome: "PASS" as const,
    passed,
    total: result.checks.length,
    probeExecutions: totalProbeExecutions,
    exactlyOnce: probesExecutedExactlyOnce,
    probes: probesEvidence,
  });
}
