import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const POSTGRES_IMAGE =
  "postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const requireFromRoot = createRequire(new URL("../../../package.json", import.meta.url));
const prismaCli = requireFromRoot.resolve("prisma/build/index.js");

const environmentKeys = Object.freeze({
  migration: "MUSTER_TEST_MIGRATION_DATABASE_URL",
  nonce: "MUSTER_TEST_RUN_NONCE",
  repository: "MUSTER_TEST_REPOSITORY_DATABASE_URL",
});

export interface PostgresTestConnectionUrls {
  readonly migration: string;
  readonly repository: string;
}

interface PrismaCommandResult {
  readonly exitCode: number;
}

function requireTestRuntime(): void {
  if (process.env["NODE_ENV"] !== "test" || process.env["VITEST"] !== "true") {
    throw new Error("PostgreSQL test resources require the Vitest test runtime");
  }
}

function connectionUrl(container: StartedPostgreSqlContainer, database: string): string {
  const connection = new URL(container.getConnectionUri());
  connection.pathname = `/${database}`;
  return connection.toString();
}

function requireEnvironmentValue(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`Required PostgreSQL test configuration is missing: ${key}`);
  }
  return value;
}

function requireOwnedTestDatabaseUrl(databaseUrl: string): string {
  requireTestRuntime();
  const nonce = requireEnvironmentValue(environmentKeys.nonce);
  const migrationUrl = requireEnvironmentValue(environmentKeys.migration);
  const repositoryUrl = requireEnvironmentValue(environmentKeys.repository);

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("PostgreSQL test target is not owned by this test run");
  }

  const expectedDatabases = new Set([`muster_migration_${nonce}`, `muster_repository_${nonce}`]);
  const databaseName = parsed.pathname.slice(1);
  // A database-name prefix alone is not proof of ownership. Destructive Prisma commands
  // require the exact loopback URL, nonce-derived user, and database minted by this run.
  if (
    !/^[a-f0-9]{16}$/u.test(nonce) ||
    (databaseUrl !== migrationUrl && databaseUrl !== repositoryUrl) ||
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    parsed.port.length === 0 ||
    parsed.username !== `muster_admin_${nonce}` ||
    parsed.password.length === 0 ||
    !expectedDatabases.has(databaseName)
  ) {
    throw new Error("PostgreSQL test target is not owned by this test run");
  }

  return databaseUrl;
}

async function runPrismaCommand(
  args: readonly string[],
  databaseUrl: string,
): Promise<PrismaCommandResult> {
  const ownedDatabaseUrl = requireOwnedTestDatabaseUrl(databaseUrl);
  return await new Promise<PrismaCommandResult>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, MIGRATION_DATABASE_URL: ownedDatabaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.resume();
    child.stderr.resume();
    child.once("error", () => reject(new Error(`Prisma command could not start: ${args[0]}`)));
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1 }));
  });
}

async function requirePrismaSuccess(args: readonly string[], databaseUrl: string): Promise<void> {
  const result = await runPrismaCommand(args, databaseUrl);
  if (result.exitCode !== 0) {
    throw new Error(`Prisma command failed safely: ${args.join(" ")}`);
  }
}

export async function validatePrismaSchema(databaseUrl: string): Promise<void> {
  await requirePrismaSuccess(["validate"], databaseUrl);
}

export async function deployMigrations(databaseUrl: string): Promise<void> {
  await requirePrismaSuccess(["migrate", "deploy"], databaseUrl);
}

export async function hasMigrationDrift(
  databaseUrl: string,
  targetSchemaPath = "prisma/schema.prisma",
): Promise<boolean> {
  const result = await runPrismaCommand(
    ["migrate", "diff", "--from-config-datasource", "--to-schema", targetSchemaPath, "--exit-code"],
    databaseUrl,
  );
  if (result.exitCode === 0) {
    return false;
  }
  if (result.exitCode === 2) {
    return true;
  }
  throw new Error("Prisma migration drift check failed safely");
}

export function getPostgresTestConnectionUrls(): PostgresTestConnectionUrls {
  requireTestRuntime();
  requireEnvironmentValue(environmentKeys.nonce);
  const migration = requireEnvironmentValue(environmentKeys.migration);
  const repository = requireEnvironmentValue(environmentKeys.repository);
  return Object.freeze({
    migration: requireOwnedTestDatabaseUrl(migration),
    repository: requireOwnedTestDatabaseUrl(repository),
  });
}

export default async function setupPostgresTestContainer(): Promise<() => Promise<void>> {
  requireTestRuntime();
  const previousEnvironment = Object.fromEntries(
    Object.values(environmentKeys).map((key) => [key, process.env[key]]),
  );
  const restoreEnvironment = (): void => {
    for (const key of Object.values(environmentKeys)) {
      const previousValue = previousEnvironment[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  };
  const runId = randomUUID().replaceAll("-", "").slice(0, 16);
  const username = `muster_admin_${runId}`;
  const password = randomBytes(24).toString("base64url");
  const adminDatabase = `muster_admin_${runId}`;
  const migrationDatabase = `muster_migration_${runId}`;
  const repositoryDatabase = `muster_repository_${runId}`;
  let container: StartedPostgreSqlContainer | undefined;
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withUsername(username)
      .withPassword(password)
      .withDatabase(adminDatabase)
      .withLabels({
        "com.muster.test.run": runId,
        "com.muster.test.scope": "foundation-postgres",
      })
      .withStartupTimeout(60_000)
      .start();

    for (const database of [migrationDatabase, repositoryDatabase]) {
      const result = await container.exec([
        "createdb",
        "--username",
        username,
        "--owner",
        username,
        database,
      ]);
      if (result.exitCode !== 0) {
        throw new Error("Disposable PostgreSQL database creation failed");
      }
    }

    process.env[environmentKeys.nonce] = runId;
    process.env[environmentKeys.migration] = connectionUrl(container, migrationDatabase);
    process.env[environmentKeys.repository] = connectionUrl(container, repositoryDatabase);
  } catch {
    restoreEnvironment();
    if (container !== undefined) {
      try {
        await container.stop();
      } catch {
        throw new Error("Disposable PostgreSQL setup cleanup failed safely");
      }
    }
    throw new Error("Disposable PostgreSQL setup failed safely");
  }

  return async () => {
    try {
      await container.stop();
    } finally {
      restoreEnvironment();
    }
  };
}
