import {
  ApplicationError,
  type CallAttemptEstablishResult,
  type CallAttemptRepository,
  type CallAttemptTransitionResult,
} from "@muster/application";
import {
  CallAttempt,
  OrganizationId,
  type CallAttemptTerminalOutcome,
  type ObservationProvenance,
} from "@muster/domain";

import type { PrismaRepositoryClient } from "./prisma-transaction.js";
import { runInPrismaTransaction } from "./prisma-transaction.js";

interface PersistedCallAttempt {
  readonly organizationId: string;
  readonly id: string;
  readonly endpointId: string;
  readonly adapterVersionId: string;
  readonly idempotencyKey: string;
  readonly trigger: "manual" | "scheduled";
  readonly provenance: "simulated" | "providerObserved";
  readonly semanticFingerprint: string;
  readonly providerDispatchIdentity: string;
  readonly acceptedAt: Date;
  readonly stage: "scheduled" | "calling" | "extracting" | "terminal";
  readonly lastTransitionAt: Date;
  readonly terminalOutcome:
    | "observationRecorded"
    | "blocked"
    | "noAnswer"
    | "busy"
    | "providerFailed"
    | "evidenceUnavailable"
    | null;
  readonly retryable: boolean | null;
  readonly latestEvidenceId: string | null;
  readonly latestObservationId: string | null;
  readonly resourceVersion: number;
}

function toPersistedProvenance(
  provenance: ObservationProvenance,
): "simulated" | "providerObserved" {
  return provenance === "SIMULATED" ? "simulated" : "providerObserved";
}

function toDomainProvenance(provenance: "simulated" | "providerObserved"): ObservationProvenance {
  return provenance === "simulated" ? "SIMULATED" : "PROVIDER_OBSERVED";
}

function toPersistedOutcome(
  outcome: CallAttemptTerminalOutcome,
):
  | "observationRecorded"
  | "blocked"
  | "noAnswer"
  | "busy"
  | "providerFailed"
  | "evidenceUnavailable" {
  const values = {
    observation_recorded: "observationRecorded",
    blocked: "blocked",
    no_answer: "noAnswer",
    busy: "busy",
    provider_failed: "providerFailed",
    evidence_unavailable: "evidenceUnavailable",
  } as const;
  return values[outcome];
}

function toDomainOutcome(
  outcome: Exclude<PersistedCallAttempt["terminalOutcome"], null>,
): CallAttemptTerminalOutcome {
  const values = {
    observationRecorded: "observation_recorded",
    blocked: "blocked",
    noAnswer: "no_answer",
    busy: "busy",
    providerFailed: "provider_failed",
    evidenceUnavailable: "evidence_unavailable",
  } as const;
  return values[outcome];
}

export function toDomainCallAttempt(record: PersistedCallAttempt): CallAttempt {
  let attempt = CallAttempt.establish({
    id: record.id,
    organizationId: OrganizationId.create(record.organizationId),
    endpointId: record.endpointId,
    adapterVersionId: record.adapterVersionId,
    trigger: record.trigger,
    provenance: toDomainProvenance(record.provenance),
    semanticFingerprint: record.semanticFingerprint,
    providerDispatchIdentity: record.providerDispatchIdentity,
    acceptedAt: record.acceptedAt.toISOString(),
  });
  if (record.stage === "calling") {
    return attempt.transitionToCalling(record.lastTransitionAt.toISOString());
  }
  if (record.stage === "extracting") {
    if (record.latestEvidenceId === null) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    attempt = attempt.transitionToCalling(record.acceptedAt.toISOString());
    return attempt.transitionToExtracting({
      evidenceId: record.latestEvidenceId,
      transitionedAt: record.lastTransitionAt.toISOString(),
    });
  }
  if (record.stage === "terminal") {
    if (record.terminalOutcome === null || record.retryable === null) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    const outcome = toDomainOutcome(record.terminalOutcome);
    if (outcome === "observation_recorded") {
      if (record.latestEvidenceId === null || record.latestObservationId === null) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      attempt = attempt.transitionToCalling(record.acceptedAt.toISOString());
      attempt = attempt.transitionToExtracting({
        evidenceId: record.latestEvidenceId,
        transitionedAt: record.acceptedAt.toISOString(),
      });
      return attempt.transitionToTerminal({
        outcome,
        observationId: record.latestObservationId,
        retryable: record.retryable,
        transitionedAt: record.lastTransitionAt.toISOString(),
      });
    }
    return attempt.transitionToTerminal({
      outcome,
      retryable: record.retryable,
      transitionedAt: record.lastTransitionAt.toISOString(),
    });
  }
  return attempt;
}

export class PrismaCallAttemptRepository implements CallAttemptRepository {
  public constructor(private readonly client: PrismaRepositoryClient) {}

  public async establish(input: {
    readonly idempotencyKey: string;
    readonly attempt: CallAttempt;
  }): Promise<CallAttemptEstablishResult> {
    const attempt = input.attempt;
    try {
      const created = await runInPrismaTransaction(this.client, async (transaction) => {
        const adapter = await transaction.adapterVersion.findUnique({
          where: {
            organizationId_id: {
              organizationId: attempt.organizationId.value,
              id: attempt.adapterVersionId,
            },
          },
        });
        if (
          adapter === null ||
          adapter.endpointId !== attempt.endpointId ||
          adapter.provenance !== toPersistedProvenance(attempt.provenance)
        ) {
          throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
        }
        return await transaction.callAttempt.create({
          data: {
            organizationId: attempt.organizationId.value,
            id: attempt.id,
            endpointId: attempt.endpointId,
            adapterVersionId: attempt.adapterVersionId,
            idempotencyKey: input.idempotencyKey,
            trigger: attempt.trigger,
            provenance: toPersistedProvenance(attempt.provenance),
            semanticFingerprint: attempt.semanticFingerprint,
            providerDispatchIdentity: attempt.providerDispatchIdentity,
            acceptedAt: new Date(attempt.acceptedAt),
            stage: "scheduled",
            lastTransitionAt: new Date(attempt.lastTransitionAt),
          },
        });
      });
      return Object.freeze({ outcome: "established", value: toDomainCallAttempt(created) });
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      // A failed create is indeterminate until the database-established scoped identities are
      // reread; that distinguishes a matching replay from a collision or unavailable storage.
      const established = await this.findEstablishedIdentities({
        organizationId: attempt.organizationId,
        id: attempt.id,
        idempotencyKey: input.idempotencyKey,
        providerDispatchIdentity: attempt.providerDispatchIdentity,
      });
      if (established.length === 0) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      if (established.length !== 1) {
        throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
      }
      const replay = established[0];
      if (
        replay === undefined ||
        replay.idempotencyKey !== input.idempotencyKey ||
        replay.semanticFingerprint !== attempt.semanticFingerprint
      ) {
        throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
      }
      return Object.freeze({ outcome: "replayed", value: toDomainCallAttempt(replay) });
    }
  }

  public async findById(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<CallAttempt | undefined> {
    try {
      const record = await this.client.callAttempt.findUnique({
        where: {
          organizationId_id: { organizationId: organizationId.value, id: operationId },
        },
      });
      return record === null ? undefined : toDomainCallAttempt(record);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async findPendingDispatches(limit: number): Promise<readonly CallAttempt[]> {
    try {
      const records = await this.client.callAttempt.findMany({
        where: { stage: "scheduled" },
        orderBy: [{ acceptedAt: "asc" }, { organizationId: "asc" }, { id: "asc" }],
        take: limit,
      });
      return records.map(toDomainCallAttempt);
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async recordCalling(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult> {
    try {
      const established = await this.requirePersisted(input.organizationId, input.operationId);
      if (established.stage !== "scheduled") {
        return Object.freeze({ outcome: "replayed", value: toDomainCallAttempt(established) });
      }
      toDomainCallAttempt(established).transitionToCalling(input.transitionedAt);
      const update = await this.client.callAttempt.updateMany({
        where: {
          organizationId: input.organizationId.value,
          id: input.operationId,
          stage: "scheduled",
          resourceVersion: established.resourceVersion,
        },
        data: {
          stage: "calling",
          lastTransitionAt: new Date(input.transitionedAt),
          resourceVersion: { increment: 1 },
        },
      });
      const current = await this.requirePersisted(input.organizationId, input.operationId);
      return Object.freeze({
        outcome: update.count === 1 ? "transitioned" : "replayed",
        value: toDomainCallAttempt(current),
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async recordExtracting(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly evidenceId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult> {
    try {
      const established = await this.requirePersisted(input.organizationId, input.operationId);
      if (established.stage !== "calling") {
        return Object.freeze({ outcome: "replayed", value: toDomainCallAttempt(established) });
      }
      if (established.latestEvidenceId !== input.evidenceId) {
        throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
      }
      toDomainCallAttempt(established).transitionToExtracting({
        evidenceId: input.evidenceId,
        transitionedAt: input.transitionedAt,
      });
      const update = await this.client.callAttempt.updateMany({
        where: {
          organizationId: input.organizationId.value,
          id: input.operationId,
          stage: "calling",
          resourceVersion: established.resourceVersion,
          latestEvidenceId: input.evidenceId,
        },
        data: {
          stage: "extracting",
          lastTransitionAt: new Date(input.transitionedAt),
          resourceVersion: { increment: 1 },
        },
      });
      const current = await this.requirePersisted(input.organizationId, input.operationId);
      return Object.freeze({
        outcome: update.count === 1 ? "transitioned" : "replayed",
        value: toDomainCallAttempt(current),
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async recordTerminalObservation(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly observationId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult> {
    try {
      const established = await this.requirePersisted(input.organizationId, input.operationId);
      if (established.stage === "terminal") {
        return Object.freeze({ outcome: "replayed", value: toDomainCallAttempt(established) });
      }
      if (
        established.stage !== "extracting" ||
        established.latestObservationId !== input.observationId
      ) {
        throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
      }
      toDomainCallAttempt(established).transitionToTerminal({
        outcome: "observation_recorded",
        observationId: input.observationId,
        retryable: false,
        transitionedAt: input.transitionedAt,
      });
      const update = await this.client.callAttempt.updateMany({
        where: {
          organizationId: input.organizationId.value,
          id: input.operationId,
          stage: "extracting",
          resourceVersion: established.resourceVersion,
          latestObservationId: input.observationId,
        },
        data: {
          stage: "terminal",
          terminalOutcome: "observationRecorded",
          retryable: false,
          lastTransitionAt: new Date(input.transitionedAt),
          resourceVersion: { increment: 1 },
        },
      });
      const current = await this.requirePersisted(input.organizationId, input.operationId);
      return Object.freeze({
        outcome: update.count === 1 ? "transitioned" : "replayed",
        value: toDomainCallAttempt(current),
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  public async recordTerminalFailure(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly outcome: Exclude<CallAttemptTerminalOutcome, "observation_recorded">;
    readonly retryable: boolean;
    readonly transitionedAt: string;
  }): Promise<CallAttempt> {
    try {
      const transitionedAt = new Date(input.transitionedAt);
      const established = await this.client.callAttempt.findUnique({
        where: {
          organizationId_id: {
            organizationId: input.organizationId.value,
            id: input.operationId,
          },
        },
      });
      if (established === null) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      const persistedOutcome = toPersistedOutcome(input.outcome);
      if (established.stage === "terminal") {
        if (
          established.terminalOutcome === persistedOutcome &&
          established.retryable === input.retryable
        ) {
          return toDomainCallAttempt(established);
        }
        throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
      }
      toDomainCallAttempt(established).transitionToTerminal({
        outcome: input.outcome,
        retryable: input.retryable,
        transitionedAt: input.transitionedAt,
      });
      // The resource version and non-terminal predicate make competing callbacks a database CAS.
      const update = await this.client.callAttempt.updateMany({
        where: {
          organizationId: input.organizationId.value,
          id: input.operationId,
          resourceVersion: established.resourceVersion,
          stage: { not: "terminal" },
        },
        data: {
          stage: "terminal",
          terminalOutcome: persistedOutcome,
          retryable: input.retryable,
          lastTransitionAt: transitionedAt,
          resourceVersion: { increment: 1 },
        },
      });
      const current = await this.client.callAttempt.findUnique({
        where: {
          organizationId_id: {
            organizationId: input.organizationId.value,
            id: input.operationId,
          },
        },
      });
      if (current === null) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      if (
        update.count === 1 ||
        (current.stage === "terminal" &&
          current.terminalOutcome === persistedOutcome &&
          current.retryable === input.retryable)
      ) {
        return toDomainCallAttempt(current);
      }
      throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  private async findEstablishedIdentities(input: {
    readonly organizationId: OrganizationId;
    readonly id: string;
    readonly idempotencyKey: string;
    readonly providerDispatchIdentity: string;
  }): Promise<readonly PersistedCallAttempt[]> {
    try {
      return await this.client.callAttempt.findMany({
        where: {
          organizationId: input.organizationId.value,
          OR: [
            { id: input.id },
            { idempotencyKey: input.idempotencyKey },
            { providerDispatchIdentity: input.providerDispatchIdentity },
          ],
        },
      });
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  private async requirePersisted(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<PersistedCallAttempt> {
    const record = await this.client.callAttempt.findUnique({
      where: {
        organizationId_id: { organizationId: organizationId.value, id: operationId },
      },
    });
    if (record === null) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    return record;
  }
}
