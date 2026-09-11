import {
  createPostgresPersistence,
  type PostgresPersistence,
  validatePostgresConnectionString,
} from "@muster/infrastructure-postgres";
import { Pool } from "pg";

export interface WorkerPostgresBinding extends PostgresPersistence {
  close(): Promise<void>;
}

export interface WorkerPostgresConfig {
  readonly connectionString: string;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly probeTimeoutMs: number;
}

function invalid(key: string): never {
  throw new Error(`Invalid worker PostgreSQL configuration: ${key}`);
}

function boundedInteger(
  environment: Record<string, string | undefined>,
  key: string,
  fallback: number | undefined,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[key]?.trim();
  if (raw === undefined || raw.length === 0) return fallback ?? invalid(key);
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : invalid(key);
}

export function parseWorkerPostgresConfig(
  environment: Record<string, string | undefined>,
): WorkerPostgresConfig {
  const profile = environment["RUNTIME_PROFILE"];
  if (!(
    profile === "development" ||
    profile === "test" ||
    profile === "ci" ||
    profile === "production"
  )) {
    invalid("RUNTIME_PROFILE");
  }
  const production = profile === "production";
  const connectionString = validatePostgresConnectionString(environment["DATABASE_URL"] ?? "");
  return Object.freeze({
    connectionString,
    poolMax: boundedInteger(environment, "WORKER_DB_POOL_MAX", production ? undefined : 3, 1, 32),
    connectionTimeoutMs: boundedInteger(
      environment,
      "WORKER_DB_CONNECTION_TIMEOUT_MS",
      production ? undefined : 2_000,
      100,
      30_000,
    ),
    probeTimeoutMs: boundedInteger(
      environment,
      "WORKER_DB_PROBE_TIMEOUT_MS",
      production ? undefined : 500,
      50,
      5_000,
    ),
  });
}

export function createWorkerPostgresBinding(
  input: string | WorkerPostgresConfig,
): WorkerPostgresBinding {
  const config =
    typeof input === "string"
      ? {
          connectionString: validatePostgresConnectionString(input),
          poolMax: 3,
          connectionTimeoutMs: 2_000,
          probeTimeoutMs: 500,
        }
      : input;
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
  });
  const persistence = createPostgresPersistence(pool, { probeTimeoutMs: config.probeTimeoutMs });
  return Object.freeze({
    ...persistence,
    close: async () => {
      await persistence.disconnect();
      await pool.end();
    },
  });
}
