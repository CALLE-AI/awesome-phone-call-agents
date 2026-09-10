import type { PrismaClient } from "./generated/prisma/client.js";
import { PrismaAuditEventRepository } from "./prisma-audit-event.repository.js";
import { PrismaCallAttemptRepository } from "./prisma-call-attempt.repository.js";
import { PrismaEvidenceRepository } from "./prisma-evidence.repository.js";
import { PrismaFleetHealthRepository } from "./prisma-fleet-health.repository.js";
import { PrismaLiveSimulatorAuthorizationRepository } from "./prisma-live-simulator-authorization.repository.js";
import { PrismaLiveSimulatorProviderFactRepository } from "./prisma-live-simulator-provider-fact.repository.js";
import { PrismaObservationProfileRepository } from "./prisma-observation-profile.repository.js";
import { PrismaObservationRepository } from "./prisma-observation.repository.js";
import { PrismaSchedulerHeartbeatRepository } from "./prisma-scheduler-heartbeat.repository.js";

export class PrismaUnitOfWork {
  public readonly auditEvents: PrismaAuditEventRepository;
  public readonly observationProfiles: PrismaObservationProfileRepository;
  public readonly callAttempts: PrismaCallAttemptRepository;
  public readonly evidence: PrismaEvidenceRepository;
  public readonly fleetHealth: PrismaFleetHealthRepository;
  public readonly liveSimulatorAuthorizations: PrismaLiveSimulatorAuthorizationRepository;
  public readonly liveSimulatorProviderFacts: PrismaLiveSimulatorProviderFactRepository;
  public readonly observations: PrismaObservationRepository;
  public readonly schedulerHeartbeat: PrismaSchedulerHeartbeatRepository;

  public constructor(client: PrismaClient) {
    this.auditEvents = new PrismaAuditEventRepository(client);
    this.observationProfiles = new PrismaObservationProfileRepository(client);
    this.callAttempts = new PrismaCallAttemptRepository(client);
    this.evidence = new PrismaEvidenceRepository(client);
    this.fleetHealth = new PrismaFleetHealthRepository(client);
    this.liveSimulatorAuthorizations = new PrismaLiveSimulatorAuthorizationRepository(client);
    this.liveSimulatorProviderFacts = new PrismaLiveSimulatorProviderFactRepository(client);
    this.observations = new PrismaObservationRepository(client);
    this.schedulerHeartbeat = new PrismaSchedulerHeartbeatRepository(client);
  }
}
