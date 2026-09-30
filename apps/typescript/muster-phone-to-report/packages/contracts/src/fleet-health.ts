import type {
  ObservationProvenance,
  ObservationQuality,
  ObservationStage,
  ObservationTrigger,
} from "./observation-api.js";
import type { ObservationTerminalOutcome } from "./observation-job.js";

export const FLEET_HEALTH_CONTRACT_VERSION = "1" as const;

export type FleetOperationalState =
  "unreachable" | "observation_incomplete" | "stale" | "not_observed" | "normal_observed";

export interface FleetFreshness {
  readonly status: "current" | "stale" | "not_observed" | "unavailable";
  readonly observedAt: string | null;
  readonly expiresAt: string | null;
  readonly windowSeconds: number | null;
}

export interface FleetLastAttempt {
  readonly operationId: string;
  readonly resourceVersion: number;
  readonly trigger: ObservationTrigger;
  readonly provenance: ObservationProvenance;
  readonly acceptedAt: string;
  readonly lastTransitionAt: string;
  readonly stage: ObservationStage;
  readonly terminalOutcome: ObservationTerminalOutcome | null;
  readonly retryable: boolean | null;
  readonly observationQuality: ObservationQuality | null;
}

export interface FleetLastCompleteObservation {
  readonly observationId: string;
  readonly operationId: string;
  readonly version: number;
  readonly observedAt: string;
  readonly completedAt: string;
  readonly provenance: ObservationProvenance;
  readonly evidenceId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly reconciliationPolicyVersion: string;
}

export interface FleetActiveManualOperation {
  readonly operationId: string;
  readonly resourceVersion: number;
  readonly stage: Exclude<ObservationStage, "terminal">;
  readonly acceptedAt: string;
}

export type FleetIncident =
  | Readonly<{ status: "none" }>
  | Readonly<{
      status: "open";
      incidentId: string;
      openedAt: string;
      displayLabel: string;
      detailPath: string;
    }>
  | Readonly<{ status: "unavailable" }>;

export interface FleetSchedulerHeartbeat {
  readonly status: "current" | "stale" | "missing" | "unavailable";
  readonly observedAt: string | null;
  readonly checkOutcome: "ready" | "degraded" | null;
  readonly evidenceKind: "foundation_health_job_completion";
}

export interface FleetEndpoint {
  readonly endpointId: string;
  readonly siteDisplayName: string | null;
  readonly endpointDisplayName: string | null;
  readonly provenance: ObservationProvenance;
  readonly operationalState: FleetOperationalState;
  readonly freshness: FleetFreshness;
  readonly lastAttempt: FleetLastAttempt | null;
  readonly lastCompleteObservation: FleetLastCompleteObservation | null;
  readonly activeManualOperation: FleetActiveManualOperation | null;
  readonly incident: FleetIncident;
}

export interface FleetHealthResponse {
  readonly contractVersion: typeof FLEET_HEALTH_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly schedulerHeartbeat: FleetSchedulerHeartbeat;
  readonly endpoints: readonly FleetEndpoint[];
}
