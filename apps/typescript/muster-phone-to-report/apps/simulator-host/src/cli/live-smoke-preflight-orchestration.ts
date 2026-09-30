export type LiveSmokePreflightResult = Readonly<{
  outcome: "PASS" | "BLOCKED";
  title: "Live-smoke preflight";
  runGateLabel: "Run gate: CLOSED" | "Run gate: BLOCKED";
  emergencyStopLabel: "Emergency stop";
  checks: readonly Readonly<{ label: string; outcome: "PASS" | "BLOCKED" }>[];
}>;

export type LiveSmokePreflightProbe = () => Promise<Readonly<{ outcome: "PASS" | "BLOCKED" }>>;

export interface LiveSmokePreflightProbes {
  readonly runtimeSecretReferences: LiveSmokePreflightProbe;
  readonly durableRepositories: LiveSmokePreflightProbe;
  readonly runGateAndKillSwitch: LiveSmokePreflightProbe;
  readonly publicOrigin: LiveSmokePreflightProbe;
  readonly twilioRestingConfiguration: LiveSmokePreflightProbe;
  readonly providerAccounts: LiveSmokePreflightProbe;
  readonly ngrokCapturePolicy: LiveSmokePreflightProbe;
  readonly traceAndSignatureConfiguration: LiveSmokePreflightProbe;
  readonly authorizedIdentities: LiveSmokePreflightProbe;
  readonly productionExclusion: LiveSmokePreflightProbe;
}

const probeLabels: Readonly<Record<keyof LiveSmokePreflightProbes, string>> = Object.freeze({
  runtimeSecretReferences: "Runtime secret references",
  durableRepositories: "Durable repositories and migration",
  runGateAndKillSwitch: "Closed run gate and emergency stop",
  publicOrigin: "Exact public HTTPS origin",
  twilioRestingConfiguration: "Twilio resting Reject read-back",
  providerAccounts: "CALL-E and Twilio read-only account access",
  ngrokCapturePolicy: "Approved ngrok capture policy",
  traceAndSignatureConfiguration: "Trace and signature configuration",
  authorizedIdentities: "Authorized target digest",
  productionExclusion: "Production capability absent",
});

/** A non-dispatch-capable composition: it accepts only narrow read-only probes. */
export function createLiveSmokePreflight(input: {
  readonly probes: LiveSmokePreflightProbes;
  readonly twilioRestingConfigurationLabel?: string;
}) {
  return Object.freeze({
    async run(): Promise<LiveSmokePreflightResult> {
      const checks = await Promise.all(
        (Object.keys(probeLabels) as Array<keyof LiveSmokePreflightProbes>).map(async (name) => {
          const label =
            name === "twilioRestingConfiguration"
              ? (input.twilioRestingConfigurationLabel ?? probeLabels[name])
              : probeLabels[name];
          try {
            const result = await input.probes[name]();
            return Object.freeze({ label, outcome: result.outcome });
          } catch {
            return Object.freeze({ label, outcome: "BLOCKED" as const });
          }
        }),
      );
      const passed = checks.every(({ outcome }) => outcome === "PASS");
      return Object.freeze({
        outcome: passed ? "PASS" : "BLOCKED",
        title: "Live-smoke preflight",
        runGateLabel: passed ? "Run gate: CLOSED" : "Run gate: BLOCKED",
        emergencyStopLabel: "Emergency stop",
        checks: Object.freeze(checks),
      });
    },
  });
}
