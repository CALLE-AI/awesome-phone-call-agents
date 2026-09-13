import type {
  ObservationProvenance,
  ObservationQuality,
  ObservationStage,
  ObservationTrigger,
} from "@muster/contracts";
import type { FleetTerminalOutcome, OrganizationId } from "@muster/domain";

export interface FleetAttemptFact {
  readonly operationId: string;
  readonly resourceVersion: number;
  readonly trigger: ObservationTrigger;
  readonly provenance: ObservationProvenance;
  readonly acceptedAt: string;
  readonly lastTransitionAt: string;
  readonly stage: ObservationStage;
  readonly terminalOutcome: FleetTerminalOutcome | null;
  readonly retryable: boolean | null;
  readonly observationQuality: ObservationQuality | null;
}

export interface FleetTerminalAttemptFact {
  readonly operationId: string;
  readonly acceptedAt: string;
  readonly terminalOutcome: FleetTerminalOutcome;
  readonly observationQuality: ObservationQuality | null;
}

export interface FleetCompleteObservationFact {
  readonly observationId: string;
  readonly operationId: string;
  readonly originatingAttemptAcceptedAt: string;
  readonly version: number;
  readonly observedAt: string;
  readonly completedAt: string;
  readonly provenance: ObservationProvenance;
  readonly evidenceId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly reconciliationPolicyVersion: string;
  readonly quality: "complete";
}

export interface FleetActiveManualOperationFact {
  readonly operationId: string;
  readonly resourceVersion: number;
  readonly stage: Exclude<ObservationStage, "terminal">;
  readonly acceptedAt: string;
}

export interface FleetEndpointFacts {
  readonly endpointId: string;
  readonly siteDisplayName: string | null;
  readonly endpointDisplayName: string | null;
  readonly provenance: ObservationProvenance;
  readonly freshnessWindowSeconds: number | null;
  readonly lastAttempt: FleetAttemptFact | null;
  readonly latestTerminalAttempt: FleetTerminalAttemptFact | null;
  readonly lastCompleteObservation: FleetCompleteObservationFact | null;
  readonly activeManualOperation: FleetActiveManualOperationFact | null;
}

export interface FleetHealthRepository {
  listFacts(organizationId: OrganizationId): Promise<readonly FleetEndpointFacts[]>;
}
