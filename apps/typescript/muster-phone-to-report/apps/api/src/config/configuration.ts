export type RuntimeProfile = "development" | "test" | "ci" | "production";
export type HealthExposure = "disabled" | "loopback" | "test-harness" | "internal-policy";

export interface ApiRuntimeConfiguration {
  readonly runtimeProfile: RuntimeProfile;
  readonly healthExposure: HealthExposure;
  readonly readinessTimeoutMs: number;
}

export interface ObservationPollingGuidance {
  readonly retryAfterSeconds: number;
}

export interface FleetHttpGuidance {
  readonly heartbeatMaxAgeSeconds: number;
  readonly maxEndpoints: number;
  readonly retryAfterSeconds: number;
}

function boundedFleetInteger(
  environment: Record<string, string | undefined>,
  key: string,
  fallback: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(environment[key]?.trim() ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid API configuration: ${key}`);
  }
  return value;
}

export function parseFleetHttpGuidance(
  environment: Record<string, string | undefined>,
): FleetHttpGuidance {
  return Object.freeze({
    heartbeatMaxAgeSeconds: boundedFleetInteger(
      environment,
      "FLEET_HEARTBEAT_MAX_AGE_SECONDS",
      "900",
      60,
      86_400,
    ),
    maxEndpoints: boundedFleetInteger(environment, "FLEET_MAX_ENDPOINTS", "500", 1, 500),
    retryAfterSeconds: boundedFleetInteger(environment, "FLEET_RETRY_AFTER_SECONDS", "3", 1, 60),
  });
}

export function parseObservationPollingGuidance(
  environment: Record<string, string | undefined>,
): ObservationPollingGuidance {
  const raw = environment["OBSERVATION_RETRY_AFTER_SECONDS"]?.trim() ?? "2";
  const retryAfterSeconds = Number(raw);
  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 60) {
    throw new Error("Invalid API configuration: OBSERVATION_RETRY_AFTER_SECONDS");
  }
  return Object.freeze({ retryAfterSeconds });
}

export function validateApiRuntimeConfiguration(
  input: ApiRuntimeConfiguration,
): ApiRuntimeConfiguration {
  if (
    !Number.isInteger(input.readinessTimeoutMs) ||
    input.readinessTimeoutMs < 50 ||
    input.readinessTimeoutMs > 750
  ) {
    throw new Error("Invalid API configuration: READINESS_TIMEOUT_MS");
  }
  if (
    input.runtimeProfile === "production" &&
    input.healthExposure !== "disabled" &&
    input.healthExposure !== "internal-policy"
  ) {
    throw new Error("Invalid API configuration: HEALTH_EXPOSURE");
  }
  if (
    (input.runtimeProfile === "test" || input.runtimeProfile === "ci") &&
    input.healthExposure !== "disabled" &&
    input.healthExposure !== "test-harness"
  ) {
    throw new Error("Invalid API configuration: HEALTH_EXPOSURE");
  }
  return Object.freeze({ ...input });
}
