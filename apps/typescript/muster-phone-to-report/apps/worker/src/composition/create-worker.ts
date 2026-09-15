import {
  GetSystemHealth,
  RecordFoundationAuditEvent,
  RunFoundationHealthCheck,
  type AuditEventRepository,
  type Clock,
  type DatabaseHealthPort,
  type IdentifierGenerator,
  type JobBackendHealthPort,
  type LoggerPort,
} from "@muster/application";

export const WORKER_APPLICATION_TOKENS = Object.freeze({
  auditEvents: Symbol("AuditEventRepository"),
  clock: Symbol("Clock"),
  databaseHealth: Symbol("DatabaseHealthPort"),
  identifiers: Symbol("IdentifierGenerator"),
  jobBackendHealth: Symbol("JobBackendHealthPort"),
  logger: Symbol("LoggerPort"),
});

export interface WorkerDependencies {
  readonly auditEvents: AuditEventRepository;
  readonly clock: Clock;
  readonly databaseHealth: DatabaseHealthPort;
  readonly identifiers: IdentifierGenerator;
  readonly jobBackendHealth: JobBackendHealthPort;
  readonly logger: LoggerPort;
}

export interface WorkerApplication {
  readonly runFoundationHealthCheck: RunFoundationHealthCheck;
}

export function createWorker(dependencies: WorkerDependencies): WorkerApplication {
  const getSystemHealth = new GetSystemHealth({
    databaseHealth: dependencies.databaseHealth,
    jobBackendHealth: dependencies.jobBackendHealth,
  });
  const recordAuditEvent = new RecordFoundationAuditEvent({
    auditEvents: dependencies.auditEvents,
    clock: dependencies.clock,
    identifiers: dependencies.identifiers,
  });

  return Object.freeze({
    runFoundationHealthCheck: new RunFoundationHealthCheck({
      getSystemHealth,
      recordAuditEvent,
      logger: dependencies.logger,
    }),
  });
}
