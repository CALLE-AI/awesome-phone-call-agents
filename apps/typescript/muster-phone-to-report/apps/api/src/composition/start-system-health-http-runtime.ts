import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { createPgBossJobInfrastructure } from "@muster/infrastructure-jobs";
import {
  createGlobalFoundationMetrics,
  createGlobalFleetHttpMetrics,
  createGlobalObservationHttpMetrics,
  createPinoLoggerRuntime,
  injectActiveW3CTraceContext,
  runObservationHttpSpan,
  runFleetHttpSpan,
  runSystemHealthHttpSpan,
  type TelemetryLifecycle,
} from "@muster/observability";

import { AppModule } from "../app.module.js";
import {
  type HealthExposure,
  type RuntimeProfile,
  parseObservationPollingGuidance,
  parseFleetHttpGuidance,
  validateApiRuntimeConfiguration,
} from "../config/configuration.js";
import { createHealthAccessPolicy } from "../system-health/health-access-policy.js";
import { SafeHttpExceptionFilter } from "../system-health/safe-http-exception.filter.js";
import type { SystemHealthRequestAuthorizer } from "../system-health/system-health.controller.js";
import type { ObservationModuleDependencies } from "../observations/observation.module.js";
import type { FleetModuleDependencies } from "../fleet/fleet.module.js";
import type { FleetRequestAuthorizer } from "../fleet/fleet.controller.js";
import { createApiApplication } from "./create-api-application.js";
import { createApiPostgresBinding } from "./create-api-postgres.js";

export interface StartSystemHealthHttpRuntimeOptions {
  readonly connectionString: string;
  readonly jobsSchema: string;
  readonly runtimeProfile: RuntimeProfile;
  readonly healthExposure: HealthExposure;
  readonly startJobs: boolean;
  readonly host?: string;
  readonly port?: number;
  readonly readinessTimeoutMs?: number;
  readonly observationRetryAfterSeconds?: number;
  readonly fleetHeartbeatMaxAgeSeconds?: number;
  readonly fleetMaxEndpoints?: number;
  readonly fleetRetryAfterSeconds?: number;
  readonly fleetRequestAuthorizer?: FleetRequestAuthorizer;
  readonly requestAuthorizer?: SystemHealthRequestAuthorizer;
  readonly telemetry?: TelemetryLifecycle;
  readonly observation?: Pick<
    ObservationModuleDependencies,
    "getObservationOperation" | "requestAuthorizer" | "requestObservation"
  > &
    Partial<Pick<ObservationModuleDependencies, "logger" | "telemetry">>;
  readonly fleet?: Pick<FleetModuleDependencies, "getFleetHealth" | "requestAuthorizer"> &
    Partial<Pick<FleetModuleDependencies, "logger" | "telemetry">>;
}

export interface SystemHealthHttpRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

type ObservationRuntimeDependencies = NonNullable<
  StartSystemHealthHttpRuntimeOptions["observation"]
>;

function hasCompleteObservationDependencies(
  value: ObservationRuntimeDependencies | undefined,
): value is ObservationRuntimeDependencies {
  return (
    value !== undefined &&
    typeof value.requestAuthorizer === "function" &&
    typeof value.requestObservation?.execute === "function" &&
    typeof value.getObservationOperation?.execute === "function"
  );
}

export function createSystemHealthRuntimeCloser(
  resources: readonly (() => Promise<void>)[],
): () => Promise<void> {
  let closePromise: Promise<void> | undefined;
  return () => {
    closePromise ??= (async () => {
      const errors: unknown[] = [];
      for (const close of resources) {
        try {
          await close();
        } catch (error: unknown) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, "API runtime shutdown failed");
    })();
    return closePromise;
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export async function startSystemHealthHttpRuntime(
  options: StartSystemHealthHttpRuntimeOptions,
): Promise<SystemHealthHttpRuntime> {
  const configuration = validateApiRuntimeConfiguration({
    runtimeProfile: options.runtimeProfile,
    healthExposure: options.healthExposure,
    readinessTimeoutMs: options.readinessTimeoutMs ?? 750,
  });
  const observationPolling = parseObservationPollingGuidance({
    OBSERVATION_RETRY_AFTER_SECONDS: String(options.observationRetryAfterSeconds ?? 2),
  });
  const fleetGuidance = parseFleetHttpGuidance({
    FLEET_HEARTBEAT_MAX_AGE_SECONDS: String(options.fleetHeartbeatMaxAgeSeconds ?? 900),
    FLEET_MAX_ENDPOINTS: String(options.fleetMaxEndpoints ?? 500),
    FLEET_RETRY_AFTER_SECONDS: String(options.fleetRetryAfterSeconds ?? 3),
  });
  if (
    configuration.healthExposure === "internal-policy" &&
    options.requestAuthorizer === undefined
  ) {
    throw new Error("Invalid API configuration: HEALTH_ACCESS_POLICY");
  }
  if (options.runtimeProfile !== "test" && options.fleetRequestAuthorizer === undefined) {
    throw new Error("Invalid API configuration: FLEET_REQUEST_AUTHORIZER");
  }
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  let postgres: ReturnType<typeof createApiPostgresBinding> | undefined;
  let jobs: ReturnType<typeof createPgBossJobInfrastructure> | undefined;
  let loggerRuntime: ReturnType<typeof createPinoLoggerRuntime> | undefined;
  let nest: NestFastifyApplication | undefined;
  const close = createSystemHealthRuntimeCloser([
    async () => await nest?.close(),
    async () => await jobs?.stop(),
    async () => await postgres?.close(),
    async () => await options.telemetry?.shutdown(),
    async () => await loggerRuntime?.close(),
  ]);
  try {
    postgres = createApiPostgresBinding(options.connectionString, { probeTimeoutMs: 500 });
    jobs = createPgBossJobInfrastructure({
      connectionString: options.connectionString,
      schema: options.jobsSchema,
      readinessTimeoutMs: 500,
    });
    const logDestination =
      configuration.runtimeProfile === "production" ? undefined : { write: () => undefined };
    loggerRuntime = createPinoLoggerRuntime({
      ...(logDestination === undefined ? {} : { destination: logDestination }),
      bindings: {
        service: "muster-api",
        environment: configuration.runtimeProfile,
        version: "0.0.0",
        runtime: "api",
      },
    });
    const application = createApiApplication({
      auditEvents: postgres.auditEvents,
      clock: { now: () => new Date().toISOString() },
      databaseHealth: postgres.databaseHealth,
      healthAccessPolicy: createHealthAccessPolicy(configuration.healthExposure),
      identifiers: { generate: randomUUID },
      jobBackendHealth: jobs.health,
      jobScheduler: jobs.scheduler,
      logger: loggerRuntime.logger,
      fleetHealth: postgres.fleetHealth,
      schedulerHeartbeat: postgres.schedulerHeartbeat,
      incidentSummaries: { listForEndpoints: async () => [] },
      fleetHeartbeatMaxAgeSeconds: fleetGuidance.heartbeatMaxAgeSeconds,
    });
    const metrics = createGlobalFoundationMetrics("@muster/api");
    const observation = hasCompleteObservationDependencies(options.observation)
      ? options.observation
      : undefined;
    const fleet =
      options.fleet ??
      (options.fleetRequestAuthorizer === undefined
        ? undefined
        : {
            getFleetHealth: application.getFleetHealth,
            requestAuthorizer: options.fleetRequestAuthorizer,
          });
    if (options.startJobs) await jobs.start();
    const exposeHealth = configuration.healthExposure !== "disabled";
    nest = await NestFactory.create<NestFastifyApplication>(
      AppModule.register(
        exposeHealth
          ? {
              accessPolicy: application.healthAccessPolicy,
              getSystemHealth: application.getSystemHealth,
              listenerScope: isLoopbackHost(host) ? "loopback" : "non-loopback",
              logger: application.logger,
              requestAuthorizer: options.requestAuthorizer ?? (async () => true),
              telemetry: {
                run: runSystemHealthHttpSpan,
                recordRequest: (input) => metrics.recordHttpRequest(input),
              },
              readinessTimeoutMs: configuration.readinessTimeoutMs,
            }
          : undefined,
        observation === undefined
          ? undefined
          : {
              ...observation,
              logger: observation.logger ?? application.logger,
              retryAfterSeconds: observationPolling.retryAfterSeconds,
              telemetry:
                observation.telemetry ??
                (() => {
                  const observationMetrics = createGlobalObservationHttpMetrics("@muster/api");
                  return {
                    run: runObservationHttpSpan,
                    activeTraceContext: injectActiveW3CTraceContext,
                    recordRequest: (input) => observationMetrics.recordRequest(input),
                  };
                })(),
            },
        fleet === undefined
          ? undefined
          : {
              ...fleet,
              logger: fleet.logger ?? application.logger,
              maxEndpoints: fleetGuidance.maxEndpoints,
              retryAfterSeconds: fleetGuidance.retryAfterSeconds,
              telemetry:
                fleet.telemetry ??
                (() => {
                  const fleetMetrics = createGlobalFleetHttpMetrics("@muster/api");
                  return {
                    run: runFleetHttpSpan,
                    recordRequest: (input) => fleetMetrics.recordRequest(input),
                  };
                })(),
            },
      ),
      new FastifyAdapter({ logger: false }),
      { abortOnError: true, bufferLogs: false },
    );
    nest.useGlobalFilters(new SafeHttpExceptionFilter());
    await nest.listen(port, host);
    const baseUrl = await nest.getUrl();
    return Object.freeze({
      baseUrl,
      close,
    });
  } catch (error: unknown) {
    try {
      await close();
    } catch (cleanupError: unknown) {
      const cleanupErrors =
        cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
      throw new AggregateError([error, ...cleanupErrors], "API startup and cleanup failed", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
