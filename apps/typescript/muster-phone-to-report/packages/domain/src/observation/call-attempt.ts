import type { OrganizationId } from "../shared/organization-id.js";
import type { ObservationProvenance } from "./endpoint-observation-profile.js";

export const CALL_ATTEMPT_STAGES = Object.freeze([
  "scheduled",
  "calling",
  "extracting",
  "terminal",
] as const);

export const CALL_ATTEMPT_TERMINAL_OUTCOMES = Object.freeze([
  "observation_recorded",
  "blocked",
  "no_answer",
  "busy",
  "provider_failed",
  "evidence_unavailable",
] as const);

export type CallAttemptStage = (typeof CALL_ATTEMPT_STAGES)[number];
export type CallAttemptTerminalOutcome = (typeof CALL_ATTEMPT_TERMINAL_OUTCOMES)[number];
export type ObservationTrigger = "manual" | "scheduled";

export interface EstablishCallAttemptInput {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly endpointId: string;
  readonly adapterVersionId: string;
  readonly trigger: ObservationTrigger;
  readonly provenance: ObservationProvenance;
  readonly semanticFingerprint: string;
  readonly providerDispatchIdentity: string;
  readonly acceptedAt: string;
}

export interface CallAttemptValue extends EstablishCallAttemptInput {
  readonly stage: CallAttemptStage;
  readonly lastTransitionAt: string;
  readonly terminalOutcome: CallAttemptTerminalOutcome | null;
  readonly retryable: boolean | null;
  readonly latestEvidenceId: string | null;
  readonly latestObservationId: string | null;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty, trimmed value`);
  }
}

function requireIsoTimestamp(value: string, field: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
}

export class CallAttempt {
  public readonly id: string;
  public readonly organizationId: OrganizationId;
  public readonly endpointId: string;
  public readonly adapterVersionId: string;
  public readonly trigger: ObservationTrigger;
  public readonly provenance: ObservationProvenance;
  public readonly semanticFingerprint: string;
  public readonly providerDispatchIdentity: string;
  public readonly acceptedAt: string;
  public readonly stage: CallAttemptStage;
  public readonly lastTransitionAt: string;
  public readonly terminalOutcome: CallAttemptTerminalOutcome | null;
  public readonly retryable: boolean | null;
  public readonly latestEvidenceId: string | null;
  public readonly latestObservationId: string | null;

  private constructor(value: CallAttemptValue) {
    this.id = value.id;
    this.organizationId = value.organizationId;
    this.endpointId = value.endpointId;
    this.adapterVersionId = value.adapterVersionId;
    this.trigger = value.trigger;
    this.provenance = value.provenance;
    this.semanticFingerprint = value.semanticFingerprint;
    this.providerDispatchIdentity = value.providerDispatchIdentity;
    this.acceptedAt = value.acceptedAt;
    this.stage = value.stage;
    this.lastTransitionAt = value.lastTransitionAt;
    this.terminalOutcome = value.terminalOutcome;
    this.retryable = value.retryable;
    this.latestEvidenceId = value.latestEvidenceId;
    this.latestObservationId = value.latestObservationId;
    Object.freeze(this);
  }

  public static establish(input: EstablishCallAttemptInput): CallAttempt {
    for (const [field, value] of Object.entries({
      id: input.id,
      endpointId: input.endpointId,
      adapterVersionId: input.adapterVersionId,
      semanticFingerprint: input.semanticFingerprint,
      providerDispatchIdentity: input.providerDispatchIdentity,
    })) {
      requireNonEmpty(value, field);
    }
    requireIsoTimestamp(input.acceptedAt, "acceptedAt");
    return new CallAttempt({
      ...input,
      stage: "scheduled",
      lastTransitionAt: input.acceptedAt,
      terminalOutcome: null,
      retryable: null,
      latestEvidenceId: null,
      latestObservationId: null,
    });
  }

  private transition(
    stage: CallAttemptStage,
    transitionedAt: string,
    changes: Partial<
      Pick<
        CallAttemptValue,
        "terminalOutcome" | "retryable" | "latestEvidenceId" | "latestObservationId"
      >
    > = {},
  ): CallAttempt {
    requireIsoTimestamp(transitionedAt, "transitionedAt");
    if (Date.parse(transitionedAt) < Date.parse(this.lastTransitionAt)) {
      throw new Error("CallAttempt transitions must not move backward in time");
    }
    return new CallAttempt({
      ...this.toValue(),
      ...changes,
      stage,
      lastTransitionAt: transitionedAt,
    });
  }

  public transitionToCalling(transitionedAt: string): CallAttempt {
    if (this.stage !== "scheduled") {
      throw new Error(`Illegal CallAttempt transition from ${this.stage} to calling`);
    }
    return this.transition("calling", transitionedAt);
  }

  public transitionToExtracting(input: {
    readonly evidenceId: string;
    readonly transitionedAt: string;
  }): CallAttempt {
    if (this.stage !== "calling") {
      throw new Error(`Illegal CallAttempt transition from ${this.stage} to extracting`);
    }
    requireNonEmpty(input.evidenceId, "evidenceId");
    return this.transition("extracting", input.transitionedAt, {
      latestEvidenceId: input.evidenceId,
    });
  }

  public transitionToTerminal(input: {
    readonly outcome: CallAttemptTerminalOutcome;
    readonly observationId?: string;
    readonly retryable: boolean;
    readonly transitionedAt: string;
  }): CallAttempt {
    if (this.stage === "terminal") {
      throw new Error("Illegal CallAttempt transition from terminal to terminal");
    }
    if (input.outcome === "observation_recorded") {
      if (this.stage !== "extracting") {
        throw new Error("observation_recorded requires the extracting stage");
      }
      if (input.observationId === undefined) {
        throw new Error("observation_recorded requires an observationId");
      }
      requireNonEmpty(input.observationId, "observationId");
    } else {
      if (input.observationId !== undefined) {
        throw new Error(`${input.outcome} must not reference an observation`);
      }
      if (this.stage === "extracting") {
        throw new Error(`${input.outcome} must be recorded before extracting`);
      }
    }
    return this.transition("terminal", input.transitionedAt, {
      terminalOutcome: input.outcome,
      retryable: input.retryable,
      latestObservationId: input.observationId ?? null,
    });
  }

  public toValue(): CallAttemptValue {
    return Object.freeze({
      id: this.id,
      organizationId: this.organizationId,
      endpointId: this.endpointId,
      adapterVersionId: this.adapterVersionId,
      trigger: this.trigger,
      provenance: this.provenance,
      semanticFingerprint: this.semanticFingerprint,
      providerDispatchIdentity: this.providerDispatchIdentity,
      acceptedAt: this.acceptedAt,
      stage: this.stage,
      lastTransitionAt: this.lastTransitionAt,
      terminalOutcome: this.terminalOutcome,
      retryable: this.retryable,
      latestEvidenceId: this.latestEvidenceId,
      latestObservationId: this.latestObservationId,
    });
  }
}
