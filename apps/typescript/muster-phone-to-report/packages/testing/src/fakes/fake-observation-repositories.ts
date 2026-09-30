import {
  ApplicationError,
  type CallAttemptEstablishResult,
  type CallAttemptRepository,
  type CallAttemptTransitionResult,
  type EvidenceAppendResult,
  type EvidenceRepository,
  type ObservationAppendResult,
  type ObservationProfileEstablishResult,
  type ObservationProfileRepository,
  type ObservationRepository,
} from "@muster/application";
import type { ObservationOperationResponse } from "@muster/contracts";
import {
  EvidenceRecord,
  Observation,
  type CallAttempt,
  type CallAttemptTerminalOutcome,
  type EndpointObservationProfile,
  type OrganizationId,
} from "@muster/domain";
/*
 * These fakes allocate database-established lineage positions so application tests exercise the
 * same replay/correction contract as the PostgreSQL repositories.
 */

function scoped(organizationId: OrganizationId, value: string): string {
  return JSON.stringify([organizationId.value, value]);
}

export class FakeObservationProfileRepository implements ObservationProfileRepository {
  private readonly profiles = new Map<string, EndpointObservationProfile>();

  public constructor(profiles: readonly EndpointObservationProfile[] = []) {
    for (const profile of profiles) {
      this.profiles.set(scoped(profile.organizationId, profile.endpointId), profile);
    }
  }

  public async establish(
    profile: EndpointObservationProfile,
  ): Promise<ObservationProfileEstablishResult> {
    const key = scoped(profile.organizationId, profile.endpointId);
    const established = this.profiles.get(key);
    if (established !== undefined) {
      if (JSON.stringify(established.toValue()) !== JSON.stringify(profile.toValue())) {
        throw ApplicationError.idempotencyConflict("observation_profile_conflict");
      }
      return Object.freeze({ outcome: "replayed", value: established });
    }
    this.profiles.set(key, profile);
    return Object.freeze({ outcome: "established", value: profile });
  }

  public async findByEndpoint(
    organizationId: OrganizationId,
    endpointId: string,
  ): Promise<EndpointObservationProfile | undefined> {
    return this.profiles.get(scoped(organizationId, endpointId));
  }
}

export class FakeCallAttemptRepository implements CallAttemptRepository {
  private readonly values = new Map<string, CallAttempt>();
  private readonly idempotency = new Map<string, CallAttempt>();

  public get attempts(): readonly CallAttempt[] {
    return [...this.values.values()];
  }

  public seed(attempt: CallAttempt, idempotencyKey: string): void {
    this.values.set(scoped(attempt.organizationId, attempt.id), attempt);
    this.idempotency.set(scoped(attempt.organizationId, idempotencyKey), attempt);
  }

  public async establish(input: {
    readonly idempotencyKey: string;
    readonly attempt: CallAttempt;
  }): Promise<CallAttemptEstablishResult> {
    const key = scoped(input.attempt.organizationId, input.idempotencyKey);
    const established = this.idempotency.get(key);
    if (established !== undefined) {
      if (
        established.semanticFingerprint !== input.attempt.semanticFingerprint ||
        established.endpointId !== input.attempt.endpointId ||
        established.adapterVersionId !== input.attempt.adapterVersionId ||
        established.provenance !== input.attempt.provenance
      ) {
        throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
      }
      return Object.freeze({ outcome: "replayed", value: established });
    }
    this.seed(input.attempt, input.idempotencyKey);
    return Object.freeze({ outcome: "established", value: input.attempt });
  }

  public async findById(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<CallAttempt | undefined> {
    return this.values.get(scoped(organizationId, operationId));
  }

  public async findPendingDispatches(limit: number): Promise<readonly CallAttempt[]> {
    return this.attempts
      .filter(({ stage }) => stage === "scheduled")
      .sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt))
      .slice(0, limit);
  }

  public async recordCalling(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult> {
    const established = this.require(input.organizationId, input.operationId);
    if (established.stage !== "scheduled") {
      return Object.freeze({ outcome: "replayed", value: established });
    }
    const transitioned = established.transitionToCalling(input.transitionedAt);
    this.values.set(scoped(input.organizationId, input.operationId), transitioned);
    return Object.freeze({ outcome: "transitioned", value: transitioned });
  }

  public async recordExtracting(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly evidenceId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult> {
    const established = this.require(input.organizationId, input.operationId);
    if (established.stage !== "calling") {
      return Object.freeze({ outcome: "replayed", value: established });
    }
    const transitioned = established.transitionToExtracting(input);
    this.values.set(scoped(input.organizationId, input.operationId), transitioned);
    return Object.freeze({ outcome: "transitioned", value: transitioned });
  }

  public async recordTerminalObservation(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly observationId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult> {
    const established = this.require(input.organizationId, input.operationId);
    if (established.stage === "terminal") {
      return Object.freeze({ outcome: "replayed", value: established });
    }
    const transitioned = established.transitionToTerminal({
      outcome: "observation_recorded",
      observationId: input.observationId,
      retryable: false,
      transitionedAt: input.transitionedAt,
    });
    this.values.set(scoped(input.organizationId, input.operationId), transitioned);
    return Object.freeze({ outcome: "transitioned", value: transitioned });
  }

  public async recordTerminalFailure(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly outcome: Exclude<CallAttemptTerminalOutcome, "observation_recorded">;
    readonly retryable: boolean;
    readonly transitionedAt: string;
  }): Promise<CallAttempt> {
    const established = this.require(input.organizationId, input.operationId);
    if (established.stage === "terminal") {
      if (
        established.terminalOutcome !== input.outcome ||
        established.retryable !== input.retryable
      ) {
        throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
      }
      return established;
    }
    const transitioned = established.transitionToTerminal(input);
    this.values.set(scoped(input.organizationId, input.operationId), transitioned);
    return transitioned;
  }

  private require(organizationId: OrganizationId, operationId: string): CallAttempt {
    const established = this.values.get(scoped(organizationId, operationId));
    if (established === undefined) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    return established;
  }
}

export class FakeEvidenceRepository implements EvidenceRepository {
  private readonly values: EvidenceRecord[] = [];

  public get records(): readonly EvidenceRecord[] {
    return [...this.values];
  }

  public async append(record: EvidenceRecord): Promise<EvidenceAppendResult> {
    const established = await this.findByProviderRevision(
      record.organizationId,
      record.providerRunId,
      record.providerRevisionId,
    );
    if (established !== undefined) {
      return Object.freeze({ outcome: "replayed", value: established });
    }
    const latest = this.values
      .filter(
        (value) =>
          value.organizationId.equals(record.organizationId) &&
          value.callAttemptId === record.callAttemptId,
      )
      .sort((left, right) => right.revision - left.revision)[0];
    const allocated = EvidenceRecord.create({
      ...record.toValue(),
      revision: (latest?.revision ?? 0) + 1,
      predecessorEvidenceId: latest?.id ?? null,
    });
    this.values.push(allocated);
    return Object.freeze({ outcome: "appended", value: allocated });
  }

  public async findById(
    organizationId: OrganizationId,
    evidenceId: string,
  ): Promise<EvidenceRecord | undefined> {
    return this.values.find(
      (value) => value.organizationId.equals(organizationId) && value.id === evidenceId,
    );
  }

  public async findByProviderRevision(
    organizationId: OrganizationId,
    providerRunId: string,
    providerRevisionId: string,
  ): Promise<EvidenceRecord | undefined> {
    return this.values.find(
      (value) =>
        value.organizationId.equals(organizationId) &&
        value.providerRunId === providerRunId &&
        value.providerRevisionId === providerRevisionId,
    );
  }
}

export class FakeObservationRepository implements ObservationRepository {
  private readonly values: Observation[] = [];
  private readonly projections = new Map<string, ObservationOperationResponse>();

  public constructor(private readonly attempts?: FakeCallAttemptRepository) {}

  public get observations(): readonly Observation[] {
    return [...this.values];
  }

  public setOperationProjection(
    organizationId: OrganizationId,
    projection: ObservationOperationResponse,
  ): void {
    this.projections.set(scoped(organizationId, projection.operationId), projection);
  }

  public async append(input: {
    readonly organizationId: OrganizationId;
    readonly observation: Observation;
  }): Promise<ObservationAppendResult> {
    const established = await this.findByDerivation({
      organizationId: input.organizationId,
      operationId: input.observation.operationId,
      evidenceId: input.observation.evidenceId,
      adapterVersionId: input.observation.adapterVersionId,
      extractorVersionId: input.observation.extractorVersionId,
      reconciliationPolicyVersion: input.observation.reconciliationPolicyVersion,
    });
    if (established !== undefined) {
      if (established.inputFingerprint !== input.observation.inputFingerprint) {
        throw ApplicationError.idempotencyConflict("observation_version_conflict");
      }
      return Object.freeze({ outcome: "replayed", value: established });
    }
    const attempt = this.attempts?.attempts.find(
      (candidate) =>
        candidate.id === input.observation.operationId &&
        candidate.organizationId.equals(input.organizationId),
    );
    const latest = this.values
      .filter(
        (value) =>
          value.operationId === input.observation.operationId &&
          this.belongsTo(value, input.organizationId),
      )
      .sort((left, right) => right.version - left.version)[0];
    if (
      attempt !== undefined &&
      (latest === undefined
        ? attempt.stage !== "extracting"
        : attempt.stage !== "terminal" || attempt.terminalOutcome !== "observation_recorded")
    ) {
      throw ApplicationError.idempotencyConflict("observation_version_conflict");
    }
    const allocated = Observation.create({
      ...input.observation.toValue(),
      version: (latest?.version ?? 0) + 1,
      predecessorObservationId: latest?.id ?? null,
    });
    this.values.push(allocated);
    return Object.freeze({ outcome: "appended", value: allocated });
  }

  public async findById(
    organizationId: OrganizationId,
    observationId: string,
  ): Promise<Observation | undefined> {
    return this.values.find(
      (value) => value.id === observationId && this.belongsTo(value, organizationId),
    );
  }

  public async findByDerivation(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly evidenceId: string;
    readonly adapterVersionId: string;
    readonly extractorVersionId: string;
    readonly reconciliationPolicyVersion: string;
  }): Promise<Observation | undefined> {
    return this.values.find(
      (value) =>
        value.operationId === input.operationId &&
        value.evidenceId === input.evidenceId &&
        value.adapterVersionId === input.adapterVersionId &&
        value.extractorVersionId === input.extractorVersionId &&
        value.reconciliationPolicyVersion === input.reconciliationPolicyVersion &&
        this.belongsTo(value, input.organizationId),
    );
  }

  public async findOperation(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<ObservationOperationResponse | undefined> {
    return this.projections.get(scoped(organizationId, operationId));
  }

  private belongsTo(observation: Observation, organizationId: OrganizationId): boolean {
    if (this.attempts === undefined) return true;
    return this.attempts.attempts.some(
      (attempt) =>
        attempt.id === observation.operationId && attempt.organizationId.equals(organizationId),
    );
  }
}
