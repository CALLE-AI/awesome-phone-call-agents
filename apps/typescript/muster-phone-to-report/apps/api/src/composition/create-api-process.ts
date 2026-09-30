import type { TelemetryLifecycle } from "@muster/observability";

import {
  type HealthExposure,
  type RuntimeProfile,
  parseFleetHttpGuidance,
  parseObservationPollingGuidance,
  validateApiRuntimeConfiguration,
} from "../config/configuration.js";
import type { SystemHealthRequestAuthorizer } from "../system-health/system-health.controller.js";
import type { FleetRequestAuthorizer } from "../fleet/fleet.controller.js";
import {
  startSystemHealthHttpRuntime,
  type SystemHealthHttpRuntime,
} from "./start-system-health-http-runtime.js";

export interface ApiProcessConfiguration {
  readonly connectionString: string;
  readonly healthExposure: HealthExposure;
  readonly host: string;
  readonly jobsSchema: string;
  readonly port: number;
  readonly readinessTimeoutMs: number;
  readonly observationRetryAfterSeconds: number;
  readonly runtimeProfile: RuntimeProfile;
  readonly fleetHeartbeatMaxAgeSeconds: number;
  readonly fleetMaxEndpoints: number;
  readonly fleetRetryAfterSeconds: number;
}

function invalid(key: string): never {
  throw new Error(`Invalid API configuration: ${key}`);
}

function required(environment: Record<string, string | undefined>, key: string): string {
  const value = environment[key]?.trim();
  return value === undefined || value.length === 0 ? invalid(key) : value;
}

function boundedInteger(
  environment: Record<string, string | undefined>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(required(environment, key));
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : invalid(key);
}

function runtimeProfile(environment: Record<string, string | undefined>): RuntimeProfile {
  const value = required(environment, "RUNTIME_PROFILE");
  return value === "development" || value === "test" || value === "ci" || value === "production"
    ? value
    : invalid("RUNTIME_PROFILE");
}

function healthExposure(
  environment: Record<string, string | undefined>,
  profile: RuntimeProfile,
): HealthExposure {
  const value =
    environment["HEALTH_EXPOSURE"]?.trim() ||
    (profile === "production" ? "disabled" : invalid("HEALTH_EXPOSURE"));
  return value === "disabled" ||
    value === "loopback" ||
    value === "test-harness" ||
    value === "internal-policy"
    ? value
    : invalid("HEALTH_EXPOSURE");
}

export function parseApiProcessConfiguration(
  environment: Record<string, string | undefined>,
): ApiProcessConfiguration {
  const profile = runtimeProfile(environment);
  const exposure = healthExposure(environment, profile);
  const host = required(environment, "API_HOST");
  const jobsSchema = required(environment, "JOB_SCHEMA");
  if (!/^[a-z][a-z0-9_]{0,49}$/u.test(jobsSchema)) invalid("JOB_SCHEMA");
  const readinessTimeoutMs = boundedInteger(environment, "READINESS_TIMEOUT_MS", 50, 750);
  const observationPolling = parseObservationPollingGuidance(environment);
  const fleetGuidance = parseFleetHttpGuidance(environment);
  validateApiRuntimeConfiguration({
    runtimeProfile: profile,
    healthExposure: exposure,
    readinessTimeoutMs,
  });
  if (exposure === "loopback" && host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    invalid("API_HOST");
  }
  return Object.freeze({
    connectionString: required(environment, "DATABASE_URL"),
    healthExposure: exposure,
    host,
    jobsSchema,
    port: boundedInteger(environment, "API_PORT", 1, 65_535),
    readinessTimeoutMs,
    observationRetryAfterSeconds: observationPolling.retryAfterSeconds,
    fleetHeartbeatMaxAgeSeconds: fleetGuidance.heartbeatMaxAgeSeconds,
    fleetMaxEndpoints: fleetGuidance.maxEndpoints,
    fleetRetryAfterSeconds: fleetGuidance.retryAfterSeconds,
    runtimeProfile: profile,
  });
}

export async function createApiProcess(
  environment: Record<string, string | undefined>,
  telemetry: TelemetryLifecycle,
  requestAuthorizer?: SystemHealthRequestAuthorizer,
  fleetRequestAuthorizer?: FleetRequestAuthorizer,
): Promise<SystemHealthHttpRuntime> {
  const configuration = parseApiProcessConfiguration(environment);
  return await startSystemHealthHttpRuntime({
    connectionString: configuration.connectionString,
    healthExposure: configuration.healthExposure,
    host: configuration.host,
    jobsSchema: configuration.jobsSchema,
    port: configuration.port,
    readinessTimeoutMs: configuration.readinessTimeoutMs,
    observationRetryAfterSeconds: configuration.observationRetryAfterSeconds,
    fleetHeartbeatMaxAgeSeconds: configuration.fleetHeartbeatMaxAgeSeconds,
    fleetMaxEndpoints: configuration.fleetMaxEndpoints,
    fleetRetryAfterSeconds: configuration.fleetRetryAfterSeconds,
    runtimeProfile: configuration.runtimeProfile,
    startJobs: true,
    telemetry,
    ...(fleetRequestAuthorizer === undefined ? {} : { fleetRequestAuthorizer }),
    ...(requestAuthorizer === undefined ? {} : { requestAuthorizer }),
  });
}
