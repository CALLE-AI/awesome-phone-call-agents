import {
  GetSystemHealth,
  GetFleetHealth,
  RecordFoundationAuditEvent,
  type AuditEventRepository,
  type Clock,
  type DatabaseHealthPort,
  type HealthAccessPolicy,
  type IdentifierGenerator,
  type JobBackendHealthPort,
  type JobSchedulerPort,
  type LoggerPort,
  type FleetHealthRepository,
  type FleetIncidentSummaryPort,
  type SchedulerHeartbeatPort,
} from "@muster/application";

export const API_APPLICATION_TOKENS = Object.freeze({
  auditEvents: Symbol("AuditEventRepository"),
  clock: Symbol("Clock"),
  databaseHealth: Symbol("DatabaseHealthPort"),
  healthAccessPolicy: Symbol("HealthAccessPolicy"),
  identifiers: Symbol("IdentifierGenerator"),
  jobBackendHealth: Symbol("JobBackendHealthPort"),
  jobScheduler: Symbol("JobSchedulerPort"),
  logger: Symbol("LoggerPort"),
});

export interface ApiApplicationDependencies {
  readonly auditEvents: AuditEventRepository;
  readonly clock: Clock;
  readonly databaseHealth: DatabaseHealthPort;
  readonly healthAccessPolicy: HealthAccessPolicy;
  readonly identifiers: IdentifierGenerator;
  readonly jobBackendHealth: JobBackendHealthPort;
  readonly jobScheduler: JobSchedulerPort;
  readonly logger: LoggerPort;
  readonly fleetHealth: FleetHealthRepository;
  readonly incidentSummaries: FleetIncidentSummaryPort;
  readonly schedulerHeartbeat: SchedulerHeartbeatPort;
  readonly fleetHeartbeatMaxAgeSeconds: number;
}

export interface ApiApplication {
  readonly getSystemHealth: GetSystemHealth;
  readonly recordFoundationAuditEvent: RecordFoundationAuditEvent;
  readonly healthAccessPolicy: HealthAccessPolicy;
  readonly jobScheduler: JobSchedulerPort;
  readonly logger: LoggerPort;
  readonly getFleetHealth: GetFleetHealth;
}

export function createApiApplication(dependencies: ApiApplicationDependencies): ApiApplication {
  return Object.freeze({
    getSystemHealth: new GetSystemHealth({
      databaseHealth: dependencies.databaseHealth,
      jobBackendHealth: dependencies.jobBackendHealth,
    }),
    recordFoundationAuditEvent: new RecordFoundationAuditEvent({
      auditEvents: dependencies.auditEvents,
      clock: dependencies.clock,
      identifiers: dependencies.identifiers,
    }),
    healthAccessPolicy: dependencies.healthAccessPolicy,
    jobScheduler: dependencies.jobScheduler,
    logger: dependencies.logger,
    getFleetHealth: new GetFleetHealth({
      fleetHealthRepository: dependencies.fleetHealth,
      schedulerHeartbeat: dependencies.schedulerHeartbeat,
      incidentSummaries: dependencies.incidentSummaries,
      clock: dependencies.clock,
      heartbeatMaxAgeSeconds: dependencies.fleetHeartbeatMaxAgeSeconds,
    }),
  });
}
