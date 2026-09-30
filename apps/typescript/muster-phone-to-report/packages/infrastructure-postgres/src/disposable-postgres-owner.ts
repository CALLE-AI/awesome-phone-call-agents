import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

import { escapeIdentifier, escapeLiteral, Pool } from "pg";

const dropDatabaseSql = readFileSync(
  new URL("../sql/drop-disposable-review-database.sql", import.meta.url),
  "utf8",
);
const inspectDatabaseSql = readFileSync(
  new URL("../sql/inspect-disposable-review-database.sql", import.meta.url),
  "utf8",
);
const sealDatabaseSql = readFileSync(
  new URL("../sql/seal-disposable-review-database.sql", import.meta.url),
  "utf8",
);
const verifyDatabaseEmptySql = readFileSync(
  new URL("../sql/verify-disposable-review-database-empty.sql", import.meta.url),
  "utf8",
);
const verifyDatabaseDeletedSql = readFileSync(
  new URL("../sql/verify-disposable-review-database-deleted.sql", import.meta.url),
  "utf8",
);

const databaseNamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/u;
const decimalIdentifierPattern = /^[1-9][0-9]{0,31}$/u;
const ownershipTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const ownershipCommentPrefix = "muster-live-demo-review-disposable-v1:";

export interface DisposablePostgresProvisioningAttestation {
  readonly version: 1;
  readonly databaseName: string;
  readonly databaseOid: string;
  readonly clusterSystemIdentifier: string;
  readonly ownershipToken: string;
  readonly exclusive: true;
}

export type DisposablePostgresOwnershipAttestation =
  | Readonly<{
      outcome: "owned";
      exclusive: true;
      provisioningOwnershipDigest: string;
    }>
  | Readonly<{ outcome: "mismatch" | "missing" | "indeterminate" }>;

export interface DisposablePostgresOwner {
  attestOwnership(): Promise<DisposablePostgresOwnershipAttestation>;
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
}

interface DatabaseInspection {
  readonly database_oid: string;
  readonly database_name: string;
  readonly ownership_comment: string | null;
  readonly cluster_system_identifier: string;
}

function parseTarget(connectionString: string): Readonly<{
  target: URL;
  admin: URL;
  databaseName: string;
}> {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (target.protocol !== "postgresql:" && target.protocol !== "postgres:") {
    throw new Error("Disposable PostgreSQL ownership configuration is invalid");
  }
  if (
    !databaseNamePattern.test(databaseName) ||
    ["postgres", "template0", "template1"].includes(databaseName)
  ) {
    throw new Error("Disposable PostgreSQL ownership configuration is invalid");
  }
  const admin = new URL(target);
  admin.pathname = "/postgres";
  return Object.freeze({ target, admin, databaseName });
}

function parseProvisioningAttestation(
  value: unknown,
): DisposablePostgresProvisioningAttestation | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<DisposablePostgresProvisioningAttestation>;
  if (
    candidate.version !== 1 ||
    candidate.exclusive !== true ||
    typeof candidate.databaseName !== "string" ||
    !databaseNamePattern.test(candidate.databaseName) ||
    typeof candidate.databaseOid !== "string" ||
    !decimalIdentifierPattern.test(candidate.databaseOid) ||
    typeof candidate.clusterSystemIdentifier !== "string" ||
    !decimalIdentifierPattern.test(candidate.clusterSystemIdentifier) ||
    typeof candidate.ownershipToken !== "string" ||
    !ownershipTokenPattern.test(candidate.ownershipToken)
  ) {
    return undefined;
  }
  return Object.freeze({
    version: 1 as const,
    databaseName: candidate.databaseName,
    databaseOid: candidate.databaseOid,
    clusterSystemIdentifier: candidate.clusterSystemIdentifier,
    ownershipToken: candidate.ownershipToken,
    exclusive: true as const,
  });
}

function provisioningOwnershipDigest(
  attestation: DisposablePostgresProvisioningAttestation,
): string {
  return createHash("sha256")
    .update("muster-live-demo-review-disposable-v1\0", "utf8")
    .update(attestation.clusterSystemIdentifier, "utf8")
    .update("\0", "utf8")
    .update(attestation.databaseOid, "utf8")
    .update("\0", "utf8")
    .update(attestation.databaseName, "utf8")
    .update("\0", "utf8")
    .update(attestation.ownershipToken, "utf8")
    .digest("hex");
}

function exactDigestMatches(actual: string, expected: string): boolean {
  if (!digestPattern.test(actual) || !digestPattern.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

async function inspectDatabase(
  pool: Pool,
  databaseName: string,
): Promise<DatabaseInspection | undefined> {
  const result = await pool.query<DatabaseInspection>(inspectDatabaseSql, [databaseName]);
  return result.rows.length === 1 ? result.rows[0] : undefined;
}

export async function provisionExclusiveDisposablePostgresDatabaseOwnership(
  input: Readonly<{
    connectionString: string;
    ownershipToken: string;
  }>,
): Promise<DisposablePostgresProvisioningAttestation> {
  if (!ownershipTokenPattern.test(input.ownershipToken)) {
    throw new Error("Disposable PostgreSQL provisioning ownership is invalid");
  }
  const configuration = parseTarget(input.connectionString);
  const targetPool = new Pool({
    connectionString: configuration.target.toString(),
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  const adminPool = new Pool({
    connectionString: configuration.admin.toString(),
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  try {
    const nonEmpty = await targetPool.query(verifyDatabaseEmptySql);
    if (nonEmpty.rowCount !== 0) {
      throw new Error("Disposable PostgreSQL database is not empty");
    }
    const inspection = await inspectDatabase(adminPool, configuration.databaseName);
    if (inspection === undefined || inspection.ownership_comment !== null) {
      throw new Error("Disposable PostgreSQL provisioning ownership is unavailable");
    }
    const attestation = Object.freeze({
      version: 1 as const,
      databaseName: configuration.databaseName,
      databaseOid: inspection.database_oid,
      clusterSystemIdentifier: inspection.cluster_system_identifier,
      ownershipToken: input.ownershipToken,
      exclusive: true as const,
    });
    const digest = provisioningOwnershipDigest(attestation);
    await adminPool.query(
      sealDatabaseSql
        .replace(":identifier", escapeIdentifier(configuration.databaseName))
        .replace(":ownership_comment", escapeLiteral(`${ownershipCommentPrefix}${digest}`)),
    );
    const readBack = await inspectDatabase(adminPool, configuration.databaseName);
    if (readBack?.ownership_comment !== `${ownershipCommentPrefix}${digest}`) {
      throw new Error("Disposable PostgreSQL provisioning ownership read-back failed");
    }
    return attestation;
  } finally {
    await targetPool.end();
    await adminPool.end();
  }
}

export function createDisposablePostgresOwner(
  connectionString: string,
  input: Readonly<{ loadProvisioningAttestation: () => Promise<unknown> }>,
): DisposablePostgresOwner {
  const configuration = parseTarget(connectionString);
  const connectAdmin = (): Pool =>
    new Pool({
      connectionString: configuration.admin.toString(),
      max: 1,
      connectionTimeoutMillis: 2_000,
    });
  const loadExactAttestation = async (): Promise<
    | Readonly<{
        attestation: DisposablePostgresProvisioningAttestation;
        digest: string;
      }>
    | undefined
  > => {
    const attestation = parseProvisioningAttestation(await input.loadProvisioningAttestation());
    if (attestation === undefined || attestation.databaseName !== configuration.databaseName) {
      return undefined;
    }
    return Object.freeze({ attestation, digest: provisioningOwnershipDigest(attestation) });
  };
  const attestOwnership = async (): Promise<DisposablePostgresOwnershipAttestation> => {
    let exact;
    try {
      exact = await loadExactAttestation();
    } catch {
      return Object.freeze({ outcome: "indeterminate" as const });
    }
    if (exact === undefined) return Object.freeze({ outcome: "mismatch" as const });
    const pool = connectAdmin();
    try {
      const inspection = await inspectDatabase(pool, configuration.databaseName);
      if (inspection === undefined) return Object.freeze({ outcome: "missing" as const });
      if (
        inspection.database_oid !== exact.attestation.databaseOid ||
        inspection.cluster_system_identifier !== exact.attestation.clusterSystemIdentifier ||
        inspection.ownership_comment !== `${ownershipCommentPrefix}${exact.digest}`
      ) {
        return Object.freeze({ outcome: "mismatch" as const });
      }
      return Object.freeze({
        outcome: "owned" as const,
        exclusive: true as const,
        provisioningOwnershipDigest: exact.digest,
      });
    } catch {
      return Object.freeze({ outcome: "indeterminate" as const });
    } finally {
      await pool.end();
    }
  };
  return Object.freeze({
    attestOwnership,
    async teardown(
      teardownInput: Readonly<{
        closeConnections: () => Promise<void>;
        expectedProvisioningOwnershipDigest: string;
      }>,
    ): Promise<Readonly<{ outcome: "deleted" }>> {
      await teardownInput.closeConnections();
      const ownership = await attestOwnership();
      if (
        ownership.outcome !== "owned" ||
        !exactDigestMatches(
          ownership.provisioningOwnershipDigest,
          teardownInput.expectedProvisioningOwnershipDigest,
        )
      ) {
        throw new Error("Disposable PostgreSQL ownership attestation failed");
      }
      const pool = connectAdmin();
      try {
        await pool.query(
          dropDatabaseSql.replace(":identifier", escapeIdentifier(configuration.databaseName)),
        );
        return Object.freeze({ outcome: "deleted" as const });
      } finally {
        await pool.end();
      }
    },
    async verifyDeleted(
      verifyInput: Readonly<{
        expectedProvisioningOwnershipDigest: string;
      }>,
    ): Promise<boolean> {
      let exact;
      try {
        exact = await loadExactAttestation();
      } catch {
        return false;
      }
      if (
        exact === undefined ||
        !exactDigestMatches(exact.digest, verifyInput.expectedProvisioningOwnershipDigest)
      ) {
        return false;
      }
      const pool = connectAdmin();
      try {
        const result = await pool.query(verifyDatabaseDeletedSql, [
          exact.attestation.databaseName,
          exact.attestation.databaseOid,
        ]);
        return result.rowCount === 0;
      } finally {
        await pool.end();
      }
    },
  });
}
