import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { Clock, IdentifierGenerator } from "@muster/application";
import { FOUNDATION_HEALTH_JOB_NAME } from "@muster/contracts";
import {
  FoundationHealthJobHandler,
  createPgBossJobInfrastructure,
  parseJobRuntimeConfig,
} from "@muster/infrastructure-jobs";
import {
  createGlobalFoundationMetrics,
  createPinoLoggerRuntime,
  injectActiveW3CTraceContext,
  parseObservabilityConfig,
  runWithConsumerSpan,
  runWithProducerSpan,
  type TelemetryLifecycle,
} from "@muster/observability";

import {
  createFoundationWorkerRuntime,
  type FoundationWorkerRuntime,
} from "./create-foundation-worker-runtime.js";
import { createWorker } from "./create-worker.js";
import {
  createWorkerPostgresBinding,
  parseWorkerPostgresConfig,
} from "./create-worker-postgres.js";

function required(environment: Record<string, string | undefined>, key: string): string {
  const value = environment[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`Invalid worker configuration: ${key}`);
  }
  return value;
}

const systemClock: Clock = { now: () => new Date().toISOString() };
const systemIdentifiers: IdentifierGenerator = { generate: () => randomUUID() };

export function createWorkerProcess(
  environment: Record<string, string | undefined>,
  telemetry: TelemetryLifecycle,
): FoundationWorkerRuntime {
  const observability = parseObservabilityConfig(environment, "worker");
  const jobConfig = parseJobRuntimeConfig(environment);
  const databaseUrl = required(environment, "DATABASE_URL");
  const postgres = createWorkerPostgresBinding(parseWorkerPostgresConfig(environment));
  const foundationMetrics = createGlobalFoundationMetrics();
  const recordMetric = (record: () => void) => {
    try {
      record();
    } catch {
      // Telemetry failure cannot reject business work or change readiness.
    }
  };
  const jobs = createPgBossJobInfrastructure({
    connectionString: databaseUrl,
    schema: jobConfig.schema,
    poolMax: jobConfig.poolMax,
    concurrency: jobConfig.concurrency,
    observationConcurrency: jobConfig.observationConcurrency,
    backlogLimit: jobConfig.backlogLimit,
    retryLimit: jobConfig.retryLimit,
    retryDelaySeconds: jobConfig.retryDelaySeconds,
    workTimeoutSeconds: jobConfig.workTimeoutSeconds,
    enqueueTimeoutMs: jobConfig.enqueueTimeoutMs,
    readinessTimeoutMs: jobConfig.readinessTimeoutMs,
    shutdownTimeoutMs: jobConfig.shutdownTimeoutMs,
    activeTraceContext: injectActiveW3CTraceContext,
    runProducerSpan: async (operation) =>
      await runWithProducerSpan({
        spanName: `${FOUNDATION_HEALTH_JOB_NAME} send`,
        operation,
      }),
    onReadiness: (outcome) =>
      recordMetric(() => foundationMetrics.recordReadiness({ dependency: "jobs", outcome })),
  });
  const loggerRuntime = createPinoLoggerRuntime({
    level: observability.logging.level,
    bindings: {
      service: observability.serviceName,
      environment: observability.deploymentEnvironment,
      version: observability.serviceVersion,
      runtime: "worker",
    },
  });
  const application = createWorker({
    auditEvents: postgres.auditEvents,
    clock: systemClock,
    databaseHealth: {
      getReadiness: async () => {
        const outcome = await postgres.databaseHealth.getReadiness();
        recordMetric(() => foundationMetrics.recordReadiness({ dependency: "database", outcome }));
        return outcome;
      },
    },
    identifiers: systemIdentifiers,
    jobBackendHealth: jobs.health,
    logger: loggerRuntime.logger,
  });
  const handler = new FoundationHealthJobHandler(application.runFoundationHealthCheck, {
    run: async (payload, operation) =>
      await runWithConsumerSpan({
        carrier:
          payload.traceContext === undefined
            ? {}
            : {
                traceparent: payload.traceContext.traceparent,
                ...(payload.traceContext.tracestate === undefined
                  ? {}
                  : { tracestate: payload.traceContext.tracestate }),
              },
        spanName: `${FOUNDATION_HEALTH_JOB_NAME} process`,
        operation,
      }),
  });
  return createFoundationWorkerRuntime({
    telemetry,
    jobs,
    handler: async (payload, execution) => {
      recordMetric(() =>
        foundationMetrics.recordJobQueueDelay({
          jobType: FOUNDATION_HEALTH_JOB_NAME,
          durationSeconds: execution.queueDelaySeconds,
        }),
      );
      const startedAt = performance.now();
      try {
        const result = await handler.handle(payload);
        recordMetric(() =>
          foundationMetrics.recordJobExecution({
            jobType: FOUNDATION_HEALTH_JOB_NAME,
            outcome: "succeeded",
            durationSeconds: (performance.now() - startedAt) / 1_000,
          }),
        );
        return result;
      } catch (error: unknown) {
        recordMetric(() =>
          foundationMetrics.recordJobExecution({
            jobType: FOUNDATION_HEALTH_JOB_NAME,
            outcome: execution.retryCount < execution.retryLimit ? "retried" : "failed",
            durationSeconds: (performance.now() - startedAt) / 1_000,
          }),
        );
        throw error;
      }
    },
    closeDatabase: async () => await postgres.close(),
    closeLogger: async () => await loggerRuntime.close(),
  });
}
