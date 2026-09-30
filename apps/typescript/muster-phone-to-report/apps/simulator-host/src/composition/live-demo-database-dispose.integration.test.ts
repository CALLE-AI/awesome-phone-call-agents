import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { escapeIdentifier, Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  LIVE_DEMO_DATABASE_PINNED_IMAGE,
  createInitialLiveDemoDatabaseLifecycleState,
  serializeLiveDemoDatabaseLifecycleState,
  transitionLiveDemoDatabaseLifecycleState,
  type LiveDemoDatabaseLifecycleState,
} from "../cli/live-demo-database-state.js";

const execFileAsync = promisify(execFile);
const enabled = process.env["MUSTER_RUN_LIVE_DEMO_DATABASE_INTEGRATION"] === "1";
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const tmpfsSpecification = "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=536870912";

interface DisposalApi {
  disposeLiveDemoDatabase(input: {
    repositoryRoot: string;
    capabilities: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

interface TestResource {
  readonly containerId: string;
  readonly databaseUrl: string;
  readonly attestation: unknown;
  readonly databaseName: string;
  readonly databaseOid: string;
  readonly digest: string;
  readonly state: LiveDemoDatabaseLifecycleState;
  readonly cleanup: () => Promise<void>;
}

async function inspectDatabaseIdentity(
  resource: TestResource,
): Promise<Readonly<{ databaseName: string; databaseOid: string }> | undefined> {
  const adminUrl = new URL(resource.databaseUrl);
  adminUrl.pathname = "/postgres";
  const pool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const result = await pool.query<{ database_name: string; database_oid: string }>(
      "SELECT datname AS database_name, oid::text AS database_oid FROM pg_database WHERE datname = $1",
      [resource.databaseName],
    );
    const row = result.rows.length === 1 ? result.rows[0] : undefined;
    return row === undefined
      ? undefined
      : Object.freeze({ databaseName: row.database_name, databaseOid: row.database_oid });
  } finally {
    await pool.end();
  }
}

async function loadApi(): Promise<DisposalApi> {
  return (await import("../cli/live-demo-database-dispose.js")) as unknown as DisposalApi;
}

async function runDocker(arguments_: readonly string[], environment: Record<string, string> = {}) {
  try {
    const result = await execFileAsync("docker", [...arguments_], {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout };
  } catch (error: unknown) {
    const failure = error as { code?: number; stdout?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
    };
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === "string") throw new Error("loopback port unavailable");
  return address.port;
}

async function waitHealthy(containerId: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const inspected = await runDocker([
      "inspect",
      "--type",
      "container",
      "--format",
      "{{.State.Health.Status}}",
      containerId,
    ]);
    if (inspected.exitCode === 0 && inspected.stdout.trim() === "healthy") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("test-owned PostgreSQL container did not become healthy");
}

async function waitDatabaseReady(databaseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 1_000,
    });
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
  throw new Error("test-owned PostgreSQL endpoint did not become ready");
}

async function createResource(): Promise<TestResource> {
  const infrastructure = await import("@muster/infrastructure-postgres");
  const work = await mkdtemp(path.join(tmpdir(), "muster-live-demo-dispose-"));
  const sessionId = randomUUID();
  const suffix = randomBytes(6).toString("hex");
  const databaseName = `muster_live_demo_${suffix}`;
  const databaseOwner = `muster_live_demo_owner_${suffix}`;
  const password = randomBytes(24).toString("base64url");
  const databaseToken = randomBytes(32).toString("base64url");
  const containerToken = randomBytes(32).toString("base64url");
  const hostPort = await availablePort();
  const containerName = `muster-live-demo-database-${sessionId}`;
  const cidFile = path.join(work, "container.cid");
  const labelFile = path.join(work, "container-labels.txt");
  await writeFile(
    labelFile,
    `com.muster.live-demo-database.session=${sessionId}\ncom.muster.live-demo-database.owner=${containerToken}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  let containerId = "";
  const cleanup = async (): Promise<void> => {
    if (/^[0-9a-f]{64}$/u.test(containerId)) {
      const inspected = await runDocker([
        "inspect",
        "--type",
        "container",
        "--format",
        '{{.Id}} {{index .Config.Labels "com.muster.live-demo-database.session"}} {{index .Config.Labels "com.muster.live-demo-database.owner"}}',
        containerId,
      ]);
      if (
        inspected.exitCode === 0 &&
        inspected.stdout.trim() === `${containerId} ${sessionId} ${containerToken}`
      ) {
        await runDocker(["rm", "--force", containerId]);
      }
    }
    await rm(work, { recursive: true, force: true });
  };
  try {
    const created = await runDocker(
      [
        "create",
        "--name",
        containerName,
        "--cidfile",
        cidFile,
        "--label-file",
        labelFile,
        "--publish",
        `127.0.0.1:${hostPort}:5432`,
        "--tmpfs",
        tmpfsSpecification,
        "--env",
        "POSTGRES_USER",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_DB",
        "--health-cmd",
        "pg_isready",
        "--health-interval",
        "500ms",
        "--health-timeout",
        "2s",
        "--health-retries",
        "60",
        LIVE_DEMO_DATABASE_PINNED_IMAGE,
      ],
      { POSTGRES_USER: databaseOwner, POSTGRES_PASSWORD: password, POSTGRES_DB: databaseName },
    );
    if (created.exitCode !== 0) throw new Error("test-owned container creation failed");
    containerId = created.stdout.trim();
    const cidFileId = (await readFile(cidFile, "utf8")).trim();
    if (!/^[0-9a-f]{64}$/u.test(containerId) || cidFileId !== containerId)
      throw new Error("test-owned container id unavailable");
    const started = await runDocker(["start", containerId]);
    if (started.exitCode !== 0) throw new Error("test-owned container start failed");
    await waitHealthy(containerId);
    const url = new URL(`postgresql://127.0.0.1:${hostPort}/${databaseName}`);
    url.username = databaseOwner;
    url.password = password;
    const databaseUrl = url.toString();
    await waitDatabaseReady(databaseUrl);
    const attestation = await infrastructure.provisionExclusiveDisposablePostgresDatabaseOwnership({
      connectionString: databaseUrl,
      ownershipToken: databaseToken,
    });
    const owner = infrastructure.createDisposablePostgresOwner(databaseUrl, {
      loadProvisioningAttestation: async () => attestation,
    });
    const ownership = await owner.attestOwnership();
    if (ownership.outcome !== "owned") throw new Error("test-owned database attestation failed");
    const initial = createInitialLiveDemoDatabaseLifecycleState({
      sessionId,
      createdAt: new Date().toISOString(),
      containerIntent: {
        name: containerName,
        image: LIVE_DEMO_DATABASE_PINNED_IMAGE,
        ownershipToken: containerToken,
        labels: {
          "com.muster.live-demo-database.session": sessionId,
          "com.muster.live-demo-database.owner": containerToken,
        },
        binding: { host: "127.0.0.1", hostPort, containerPort: 5432 },
        storage: "tmpfs",
      },
    });
    const withContainer = transitionLiveDemoDatabaseLifecycleState(initial, {
      status: "starting",
      checkpoint: "container_created",
      container: { id: containerId, ...initial.containerIntent },
    });
    const withDatabase = transitionLiveDemoDatabaseLifecycleState(withContainer, {
      status: "starting",
      checkpoint: "database_owned",
      database: {
        databaseName,
        databaseOwner,
        provisioningOwnershipDigest: ownership.provisioningOwnershipDigest,
        attestationVersion: 1,
      },
    });
    const state = transitionLiveDemoDatabaseLifecycleState(withDatabase, {
      status: "ready",
      checkpoint: "artifacts_published",
    });
    return Object.freeze({
      containerId,
      databaseUrl,
      attestation,
      databaseName,
      databaseOid: attestation.databaseOid,
      digest: ownership.provisioningOwnershipDigest,
      state,
      cleanup,
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function capabilities(resource: TestResource, options: { failInspect?: boolean } = {}) {
  const paths = {
    databaseUrl: path.join(
      repositoryRoot,
      ".generated-tmp",
      "live-demo-database",
      "database-url.txt",
    ),
    attestation: path.join(
      repositoryRoot,
      ".generated-tmp",
      "live-demo-database",
      "provisioning-attestation.json",
    ),
    activation: path.join(repositoryRoot, ".generated-tmp", "live-demo-database", "activate.ps1"),
  };
  let serializedState: string | undefined = serializeLiveDemoDatabaseLifecycleState(resource.state);
  const files = new Map<string, string>([
    [paths.databaseUrl, `${resource.databaseUrl}\n`],
    [paths.attestation, `${JSON.stringify(resource.attestation)}\n`],
    [paths.activation, "# protected\n"],
  ]);
  return {
    capability: {
      process: {
        run: async (request: {
          arguments: readonly string[];
          environment: Record<string, string>;
        }) => {
          if (options.failInspect === true && request.arguments[0] === "inspect") {
            return { exitCode: 1, stdout: "" };
          }
          return await runDocker(request.arguments, request.environment);
        },
      },
      state: {
        createExclusive: async () => false,
        loadOwnerOnly: async () => serializedState,
        replaceAtomically: async ({
          expectedSerializedState,
          nextSerializedState,
        }: {
          expectedSerializedState: string;
          nextSerializedState: string;
        }) => {
          if (serializedState !== expectedSerializedState) return false;
          serializedState = nextSerializedState;
          return true;
        },
        removeExact: async (expectedSerializedState: string) => {
          if (serializedState !== expectedSerializedState) return false;
          serializedState = undefined;
          return true;
        },
      },
      artifacts: {
        verifyOwnerOnly: async (filePath: string) => files.has(filePath),
        readOwnerOnly: async (filePath: string) => files.get(filePath),
        removeWithin: async (filePath: string) => {
          files.delete(filePath);
          return true;
        },
      },
      ownership: {} as { createDisposablePostgresOwner?: unknown },
      closeConnections: async () => undefined,
    },
    bindOwnership: async () => {
      const composition = await import("./live-demo-database-dispose-ownership.js");
      return composition.liveDemoDatabaseDisposeOwnershipCapabilities;
    },
    state: () => serializedState,
  };
}

describe.skipIf(!enabled)("live-demo database real Docker/PostgreSQL disposal", () => {
  it("disposes an intact exact test-owned database and container", async () => {
    const api = await loadApi();
    const resource = await createResource();
    try {
      const harness = capabilities(resource);
      harness.capability.ownership = await harness.bindOwnership();
      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capability }),
      ).resolves.toMatchObject({ outcome: "disposed" });
      expect((await runDocker(["inspect", resource.containerId])).exitCode).not.toBe(0);
      expect(harness.state()).toBeUndefined();
    } finally {
      await resource.cleanup();
    }
  }, 120_000);

  it("removes the exact container after independently verified prior database deletion", async () => {
    const api = await loadApi();
    const resource = await createResource();
    try {
      const ownership = await import("./live-demo-database-dispose-ownership.js");
      const owner =
        ownership.liveDemoDatabaseDisposeOwnershipCapabilities.createDisposablePostgresOwner(
          resource.databaseUrl,
          { loadProvisioningAttestation: async () => resource.attestation },
        );
      await owner.teardown({
        closeConnections: async () => undefined,
        expectedProvisioningOwnershipDigest: resource.digest,
      });
      const harness = capabilities(resource);
      harness.capability.ownership = await harness.bindOwnership();
      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capability }),
      ).resolves.toMatchObject({ outcome: "disposed" });
    } finally {
      await resource.cleanup();
    }
  }, 120_000);

  it("retains a real container and database after ownership-comment tampering", async () => {
    const api = await loadApi();
    const resource = await createResource();
    try {
      const identityBefore = await inspectDatabaseIdentity(resource);
      expect(identityBefore).toEqual({
        databaseName: resource.databaseName,
        databaseOid: resource.databaseOid,
      });
      const adminUrl = new URL(resource.databaseUrl);
      adminUrl.pathname = "/postgres";
      const pool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
      try {
        const databaseName = new URL(resource.databaseUrl).pathname.slice(1);
        await pool.query(`COMMENT ON DATABASE ${escapeIdentifier(databaseName)} IS 'tampered'`);
      } finally {
        await pool.end();
      }
      const harness = capabilities(resource);
      harness.capability.ownership = await harness.bindOwnership();
      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capability }),
      ).resolves.toMatchObject({ outcome: "blocked" });
      expect((await runDocker(["inspect", resource.containerId])).exitCode).toBe(0);
      expect(harness.state()).toBeDefined();
      await expect(inspectDatabaseIdentity(resource)).resolves.toEqual(identityBefore);
    } finally {
      await resource.cleanup();
    }
  }, 120_000);

  it("retains recovery state and a real owned container when Docker inspection is ambiguous", async () => {
    const api = await loadApi();
    const resource = await createResource();
    try {
      const identityBefore = await inspectDatabaseIdentity(resource);
      expect(identityBefore).toEqual({
        databaseName: resource.databaseName,
        databaseOid: resource.databaseOid,
      });
      const harness = capabilities(resource, { failInspect: true });
      harness.capability.ownership = await harness.bindOwnership();
      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capability }),
      ).resolves.toMatchObject({ outcome: "blocked" });
      expect((await runDocker(["inspect", resource.containerId])).exitCode).toBe(0);
      expect(harness.state()).toBeDefined();
      await expect(inspectDatabaseIdentity(resource)).resolves.toEqual(identityBefore);
    } finally {
      await resource.cleanup();
    }
  }, 120_000);
});
