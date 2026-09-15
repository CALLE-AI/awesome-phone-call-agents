import { ApplicationError, type AuditEventRepository } from "@muster/application";
import { AuditEvent, OrganizationId } from "@muster/domain";
import {
  deployMigrations,
  FakeAuditEventRepository,
  getPostgresTestConnectionUrls,
} from "@muster/testing";
import { describe, expect, it } from "vitest";

interface PostgresPersistence {
  readonly auditEvents: AuditEventRepository;
  readonly disconnect: () => Promise<void>;
}

interface PostgresInfrastructureModule {
  readonly createPostgresPersistence: (
    pool: { readonly options: { readonly max: number } },
    options?: { readonly probeTimeoutMs?: number },
  ) => PostgresPersistence;
}

interface TestPool {
  readonly options: { readonly max: number };
  end(): Promise<void>;
}

async function loadPostgresInfrastructure(): Promise<PostgresInfrastructureModule> {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  const loaded = (await import(
    /* @vite-ignore */ moduleUrl
  )) as Partial<PostgresInfrastructureModule>;
  if (loaded.createPostgresPersistence === undefined) {
    throw new Error("createPostgresPersistence is not implemented");
  }
  return { createPostgresPersistence: loaded.createPostgresPersistence };
}

async function createPostgresRepository(): Promise<{
  readonly persistence: PostgresPersistence;
  readonly pool: TestPool;
}> {
  const infrastructure = await loadPostgresInfrastructure();
  const pg = await import("pg");
  const connectionString = getPostgresTestConnectionUrls().repository;
  await deployMigrations(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1_000,
  });
  return {
    persistence: infrastructure.createPostgresPersistence(pool),
    pool,
  };
}

function auditEvent(input: {
  readonly id: string;
  readonly organizationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly outcome?: "ready" | "degraded";
  readonly occurredAt?: string;
}): AuditEvent {
  return AuditEvent.create({
    id: input.id,
    organizationId: OrganizationId.create(input.organizationId),
    kind: "foundation.health.checked",
    occurredAt: input.occurredAt ?? "2026-08-04T20:00:00.000Z",
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    outcome: input.outcome ?? "ready",
  });
}

async function expectAppendReplayContract(repository: AuditEventRepository, suffix: string) {
  const original = auditEvent({
    id: `audit_contract_original_${suffix}`,
    organizationId: `org_contract_${suffix}`,
    idempotencyKey: `idempotency_contract_${suffix}`,
    correlationId: `correlation_contract_${suffix}`,
  });
  const replayCandidate = auditEvent({
    id: `audit_contract_candidate_${suffix}`,
    organizationId: `org_contract_${suffix}`,
    idempotencyKey: `idempotency_contract_${suffix}`,
    correlationId: `correlation_contract_${suffix}`,
    outcome: "degraded",
    occurredAt: "2026-08-04T20:01:00.000Z",
  });

  const appended = await repository.append(original);
  const replayed = await repository.append(replayCandidate);

  expect(appended).toMatchObject({ outcome: "appended", event: original });
  expect(replayed).toMatchObject({
    outcome: "replayed",
    event: {
      id: original.id,
      occurredAt: original.occurredAt,
      correlationId: original.correlationId,
      outcome: original.outcome,
    },
  });
}

describe.sequential("AuditEventRepository PostgreSQL contract", () => {
  // Test strategy: the production adapter and fake share the same append/replay contract, while
  // PostgreSQL-only cases prove durable append-only evidence, organization scope, and database-
  // enforced concurrency. Generic CRUD, product aggregates, raw SQL, and vendor internals are not tested.
  it("satisfies the same append and replay contract as the fake adapter", async () => {
    const { persistence, pool } = await createPostgresRepository();
    try {
      await expectAppendReplayContract(new FakeAuditEventRepository(), "fake");
      await expectAppendReplayContract(persistence.auditEvents, "postgres");
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("preserves append-only established evidence across repository instances", async () => {
    const infrastructure = await loadPostgresInfrastructure();
    const pg = await import("pg");
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const pool = new pg.Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 1_000,
    });
    const first = infrastructure.createPostgresPersistence(pool);
    const second = infrastructure.createPostgresPersistence(pool);
    const original = auditEvent({
      id: "audit_durable_original",
      organizationId: "org_durable_001",
      idempotencyKey: "idempotency_durable_001",
      correlationId: "correlation_durable_001",
    });
    try {
      await first.auditEvents.append(original);
      const replay = await second.auditEvents.append(
        auditEvent({
          id: "audit_durable_candidate",
          organizationId: "org_durable_001",
          idempotencyKey: "idempotency_durable_001",
          correlationId: "correlation_durable_001",
          occurredAt: "2026-08-04T20:02:00.000Z",
        }),
      );

      expect(replay).toMatchObject({ outcome: "replayed", event: { id: original.id } });
    } finally {
      await first.disconnect();
      await second.disconnect();
      await pool.end();
    }
  });

  it("scopes idempotency uniqueness to organization ownership", async () => {
    const { persistence, pool } = await createPostgresRepository();
    try {
      const first = await persistence.auditEvents.append(
        auditEvent({
          id: "audit_ownership_001",
          organizationId: "org_ownership_001",
          idempotencyKey: "idempotency_shared_ownership",
          correlationId: "correlation_shared_ownership",
        }),
      );
      const second = await persistence.auditEvents.append(
        auditEvent({
          id: "audit_ownership_002",
          organizationId: "org_ownership_002",
          idempotencyKey: "idempotency_shared_ownership",
          correlationId: "correlation_shared_ownership",
        }),
      );

      expect([first.outcome, second.outcome]).toEqual(["appended", "appended"]);
      expect(first.event.organizationId.equals(second.event.organizationId)).toBe(false);
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("uses the database constraint to serialize concurrent scoped conflicts safely", async () => {
    const { persistence, pool } = await createPostgresRepository();
    try {
      const results = await Promise.allSettled([
        persistence.auditEvents.append(
          auditEvent({
            id: "audit_conflict_candidate_a",
            organizationId: "org_database_conflict_001",
            idempotencyKey: "idempotency_database_conflict_001",
            correlationId: "correlation_database_conflict_a",
          }),
        ),
        persistence.auditEvents.append(
          auditEvent({
            id: "audit_conflict_candidate_b",
            organizationId: "org_database_conflict_001",
            idempotencyKey: "idempotency_database_conflict_001",
            correlationId: "correlation_database_conflict_b",
          }),
        ),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(ApplicationError);
      expect(rejected[0]?.reason).toMatchObject({
        kind: "idempotency_conflict",
        code: "audit_event_idempotency_conflict",
        retryable: false,
      });
      expect(String(rejected[0]?.reason)).not.toContain("org_database_conflict_001");
      expect(String(rejected[0]?.reason)).not.toContain("idempotency_database_conflict_001");
      expect(String(rejected[0]?.reason)).not.toContain("correlation_database_conflict_b");
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });
});
