export type RuntimeProfile = "development" | "test" | "ci" | "production";
export type TelemetryExporterMode = "none" | "otlp";
export type TraceSamplerMode = "always_off" | "always_on" | "parent_based_ratio";

export interface ObservabilityConfig {
  readonly profile: RuntimeProfile;
  readonly runtime: "api" | "worker" | "simulator-host";
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly deploymentEnvironment: string;
  readonly logging: Readonly<{
    level: "debug" | "info" | "warn" | "error";
    format: "json" | "pretty";
    output: "stdout";
  }>;
  readonly tracing: Readonly<{
    exporter: TelemetryExporterMode;
    endpoint?: string;
    sampler: TraceSamplerMode;
    ratio?: number;
    timeoutMs: number;
  }>;
  readonly metrics: Readonly<{
    enabled: boolean;
    exporter: TelemetryExporterMode;
    endpoint?: string;
    timeoutMs: number;
  }>;
}

function invalid(key: string): never {
  throw new Error(`Invalid observability configuration: ${key}`);
}

function required(environment: Record<string, string | undefined>, key: string): string {
  const value = environment[key]?.trim();
  return value === undefined || value.length === 0 ? invalid(key) : value;
}

function optionalEnum<const T extends string>(
  environment: Record<string, string | undefined>,
  key: string,
  allowed: readonly T[],
  fallback: T | undefined,
): T {
  const value = environment[key]?.trim();
  if (value === undefined || value.length === 0) {
    return fallback ?? invalid(key);
  }
  return (allowed as readonly string[]).includes(value) ? (value as T) : invalid(key);
}

function positiveInteger(
  environment: Record<string, string | undefined>,
  key: string,
  fallback: number,
  maximum: number,
): number {
  const raw = environment[key];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : invalid(key);
}

function endpoint(
  environment: Record<string, string | undefined>,
  key: string,
  exporter: TelemetryExporterMode,
): string | undefined {
  if (exporter === "none") {
    return undefined;
  }
  const value = required(environment, key);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return invalid(key);
    }
  } catch {
    return invalid(key);
  }
  return value;
}

function booleanValue(
  environment: Record<string, string | undefined>,
  key: string,
  fallback: boolean | undefined,
): boolean {
  const raw = environment[key]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback ?? invalid(key);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  return invalid(key);
}

export function parseObservabilityConfig(
  environment: Record<string, string | undefined>,
  runtime: "api" | "worker" | "simulator-host",
): ObservabilityConfig {
  const rawProfile = required(environment, "RUNTIME_PROFILE");
  const profiles = ["development", "test", "ci", "production"] as const;
  const profile = (profiles as readonly string[]).includes(rawProfile)
    ? (rawProfile as RuntimeProfile)
    : invalid("RUNTIME_PROFILE");
  const serviceName = required(environment, "OTEL_SERVICE_NAME");
  const serviceVersion = required(environment, "OTEL_SERVICE_VERSION");
  const logFormat = optionalEnum(environment, "LOG_FORMAT", ["json", "pretty"] as const, "json");
  const logOutput = optionalEnum(environment, "LOG_OUTPUT", ["stdout"] as const, "stdout");
  if (profile === "production" && logFormat !== "json") {
    invalid("LOG_FORMAT");
  }

  const traceExporter = optionalEnum(
    environment,
    "OTEL_TRACES_EXPORTER",
    ["none", "otlp"] as const,
    profile === "production" ? undefined : "none",
  );
  const sampler = optionalEnum(
    environment,
    "OTEL_TRACES_SAMPLER",
    ["always_off", "always_on", "parent_based_ratio"] as const,
    profile === "production" ? undefined : "always_off",
  );
  let ratio: number | undefined;
  if (sampler === "parent_based_ratio") {
    const rawRatio = required(environment, "OTEL_TRACES_SAMPLER_ARG");
    ratio = Number(rawRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      invalid("OTEL_TRACES_SAMPLER_ARG");
    }
  }

  const metricsEnabled = booleanValue(
    environment,
    "METRICS_ENABLED",
    profile === "production" ? undefined : false,
  );
  const metricsExporter = optionalEnum(
    environment,
    "OTEL_METRICS_EXPORTER",
    ["none", "otlp"] as const,
    profile === "production" ? undefined : "none",
  );
  const traceEndpoint = endpoint(environment, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", traceExporter);
  const metricsEndpoint = endpoint(
    environment,
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
    metricsExporter,
  );

  return Object.freeze({
    profile,
    runtime,
    serviceName,
    serviceVersion,
    deploymentEnvironment: environment["DEPLOYMENT_ENVIRONMENT"]?.trim() || profile,
    logging: Object.freeze({
      level: optionalEnum(
        environment,
        "LOG_LEVEL",
        ["debug", "info", "warn", "error"] as const,
        "info",
      ),
      format: logFormat,
      output: logOutput,
    }),
    tracing: Object.freeze({
      exporter: traceExporter,
      ...(traceEndpoint === undefined ? {} : { endpoint: traceEndpoint }),
      sampler,
      ...(ratio === undefined ? {} : { ratio }),
      timeoutMs: positiveInteger(environment, "OTEL_EXPORT_TIMEOUT_MS", 5_000, 30_000),
    }),
    metrics: Object.freeze({
      enabled: metricsEnabled,
      exporter: metricsExporter,
      ...(metricsEndpoint === undefined ? {} : { endpoint: metricsEndpoint }),
      timeoutMs: positiveInteger(environment, "OTEL_EXPORT_TIMEOUT_MS", 5_000, 30_000),
    }),
  });
}
