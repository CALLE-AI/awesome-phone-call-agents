import {
  deployMigrations,
  getPostgresTestConnectionUrls,
  hasMigrationDrift,
  validatePrismaSchema,
} from "@muster/testing";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

interface TableNameRow {
  readonly table_name: string;
}

async function getMigrationDatabaseUrl(): Promise<string> {
  return getPostgresTestConnectionUrls().migration;
}

describe.sequential("Prisma migration integration", () => {
  it("enforces the review cleanup transition graph and non-regressing state timestamp in SQL", async () => {
    const reviewLifecycle = await readFile(
      new URL(
        "../../../prisma/migrations/0009_live_demo_review_lifecycle/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(reviewLifecycle).toContain("prevent_live_demo_review_cleanup_regression");
    expect(reviewLifecycle).toMatch(
      /OLD\."review_cleanup_state" = 'ready'[\s\S]*NEW\."review_cleanup_state" IN \('cleanup_pending'\)/u,
    );
    expect(reviewLifecycle).toMatch(
      /OLD\."review_cleanup_state" = 'cleanup_pending'[\s\S]*NEW\."review_cleanup_state" IN \('cleanup_blocked', 'deleted'\)/u,
    );
    expect(reviewLifecycle).toMatch(
      /OLD\."review_cleanup_state" = 'cleanup_blocked'[\s\S]*NEW\."review_cleanup_state" IN \('cleanup_pending'\)/u,
    );
    expect(reviewLifecycle).toMatch(
      /NEW\."review_cleanup_state_changed_at" < OLD\."review_cleanup_state_changed_at"/u,
    );
    expect(reviewLifecycle).toMatch(
      /OLD\."review_cleanup_state" = 'deleted'[\s\S]*RAISE EXCEPTION/u,
    );
  });

  it("stages Phase 6 columns so legacy authorizations are expired and never receive fabricated usable claims", async () => {
    const phase4 = await readFile(
      new URL(
        "../../../prisma/migrations/0004_live_simulator_authorization/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const phase5 = await readFile(
      new URL(
        "../../../prisma/migrations/0005_phase6_live_smoke_authorization/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const databaseUrl = await getMigrationDatabaseUrl();
    const pg = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    const schema = `phase6_legacy_${randomBytes(6).toString("hex")}`;
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await pool.query(`SET search_path TO "${schema}"`);
      await pool.query(phase4);
      await pool.query(
        `INSERT INTO live_simulator_authorizations
          (organization_id, operation_id, nonce_digest, semantic_digest, scenario_id,
           scenario_revision, audience, endpoint_alias, issued_at, expires_at)
         VALUES ('org-legacy', 'operation-legacy', $1, $2, 'synthetic-normal', 2,
                 'muster-live-simulator', 'greenhouse-synthetic', NOW() - INTERVAL '1 minute',
                 NOW() + INTERVAL '1 hour')`,
        ["a".repeat(64), "b".repeat(64)],
      );
      await pool.query(phase5);
      const result = await pool.query<{
        authorization_version: number;
        expected_caller_digest: string | null;
        authorized_target_digest: string | null;
        public_origin: string | null;
        expired: boolean;
      }>(
        `SELECT authorization_version, expected_caller_digest, authorized_target_digest,
                public_origin, expires_at <= CURRENT_TIMESTAMP AS expired
           FROM live_simulator_authorizations
          WHERE operation_id = 'operation-legacy'`,
      );
      expect(result.rows).toEqual([
        {
          authorization_version: 1,
          expected_caller_digest: null,
          authorized_target_digest: null,
          public_origin: null,
          expired: true,
        },
      ]);
      await expect(
        pool.query(
          `UPDATE live_simulator_authorizations SET authorization_version = 2
            WHERE operation_id = 'operation-legacy'`,
        ),
      ).rejects.toThrow();
      expect(phase5).not.toMatch(/DEFAULT '[0-9a-f]{64}'/u);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  // Test strategy: execute the committed Prisma workflow against a unique disposable database.
  // pg-boss internals, production credentials, and provider behavior are deliberately outside
  // this phase's migration proof.
  it("validates the canonical schema and applies the normalized observation migration to a clean database", async () => {
    const databaseUrl = await getMigrationDatabaseUrl();

    await validatePrismaSchema(databaseUrl);
    await expect(deployMigrations(databaseUrl)).resolves.toBeUndefined();

    const pg = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const expectedTables = [
        "adapter_expected_zones",
        "adapter_versions",
        "adapter_zone_unit_mappings",
        "call_attempts",
        "endpoints",
        "evidence_records",
        "observations",
        "readings",
      ];
      const result = await pool.query<TableNameRow>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
          ORDER BY table_name`,
        [expectedTables],
      );

      expect(result.rows.map(({ table_name }) => table_name)).toEqual(expectedTables);
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("replays committed migrations without changes and reports no schema drift", async () => {
    const databaseUrl = await getMigrationDatabaseUrl();

    await deployMigrations(databaseUrl);

    await expect(hasMigrationDrift(databaseUrl)).resolves.toBe(false);
  }, 60_000);
});
