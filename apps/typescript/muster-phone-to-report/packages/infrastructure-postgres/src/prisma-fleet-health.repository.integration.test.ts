import { OrganizationId } from "@muster/domain";
import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

interface FleetHealthPersistence {
  readonly fleetHealth?: {
    listFacts(organizationId: OrganizationId): Promise<readonly unknown[]>;
  };
  disconnect(): Promise<void>;
}

interface PostgresInfrastructureModule {
  readonly createPostgresPersistence: (pool: {
    readonly options: { readonly max: number };
  }) => FleetHealthPersistence;
}

async function loadPostgresInfrastructure(): Promise<PostgresInfrastructureModule> {
  const loaded = (await import("./index.js")) as Partial<PostgresInfrastructureModule>;
  if (loaded.createPostgresPersistence === undefined) {
    throw new Error("createPostgresPersistence is not implemented");
  }
  return { createPostgresPersistence: loaded.createPostgresPersistence };
}

describe.sequential("PrismaFleetHealthRepository", () => {
  // Test strategy: seed disposable synthetic PostgreSQL facts and verify the public query port's
  // organization scope plus independent latest-attempt/latest-complete selection. Prisma query
  // structure, raw ORM records, transport mapping, and browser rendering are deliberately omitted.
  it("returns only the organization-scoped latest attempt while retaining the independently latest complete observation", async () => {
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const pg = await import("pg");
    const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 1_000 });
    const infrastructure = await loadPostgresInfrastructure();
    const persistence = infrastructure.createPostgresPersistence(pool);
    const suffix = randomUUID().replaceAll("-", "");
    const organizationId = `org_fleet_${suffix}`;
    const otherOrganizationId = `org_fleet_other_${suffix}`;
    const endpointId = `endpoint_fleet_${suffix}`;
    const adapterVersionId = `adapter_fleet_${suffix}`;
    const completeOperationId = `operation_complete_${suffix}`;
    const failedOperationId = `operation_failed_${suffix}`;
    const tiedFailedOperationId = `operation_failed_z_${suffix}`;
    const evidenceId = `evidence_fleet_${suffix}`;
    const observationId = `observation_fleet_${suffix}`;
    const tiedCompleteA = `operation_complete_a_${suffix}`;
    const tiedCompleteZ = `operation_complete_z_${suffix}`;
    const tiedEvidenceA = `evidence_complete_a_${suffix}`;
    const tiedEvidenceZ = `evidence_complete_z_${suffix}`;
    const tiedObservationA = `observation_complete_a_${suffix}`;
    const tiedObservationZ1 = `observation_complete_z1_${suffix}`;
    const tiedObservationZ2 = `observation_complete_z2_${suffix}`;
    try {
      for (const scopedOrganizationId of [organizationId, otherOrganizationId]) {
        await pool.query(
          `INSERT INTO endpoints
             (organization_id, id, active_adapter_version_id, authorization_reference_id,
              site_display_name, endpoint_display_name, freshness_window_seconds)
           VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
          [
            scopedOrganizationId,
            endpointId,
            `authorization_${suffix}`,
            scopedOrganizationId === organizationId ? "North Campus" : "Other Campus",
            "Boiler monitor",
            900,
          ],
        );
        await pool.query(
          `INSERT INTO adapter_versions
             (organization_id, id, endpoint_id, dtmf_policy_kind, compatibility, provenance)
           VALUES ($1, $2, $3, 'forbidden', 'simulator-tested', 'SIMULATED')`,
          [scopedOrganizationId, adapterVersionId, endpointId],
        );
        await pool.query(
          `UPDATE endpoints SET active_adapter_version_id = $1
            WHERE organization_id = $2 AND id = $3`,
          [adapterVersionId, scopedOrganizationId, endpointId],
        );
      }

      await pool.query(
        `INSERT INTO call_attempts
           (organization_id, id, endpoint_id, adapter_version_id, idempotency_key, trigger,
            provenance, semantic_fingerprint, provider_dispatch_identity, accepted_at, stage,
            last_transition_at, terminal_outcome, retryable, resource_version)
         VALUES
           ($1, $2, $3, $4, $5, 'manual', 'SIMULATED', $6, $7, $8, 'terminal', $9,
            'observation_recorded', FALSE, 4),
           ($1, $10, $3, $4, $11, 'manual', 'SIMULATED', $12, $13, $14, 'terminal', $15,
            'provider_failed', TRUE, 2)`,
        [
          organizationId,
          completeOperationId,
          endpointId,
          adapterVersionId,
          `idempotency_complete_${suffix}`,
          `fingerprint_complete_${suffix}`,
          `dispatch_complete_${suffix}`,
          "2026-08-08T12:00:00.000Z",
          "2026-08-08T12:00:07.000Z",
          failedOperationId,
          `idempotency_failed_${suffix}`,
          `fingerprint_failed_${suffix}`,
          `dispatch_failed_${suffix}`,
          "2026-08-08T12:10:00.000Z",
          "2026-08-08T12:10:05.000Z",
        ],
      );
      await pool.query(
        `INSERT INTO call_attempts
           (organization_id,id,endpoint_id,adapter_version_id,idempotency_key,trigger,provenance,
            semantic_fingerprint,provider_dispatch_identity,accepted_at,stage,last_transition_at,
            terminal_outcome,retryable,resource_version)
         VALUES ($1,$2,$3,$4,$5,'manual','SIMULATED',$6,$7,$8,'terminal',$9,'provider_failed',TRUE,3)`,
        [
          organizationId,
          tiedFailedOperationId,
          endpointId,
          adapterVersionId,
          `idempotency_tie_${suffix}`,
          `fingerprint_tie_${suffix}`,
          `dispatch_tie_${suffix}`,
          "2026-08-08T12:10:00.000Z",
          "2026-08-08T12:10:06.000Z",
        ],
      );
      await pool.query(
        `INSERT INTO evidence_records
           (organization_id, id, call_attempt_id, endpoint_id, adapter_version_id, revision,
            provider_run_id, provider_revision_id, captured_at, retained_at, opaque_custody_ref,
            provenance, source_completeness)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, 'SIMULATED', 'complete')`,
        [
          organizationId,
          evidenceId,
          completeOperationId,
          endpointId,
          adapterVersionId,
          `provider_run_${suffix}`,
          `provider_revision_${suffix}`,
          "2026-08-08T12:00:05.000Z",
          "2026-08-08T12:00:06.000Z",
          `custody_${suffix}`,
        ],
      );
      await pool.query(
        `INSERT INTO observations
           (organization_id, id, operation_id, endpoint_id, version, created_at, evidence_id,
            evidence_revision_id, adapter_version_id, extractor_version_id,
            reconciliation_policy_version, provenance, quality, input_fingerprint)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, 'SIMULATED', 'complete', $11)`,
        [
          organizationId,
          observationId,
          completeOperationId,
          endpointId,
          "2026-08-08T12:00:06.000Z",
          evidenceId,
          `provider_revision_${suffix}`,
          adapterVersionId,
          "extractor_v1",
          "reconciliation_v1",
          `input_fingerprint_${suffix}`,
        ],
      );
      await pool.query(
        `UPDATE call_attempts SET latest_evidence_id = $1, latest_observation_id = $2
          WHERE organization_id = $3 AND id = $4`,
        [evidenceId, observationId, organizationId, completeOperationId],
      );
      for (const [operationId, acceptedAt] of [
        [tiedCompleteA, "2026-08-08T12:04:00.000Z"],
        [tiedCompleteZ, "2026-08-08T12:05:00.000Z"],
      ]) {
        await pool.query(
          `INSERT INTO call_attempts (organization_id,id,endpoint_id,adapter_version_id,idempotency_key,trigger,provenance,semantic_fingerprint,provider_dispatch_identity,accepted_at,stage,last_transition_at,terminal_outcome,retryable,resource_version) VALUES ($1,$2,$3,$4,$5,'scheduled','SIMULATED',$6,$7,$8,'terminal',$9,'observation_recorded',FALSE,1)`,
          [
            organizationId,
            operationId,
            endpointId,
            adapterVersionId,
            `idem_${operationId}`,
            `finger_${operationId}`,
            `dispatch_${operationId}`,
            acceptedAt,
            "2026-08-08T12:20:01.000Z",
          ],
        );
      }
      for (const [evidence, operationId, revision] of [
        [tiedEvidenceA, tiedCompleteA, "a"],
        [tiedEvidenceZ, tiedCompleteZ, "z"],
      ]) {
        await pool.query(
          `INSERT INTO evidence_records (organization_id,id,call_attempt_id,endpoint_id,adapter_version_id,revision,provider_run_id,provider_revision_id,captured_at,retained_at,opaque_custody_ref,provenance,source_completeness) VALUES ($1,$2,$3,$4,$5,1,$6,$7,'2026-08-08T12:20:00.000Z','2026-08-08T12:20:01.000Z',$8,'SIMULATED','complete')`,
          [
            organizationId,
            evidence,
            operationId,
            endpointId,
            adapterVersionId,
            `run_${revision}_${suffix}`,
            `revision_${revision}_${suffix}`,
            `custody_${revision}_${suffix}`,
          ],
        );
      }
      for (const row of [
        [
          tiedObservationA,
          tiedCompleteA,
          1,
          null,
          tiedEvidenceA,
          `revision_a_${suffix}`,
          "policy_a",
        ],
        [
          tiedObservationZ1,
          tiedCompleteZ,
          1,
          null,
          tiedEvidenceZ,
          `revision_z_${suffix}`,
          "policy_z1",
        ],
        [
          tiedObservationZ2,
          tiedCompleteZ,
          2,
          tiedObservationZ1,
          tiedEvidenceZ,
          `revision_z_${suffix}`,
          "policy_z2",
        ],
      ])
        await pool.query(
          `INSERT INTO observations (organization_id,id,operation_id,endpoint_id,version,predecessor_observation_id,created_at,evidence_id,evidence_revision_id,adapter_version_id,extractor_version_id,reconciliation_policy_version,provenance,quality,input_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,'2026-08-08T12:20:02.000Z',$7,$8,$9,'extractor_v1',$10,'SIMULATED','complete',$11)`,
          [
            organizationId,
            row[0],
            row[1],
            endpointId,
            row[2],
            row[3],
            row[4],
            row[5],
            adapterVersionId,
            row[6],
            `fingerprint_${row[0]}`,
          ],
        );

      if (persistence.fleetHealth === undefined) {
        throw new Error("fleetHealth persistence is not implemented");
      }
      const facts = await persistence.fleetHealth.listFacts(OrganizationId.create(organizationId));

      expect(facts).toEqual([
        expect.objectContaining({
          endpointId,
          siteDisplayName: "North Campus",
          endpointDisplayName: "Boiler monitor",
          freshnessWindowSeconds: 900,
          lastAttempt: expect.objectContaining({
            operationId: tiedFailedOperationId,
            terminalOutcome: "provider_failed",
          }),
          lastCompleteObservation: expect.objectContaining({
            observationId: tiedObservationZ2,
            operationId: tiedCompleteZ,
            version: 2,
            observedAt: "2026-08-08T12:20:00.000Z",
            completedAt: "2026-08-08T12:20:02.000Z",
          }),
        }),
      ]);
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  }, 60_000);
});
