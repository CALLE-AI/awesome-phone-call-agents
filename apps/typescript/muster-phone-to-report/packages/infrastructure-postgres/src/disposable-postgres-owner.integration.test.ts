import { randomBytes } from "node:crypto";

import { getPostgresTestConnectionUrls } from "@muster/testing";
import { escapeIdentifier, Pool } from "pg";
import { describe, expect, it } from "vitest";

interface ProvisioningAttestation {
  readonly version: 1;
  readonly databaseName: string;
  readonly databaseOid: string;
  readonly clusterSystemIdentifier: string;
  readonly ownershipToken: string;
  readonly exclusive: true;
}

interface DisposableOwnerApi {
  readonly provisionExclusiveDisposablePostgresDatabaseOwnership: (
    input: Readonly<{
      connectionString: string;
      ownershipToken: string;
    }>,
  ) => Promise<ProvisioningAttestation>;
  readonly createDisposablePostgresOwner: (
    connectionString: string,
    input: Readonly<{
      loadProvisioningAttestation: () => Promise<unknown>;
    }>,
  ) => {
    attestOwnership(): Promise<
      | Readonly<{
          outcome: "owned";
          exclusive: true;
          provisioningOwnershipDigest: string;
        }>
      | Readonly<{ outcome: "mismatch" | "missing" | "indeterminate" }>
    >;
    teardown(
      input: Readonly<{
        closeConnections: () => Promise<void>;
        expectedProvisioningOwnershipDigest: string;
      }>,
    ): Promise<Readonly<{ outcome: "deleted" }>>;
    verifyDeleted(
      input: Readonly<{
        expectedProvisioningOwnershipDigest: string;
      }>,
    ): Promise<boolean>;
  };
}

async function loadApi(): Promise<DisposableOwnerApi> {
  const loaded = (await import("./disposable-postgres-owner.js")) as Partial<DisposableOwnerApi>;
  if (
    loaded.provisionExclusiveDisposablePostgresDatabaseOwnership === undefined ||
    loaded.createDisposablePostgresOwner === undefined
  ) {
    throw new Error("Disposable PostgreSQL provisioning ownership is not implemented");
  }
  return loaded as DisposableOwnerApi;
}

function disposableConnection(databaseName: string): {
  readonly adminConnectionString: string;
  readonly targetConnectionString: string;
} {
  const target = new URL(getPostgresTestConnectionUrls().repository);
  target.pathname = `/${databaseName}`;
  const admin = new URL(target);
  admin.pathname = "/postgres";
  return Object.freeze({
    adminConnectionString: admin.toString(),
    targetConnectionString: target.toString(),
  });
}

async function createDatabase(admin: Pool, databaseName: string): Promise<void> {
  await admin.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
}

async function dropDatabaseIfPresent(admin: Pool, databaseName: string): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE)`);
}

async function databaseExists(admin: Pool, databaseName: string): Promise<boolean> {
  const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  return result.rowCount === 1;
}

describe("exclusive disposable PostgreSQL ownership", () => {
  it("establishes out-of-band provisioning identity and re-attests exact exclusivity immediately before DROP", async () => {
    const api = await loadApi();
    const databaseName = `review_disposable_${randomBytes(8).toString("hex")}`;
    const urls = disposableConnection(databaseName);
    const admin = new Pool({ connectionString: urls.adminConnectionString, max: 1 });
    let target: Pool | undefined;
    try {
      await createDatabase(admin, databaseName);
      const attestation = await api.provisionExclusiveDisposablePostgresDatabaseOwnership({
        connectionString: urls.targetConnectionString,
        ownershipToken: randomBytes(32).toString("base64url"),
      });
      const owner = api.createDisposablePostgresOwner(urls.targetConnectionString, {
        loadProvisioningAttestation: async () => attestation,
      });
      const established = await owner.attestOwnership();
      expect(established).toMatchObject({
        outcome: "owned",
        exclusive: true,
        provisioningOwnershipDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      if (established.outcome !== "owned") throw new Error("Expected exact ownership");

      target = new Pool({ connectionString: urls.targetConnectionString, max: 1 });
      await target.query("CREATE TABLE review_owned_state (id integer PRIMARY KEY)");
      await expect(
        owner.teardown({
          closeConnections: async () => {
            await target?.end();
            target = undefined;
          },
          expectedProvisioningOwnershipDigest: established.provisioningOwnershipDigest,
        }),
      ).resolves.toEqual({ outcome: "deleted" });
      await expect(
        owner.verifyDeleted({
          expectedProvisioningOwnershipDigest: established.provisioningOwnershipDigest,
        }),
      ).resolves.toBe(true);
      await expect(databaseExists(admin, databaseName)).resolves.toBe(false);
    } finally {
      await target?.end().catch(() => undefined);
      await dropDatabaseIfPresent(admin, databaseName);
      await admin.end();
    }
  });

  it("refuses to provision or drop an arbitrary database containing unrelated state", async () => {
    const api = await loadApi();
    const databaseName = `review_shared_${randomBytes(8).toString("hex")}`;
    const urls = disposableConnection(databaseName);
    const admin = new Pool({ connectionString: urls.adminConnectionString, max: 1 });
    const target = new Pool({ connectionString: urls.targetConnectionString, max: 1 });
    try {
      await createDatabase(admin, databaseName);
      await target.query("CREATE TABLE unrelated_business_state (id integer PRIMARY KEY)");
      await expect(
        api.provisionExclusiveDisposablePostgresDatabaseOwnership({
          connectionString: urls.targetConnectionString,
          ownershipToken: randomBytes(32).toString("base64url"),
        }),
      ).rejects.toThrow("Disposable PostgreSQL database is not empty");

      const owner = api.createDisposablePostgresOwner(urls.targetConnectionString, {
        loadProvisioningAttestation: async () => ({
          version: 1,
          databaseName,
          databaseOid: "1",
          clusterSystemIdentifier: "1",
          ownershipToken: randomBytes(32).toString("base64url"),
          exclusive: true,
        }),
      });
      await expect(owner.attestOwnership()).resolves.toMatchObject({ outcome: "mismatch" });
      await expect(
        owner.teardown({
          closeConnections: async () => undefined,
          expectedProvisioningOwnershipDigest: "a".repeat(64),
        }),
      ).rejects.toThrow("Disposable PostgreSQL ownership attestation failed");
      await expect(databaseExists(admin, databaseName)).resolves.toBe(true);
    } finally {
      await target.end();
      await dropDatabaseIfPresent(admin, databaseName);
      await admin.end();
    }
  });

  it("refuses a tampered out-of-band token for the exact provisioned database", async () => {
    const api = await loadApi();
    const databaseName = `review_tampered_${randomBytes(8).toString("hex")}`;
    const urls = disposableConnection(databaseName);
    const admin = new Pool({ connectionString: urls.adminConnectionString, max: 1 });
    try {
      await createDatabase(admin, databaseName);
      const attestation = await api.provisionExclusiveDisposablePostgresDatabaseOwnership({
        connectionString: urls.targetConnectionString,
        ownershipToken: randomBytes(32).toString("base64url"),
      });
      const owner = api.createDisposablePostgresOwner(urls.targetConnectionString, {
        loadProvisioningAttestation: async () => ({
          ...attestation,
          ownershipToken: randomBytes(32).toString("base64url"),
        }),
      });
      await expect(owner.attestOwnership()).resolves.toMatchObject({ outcome: "mismatch" });
      await expect(databaseExists(admin, databaseName)).resolves.toBe(true);
    } finally {
      await dropDatabaseIfPresent(admin, databaseName);
      await admin.end();
    }
  });
});
