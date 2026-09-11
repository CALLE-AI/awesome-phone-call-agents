import type { ObservationTerminalOutcome } from "./observation-job.js";

export const OBSERVATION_API_CONTRACT_VERSION = "1" as const;
export const OBSERVATION_STAGES = Object.freeze([
  "scheduled",
  "calling",
  "extracting",
  "terminal",
] as const);
export const OBSERVATION_TERMINAL_OUTCOMES = Object.freeze([
  "observation_recorded",
  "blocked",
  "no_answer",
  "busy",
  "provider_failed",
  "evidence_unavailable",
] as const satisfies readonly ObservationTerminalOutcome[]);

export type ObservationStage = (typeof OBSERVATION_STAGES)[number];
export type ObservationQuality = "complete" | "partial" | "unknown" | "invalid";
export type ObservationProvenance = "SIMULATED" | "PROVIDER_OBSERVED";
export type ObservationTrigger = "manual" | "scheduled";
export type ObservationReadingDisposition =
  "grounded" | "missing" | "ambiguous" | "contradictory" | "reviewed_not_applicable" | "invalid";
export type ObservationRecommendedAction =
  "poll" | "none" | "review_incomplete_evidence" | "create_new_request_after_remediation";

export interface ObservationRequestBody {
  readonly pollWindowId: string;
}

export interface ObservationAcceptedResponse {
  readonly contractVersion: typeof OBSERVATION_API_CONTRACT_VERSION;
  readonly operationId: string;
  readonly statusUrl: string;
  readonly stage: ObservationStage;
  readonly terminalOutcome: ObservationTerminalOutcome | null;
  readonly acceptedAt: string;
}

export interface ObservationAttemptResponse {
  readonly trigger: ObservationTrigger;
  readonly provenance: ObservationProvenance;
  readonly acceptedAt: string;
  readonly retryable: boolean | null;
}

export interface ObservationEvidenceMetadataResponse {
  readonly evidenceId: string;
  readonly revision: number;
  readonly providerRunId: string;
  readonly provenance: ObservationProvenance;
  readonly sourceCompleteness: "complete" | "truncated" | "unknown";
  readonly retainedAt: string;
}

export interface ObservationReadingResponse {
  readonly zoneId: string;
  readonly ordinal: number;
  readonly disposition: ObservationReadingDisposition;
  readonly value: string | null;
  readonly spokenUnit: string | null;
  readonly normalizedUnit: string | null;
  readonly confidenceToken: string | null;
  readonly confidenceSemanticsVersion: string | null;
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly providerRunId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly evidenceAnchorIds: readonly string[];
  readonly sourceCapturedAt: string;
  readonly derivedAt: string;
}

export interface VersionedObservationResponse {
  readonly observationId: string;
  readonly version: number;
  readonly predecessorObservationId: string | null;
  readonly quality: ObservationQuality;
  readonly provenance: ObservationProvenance;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly reconciliationPolicyVersion: string;
  readonly evidenceId: string;
  readonly readings: readonly ObservationReadingResponse[];
  readonly createdAt: string;
}

export interface ObservationOperationResponse {
  readonly contractVersion: typeof OBSERVATION_API_CONTRACT_VERSION;
  readonly operationId: string;
  readonly resourceVersion: number;
  readonly stage: ObservationStage;
  readonly terminal: boolean;
  readonly lastTransitionAt: string;
  readonly latestRevisionAt: string | null;
  readonly attempt: ObservationAttemptResponse;
  readonly terminalOutcome: ObservationTerminalOutcome | null;
  readonly evidence: ObservationEvidenceMetadataResponse | null;
  readonly observation: VersionedObservationResponse | null;
  readonly recommendedAction: ObservationRecommendedAction;
}
