import {
  ApplicationError,
  type ObservationAppendResult,
  type ObservationRepository,
} from "@muster/application";
import {
  Observation,
  OrganizationId,
  Reading,
  type ObservationProvenance,
  type ReadingDisposition,
} from "@muster/domain";

import type { PrismaRepositoryClient } from "./prisma-transaction.js";
import { runInPrismaTransaction } from "./prisma-transaction.js";

interface PersistedReading {
  readonly zoneId: string;
  readonly ordinal: number;
  readonly disposition:
    "grounded" | "missing" | "ambiguous" | "contradictory" | "reviewedNotApplicable" | "invalid";
  readonly value: string | null;
  readonly spokenUnit: string | null;
  readonly normalizedUnit: string | null;
  readonly confidenceToken: string | null;
  readonly confidenceSemanticsVersion: string | null;
  readonly candidateIds: readonly string[];
  readonly evidenceAnchorIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly providerRunId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly sourceCapturedAt: Date;
  readonly derivedAt: Date;
}

interface PersistedObservation {
  readonly id: string;
  readonly operationId: string;
  readonly version: number;
  readonly predecessorObservationId: string | null;
  readonly createdAt: Date;
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly reconciliationPolicyVersion: string;
  readonly provenance: "simulated" | "providerObserved";
  readonly quality: "complete" | "partial" | "unknown" | "invalid";
  readonly inputFingerprint: string;
  readonly readings: readonly PersistedReading[];
}

function toPersistedProvenance(
  provenance: ObservationProvenance,
): "simulated" | "providerObserved" {
  return provenance === "SIMULATED" ? "simulated" : "providerObserved";
}

function toDomainProvenance(provenance: "simulated" | "providerObserved"): ObservationProvenance {
  return provenance === "simulated" ? "SIMULATED" : "PROVIDER_OBSERVED";
}

function toPersistedDisposition(disposition: ReadingDisposition): PersistedReading["disposition"] {
  return disposition === "reviewed_not_applicable" ? "reviewedNotApplicable" : disposition;
}

function toDomainDisposition(disposition: PersistedReading["disposition"]): ReadingDisposition {
  return disposition === "reviewedNotApplicable" ? "reviewed_not_applicable" : disposition;
}

function toDomainReading(record: PersistedReading): Reading {
  return Reading.create({
    zoneId: record.zoneId,
    ordinal: record.ordinal,
    disposition: toDomainDisposition(record.disposition),
    value: record.value,
    spokenUnit: record.spokenUnit,
    normalizedUnit: record.normalizedUnit,
    confidenceToken: record.confidenceToken,
    confidenceSemanticsVersion: record.confidenceSemanticsVersion,
    candidateIds: record.candidateIds,
    evidenceAnchorIds: record.evidenceAnchorIds,
    reasonCodes: record.reasonCodes,
    evidenceId: record.evidenceId,
    evidenceRevisionId: record.evidenceRevisionId,
    providerRunId: record.providerRunId,
    adapterVersionId: record.adapterVersionId,
    extractorVersionId: record.extractorVersionId,
    sourceCapturedAt: record.sourceCapturedAt.toISOString(),
    derivedAt: record.derivedAt.toISOString(),
  });
}

function toDomainObservation(record: PersistedObservation): Observation {
  return Observation.create({
    id: record.id,
    operationId: record.operationId,
    version: record.version,
    predecessorObservationId: record.predecessorObservationId,
    createdAt: record.createdAt.toISOString(),
    evidenceId: record.evidenceId,
    evidenceRevisionId: record.evidenceRevisionId,
    adapterVersionId: record.adapterVersionId,
    extractorVersionId: record.extractorVersionId,
    reconciliationPolicyVersion: record.reconciliationPolicyVersion,
    provenance: toDomainProvenance(record.provenance),
    quality: record.quality,
    inputFingerprint: record.inputFingerprint,
    readings: record.readings.map(toDomainReading),
  });
}

function isSemanticReplay(established: Observation, candidate: Observation): boolean {
  // Database-established observation IDs and local derivation timestamps are not derivation
  // identity; source lineage, versions, reconciliation, and reading facts are.
  const semanticFacts = (observation: Observation) => ({
    operationId: observation.operationId,
    evidenceId: observation.evidenceId,
    evidenceRevisionId: observation.evidenceRevisionId,
    adapterVersionId: observation.adapterVersionId,
    extractorVersionId: observation.extractorVersionId,
    reconciliationPolicyVersion: observation.reconciliationPolicyVersion,
    provenance: observation.provenance,
    quality: observation.quality,
    inputFingerprint: observation.inputFingerprint,
    readings: observation.readings.map((reading) => ({
      zoneId: reading.zoneId,
      ordinal: reading.ordinal,
      disposition: reading.disposition,
      value: reading.value,
      spokenUnit: reading.spokenUnit,
      normalizedUnit: reading.normalizedUnit,
      confidenceToken: reading.confidenceToken,
      confidenceSemanticsVersion: reading.confidenceSemanticsVersion,
      candidateIds: reading.candidateIds,
      evidenceAnchorIds: reading.evidenceAnchorIds,
      reasonCodes: reading.reasonCodes,
      evidenceId: reading.evidenceId,
      evidenceRevisionId: reading.evidenceRevisionId,
      providerRunId: reading.providerRunId,
      adapterVersionId: reading.adapterVersionId,
      extractorVersionId: reading.extractorVersionId,
      sourceCapturedAt: reading.sourceCapturedAt,
    })),
  });
  return JSON.stringify(semanticFacts(established)) === JSON.stringify(semanticFacts(candidate));
}

class ObservationChainPositionRaceError extends Error {}

function recommendedAction(input: {
  readonly terminal: boolean;
  readonly terminalOutcome: string | null;
  readonly quality: "complete" | "partial" | "unknown" | "invalid" | null;
}): "poll" | "none" | "review_incomplete_evidence" | "create_new_request_after_remediation" {
  if (!input.terminal) {
    return "poll";
  }
  if (input.terminalOutcome !== "observation_recorded") {
    return "create_new_request_after_remediation";
  }
  return input.quality === "complete" ? "none" : "review_incomplete_evidence";
}

const observationInclude = {
  readings: { orderBy: [{ ordinal: "asc" as const }, { zoneId: "asc" as const }] },
};

export class PrismaObservationRepository implements ObservationRepository {
  public constructor(private readonly client: PrismaRepositoryClient) {}

  public async append(input: {
    readonly organizationId: OrganizationId;
    readonly observation: Observation;
  }): Promise<ObservationAppendResult> {
    const observation = input.observation;
    const establishedDerivation = await this.findByDerivation({
      organizationId: input.organizationId,
      operationId: observation.operationId,
      evidenceId: observation.evidenceId,
      adapterVersionId: observation.adapterVersionId,
      extractorVersionId: observation.extractorVersionId,
      reconciliationPolicyVersion: observation.reconciliationPolicyVersion,
    });
    if (establishedDerivation !== undefined) {
      if (!isSemanticReplay(establishedDerivation, observation)) {
        throw ApplicationError.idempotencyConflict("observation_version_conflict");
      }
      return Object.freeze({ outcome: "replayed", value: establishedDerivation });
    }
    for (let appendAttempt = 0; appendAttempt < 5; appendAttempt += 1) {
      try {
        const created = await runInPrismaTransaction(this.client, async (transaction) => {
          const attempt = await transaction.callAttempt.findUnique({
            where: {
              organizationId_id: {
                organizationId: input.organizationId.value,
                id: observation.operationId,
              },
            },
          });
          if (
            attempt === null ||
            attempt.adapterVersionId !== observation.adapterVersionId ||
            attempt.provenance !== toPersistedProvenance(observation.provenance)
          ) {
            throw ApplicationError.idempotencyConflict("observation_version_conflict");
          }
          const evidence = await transaction.evidenceRecord.findUnique({
            where: {
              organizationId_id: {
                organizationId: input.organizationId.value,
                id: observation.evidenceId,
              },
            },
          });
          if (
            evidence === null ||
            evidence.callAttemptId !== observation.operationId ||
            evidence.adapterVersionId !== observation.adapterVersionId ||
            evidence.providerRevisionId !== observation.evidenceRevisionId ||
            evidence.provenance !== toPersistedProvenance(observation.provenance) ||
            observation.readings.some(
              (reading) =>
                reading.providerRunId !== evidence.providerRunId ||
                reading.sourceCapturedAt !== evidence.capturedAt.toISOString(),
            )
          ) {
            throw ApplicationError.idempotencyConflict("observation_version_conflict");
          }
          const latestObservation =
            attempt.latestObservationId === null
              ? null
              : await transaction.observation.findUnique({
                  where: {
                    organizationId_id: {
                      organizationId: input.organizationId.value,
                      id: attempt.latestObservationId,
                    },
                  },
                });
          const firstObservation = latestObservation === null;
          const lifecycleAllowsAppend = firstObservation
            ? attempt.stage === "extracting" && attempt.terminalOutcome === null
            : attempt.stage === "terminal" && attempt.terminalOutcome === "observationRecorded";
          if (!lifecycleAllowsAppend) {
            throw ApplicationError.idempotencyConflict("observation_version_conflict");
          }
          if (latestObservation === null) {
            if (observation.version !== 1 || observation.predecessorObservationId !== null) {
              throw ApplicationError.idempotencyConflict("observation_version_conflict");
            }
          } else if (observation.version === latestObservation.version + 1) {
            if (observation.predecessorObservationId !== latestObservation.id) {
              throw ApplicationError.idempotencyConflict("observation_version_conflict");
            }
          } else if (observation.version <= latestObservation.version) {
            const stalePredecessor =
              observation.predecessorObservationId === null
                ? null
                : await transaction.observation.findUnique({
                    where: {
                      organizationId_id: {
                        organizationId: input.organizationId.value,
                        id: observation.predecessorObservationId,
                      },
                    },
                  });
            const validStalePosition =
              (observation.version === 1 && observation.predecessorObservationId === null) ||
              (stalePredecessor !== null &&
                stalePredecessor.operationId === observation.operationId &&
                stalePredecessor.version === observation.version - 1);
            if (!validStalePosition) {
              throw ApplicationError.idempotencyConflict("observation_version_conflict");
            }
          } else {
            throw ApplicationError.idempotencyConflict("observation_version_conflict");
          }
          // The caller's version is a consistency claim; the transaction allocates from the
          // current database pointer so concurrent derivations become one immutable lineage.
          const allocatedVersion = (latestObservation?.version ?? 0) + 1;
          const allocatedPredecessorId = latestObservation?.id ?? null;
          await transaction.observation.create({
            data: {
              organizationId: input.organizationId.value,
              id: observation.id,
              operationId: observation.operationId,
              endpointId: attempt.endpointId,
              version: allocatedVersion,
              predecessorObservationId: allocatedPredecessorId,
              createdAt: new Date(observation.createdAt),
              evidenceId: observation.evidenceId,
              evidenceRevisionId: observation.evidenceRevisionId,
              adapterVersionId: observation.adapterVersionId,
              extractorVersionId: observation.extractorVersionId,
              reconciliationPolicyVersion: observation.reconciliationPolicyVersion,
              provenance: toPersistedProvenance(observation.provenance),
              quality: observation.quality,
              inputFingerprint: observation.inputFingerprint,
            },
          });
          for (const reading of observation.readings) {
            await transaction.reading.create({
              data: {
                organizationId: input.organizationId.value,
                operationId: observation.operationId,
                observationId: observation.id,
                endpointId: attempt.endpointId,
                adapterVersionId: reading.adapterVersionId,
                evidenceId: reading.evidenceId,
                evidenceRevisionId: reading.evidenceRevisionId,
                zoneId: reading.zoneId,
                ordinal: reading.ordinal,
                disposition: toPersistedDisposition(reading.disposition),
                value: reading.value,
                spokenUnit: reading.spokenUnit,
                normalizedUnit: reading.normalizedUnit,
                confidenceToken: reading.confidenceToken,
                confidenceSemanticsVersion: reading.confidenceSemanticsVersion,
                candidateIds: [...reading.candidateIds],
                evidenceAnchorIds: [...reading.evidenceAnchorIds],
                reasonCodes: [...reading.reasonCodes],
                providerRunId: reading.providerRunId,
                extractorVersionId: reading.extractorVersionId,
                sourceCapturedAt: new Date(reading.sourceCapturedAt),
                derivedAt: new Date(reading.derivedAt),
              },
            });
          }
          const pointerUpdate = await transaction.callAttempt.updateMany({
            where: {
              organizationId: input.organizationId.value,
              id: observation.operationId,
              // Updating only the pointer we read keeps correction history linear under concurrency.
              latestObservationId: attempt.latestObservationId,
              resourceVersion: attempt.resourceVersion,
              stage: firstObservation ? "extracting" : "terminal",
              terminalOutcome: firstObservation ? null : "observationRecorded",
            },
            data: {
              latestObservationId: observation.id,
              resourceVersion: { increment: 1 },
            },
          });
          if (pointerUpdate.count !== 1) {
            throw new ObservationChainPositionRaceError();
          }
          return await transaction.observation.findUniqueOrThrow({
            where: {
              organizationId_id: {
                organizationId: input.organizationId.value,
                id: observation.id,
              },
            },
            include: observationInclude,
          });
        });
        return Object.freeze({ outcome: "appended", value: toDomainObservation(created) });
      } catch (error) {
        const established = await this.findEstablishedIdentities(input.organizationId, observation);
        const replay = established.find((candidate) => isSemanticReplay(candidate, observation));
        if (replay !== undefined) {
          return Object.freeze({ outcome: "replayed", value: replay });
        }
        if (
          established.some(
            (candidate) =>
              candidate.operationId === observation.operationId &&
              candidate.evidenceId === observation.evidenceId &&
              candidate.adapterVersionId === observation.adapterVersionId &&
              candidate.extractorVersionId === observation.extractorVersionId &&
              candidate.reconciliationPolicyVersion === observation.reconciliationPolicyVersion,
          )
        ) {
          throw ApplicationError.idempotencyConflict("observation_version_conflict");
        }
        if (established.some(({ id }) => id === observation.id)) {
          throw ApplicationError.idempotencyConflict("observation_version_conflict");
        }
        if (error instanceof ApplicationError) {
          throw error;
        }
        if (appendAttempt === 4) {
          throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
        }
      }
    }
    throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
  }

  public async findById(
    organizationId: OrganizationId,
    observationId: string,
  ): Promise<Observation | undefined> {
    try {
      const record = await this.client.observation.findUnique({
        where: {
          organizationId_id: { organizationId: organizationId.value, id: observationId },
        },
        include: observationInclude,
      });
      return record === null ? undefined : toDomainObservation(record);
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async findByDerivation(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly evidenceId: string;
    readonly adapterVersionId: string;
    readonly extractorVersionId: string;
    readonly reconciliationPolicyVersion: string;
  }): Promise<Observation | undefined> {
    try {
      const record = await this.client.observation.findUnique({
        where: {
          organizationId_operationId_evidenceId_adapterVersionId_extractorVersionId_reconciliationPolicyVersion:
            {
              organizationId: input.organizationId.value,
              operationId: input.operationId,
              evidenceId: input.evidenceId,
              adapterVersionId: input.adapterVersionId,
              extractorVersionId: input.extractorVersionId,
              reconciliationPolicyVersion: input.reconciliationPolicyVersion,
            },
        },
        include: observationInclude,
      });
      return record === null ? undefined : toDomainObservation(record);
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async findOperation(
    organizationId: OrganizationId,
    operationId: string,
  ): ReturnType<ObservationRepository["findOperation"]> {
    try {
      const attempt = await this.client.callAttempt.findUnique({
        where: {
          organizationId_id: { organizationId: organizationId.value, id: operationId },
        },
      });
      if (attempt === null) {
        return undefined;
      }
      const evidence =
        attempt.latestEvidenceId === null
          ? null
          : await this.client.evidenceRecord.findUnique({
              where: {
                organizationId_id: {
                  organizationId: organizationId.value,
                  id: attempt.latestEvidenceId,
                },
              },
            });
      const observation =
        attempt.latestObservationId === null
          ? null
          : await this.client.observation.findUnique({
              where: {
                organizationId_id: {
                  organizationId: organizationId.value,
                  id: attempt.latestObservationId,
                },
              },
              include: observationInclude,
            });
      const terminalOutcome =
        attempt.terminalOutcome === null
          ? null
          : (
              {
                observationRecorded: "observation_recorded",
                blocked: "blocked",
                noAnswer: "no_answer",
                busy: "busy",
                providerFailed: "provider_failed",
                evidenceUnavailable: "evidence_unavailable",
              } as const
            )[attempt.terminalOutcome];
      const evidenceResponse =
        evidence === null
          ? null
          : {
              evidenceId: evidence.id,
              revision: evidence.revision,
              providerRunId: evidence.providerRunId,
              provenance: toDomainProvenance(evidence.provenance),
              sourceCompleteness: evidence.sourceCompleteness,
              retainedAt: evidence.retainedAt.toISOString(),
            };
      const domainObservation = observation === null ? null : toDomainObservation(observation);
      const observationResponse =
        domainObservation === null
          ? null
          : {
              observationId: domainObservation.id,
              version: domainObservation.version,
              predecessorObservationId: domainObservation.predecessorObservationId,
              quality: domainObservation.quality,
              provenance: domainObservation.provenance,
              adapterVersionId: domainObservation.adapterVersionId,
              extractorVersionId: domainObservation.extractorVersionId,
              reconciliationPolicyVersion: domainObservation.reconciliationPolicyVersion,
              evidenceId: domainObservation.evidenceId,
              readings: domainObservation.readings.map((reading) => ({
                zoneId: reading.zoneId,
                ordinal: reading.ordinal,
                disposition: reading.disposition,
                value: reading.value,
                spokenUnit: reading.spokenUnit,
                normalizedUnit: reading.normalizedUnit,
                confidenceToken: reading.confidenceToken,
                confidenceSemanticsVersion: reading.confidenceSemanticsVersion,
                evidenceId: reading.evidenceId,
                evidenceRevisionId: reading.evidenceRevisionId,
                providerRunId: reading.providerRunId,
                adapterVersionId: reading.adapterVersionId,
                extractorVersionId: reading.extractorVersionId,
                evidenceAnchorIds: reading.evidenceAnchorIds,
                sourceCapturedAt: reading.sourceCapturedAt,
                derivedAt: reading.derivedAt,
              })),
              createdAt: domainObservation.createdAt,
            };
      const revisionDates = [evidence?.retainedAt, observation?.createdAt].filter(
        (value): value is Date => value !== undefined,
      );
      const terminal = attempt.stage === "terminal";
      return Object.freeze({
        contractVersion: "1",
        operationId: attempt.id,
        resourceVersion: attempt.resourceVersion,
        stage: attempt.stage,
        terminal,
        lastTransitionAt: attempt.lastTransitionAt.toISOString(),
        latestRevisionAt:
          revisionDates.length === 0
            ? null
            : new Date(Math.max(...revisionDates.map((value) => value.getTime()))).toISOString(),
        attempt: {
          trigger: attempt.trigger,
          provenance: toDomainProvenance(attempt.provenance),
          acceptedAt: attempt.acceptedAt.toISOString(),
          retryable: attempt.retryable,
        },
        terminalOutcome,
        evidence: evidenceResponse,
        observation: observationResponse,
        recommendedAction: recommendedAction({
          terminal,
          terminalOutcome,
          quality: domainObservation?.quality ?? null,
        }),
      });
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  private async findEstablishedIdentities(
    organizationId: OrganizationId,
    candidate: Observation,
  ): Promise<readonly Observation[]> {
    try {
      const records = await this.client.observation.findMany({
        where: {
          organizationId: organizationId.value,
          OR: [
            { id: candidate.id },
            { operationId: candidate.operationId, version: candidate.version },
            {
              operationId: candidate.operationId,
              evidenceId: candidate.evidenceId,
              adapterVersionId: candidate.adapterVersionId,
              extractorVersionId: candidate.extractorVersionId,
              reconciliationPolicyVersion: candidate.reconciliationPolicyVersion,
            },
          ],
        },
        include: observationInclude,
      });
      return records.map(toDomainObservation);
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }
}
