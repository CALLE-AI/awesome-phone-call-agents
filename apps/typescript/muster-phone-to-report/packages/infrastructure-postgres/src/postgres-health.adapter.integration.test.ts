import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";
import { describe, expect, it } from "vitest";

interface PostgresInfrastructureModule {
  readonly createPostgresPersistence: (
    pool: { readonly options: { readonly max: number } },
    options?: { readonly probeTimeoutMs?: number },
  ) => {
    readonly databaseHealth: { getReadiness(): Promise<"ready" | "degraded" | "unknown"> };
    readonly disconnect: () => Promise<void>;
  };
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

describe("PostgresHealthAdapter", () => {
  // Test strategy: use the modeled Prisma adapter against real PostgreSQL, then against an
  // unreachable local endpoint. HTTP mapping, job readiness, telemetry, and database internals
  // are deliberately deferred to their owning phases.
  it("reports ready and degrades safely within the bounded probe timeout when PostgreSQL is unavailable", async () => {
    const infrastructure = await loadPostgresInfrastructure();
    const pg = await import("pg");
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const readyPool = new pg.Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 1_000,
    });
    const unavailablePool = new pg.Pool({
      connectionString: "postgresql://synthetic:synthetic@127.0.0.1:1/muster_unavailable",
      max: 1,
      connectionTimeoutMillis: 100,
    });
    const ready = infrastructure.createPostgresPersistence(readyPool, { probeTimeoutMs: 1_000 });
    const unavailable = infrastructure.createPostgresPersistence(unavailablePool, {
      probeTimeoutMs: 1_000,
    });
    try {
      expect(await ready.databaseHealth.getReadiness()).toBe("ready");
      const startedAt = performance.now();
      const unavailableReadiness = await unavailable.databaseHealth.getReadiness();

      expect(["degraded", "unknown"]).toContain(unavailableReadiness);
      expect(performance.now() - startedAt).toBeLessThan(1_500);
    } finally {
      await ready.disconnect();
      await unavailable.disconnect();
      await readyPool.end();
      await unavailablePool.end();
    }
  });
});
