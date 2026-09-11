import { describe, expect, it } from "vitest";

import type {
  FoundationHealthJobPayload,
  FoundationHealthSchedulingOutcome,
  ObservationJobPayload,
  ObservationSchedulingOutcome,
} from "@muster/contracts";

interface JobsInfrastructure {
  readonly scheduler: {
    scheduleFoundationHealthCheck(
      payload: FoundationHealthJobPayload,
    ): Promise<FoundationHealthSchedulingOutcome>;
    scheduleObservation?(payload: ObservationJobPayload): Promise<ObservationSchedulingOutcome>;
  };
  start(): Promise<void>;
  work(handler: (payload: FoundationHealthJobPayload) => Promise<void>): Promise<void>;
  workObservation?(handler: (payload: ObservationJobPayload) => Promise<void>): Promise<void>;
  stop(options?: { readonly graceful?: boolean }): Promise<void>;
}

interface JobsModule {
  readonly createPgBossJobInfrastructure: (options: {
    readonly connectionString: string;
    readonly schema: string;
    readonly retryDelaySeconds?: number;
    readonly retryLimit?: number;
    readonly workTimeoutSeconds?: number;
    readonly maintenanceIntervalSeconds?: number;
  }) => JobsInfrastructure;
}

async function loadJobsModule(): Promise<JobsModule> {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<JobsModule>;
  if (loaded.createPgBossJobInfrastructure === undefined) {
    throw new Error("createPgBossJobInfrastructure is not implemented");
  }
  return { createPgBossJobInfrastructure: loaded.createPgBossJobInfrastructure };
}

async function connectionString(): Promise<string> {
  const testing = await import("@muster/testing");
  return testing.getPostgresTestConnectionUrls().repository;
}

function payload(suffix: string): FoundationHealthJobPayload {
  return {
    version: "1",
    organizationId: `org_phase4_${suffix}`,
    correlationId: `correlation_phase4_${suffix}`,
    idempotencyKey: `idempotency_phase4_${suffix}`,
    traceContext: {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=opaque",
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for pg-boss job evidence");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe.sequential("pg-boss foundation-health execution", () => {
  it("enqueues, claims, and completes a real PostgreSQL-backed job", async () => {
    const jobs = await loadJobsModule();
    const infrastructure = jobs.createPgBossJobInfrastructure({
      connectionString: await connectionString(),
      schema: "pgboss_phase4_complete",
      retryLimit: 2,
      retryDelaySeconds: 0,
    });
    const completed: FoundationHealthJobPayload[] = [];
    try {
      await infrastructure.start();
      await infrastructure.work(async (job) => {
        completed.push(job);
      });
      const outcome = await infrastructure.scheduler.scheduleFoundationHealthCheck(
        payload("complete"),
      );
      await waitFor(() => completed.length === 1);

      expect(outcome).toMatchObject({ outcome: "scheduled" });
      expect(completed).toHaveLength(1);
    } finally {
      await infrastructure.stop();
    }
  });

  it("deduplicates concurrent idempotency keys into one logical completion", async () => {
    const jobs = await loadJobsModule();
    const infrastructure = jobs.createPgBossJobInfrastructure({
      connectionString: await connectionString(),
      schema: "pgboss_phase4_duplicate",
      retryLimit: 2,
      retryDelaySeconds: 0,
    });
    const completed: FoundationHealthJobPayload[] = [];
    const request = payload("duplicate");
    try {
      await infrastructure.start();
      const [first, second] = await Promise.all([
        infrastructure.scheduler.scheduleFoundationHealthCheck(request),
        infrastructure.scheduler.scheduleFoundationHealthCheck(request),
      ]);
      await infrastructure.work(async (job) => {
        completed.push(job);
      });
      await waitFor(() => completed.length === 1);

      expect([first.outcome, second.outcome].sort()).toEqual(["duplicate", "scheduled"]);
      expect(completed).toHaveLength(1);
    } finally {
      await infrastructure.stop();
    }
  });

  it("recovers persisted work through a fresh client after an interrupted attempt", async () => {
    const jobs = await loadJobsModule();
    const options = {
      connectionString: await connectionString(),
      schema: "pgboss_phase4_recovery",
      retryLimit: 2,
      retryDelaySeconds: 0,
      workTimeoutSeconds: 1,
      maintenanceIntervalSeconds: 1,
    } as const;
    const first = jobs.createPgBossJobInfrastructure(options);
    let reportClaim: (() => void) | undefined;
    const claimed = new Promise<void>((resolve) => {
      reportClaim = resolve;
    });
    try {
      await first.start();
      await first.work(async () => {
        reportClaim?.();
        await new Promise<never>(() => undefined);
      });
      await first.scheduler.scheduleFoundationHealthCheck(payload("recovery"));
      await claimed;
    } finally {
      await first.stop({ graceful: false });
    }

    const restarted = jobs.createPgBossJobInfrastructure(options);
    const completed: FoundationHealthJobPayload[] = [];
    try {
      await restarted.start();
      await restarted.work(async (job) => {
        completed.push(job);
      });
      await waitFor(() => completed.length === 1, 15_000);
      expect(completed[0]?.correlationId).toBe("correlation_phase4_recovery");
    } finally {
      await restarted.stop();
    }
  });

  it("preserves only W3C trace context across producer and consumer boundaries", async () => {
    const jobs = await loadJobsModule();
    const infrastructure = jobs.createPgBossJobInfrastructure({
      connectionString: await connectionString(),
      schema: "pgboss_phase4_trace",
      retryLimit: 2,
      retryDelaySeconds: 0,
    });
    const completed: FoundationHealthJobPayload[] = [];
    try {
      await infrastructure.start();
      await infrastructure.work(async (job) => {
        completed.push(job);
      });
      await infrastructure.scheduler.scheduleFoundationHealthCheck(payload("trace"));
      await waitFor(() => completed.length === 1);

      expect(completed[0]?.traceContext).toEqual({
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=opaque",
      });
      expect(completed[0]).not.toHaveProperty("baggage");
    } finally {
      await infrastructure.stop();
    }
  });

  it("delivers observation-request.v1 through the shared PostgreSQL-backed runtime", async () => {
    const jobs = await loadJobsModule();
    const infrastructure = jobs.createPgBossJobInfrastructure({
      connectionString: await connectionString(),
      schema: "pgboss_phase3_observation",
      retryLimit: 2,
      retryDelaySeconds: 0,
    });
    const completed: ObservationJobPayload[] = [];
    try {
      await infrastructure.start();
      if (
        infrastructure.workObservation === undefined ||
        infrastructure.scheduler.scheduleObservation === undefined
      ) {
        throw new Error("observation-request.v1 shared runtime is not implemented");
      }
      await infrastructure.workObservation(async (job) => {
        completed.push(job);
      });
      const outcome = await infrastructure.scheduler.scheduleObservation({
        version: "1",
        organizationId: "org_phase3_observation",
        operationId: "operation_phase3_observation",
        correlationId: "correlation_phase3_observation",
        traceContext: {
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          tracestate: "vendor=opaque",
        },
      });
      await waitFor(() => completed.length === 1);

      expect(outcome).toMatchObject({ outcome: "scheduled" });
      expect(completed).toEqual([
        {
          version: "1",
          organizationId: "org_phase3_observation",
          operationId: "operation_phase3_observation",
          correlationId: "correlation_phase3_observation",
          traceContext: {
            traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            tracestate: "vendor=opaque",
          },
        },
      ]);
    } finally {
      await infrastructure.stop();
    }
  });
});
