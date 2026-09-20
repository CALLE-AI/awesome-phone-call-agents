import { describe, expect, it } from "vitest";

type ObservationProvenance = "SIMULATED" | "PROVIDER_OBSERVED";
type ObservationQuality = "complete" | "partial" | "unknown" | "invalid";
type TerminalOutcome =
  | "observation_recorded"
  | "blocked"
  | "no_answer"
  | "busy"
  | "provider_failed"
  | "evidence_unavailable";

interface CompleteObservationFact {
  readonly operationId: string;
  readonly originatingAttemptAcceptedAt: string;
  readonly observedAt: string;
  readonly quality: ObservationQuality;
  readonly provenance: ObservationProvenance;
}

interface TerminalAttemptFact {
  readonly operationId: string;
  readonly acceptedAt: string;
  readonly terminalOutcome: TerminalOutcome;
  readonly observationQuality: ObservationQuality | null;
}

interface PolicyInput {
  readonly now: string;
  readonly freshnessWindowSeconds: number | null;
  readonly lastCompleteObservation: CompleteObservationFact | null;
  readonly latestTerminalAttempt: TerminalAttemptFact | null;
}

interface PolicyResult {
  readonly operationalState:
    "unreachable" | "observation_incomplete" | "stale" | "not_observed" | "normal_observed";
  readonly freshness: {
    readonly status: "current" | "stale" | "not_observed" | "unavailable";
    readonly observedAt: string | null;
    readonly expiresAt: string | null;
    readonly windowSeconds: number | null;
  };
}

interface DomainFleetModule {
  readonly deriveEndpointOperationalState?: (input: PolicyInput) => PolicyResult;
}

async function loadPolicy(): Promise<(input: PolicyInput) => PolicyResult> {
  const loaded = (await import("../index.js")) as DomainFleetModule;
  if (loaded.deriveEndpointOperationalState === undefined) {
    throw new Error("deriveEndpointOperationalState is not implemented");
  }
  return loaded.deriveEndpointOperationalState;
}

const currentComplete: CompleteObservationFact = Object.freeze({
  operationId: "operation_complete_001",
  originatingAttemptAcceptedAt: "2026-08-08T12:00:00.000Z",
  observedAt: "2026-08-08T12:00:05.000Z",
  quality: "complete",
  provenance: "PROVIDER_OBSERVED",
});

describe("deriveEndpointOperationalState", () => {
  // Test strategy: verify the pure safety policy, including decisive-terminal precedence and the
  // exact half-open clock boundary. Prisma selection, HTTP copy, incident policy, and browser
  // styling are deliberately deferred to their owning layers and phases.
  it("allows only a current complete observation to become normal without laundering simulation provenance", async () => {
    const deriveEndpointOperationalState = await loadPolicy();

    for (const provenance of ["PROVIDER_OBSERVED", "SIMULATED"] as const) {
      expect(
        deriveEndpointOperationalState({
          now: "2026-08-08T12:14:59.999Z",
          freshnessWindowSeconds: 900,
          lastCompleteObservation: { ...currentComplete, provenance },
          latestTerminalAttempt: {
            operationId: currentComplete.operationId,
            acceptedAt: currentComplete.originatingAttemptAcceptedAt,
            terminalOutcome: "observation_recorded",
            observationQuality: "complete",
          },
        }),
      ).toEqual({
        operationalState: "normal_observed",
        freshness: {
          status: "current",
          observedAt: "2026-08-08T12:00:05.000Z",
          expiresAt: "2026-08-08T12:15:05.000Z",
          windowSeconds: 900,
        },
      });
    }
  });

  it("fails closed for null, partial, unknown, and invalid decisive observations while retaining complete history", async () => {
    const deriveEndpointOperationalState = await loadPolicy();

    for (const observationQuality of [null, "partial", "unknown", "invalid"] as const) {
      const result = deriveEndpointOperationalState({
        now: "2026-08-08T12:10:00.000Z",
        freshnessWindowSeconds: 900,
        lastCompleteObservation: currentComplete,
        latestTerminalAttempt: {
          operationId: `operation_incomplete_${observationQuality ?? "null"}`,
          acceptedAt: "2026-08-08T12:09:00.000Z",
          terminalOutcome: observationQuality === null ? "blocked" : "observation_recorded",
          observationQuality,
        },
      });

      expect(result.operationalState).toBe("observation_incomplete");
      expect(result.freshness).toMatchObject({
        status: "current",
        observedAt: currentComplete.observedAt,
      });
    }
  });

  it("uses a half-open freshness window and makes missing, invalid, or future evidence unavailable", async () => {
    const deriveEndpointOperationalState = await loadPolicy();
    const scenarios = [
      { now: "2026-08-08T12:15:04.999Z", window: 900, status: "current", state: "normal_observed" },
      { now: "2026-08-08T12:15:05.000Z", window: 900, status: "stale", state: "stale" },
      { now: "2026-08-08T12:15:05.001Z", window: 900, status: "stale", state: "stale" },
      {
        now: "2026-08-08T12:10:00.000Z",
        window: null,
        status: "unavailable",
        state: "observation_incomplete",
      },
      {
        now: "2026-08-08T12:10:00.000Z",
        window: 59,
        status: "unavailable",
        state: "observation_incomplete",
      },
      {
        now: "2026-08-08T11:59:59.999Z",
        window: 900,
        status: "unavailable",
        state: "observation_incomplete",
      },
      { now: "2026-08-08", window: 900, status: "unavailable", state: "observation_incomplete" },
    ] as const;

    for (const scenario of scenarios) {
      const result = deriveEndpointOperationalState({
        now: scenario.now,
        freshnessWindowSeconds: scenario.window,
        lastCompleteObservation: currentComplete,
        latestTerminalAttempt: null,
      });
      expect(result.freshness.status).toBe(scenario.status);
      expect(result.operationalState).toBe(scenario.state);
    }
  });

  it("fails closed when attempt or observation instants are malformed or noncanonical", async () => {
    const deriveEndpointOperationalState = await loadPolicy();
    for (const mutation of [
      { lastCompleteObservation: { ...currentComplete, observedAt: "2026-08-08" } },
      {
        lastCompleteObservation: { ...currentComplete, originatingAttemptAcceptedAt: "2026-08-08" },
      },
      {
        latestTerminalAttempt: {
          operationId: "operation_complete_001",
          acceptedAt: "2026-08-08",
          terminalOutcome: "observation_recorded",
          observationQuality: "complete",
        },
      },
    ] as const) {
      const result = deriveEndpointOperationalState({
        now: "2026-08-08T12:10:00.000Z",
        freshnessWindowSeconds: 900,
        lastCompleteObservation: mutation.lastCompleteObservation ?? currentComplete,
        latestTerminalAttempt: mutation.latestTerminalAttempt ?? {
          operationId: currentComplete.operationId,
          acceptedAt: currentComplete.originatingAttemptAcceptedAt,
          terminalOutcome: "observation_recorded",
          observationQuality: "complete",
        },
      });
      expect(result.operationalState).toBe("observation_incomplete");
    }
  });

  it("lets a decisive unreachable terminal attempt outrank an older complete observation but not a newer one", async () => {
    const deriveEndpointOperationalState = await loadPolicy();
    const unreachableAttempt: TerminalAttemptFact = {
      operationId: "operation_unreachable_001",
      acceptedAt: "2026-08-08T12:09:00.000Z",
      terminalOutcome: "provider_failed",
      observationQuality: null,
    };

    expect(
      deriveEndpointOperationalState({
        now: "2026-08-08T12:10:00.000Z",
        freshnessWindowSeconds: 900,
        lastCompleteObservation: currentComplete,
        latestTerminalAttempt: unreachableAttempt,
      }).operationalState,
    ).toBe("unreachable");

    expect(
      deriveEndpointOperationalState({
        now: "2026-08-08T12:10:00.000Z",
        freshnessWindowSeconds: 900,
        lastCompleteObservation: {
          ...currentComplete,
          operationId: "operation_complete_newer",
          originatingAttemptAcceptedAt: "2026-08-08T12:09:00.001Z",
          observedAt: "2026-08-08T12:09:05.000Z",
        },
        latestTerminalAttempt: unreachableAttempt,
      }).operationalState,
    ).toBe("normal_observed");
  });
});
