import {
  ApplicationError,
  type EvidenceAppendResult,
  type EvidenceRepository,
} from "@muster/application";
import {
  EvidenceRecord,
  type EvidenceSourceCompleteness,
  OrganizationId,
  type ObservationProvenance,
} from "@muster/domain";

import type { PrismaRepositoryClient } from "./prisma-transaction.js";
import { runInPrismaTransaction } from "./prisma-transaction.js";

interface PersistedEvidenceRecord {
  readonly organizationId: string;
  readonly id: string;
  readonly callAttemptId: string;
  readonly adapterVersionId: string;
  readonly revision: number;
  readonly predecessorEvidenceId: string | null;
  readonly providerRunId: string;
  readonly providerRevisionId: string;
  readonly capturedAt: Date;
  readonly retainedAt: Date;
  readonly opaqueCustodyRef: string;
  readonly provenance: "simulated" | "providerObserved";
  readonly sourceCompleteness: EvidenceSourceCompleteness;
}

function toPersistedProvenance(
  provenance: ObservationProvenance,
): "simulated" | "providerObserved" {
  return provenance === "SIMULATED" ? "simulated" : "providerObserved";
}

function toDomainProvenance(provenance: "simulated" | "providerObserved"): ObservationProvenance {
  return provenance === "simulated" ? "SIMULATED" : "PROVIDER_OBSERVED";
}

export function toDomainEvidence(record: PersistedEvidenceRecord): EvidenceRecord {
  return EvidenceRecord.create({
    id: record.id,
    revision: record.revision,
    predecessorEvidenceId: record.predecessorEvidenceId,
    organizationId: OrganizationId.create(record.organizationId),
    callAttemptId: record.callAttemptId,
    adapterVersionId: record.adapterVersionId,
    providerRunId: record.providerRunId,
    providerRevisionId: record.providerRevisionId,
    capturedAt: record.capturedAt.toISOString(),
    retainedAt: record.retainedAt.toISOString(),
    opaqueCustodyRef: record.opaqueCustodyRef,
    provenance: toDomainProvenance(record.provenance),
    sourceCompleteness: record.sourceCompleteness,
  });
}

function isSemanticReplay(established: EvidenceRecord, candidate: EvidenceRecord): boolean {
  // Local identifiers and retention time are database-established values, not provider revision
  // semantics, so matching redelivery returns the row that won the original append.
  return (
    established.organizationId.equals(candidate.organizationId) &&
    established.callAttemptId === candidate.callAttemptId &&
    established.adapterVersionId === candidate.adapterVersionId &&
    established.providerRunId === candidate.providerRunId &&
    established.providerRevisionId === candidate.providerRevisionId &&
    established.capturedAt === candidate.capturedAt &&
    established.opaqueCustodyRef === candidate.opaqueCustodyRef &&
    established.provenance === candidate.provenance &&
    established.sourceCompleteness === candidate.sourceCompleteness
  );
}

class EvidenceChainPositionRaceError extends Error {}

export class PrismaEvidenceRepository implements EvidenceRepository {
  public constructor(private readonly client: PrismaRepositoryClient) {}

  public async append(record: EvidenceRecord): Promise<EvidenceAppendResult> {
    const providerRevision = await this.findByProviderRevision(
      record.organizationId,
      record.providerRunId,
      record.providerRevisionId,
    );
    if (providerRevision !== undefined) {
      if (!isSemanticReplay(providerRevision, record)) {
        throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
      }
      return Object.freeze({ outcome: "replayed", value: providerRevision });
    }
    for (let appendAttempt = 0; appendAttempt < 5; appendAttempt += 1) {
      try {
        const created = await runInPrismaTransaction(this.client, async (transaction) => {
          const attempt = await transaction.callAttempt.findUnique({
            where: {
              organizationId_id: {
                organizationId: record.organizationId.value,
                id: record.callAttemptId,
              },
            },
          });
          if (
            attempt === null ||
            attempt.adapterVersionId !== record.adapterVersionId ||
            attempt.provenance !== toPersistedProvenance(record.provenance)
          ) {
            throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
          }
          const latestEvidence =
            attempt.latestEvidenceId === null
              ? null
              : await transaction.evidenceRecord.findUnique({
                  where: {
                    organizationId_id: {
                      organizationId: record.organizationId.value,
                      id: attempt.latestEvidenceId,
                    },
                  },
                });
          if (latestEvidence === null) {
            if (record.revision !== 1 || record.predecessorEvidenceId !== null) {
              throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
            }
          } else if (record.revision === latestEvidence.revision + 1) {
            if (record.predecessorEvidenceId !== latestEvidence.id) {
              throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
            }
          } else if (record.revision <= latestEvidence.revision) {
            const stalePredecessor =
              record.predecessorEvidenceId === null
                ? null
                : await transaction.evidenceRecord.findUnique({
                    where: {
                      organizationId_id: {
                        organizationId: record.organizationId.value,
                        id: record.predecessorEvidenceId,
                      },
                    },
                  });
            const validStalePosition =
              (record.revision === 1 && record.predecessorEvidenceId === null) ||
              (stalePredecessor !== null &&
                stalePredecessor.callAttemptId === record.callAttemptId &&
                stalePredecessor.revision === record.revision - 1);
            if (!validStalePosition) {
              throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
            }
          } else {
            throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
          }
          // The caller's chain position is a consistency claim; the transaction allocates from
          // the current database pointer so concurrent corrections serialize instead of branch.
          const allocatedRevision = (latestEvidence?.revision ?? 0) + 1;
          const allocatedPredecessorId = latestEvidence?.id ?? null;
          const evidence = await transaction.evidenceRecord.create({
            data: {
              organizationId: record.organizationId.value,
              id: record.id,
              callAttemptId: record.callAttemptId,
              endpointId: attempt.endpointId,
              adapterVersionId: record.adapterVersionId,
              revision: allocatedRevision,
              predecessorEvidenceId: allocatedPredecessorId,
              providerRunId: record.providerRunId,
              providerRevisionId: record.providerRevisionId,
              capturedAt: new Date(record.capturedAt),
              retainedAt: new Date(record.retainedAt),
              opaqueCustodyRef: record.opaqueCustodyRef,
              provenance: toPersistedProvenance(record.provenance),
              sourceCompleteness: record.sourceCompleteness,
            },
          });
          const pointerUpdate = await transaction.callAttempt.updateMany({
            where: {
              organizationId: record.organizationId.value,
              id: record.callAttemptId,
              // Updating only the pointer we read keeps correction history linear under concurrency.
              latestEvidenceId: attempt.latestEvidenceId,
              resourceVersion: attempt.resourceVersion,
            },
            data: {
              latestEvidenceId: evidence.id,
              resourceVersion: { increment: 1 },
            },
          });
          if (pointerUpdate.count !== 1) {
            throw new EvidenceChainPositionRaceError();
          }
          return evidence;
        });
        return Object.freeze({ outcome: "appended", value: toDomainEvidence(created) });
      } catch (error) {
        const established = await this.findEstablishedIdentities(record);
        const replay = established.find((candidate) => isSemanticReplay(candidate, record));
        if (replay !== undefined) {
          return Object.freeze({ outcome: "replayed", value: replay });
        }
        if (
          established.some(
            (candidate) =>
              candidate.providerRunId === record.providerRunId &&
              candidate.providerRevisionId === record.providerRevisionId,
          )
        ) {
          throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
        }
        if (established.some(({ id }) => id === record.id)) {
          throw ApplicationError.idempotencyConflict("evidence_revision_conflict");
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
    evidenceId: string,
  ): Promise<EvidenceRecord | undefined> {
    try {
      const record = await this.client.evidenceRecord.findUnique({
        where: {
          organizationId_id: { organizationId: organizationId.value, id: evidenceId },
        },
      });
      return record === null ? undefined : toDomainEvidence(record);
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async findByProviderRevision(
    organizationId: OrganizationId,
    providerRunId: string,
    providerRevisionId: string,
  ): Promise<EvidenceRecord | undefined> {
    try {
      const record = await this.client.evidenceRecord.findUnique({
        where: {
          organizationId_providerRunId_providerRevisionId: {
            organizationId: organizationId.value,
            providerRunId,
            providerRevisionId,
          },
        },
      });
      return record === null ? undefined : toDomainEvidence(record);
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  private async findEstablishedIdentities(
    candidate: EvidenceRecord,
  ): Promise<readonly EvidenceRecord[]> {
    try {
      const records = await this.client.evidenceRecord.findMany({
        where: {
          organizationId: candidate.organizationId.value,
          OR: [
            { id: candidate.id },
            { callAttemptId: candidate.callAttemptId, revision: candidate.revision },
            {
              providerRunId: candidate.providerRunId,
              providerRevisionId: candidate.providerRevisionId,
            },
          ],
        },
      });
      return records.map(toDomainEvidence);
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }
}
