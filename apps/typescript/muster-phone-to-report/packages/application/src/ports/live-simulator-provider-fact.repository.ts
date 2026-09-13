import type { OrganizationId } from "@muster/domain";

export type LiveSimulatorProviderFactPhase =
  "voice" | "canary" | "status" | "calle_terminal" | "reconciliation";

export type LiveSimulatorProviderFactOutcome =
  | "accepted"
  | "zero_dtmf"
  | "dtmf_observed"
  | "completed"
  | "failed"
  | "admissible"
  | "inadmissible"
  | "one_matching_call"
  | "zero_calls"
  | "mismatched_call"
  | "multiple_calls"
  | "timeout";

export interface LiveSimulatorProviderFact {
  readonly organizationId: OrganizationId;
  readonly operationId: string;
  readonly phase: LiveSimulatorProviderFactPhase;
  readonly providerCallDigest: string;
  readonly semanticDigest: string;
  readonly outcome: LiveSimulatorProviderFactOutcome;
  readonly occurredAt: string;
  readonly traceId: string;
  readonly signatureValidated: boolean;
  readonly actionsObserved: 0 | 1 | null;
  readonly inboundCallCount: number | null;
  /** Database-established append order; absent only before persistence. */
  readonly appendOrdinal?: number;
}

export interface LiveSimulatorProviderFactRepository {
  append(fact: LiveSimulatorProviderFact): Promise<Readonly<{ outcome: "appended" | "replayed" }>>;
  listForOperation(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<readonly LiveSimulatorProviderFact[]>;
}
