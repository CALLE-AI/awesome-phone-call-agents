import type {
  AuditEventRepository,
  CallAttemptRepository,
  DatabaseHealthPort,
  EvidenceRepository,
  FleetHealthRepository,
  LiveSimulatorAuthorizationRepository,
  LiveSimulatorProviderFactRepository,
  ObservationProfileRepository,
  ObservationRepository,
  SchedulerHeartbeatPort,
} from "@muster/application";

import { PostgresHealthAdapter } from "./postgres-health.adapter.js";
import { createPrismaClient, type PostgresPoolHandle } from "./prisma-client.js";
import { PrismaCallAttemptRepository } from "./prisma-call-attempt.repository.js";
import { PrismaEvidenceRepository } from "./prisma-evidence.repository.js";
import { PrismaObservationProfileRepository } from "./prisma-observation-profile.repository.js";
import { PrismaObservationRepository } from "./prisma-observation.repository.js";
import { PrismaUnitOfWork } from "./prisma-unit-of-work.js";

export { validatePostgresConnectionString } from "./postgres-connection-config.js";
export {
  createDisposablePostgresOwner,
  provisionExclusiveDisposablePostgresDatabaseOwnership,
  type DisposablePostgresOwner,
  type DisposablePostgresOwnershipAttestation,
  type DisposablePostgresProvisioningAttestation,
} from "./disposable-postgres-owner.js";
export type { PostgresPoolHandle } from "./prisma-client.js";

export interface PostgresPersistence {
  readonly auditEvents: AuditEventRepository;
  readonly observationProfiles: ObservationProfileRepository;
  readonly callAttempts: CallAttemptRepository;
  readonly evidence: EvidenceRepository;
  readonly fleetHealth: FleetHealthRepository;
  readonly liveSimulatorAuthorizations: LiveSimulatorAuthorizationRepository;
  readonly liveSimulatorProviderFacts: LiveSimulatorProviderFactRepository;
  readonly observations: ObservationRepository;
  readonly schedulerHeartbeat: SchedulerHeartbeatPort;
  readonly databaseHealth: DatabaseHealthPort;
  runObservationResultTransaction<T>(
    operation: (repositories: ObservationResultRepositories) => Promise<T>,
    canCommit: () => boolean,
  ): Promise<T | undefined>;
  disconnect(): Promise<void>;
}

export interface ObservationResultRepositories {
  readonly attempts: CallAttemptRepository;
  readonly profiles: ObservationProfileRepository;
  readonly evidence: EvidenceRepository;
  readonly observations: ObservationRepository;
}

class ObservationResultCompletionBarrierBlocked extends Error {}

export function createPostgresPersistence(
  pool: PostgresPoolHandle,
  options: {
    readonly probeTimeoutMs?: number;
    readonly observationResultTransactionMaxWaitMs?: number;
    readonly observationResultTransactionTimeoutMs?: number;
  } = {},
): PostgresPersistence {
  const observationResultTransactionMaxWaitMs =
    options.observationResultTransactionMaxWaitMs ?? 1_000;
  const observationResultTransactionTimeoutMs =
    options.observationResultTransactionTimeoutMs ?? 4_000;
  if (
    !Number.isSafeInteger(observationResultTransactionMaxWaitMs) ||
    observationResultTransactionMaxWaitMs < 1 ||
    !Number.isSafeInteger(observationResultTransactionTimeoutMs) ||
    observationResultTransactionTimeoutMs < 1 ||
    observationResultTransactionMaxWaitMs + observationResultTransactionTimeoutMs > 5_000
  ) {
    throw new Error("Observation result transaction deadline must be between 2 and 5000ms");
  }
  const client = createPrismaClient(pool);
  const unitOfWork = new PrismaUnitOfWork(client);
  return Object.freeze({
    auditEvents: unitOfWork.auditEvents,
    observationProfiles: unitOfWork.observationProfiles,
    callAttempts: unitOfWork.callAttempts,
    evidence: unitOfWork.evidence,
    fleetHealth: unitOfWork.fleetHealth,
    liveSimulatorAuthorizations: unitOfWork.liveSimulatorAuthorizations,
    liveSimulatorProviderFacts: unitOfWork.liveSimulatorProviderFacts,
    observations: unitOfWork.observations,
    schedulerHeartbeat: unitOfWork.schedulerHeartbeat,
    databaseHealth: new PostgresHealthAdapter(client, options.probeTimeoutMs ?? 1_000),
    runObservationResultTransaction: async <T>(
      operation: (repositories: ObservationResultRepositories) => Promise<T>,
      canCommit: () => boolean,
    ): Promise<T | undefined> => {
      try {
        return await client.$transaction(
          async (transaction) => {
            const result = await operation(
              Object.freeze({
                attempts: new PrismaCallAttemptRepository(transaction),
                profiles: new PrismaObservationProfileRepository(transaction),
                evidence: new PrismaEvidenceRepository(transaction),
                observations: new PrismaObservationRepository(transaction),
              }),
            );
            if (!canCommit()) throw new ObservationResultCompletionBarrierBlocked();
            return result;
          },
          {
            maxWait: observationResultTransactionMaxWaitMs,
            timeout: observationResultTransactionTimeoutMs,
          },
        );
      } catch (error: unknown) {
        if (error instanceof ObservationResultCompletionBarrierBlocked) return undefined;
        throw error;
      }
    },
    disconnect: async () => client.$disconnect(),
  });
}
