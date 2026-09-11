export type FleetObservationQuality = "complete" | "partial" | "unknown" | "invalid";
export type FleetObservationProvenance = "SIMULATED" | "PROVIDER_OBSERVED";
export type FleetTerminalOutcome =
  | "observation_recorded"
  | "blocked"
  | "no_answer"
  | "busy"
  | "provider_failed"
  | "evidence_unavailable";

export interface CompleteFleetObservationFact {
  readonly operationId: string;
  readonly originatingAttemptAcceptedAt: string;
  readonly observedAt: string;
  readonly quality: FleetObservationQuality;
  readonly provenance: FleetObservationProvenance;
}

export interface TerminalFleetAttemptFact {
  readonly operationId: string;
  readonly acceptedAt: string;
  readonly terminalOutcome: FleetTerminalOutcome;
  readonly observationQuality: FleetObservationQuality | null;
}

export interface EndpointOperationalStateInput {
  readonly now: string;
  readonly freshnessWindowSeconds: number | null;
  readonly lastCompleteObservation: CompleteFleetObservationFact | null;
  readonly latestTerminalAttempt: TerminalFleetAttemptFact | null;
}

export interface EndpointOperationalStateResult {
  readonly operationalState:
    "unreachable" | "observation_incomplete" | "stale" | "not_observed" | "normal_observed";
  readonly freshness: {
    readonly status: "current" | "stale" | "not_observed" | "unavailable";
    readonly observedAt: string | null;
    readonly expiresAt: string | null;
    readonly windowSeconds: number | null;
  };
}

const MINIMUM_FRESHNESS_WINDOW_SECONDS = 60;
const MAXIMUM_FRESHNESS_WINDOW_SECONDS = 2_592_000;

function parseInstant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

function isValidWindow(value: number | null): value is number {
  return (
    value !== null &&
    Number.isInteger(value) &&
    value >= MINIMUM_FRESHNESS_WINDOW_SECONDS &&
    value <= MAXIMUM_FRESHNESS_WINDOW_SECONDS
  );
}

function compareAttemptKeys(
  left: { readonly acceptedAt: string; readonly operationId: string },
  right: { readonly acceptedAt: string; readonly operationId: string },
): number | undefined {
  const leftTime = parseInstant(left.acceptedAt);
  const rightTime = parseInstant(right.acceptedAt);
  if (leftTime === undefined || rightTime === undefined) return undefined;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0;
}

function deriveFreshness(
  input: EndpointOperationalStateInput,
): EndpointOperationalStateResult["freshness"] {
  const observation = input.lastCompleteObservation;
  if (observation === null) {
    return Object.freeze({
      status: "not_observed",
      observedAt: null,
      expiresAt: null,
      windowSeconds: isValidWindow(input.freshnessWindowSeconds)
        ? input.freshnessWindowSeconds
        : null,
    });
  }
  if (observation.quality !== "complete") {
    return Object.freeze({
      status: "unavailable",
      observedAt: null,
      expiresAt: null,
      windowSeconds: isValidWindow(input.freshnessWindowSeconds)
        ? input.freshnessWindowSeconds
        : null,
    });
  }

  const now = parseInstant(input.now);
  const observedAt = parseInstant(observation.observedAt);
  if (now === undefined || observedAt === undefined || observedAt > now) {
    return Object.freeze({
      status: "unavailable",
      observedAt: observedAt === undefined ? null : observation.observedAt,
      expiresAt: null,
      windowSeconds: isValidWindow(input.freshnessWindowSeconds)
        ? input.freshnessWindowSeconds
        : null,
    });
  }
  if (!isValidWindow(input.freshnessWindowSeconds)) {
    return Object.freeze({
      status: "unavailable",
      observedAt: observation.observedAt,
      expiresAt: null,
      windowSeconds: null,
    });
  }

  const expiresAt = observedAt + input.freshnessWindowSeconds * 1_000;
  if (!Number.isSafeInteger(expiresAt) || Number.isNaN(new Date(expiresAt).getTime())) {
    return Object.freeze({
      status: "unavailable",
      observedAt: observation.observedAt,
      expiresAt: null,
      windowSeconds: input.freshnessWindowSeconds,
    });
  }

  return Object.freeze({
    status: now < expiresAt ? "current" : "stale",
    observedAt: observation.observedAt,
    expiresAt: new Date(expiresAt).toISOString(),
    windowSeconds: input.freshnessWindowSeconds,
  });
}

export function deriveEndpointOperationalState(
  input: EndpointOperationalStateInput,
): EndpointOperationalStateResult {
  const freshness = deriveFreshness(input);
  const terminalAttempt = input.latestTerminalAttempt;
  const comparison =
    terminalAttempt === null || input.lastCompleteObservation === null
      ? undefined
      : compareAttemptKeys(terminalAttempt, {
          acceptedAt: input.lastCompleteObservation.originatingAttemptAcceptedAt,
          operationId: input.lastCompleteObservation.operationId,
        });
  const terminalAttemptIsDecisive =
    terminalAttempt !== null &&
    (input.lastCompleteObservation === null || (comparison !== undefined && comparison >= 0));

  if (
    terminalAttempt !== null &&
    input.lastCompleteObservation !== null &&
    comparison === undefined
  ) {
    return Object.freeze({ operationalState: "observation_incomplete", freshness });
  }

  if (
    terminalAttemptIsDecisive &&
    ["busy", "no_answer", "provider_failed", "evidence_unavailable"].includes(
      terminalAttempt.terminalOutcome,
    )
  ) {
    return Object.freeze({ operationalState: "unreachable", freshness });
  }
  if (
    terminalAttemptIsDecisive &&
    (terminalAttempt.terminalOutcome === "blocked" ||
      terminalAttempt.observationQuality === null ||
      terminalAttempt.observationQuality !== "complete")
  ) {
    return Object.freeze({ operationalState: "observation_incomplete", freshness });
  }
  if (input.lastCompleteObservation === null) {
    return Object.freeze({ operationalState: "not_observed", freshness });
  }
  if (freshness.status === "unavailable") {
    return Object.freeze({ operationalState: "observation_incomplete", freshness });
  }
  if (freshness.status === "stale") {
    return Object.freeze({ operationalState: "stale", freshness });
  }
  return Object.freeze({ operationalState: "normal_observed", freshness });
}
