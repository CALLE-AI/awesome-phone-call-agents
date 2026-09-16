import {
  type LiveSmokePreflightProbe,
  type LiveSmokePreflightResult,
} from "./live-smoke-preflight-orchestration.js";

export {
  createLiveSmokePreflight,
  type LiveSmokePreflightProbe,
  type LiveSmokePreflightProbes,
  type LiveSmokePreflightResult,
} from "./live-smoke-preflight-orchestration.js";

export interface LiveSmokePreflightFacts {
  readonly runtimeProfile: string;
  readonly publicOrigin: string;
  readonly ngrokCaptureDisabled: boolean;
  readonly runtimeSecretReferencesResolved: boolean;
  readonly durableAuthorizationStoreReady: boolean;
  readonly durableEvidenceStoreReady: boolean;
  readonly traceContextReady: boolean;
  readonly targetAuthorized: boolean;
  readonly calleAccountReachable: boolean;
  readonly twilioAccountReachable: boolean;
  readonly twilioRestingRejectVerified: boolean;
  readonly productionCapabilityAbsent: boolean;
  readonly runGate: "OPEN" | "CLOSED";
  readonly emergencyStopHealthy: boolean;
}

const officialCalleApiOrigin = "https://api.heycall-e.com" as const;
const productionLiveSmokeMarkers = Object.freeze([
  "/twilio/voice",
  "/twilio/canary",
  "/twilio/status",
  "@muster/simulator-host",
  "@muster/infrastructure-calle",
  "@call-e/calle",
  "Run live observation",
]);

type ReadOnlyFetch = (
  url: string,
  init: Readonly<{
    method: "GET";
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }>,
) => Promise<Readonly<{ ok: boolean }>>;

function canonicalOfficialCalleOrigin(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    parsed.origin !== officialCalleApiOrigin ||
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.port.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    value !== officialCalleApiOrigin
  ) {
    return undefined;
  }
  return parsed.origin;
}

/** Resolves and attaches the credential only after exact official-origin validation. */
export function createCalleAccountProbe(input: {
  readonly apiOrigin: string;
  readonly resolveApiKey: () => Promise<string>;
  readonly fetch: ReadOnlyFetch;
}): LiveSmokePreflightProbe {
  return async () => {
    const origin = canonicalOfficialCalleOrigin(input.apiOrigin);
    if (origin === undefined) return Object.freeze({ outcome: "BLOCKED" as const });
    try {
      const apiKey = await input.resolveApiKey();
      if (apiKey.length === 0) return Object.freeze({ outcome: "BLOCKED" as const });
      const response = await input.fetch(`${origin}/v1/goals`, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return Object.freeze({ outcome: response.ok ? "PASS" : "BLOCKED" });
    } catch {
      return Object.freeze({ outcome: "BLOCKED" as const });
    }
  };
}

export function createProductionExclusionProbe(input: {
  readonly readArtifacts: () => Promise<readonly Readonly<{ path: string; content: string }>[]>;
}): LiveSmokePreflightProbe {
  return async () => {
    try {
      const artifacts = await input.readArtifacts();
      const requiredApplications = ["apps/api/dist/", "apps/worker/dist/", "apps/web/dist/"];
      const complete = requiredApplications.every((prefix) =>
        artifacts.some(({ path }) => path.replaceAll("\\", "/").startsWith(prefix)),
      );
      const forbidden = artifacts.some(({ content }) =>
        productionLiveSmokeMarkers.some((marker) => content.includes(marker)),
      );
      return Object.freeze({ outcome: complete && !forbidden ? "PASS" : "BLOCKED" });
    } catch {
      return Object.freeze({ outcome: "BLOCKED" as const });
    }
  };
}

export async function runLiveSmokePreflight(input: {
  readonly facts: LiveSmokePreflightFacts;
  /** Deliberately ignored: preflight is incapable of constructing a calling provider. */
  readonly createProvider?: () => unknown;
}): Promise<LiveSmokePreflightResult> {
  const facts = input.facts;
  const checks = Object.freeze([
    { label: "Non-production runtime", pass: facts.runtimeProfile !== "production" },
    { label: "Exact public HTTPS origin", pass: /^https:\/\/[^/?#]+$/u.test(facts.publicOrigin) },
    { label: "Tunnel capture disabled", pass: facts.ngrokCaptureDisabled },
    { label: "Runtime secret references", pass: facts.runtimeSecretReferencesResolved },
    { label: "Durable authorization store", pass: facts.durableAuthorizationStoreReady },
    { label: "Durable evidence store", pass: facts.durableEvidenceStoreReady },
    { label: "Trace context", pass: facts.traceContextReady },
    { label: "Synthetic target authorization", pass: facts.targetAuthorized },
    { label: "CALL-E account", pass: facts.calleAccountReachable },
    { label: "Twilio account", pass: facts.twilioAccountReachable },
    { label: "Twilio resting Reject", pass: facts.twilioRestingRejectVerified },
    { label: "Production capability absent", pass: facts.productionCapabilityAbsent },
    { label: "Run gate closed", pass: facts.runGate === "CLOSED" },
    { label: "Emergency stop", pass: facts.emergencyStopHealthy },
  ]);
  const passed = checks.every((check) => check.pass);
  return Object.freeze({
    outcome: passed ? "PASS" : "BLOCKED",
    title: "Live-smoke preflight",
    runGateLabel: facts.runGate === "CLOSED" ? "Run gate: CLOSED" : "Run gate: BLOCKED",
    emergencyStopLabel: "Emergency stop",
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({ label: check.label, outcome: check.pass ? "PASS" : "BLOCKED" }),
      ),
    ),
  });
}

type ConfirmationReceipt = Readonly<{
  readonly kind: "live-smoke-billable-confirmation";
  readonly confirmedAt: number;
  readonly nonce: symbol;
}>;

export function createLiveSmokeArmSequence(input: {
  readonly confirmationMaxAgeMs: number;
  readonly now: () => number;
  readonly armTwilio: () => Promise<void>;
  readonly verifyTwilio: () => Promise<boolean>;
  readonly openRunGate: () => void;
  readonly mintAuthorization: () => Promise<string>;
  readonly reserveAuthorization: (authorization: string) => Promise<"reserved" | string>;
  readonly cleanup?: () => Promise<Readonly<{ outcome: "restored" | "blocked" }>>;
}) {
  if (
    !Number.isSafeInteger(input.confirmationMaxAgeMs) ||
    input.confirmationMaxAgeMs < 1 ||
    input.confirmationMaxAgeMs > 60_000
  ) {
    throw new Error("Invalid confirmation maximum age");
  }
  const receipts = new Set<symbol>();
  return Object.freeze({
    confirm(): ConfirmationReceipt {
      const nonce = Symbol("live-smoke-confirmation");
      receipts.add(nonce);
      return Object.freeze({
        kind: "live-smoke-billable-confirmation",
        confirmedAt: input.now(),
        nonce,
      });
    },
    async arm(
      receipt?: ConfirmationReceipt,
    ): Promise<
      | Readonly<{ outcome: "armed" }>
      | Readonly<{ outcome: "blocked"; hostAndTunnelMustRemainUp?: true }>
    > {
      if (
        receipt === undefined ||
        receipt.kind !== "live-smoke-billable-confirmation" ||
        !receipts.delete(receipt.nonce) ||
        input.now() - receipt.confirmedAt < 0 ||
        input.now() - receipt.confirmedAt > input.confirmationMaxAgeMs
      ) {
        return Object.freeze({ outcome: "blocked" });
      }
      try {
        await input.armTwilio();
        if (!(await input.verifyTwilio())) {
          const restored = await input.cleanup?.();
          return restored?.outcome === "blocked"
            ? Object.freeze({ outcome: "blocked", hostAndTunnelMustRemainUp: true })
            : Object.freeze({ outcome: "blocked" });
        }
        input.openRunGate();
        const authorization = await input.mintAuthorization();
        if (authorization.length === 0) {
          const restored = await input.cleanup?.();
          return restored?.outcome === "blocked"
            ? Object.freeze({ outcome: "blocked", hostAndTunnelMustRemainUp: true })
            : Object.freeze({ outcome: "blocked" });
        }
        const reservation = await input.reserveAuthorization(authorization);
        if (reservation === "reserved") return Object.freeze({ outcome: "armed" });
        const restored = await input.cleanup?.();
        return restored?.outcome === "blocked"
          ? Object.freeze({ outcome: "blocked", hostAndTunnelMustRemainUp: true })
          : Object.freeze({ outcome: "blocked" });
      } catch {
        const restored = await input.cleanup?.().catch(() => ({ outcome: "blocked" as const }));
        return restored?.outcome === "blocked"
          ? Object.freeze({ outcome: "blocked", hostAndTunnelMustRemainUp: true })
          : Object.freeze({ outcome: "blocked" });
      }
    },
  });
}
