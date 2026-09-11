import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMusterApiClient } from "@muster/api-client";
import type { FoundationHealthJobPayload } from "@muster/contracts";
import {
  FoundationHealthJobHandler,
  createPgBossJobInfrastructure,
} from "@muster/infrastructure-jobs";
import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";

import { startSystemHealthHttpRuntime } from "../../apps/api/src/composition/start-system-health-http-runtime.js";
import { createWorker } from "../../apps/worker/src/composition/create-worker.js";
import { createWorkerPostgresBinding } from "../../apps/worker/src/composition/create-worker-postgres.js";

const traceContext = Object.freeze({
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  tracestate: "muster=phase6",
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for foundation evidence");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe.sequential("complete foundation path", () => {
  const closers: (() => Promise<void>)[] = [];
  let connectionString = "";

  beforeEach(async () => {
    connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
  });

  afterEach(async () => {
    const errors: unknown[] = [];
    for (const close of closers.splice(0).reverse()) {
      try {
        await close();
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Foundation E2E cleanup failed");
  });

  it("proves generated-client HTTP readiness and independent pg-boss-to-worker persistence", async () => {
    const schema = `pgboss_phase6_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const postgres = createWorkerPostgresBinding(connectionString);
    closers.push(async () => await postgres.close());
    const persistedCorrelations: string[] = [];
    const completedCorrelations: string[] = [];
    const observedTraceContexts: FoundationHealthJobPayload["traceContext"][] = [];
    const jobs = createPgBossJobInfrastructure({
      connectionString,
      schema,
      activeTraceContext: () => traceContext,
      retryDelaySeconds: 0,
    });
    closers.push(async () => await jobs.stop());
    const worker = createWorker({
      auditEvents: {
        append: async (event) => {
          const result = await postgres.auditEvents.append(event);
          persistedCorrelations.push(result.event.correlationId);
          return result;
        },
      },
      clock: { now: () => new Date().toISOString() },
      databaseHealth: postgres.databaseHealth,
      identifiers: { generate: randomUUID },
      jobBackendHealth: jobs.health,
      logger: { info: () => undefined, error: () => undefined },
    });
    const handler = new FoundationHealthJobHandler(worker.runFoundationHealthCheck, {
      run: async (payload, operation) => {
        observedTraceContexts.push(payload.traceContext);
        return await operation();
      },
    });
    await jobs.start();
    await jobs.work(async (payload) => {
      const result = await handler.handle(payload);
      completedCorrelations.push(result.correlationId);
    });

    const api = await startSystemHealthHttpRuntime({
      connectionString,
      jobsSchema: schema,
      runtimeProfile: "test",
      healthExposure: "test-harness",
      startJobs: true,
    });
    closers.push(async () => await api.close());
    await expect(
      createMusterApiClient({ baseUrl: api.baseUrl }).getSystemHealth(),
    ).resolves.toEqual({
      status: "ready",
    });

    const correlations = [`phase6-${randomUUID()}`, `phase6-${randomUUID()}`] as const;
    for (const [index, correlationId] of correlations.entries()) {
      const payload: FoundationHealthJobPayload = {
        version: "1",
        organizationId: `org_phase6_${index}`,
        correlationId,
        idempotencyKey: `phase6-${randomUUID()}`,
      };
      await expect(jobs.scheduler.scheduleFoundationHealthCheck(payload)).resolves.toMatchObject({
        outcome: "scheduled",
      });
    }

    await waitFor(async () => completedCorrelations.length === 2);
    expect(persistedCorrelations.sort()).toEqual([...correlations].sort());
    expect(completedCorrelations.sort()).toEqual([...correlations].sort());
    expect(observedTraceContexts).toEqual([traceContext, traceContext]);
    await expect(
      createMusterApiClient({ baseUrl: api.baseUrl }).getSystemHealth(),
    ).resolves.toEqual({
      status: "ready",
    });
  }, 15_000);

  it("returns the documented degraded result when the real job backend is unavailable", async () => {
    const api = await startSystemHealthHttpRuntime({
      connectionString,
      jobsSchema: `pgboss_phase6_degraded_${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      runtimeProfile: "test",
      healthExposure: "test-harness",
      startJobs: false,
    });
    closers.push(async () => await api.close());

    await expect(
      createMusterApiClient({ baseUrl: api.baseUrl }).getSystemHealth(),
    ).resolves.toEqual({
      status: "degraded",
    });
  });
});
