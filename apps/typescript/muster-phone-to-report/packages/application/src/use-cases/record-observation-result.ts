import {
  EvidenceRecord,
  Observation,
  Reading,
  reconcileObservation,
  type CallAttempt,
  type EndpointObservationProfile,
  type OrganizationId,
  type ReconciliationOutcome,
} from "@muster/domain";

import { ApplicationError } from "../errors/application-error.js";
import type { CallAttemptRepository } from "../ports/call-attempt.repository.js";
import type { Clock } from "../ports/clock.port.js";
import type { EvidenceRepository } from "../ports/evidence.repository.js";
import type { IdentifierGenerator } from "../ports/identifier-generator.port.js";
import type { ObservationRepository } from "../ports/observation.repository.js";
import type { ObservationProfileRepository } from "../ports/observation-profile.repository.js";
import type { VoiceCallEvidenceResult, VoiceCallResult } from "../ports/voice-call.port.js";

export interface RecordObservationResultDependencies {
  readonly attempts: CallAttemptRepository;
  readonly profiles: ObservationProfileRepository;
  readonly evidence: EvidenceRepository;
  readonly observations: ObservationRepository;
  readonly clock: Clock;
  readonly identifiers: IdentifierGenerator;
}

export type RecordObservationResultOutput =
  | Readonly<{ kind: "terminal_failure"; attempt: CallAttempt }>
  | Readonly<{
      kind: "observation_recorded";
      attempt: CallAttempt;
      evidence: EvidenceRecord;
      observation: Observation;
    }>;

const MAX_PROVIDER_CAPTURE_CLOCK_SKEW_MS = 5_000;

function canonicalInstantMilliseconds(value: string): number | undefined {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : undefined;
}

function normalizeEvidenceOperationInstant(capturedAt: string, localNow: string): string {
  const capturedMilliseconds = canonicalInstantMilliseconds(capturedAt);
  const localMilliseconds = canonicalInstantMilliseconds(localNow);
  if (
    capturedMilliseconds === undefined ||
    localMilliseconds === undefined ||
    capturedMilliseconds - localMilliseconds > MAX_PROVIDER_CAPTURE_CLOCK_SKEW_MS
  ) {
    throw ApplicationError.validation("evidence_timestamp_invalid");
  }
  return capturedMilliseconds > localMilliseconds ? capturedAt : localNow;
}

function evidenceSemanticsMatch(
  established: EvidenceRecord,
  attempt: CallAttempt,
  result: VoiceCallEvidenceResult,
): boolean {
  return (
    established.organizationId.equals(attempt.organizationId) &&
    established.callAttemptId === attempt.id &&
    established.adapterVersionId === attempt.adapterVersionId &&
    established.providerRunId === result.providerRunId &&
    established.providerRevisionId === result.providerRevisionId &&
    established.capturedAt === result.capturedAt &&
    established.opaqueCustodyRef === result.opaqueCustodyRef &&
    established.provenance === result.provenance &&
    established.sourceCompleteness === result.sourceCompleteness
  );
}

function reconciliationFor(
  attempt: CallAttempt,
  profile: EndpointObservationProfile,
  evidence: EvidenceRecord,
  result: VoiceCallEvidenceResult,
): ReconciliationOutcome {
  return reconcileObservation({
    operationId: attempt.id,
    adapterVersionId: profile.adapterVersionId,
    extractorVersionId: "extractor_version_deterministic_v1",
    reconciliationPolicyVersion: "reconciliation_policy_v1",
    provenance: profile.provenance,
    expectedZones: profile.expectedZones,
    evidence: {
      evidenceId: evidence.id,
      evidenceRevisionId: result.providerRevisionId,
      providerRunId: result.providerRunId,
      callAttemptId: attempt.id,
      adapterVersionId: profile.adapterVersionId,
      provenance: result.provenance,
      availability: "available",
      sourceCompleteness: result.sourceCompleteness,
      opaqueCustodyRef: result.opaqueCustodyRef,
      capturedAt: result.capturedAt,
      admittedAnchors: result.admittedAnchors,
    },
    candidates: result.candidates,
    confidencePolicy: result.confidencePolicy,
  });
}

function readingsFrom(input: {
  readonly outcome: Extract<ReconciliationOutcome, { readonly kind: "observation" }>;
  readonly evidence: EvidenceRecord;
  readonly derivedAt: string;
}): readonly Reading[] {
  return input.outcome.zones.map((zone) =>
    Reading.create({
      zoneId: zone.zoneId,
      ordinal: zone.ordinal,
      disposition: zone.disposition,
      value: zone.reading?.value ?? null,
      spokenUnit: zone.reading?.spokenUnit ?? null,
      normalizedUnit: zone.reading?.normalizedUnit ?? null,
      confidenceToken: zone.reading?.confidenceToken ?? null,
      confidenceSemanticsVersion: zone.reading?.confidenceSemanticsVersion ?? null,
      candidateIds: zone.candidateIds,
      evidenceAnchorIds: zone.evidenceAnchorIds,
      reasonCodes: zone.reasonCodes,
      evidenceId: input.evidence.id,
      evidenceRevisionId: input.evidence.providerRevisionId,
      providerRunId: input.evidence.providerRunId,
      adapterVersionId: input.evidence.adapterVersionId,
      extractorVersionId: "extractor_version_deterministic_v1",
      sourceCapturedAt: input.evidence.capturedAt,
      derivedAt: input.derivedAt,
    }),
  );
}

function terminalFailureWinner(
  attempt: CallAttempt,
): Extract<RecordObservationResultOutput, { readonly kind: "terminal_failure" }> | undefined {
  return attempt.stage === "terminal" && attempt.terminalOutcome !== "observation_recorded"
    ? Object.freeze({ kind: "terminal_failure", attempt })
    : undefined;
}

export class RecordObservationResult {
  public constructor(private readonly dependencies: RecordObservationResultDependencies) {}

  public async execute(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly result: VoiceCallResult;
  }): Promise<RecordObservationResultOutput> {
    const attempt = await this.dependencies.attempts.findById(
      input.organizationId,
      input.operationId,
    );
    if (attempt === undefined) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    const establishedFailure = terminalFailureWinner(attempt);
    if (establishedFailure !== undefined) {
      return establishedFailure;
    }
    if (input.result.kind === "terminal_failure") {
      const terminal = await this.dependencies.attempts.recordTerminalFailure({
        organizationId: input.organizationId,
        operationId: input.operationId,
        outcome: input.result.outcome,
        retryable: input.result.retryable,
        transitionedAt: this.dependencies.clock.now(),
      });
      return Object.freeze({ kind: "terminal_failure", attempt: terminal });
    }
    const operationInstant = normalizeEvidenceOperationInstant(
      input.result.capturedAt,
      this.dependencies.clock.now(),
    );
    const profile = await this.dependencies.profiles.findByEndpoint(
      input.organizationId,
      attempt.endpointId,
    );
    if (profile === undefined || profile.adapterVersionId !== attempt.adapterVersionId) {
      throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
    }
    let evidence = await this.dependencies.evidence.findByProviderRevision(
      input.organizationId,
      input.result.providerRunId,
      input.result.providerRevisionId,
    );
    if (evidence !== undefined && !evidenceSemanticsMatch(evidence, attempt, input.result)) {
      throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
    }
    if (evidence === undefined) {
      const current = await this.dependencies.attempts.findById(
        input.organizationId,
        input.operationId,
      );
      if (current === undefined) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      const predecessor =
        current.latestEvidenceId === null
          ? undefined
          : await this.dependencies.evidence.findById(
              input.organizationId,
              current.latestEvidenceId,
            );
      const candidate = EvidenceRecord.create({
        id: this.dependencies.identifiers.generate(),
        revision: (predecessor?.revision ?? 0) + 1,
        predecessorEvidenceId: predecessor?.id ?? null,
        organizationId: input.organizationId,
        callAttemptId: input.operationId,
        adapterVersionId: attempt.adapterVersionId,
        providerRunId: input.result.providerRunId,
        providerRevisionId: input.result.providerRevisionId,
        capturedAt: input.result.capturedAt,
        retainedAt: operationInstant,
        opaqueCustodyRef: input.result.opaqueCustodyRef,
        provenance: input.result.provenance,
        sourceCompleteness: input.result.sourceCompleteness,
      });
      evidence = (await this.dependencies.evidence.append(candidate)).value;
    }
    const afterEvidence = await this.dependencies.attempts.findById(
      input.organizationId,
      input.operationId,
    );
    if (afterEvidence === undefined) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    const failureAfterEvidence = terminalFailureWinner(afterEvidence);
    if (failureAfterEvidence !== undefined) {
      return failureAfterEvidence;
    }
    const outcome = reconciliationFor(attempt, profile, evidence, input.result);
    if (outcome.kind === "no_observation") {
      const terminal = await this.dependencies.attempts.recordTerminalFailure({
        organizationId: input.organizationId,
        operationId: input.operationId,
        outcome: "evidence_unavailable",
        retryable: false,
        transitionedAt: operationInstant,
      });
      return Object.freeze({ kind: "terminal_failure", attempt: terminal });
    }
    const existing = await this.dependencies.observations.findByDerivation({
      organizationId: input.organizationId,
      operationId: input.operationId,
      evidenceId: evidence.id,
      adapterVersionId: profile.adapterVersionId,
      extractorVersionId: "extractor_version_deterministic_v1",
      reconciliationPolicyVersion: "reconciliation_policy_v1",
    });
    if (existing !== undefined) {
      if (existing.inputFingerprint !== outcome.inputFingerprint) {
        throw ApplicationError.idempotencyConflict("observation_version_conflict");
      }
      // The observation append and terminal transition are separate durable writes. Redelivery
      // after a crash must finalize the already-established derivation rather than append again.
      let establishedAttempt = await this.dependencies.attempts.findById(
        input.organizationId,
        input.operationId,
      );
      if (establishedAttempt === undefined) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      const failureWinner = terminalFailureWinner(establishedAttempt);
      if (failureWinner !== undefined) {
        return failureWinner;
      }
      if (establishedAttempt.stage === "extracting") {
        establishedAttempt = (
          await this.dependencies.attempts.recordTerminalObservation({
            organizationId: input.organizationId,
            operationId: input.operationId,
            observationId: existing.id,
            transitionedAt: operationInstant,
          })
        ).value;
        const terminalFailure = terminalFailureWinner(establishedAttempt);
        if (terminalFailure !== undefined) {
          return terminalFailure;
        }
      }
      if (
        establishedAttempt.stage !== "terminal" ||
        establishedAttempt.terminalOutcome !== "observation_recorded"
      ) {
        throw ApplicationError.idempotencyConflict("observation_version_conflict");
      }
      return Object.freeze({
        kind: "observation_recorded",
        attempt: establishedAttempt,
        evidence,
        observation: existing,
      });
    }
    const beforeDerivation = await this.dependencies.attempts.findById(
      input.organizationId,
      input.operationId,
    );
    if (beforeDerivation === undefined) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    const failureBeforeDerivation = terminalFailureWinner(beforeDerivation);
    if (failureBeforeDerivation !== undefined) {
      return failureBeforeDerivation;
    }
    if (beforeDerivation.stage === "calling") {
      const extracting = await this.dependencies.attempts.recordExtracting({
        organizationId: input.organizationId,
        operationId: input.operationId,
        evidenceId: evidence.id,
        transitionedAt: operationInstant,
      });
      const failureWinner = terminalFailureWinner(extracting.value);
      if (failureWinner !== undefined) {
        return failureWinner;
      }
    } else if (beforeDerivation.stage === "scheduled") {
      throw ApplicationError.idempotencyConflict("observation_version_conflict");
    }
    const latestObservation =
      beforeDerivation.latestObservationId === null
        ? undefined
        : await this.dependencies.observations.findById(
            input.organizationId,
            beforeDerivation.latestObservationId,
          );
    const derivedAt = operationInstant;
    const observation = Observation.create({
      id: this.dependencies.identifiers.generate(),
      operationId: input.operationId,
      version: (latestObservation?.version ?? 0) + 1,
      predecessorObservationId: latestObservation?.id ?? null,
      createdAt: derivedAt,
      evidenceId: evidence.id,
      evidenceRevisionId: evidence.providerRevisionId,
      adapterVersionId: profile.adapterVersionId,
      extractorVersionId: "extractor_version_deterministic_v1",
      reconciliationPolicyVersion: "reconciliation_policy_v1",
      provenance: outcome.provenance,
      quality: outcome.quality,
      inputFingerprint: outcome.inputFingerprint,
      readings: readingsFrom({ outcome, evidence, derivedAt }),
    });
    let establishedObservation: Observation;
    try {
      establishedObservation = (
        await this.dependencies.observations.append({
          organizationId: input.organizationId,
          observation,
        })
      ).value;
    } catch (error) {
      const current = await this.dependencies.attempts.findById(
        input.organizationId,
        input.operationId,
      );
      if (current === undefined) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      const failureWinner = terminalFailureWinner(current);
      if (failureWinner !== undefined) {
        return failureWinner;
      }
      throw error;
    }
    const currentAttempt = await this.dependencies.attempts.findById(
      input.organizationId,
      input.operationId,
    );
    if (currentAttempt === undefined) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    const terminal =
      currentAttempt.stage === "terminal"
        ? currentAttempt
        : (
            await this.dependencies.attempts.recordTerminalObservation({
              organizationId: input.organizationId,
              operationId: input.operationId,
              observationId: establishedObservation.id,
              transitionedAt: operationInstant,
            })
          ).value;
    const terminalFailure = terminalFailureWinner(terminal);
    if (terminalFailure !== undefined) {
      return terminalFailure;
    }
    if (terminal.stage !== "terminal" || terminal.terminalOutcome !== "observation_recorded") {
      throw ApplicationError.idempotencyConflict("observation_version_conflict");
    }
    return Object.freeze({
      kind: "observation_recorded",
      attempt: terminal,
      evidence,
      observation: establishedObservation,
    });
  }
}
