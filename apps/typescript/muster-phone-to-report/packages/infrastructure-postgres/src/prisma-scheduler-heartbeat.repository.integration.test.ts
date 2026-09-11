import { OrganizationId } from "@muster/domain";
import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresPersistence } from "./index.js";

describe.sequential("PrismaSchedulerHeartbeatRepository", () => {
  it("selects the latest organization-scoped heartbeat and returns missing evidence", async () => {
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const pg = await import("pg");
    const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 1_000 });
    const persistence = createPostgresPersistence(pool);
    const suffix = randomUUID().replaceAll("-", "");
    const org = `org_heartbeat_${suffix}`;
    try {
      for (const row of [
        [org, `event_a_${suffix}`, "2026-08-08T12:00:00.000Z", "ready"],
        [org, `event_z_${suffix}`, "2026-08-08T12:05:00.000Z", "degraded"],
        [`org_other_${suffix}`, `event_other_${suffix}`, "2026-08-08T12:10:00.000Z", "ready"],
      ])
        await pool.query(
          `INSERT INTO audit_events (organization_id,id,kind,occurred_at,correlation_id,idempotency_key,outcome) VALUES ($1,$2,'foundation.health.checked',$3,$2,$2,$4) ON CONFLICT (id) DO UPDATE SET occurred_at = EXCLUDED.occurred_at, outcome = EXCLUDED.outcome`,
          row,
        );
      expect(await persistence.schedulerHeartbeat.readLatest(OrganizationId.create(org))).toEqual({
        observedAt: "2026-08-08T12:05:00.000Z",
        checkOutcome: "degraded",
      });
      expect(
        await persistence.schedulerHeartbeat.readLatest(
          OrganizationId.create(`org_missing_${suffix}`),
        ),
      ).toBeNull();
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  }, 60_000);
});
