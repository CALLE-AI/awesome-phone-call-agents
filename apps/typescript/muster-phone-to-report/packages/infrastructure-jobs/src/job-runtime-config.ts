export interface JobRuntimeConfig {
  readonly schema: string;
  readonly poolMax: number;
  readonly concurrency: number;
  readonly observationConcurrency: number;
  readonly backlogLimit: number;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly workTimeoutSeconds: number;
  readonly enqueueTimeoutMs: number;
  readonly readinessTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
}

function invalid(key: string): never {
  throw new Error(`Invalid job configuration: ${key}`);
}

function boundedInteger(
  environment: Record<string, string | undefined>,
  key: string,
  fallback: number | undefined,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[key];
  if (raw === undefined || raw.length === 0) {
    return fallback ?? invalid(key);
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : invalid(key);
}

export function parseJobRuntimeConfig(
  environment: Record<string, string | undefined>,
): JobRuntimeConfig {
  const profile = environment["RUNTIME_PROFILE"];
  if (!(["development", "test", "ci", "production"] as const).includes(profile as never)) {
    invalid("RUNTIME_PROFILE");
  }
  const production = profile === "production";
  const schema = environment["PG_BOSS_SCHEMA"]?.trim() || "pgboss";
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(schema)) {
    invalid("PG_BOSS_SCHEMA");
  }
  const concurrency = boundedInteger(
    environment,
    "JOB_CONCURRENCY",
    production ? undefined : 2,
    1,
    32,
  );
  return Object.freeze({
    schema,
    poolMax: boundedInteger(environment, "PG_BOSS_POOL_MAX", production ? undefined : 3, 1, 32),
    concurrency,
    observationConcurrency: boundedInteger(
      environment,
      "OBSERVATION_JOB_CONCURRENCY",
      concurrency,
      1,
      32,
    ),
    backlogLimit: boundedInteger(
      environment,
      "JOB_BACKLOG_LIMIT",
      production ? undefined : 100,
      1,
      100_000,
    ),
    retryLimit: boundedInteger(environment, "JOB_RETRY_LIMIT", production ? undefined : 2, 0, 10),
    retryDelaySeconds: boundedInteger(
      environment,
      "JOB_RETRY_DELAY_SECONDS",
      production ? undefined : 0,
      0,
      3_600,
    ),
    workTimeoutSeconds: boundedInteger(
      environment,
      "JOB_WORK_TIMEOUT_SECONDS",
      production ? undefined : 30,
      1,
      3_600,
    ),
    enqueueTimeoutMs: boundedInteger(
      environment,
      "JOB_ENQUEUE_TIMEOUT_MS",
      production ? undefined : 2_000,
      100,
      30_000,
    ),
    readinessTimeoutMs: boundedInteger(
      environment,
      "JOB_READINESS_TIMEOUT_MS",
      production ? undefined : 500,
      50,
      5_000,
    ),
    shutdownTimeoutMs: boundedInteger(
      environment,
      "JOB_SHUTDOWN_TIMEOUT_MS",
      production ? undefined : 30_000,
      1_000,
      120_000,
    ),
  });
}
