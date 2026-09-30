import type { W3CTraceContext } from "@muster/contracts";
import type {
  DtmfPolicy,
  EvidenceAnchor,
  EvidenceSourceCompleteness,
  ExtractedCandidate,
  ObservationProvenance,
  OrganizationId,
  ReconciliationConfidencePolicy,
} from "@muster/domain";

export interface VoiceCallRequest {
  readonly organizationId: OrganizationId;
  readonly operationId: string;
  readonly providerDispatchIdentity: string;
  readonly instructionFingerprint: string;
  readonly dtmfPolicy: DtmfPolicy;
  readonly correlationId: string;
  readonly traceContext?: W3CTraceContext;
}

export type VoiceCallTerminalFailure = Readonly<{
  kind: "terminal_failure";
  outcome: "no_answer" | "busy" | "provider_failed" | "evidence_unavailable";
  retryable: boolean;
}>;

export interface VoiceCallEvidenceResult {
  readonly kind: "evidence";
  readonly providerRunId: string;
  readonly providerRevisionId: string;
  readonly capturedAt: string;
  readonly opaqueCustodyRef: string;
  readonly provenance: ObservationProvenance;
  readonly sourceCompleteness: EvidenceSourceCompleteness;
  readonly admittedAnchors: readonly EvidenceAnchor[];
  readonly candidates: readonly ExtractedCandidate[] | null;
  readonly confidencePolicy: ReconciliationConfidencePolicy;
}

export type VoiceCallResult = VoiceCallTerminalFailure | VoiceCallEvidenceResult;

export type VoiceCallDispatchFailureOutcome = "provider_failed" | "evidence_unavailable";

export class VoiceCallDispatchError extends Error {
  public readonly outcome: VoiceCallDispatchFailureOutcome;
  public readonly retryable: boolean;

  private constructor(input: {
    readonly outcome: VoiceCallDispatchFailureOutcome;
    readonly retryable: boolean;
  }) {
    super("Voice call dispatch failed");
    this.name = "VoiceCallDispatchError";
    this.outcome = input.outcome;
    this.retryable = input.retryable;
  }

  public static providerFailed(input: { readonly retryable: boolean }): VoiceCallDispatchError {
    return new VoiceCallDispatchError({ outcome: "provider_failed", ...input });
  }

  public static evidenceUnavailable(input: {
    readonly retryable: boolean;
  }): VoiceCallDispatchError {
    return new VoiceCallDispatchError({ outcome: "evidence_unavailable", ...input });
  }
}

export interface VoiceCallPort {
  createOrReconcile(request: VoiceCallRequest): Promise<VoiceCallResult>;
}

export interface VoiceCallPortFactory {
  create(): VoiceCallPort;
}
