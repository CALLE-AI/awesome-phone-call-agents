import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeBoss {
  start(): Promise<void>;
  createQueue(name: string, options: Record<string, unknown>): Promise<void>;
  getQueue(
    name: string,
  ): Promise<{ readonly readyCount: number; readonly activeCount: number } | null>;
  send(name: string, data: object, options: Record<string, unknown>): Promise<string | null>;
  work(name: string, options: Record<string, unknown>, handler: unknown): Promise<string>;
  stop(): Promise<void>;
}

describe("pg-boss operation boundaries", () => {
  afterEach(() => vi.useRealTimers());

  it("returns bounded rejected/degraded outcomes when pg-boss does not respond", async () => {
    vi.useFakeTimers();
    const moduleUrl = new URL("./pg-boss-job-scheduler.adapter.ts", import.meta.url).href;
    const jobs = (await import(/* @vite-ignore */ moduleUrl)) as {
      createPgBossJobInfrastructureForTest?: (
        options: Record<string, unknown>,
        boss: FakeBoss,
      ) => {
        scheduler: {
          scheduleFoundationHealthCheck(payload: Record<string, unknown>): Promise<unknown>;
        };
        health: { getReadiness(): Promise<unknown> };
        start(): Promise<void>;
      };
    };
    if (jobs.createPgBossJobInfrastructureForTest === undefined) {
      throw new Error("createPgBossJobInfrastructureForTest is not implemented");
    }
    const never = new Promise<never>(() => undefined);
    const boss: FakeBoss = {
      start: async () => undefined,
      createQueue: async () => undefined,
      getQueue: async () => await never,
      send: async () => await never,
      work: async () => "worker",
      stop: async () => undefined,
    };
    const infrastructure = jobs.createPgBossJobInfrastructureForTest(
      { connectionString: "postgres://unused", enqueueTimeoutMs: 2_000, readinessTimeoutMs: 500 },
      boss,
    );
    await infrastructure.start();

    const enqueue = infrastructure.scheduler.scheduleFoundationHealthCheck({
      version: "1",
      organizationId: "org_deadline_001",
      correlationId: "correlation_deadline_001",
      idempotencyKey: "idempotency_deadline_001",
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await expect(enqueue).resolves.toEqual({ outcome: "rejected" });

    const readiness = infrastructure.health.getReadiness();
    await vi.advanceTimersByTimeAsync(501);
    await expect(readiness).resolves.toBe("degraded");
  });

  it("rejects oversized opaque job identifiers before contacting pg-boss", async () => {
    const moduleUrl = new URL("./pg-boss-job-scheduler.adapter.ts", import.meta.url).href;
    const jobs = (await import(/* @vite-ignore */ moduleUrl)) as {
      createPgBossJobInfrastructureForTest?: (
        options: Record<string, unknown>,
        boss: FakeBoss,
      ) => {
        scheduler: {
          scheduleFoundationHealthCheck(payload: Record<string, unknown>): Promise<unknown>;
        };
        start(): Promise<void>;
      };
    };
    if (jobs.createPgBossJobInfrastructureForTest === undefined) {
      throw new Error("createPgBossJobInfrastructureForTest is not implemented");
    }
    const send = vi.fn(async () => "job");
    const boss: FakeBoss = {
      start: async () => undefined,
      createQueue: async () => undefined,
      getQueue: async () => ({ readyCount: 0, activeCount: 0 }),
      send,
      work: async () => "worker",
      stop: async () => undefined,
    };
    const infrastructure = jobs.createPgBossJobInfrastructureForTest(
      { connectionString: "postgres://unused" },
      boss,
    );
    await infrastructure.start();

    await expect(
      infrastructure.scheduler.scheduleFoundationHealthCheck({
        version: "1",
        organizationId: "org_deadline_001",
        correlationId: "x".repeat(257),
        idempotencyKey: "idempotency_deadline_001",
      }),
    ).rejects.toThrow("Invalid foundation health job payload");
    expect(send).not.toHaveBeenCalled();
  });

  it("closes a partially started pg-boss client when queue creation fails", async () => {
    const moduleUrl = new URL("./pg-boss-job-scheduler.adapter.ts", import.meta.url).href;
    const jobs = (await import(/* @vite-ignore */ moduleUrl)) as {
      createPgBossJobInfrastructureForTest?: (
        options: Record<string, unknown>,
        boss: FakeBoss,
      ) => { start(): Promise<void>; stop(): Promise<void> };
    };
    if (jobs.createPgBossJobInfrastructureForTest === undefined) {
      throw new Error("createPgBossJobInfrastructureForTest is not implemented");
    }
    const stop = vi.fn(async () => undefined);
    const boss: FakeBoss = {
      start: async () => undefined,
      createQueue: async () => {
        throw new Error("synthetic queue creation failure");
      },
      getQueue: async () => null,
      send: async () => null,
      work: async () => "worker",
      stop,
    };
    const infrastructure = jobs.createPgBossJobInfrastructureForTest(
      { connectionString: "postgres://unused" },
      boss,
    );

    await expect(infrastructure.start()).rejects.toThrow("synthetic queue creation failure");
    await infrastructure.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("encodes organization-scoped singleton keys without delimiter collisions", async () => {
    const moduleUrl = new URL("./pg-boss-job-scheduler.adapter.ts", import.meta.url).href;
    const jobs = (await import(/* @vite-ignore */ moduleUrl)) as {
      createPgBossJobInfrastructureForTest?: (
        options: Record<string, unknown>,
        boss: FakeBoss,
      ) => {
        scheduler: {
          scheduleFoundationHealthCheck(payload: Record<string, unknown>): Promise<unknown>;
        };
        start(): Promise<void>;
      };
    };
    if (jobs.createPgBossJobInfrastructureForTest === undefined) {
      throw new Error("createPgBossJobInfrastructureForTest is not implemented");
    }
    const singletonKeys: string[] = [];
    const boss: FakeBoss = {
      start: async () => undefined,
      createQueue: async () => undefined,
      getQueue: async () => ({ readyCount: 0, activeCount: 0 }),
      send: async (_name: string, _data: object, options: Record<string, unknown>) => {
        singletonKeys.push(String(options["singletonKey"]));
        return `job-${singletonKeys.length}`;
      },
      work: async () => "worker",
      stop: async () => undefined,
    };
    const infrastructure = jobs.createPgBossJobInfrastructureForTest(
      { connectionString: "postgres://unused" },
      boss,
    );
    await infrastructure.start();

    for (const [organizationId, idempotencyKey] of [
      ["org:a", "b"],
      ["org", "a:b"],
    ] as const) {
      await infrastructure.scheduler.scheduleFoundationHealthCheck({
        version: "1",
        organizationId,
        correlationId: `correlation-${organizationId}`,
        idempotencyKey,
      });
    }

    expect(singletonKeys).toHaveLength(2);
    expect(singletonKeys[0]).not.toBe(singletonKeys[1]);
  });

  it("hosts observation-request.v1 on the same owned client with bounded W3C payloads", async () => {
    const moduleUrl = new URL("./pg-boss-job-scheduler.adapter.ts", import.meta.url).href;
    const jobs = (await import(/* @vite-ignore */ moduleUrl)) as {
      createPgBossJobInfrastructureForTest?: (
        options: Record<string, unknown>,
        boss: FakeBoss,
      ) => {
        scheduler: {
          scheduleObservation?(payload: Record<string, unknown>): Promise<unknown>;
        };
        start(): Promise<void>;
      };
    };
    const createInfrastructure = jobs.createPgBossJobInfrastructureForTest;
    if (createInfrastructure === undefined) {
      throw new Error("createPgBossJobInfrastructureForTest is not implemented");
    }
    const queueNames: string[] = [];
    const sends: Array<{
      readonly name: string;
      readonly data: Record<string, unknown>;
      readonly options: Record<string, unknown>;
    }> = [];
    const boss: FakeBoss = {
      start: async () => undefined,
      createQueue: async (name: string) => {
        queueNames.push(name);
      },
      getQueue: async () => ({ readyCount: 0, activeCount: 0 }),
      send: async (
        name: string,
        data: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        sends.push({ name, data, options });
        return "observation-job";
      },
      work: async () => "worker",
      stop: async () => undefined,
    };
    const infrastructure = createInfrastructure(
      {
        connectionString: "postgres://unused",
        activeTraceContext: () => ({
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          tracestate: "vendor=opaque",
        }),
      },
      boss,
    );
    await infrastructure.start();
    if (infrastructure.scheduler.scheduleObservation === undefined) {
      throw new Error("observation-request.v1 scheduling is not implemented");
    }

    await infrastructure.scheduler.scheduleObservation({
      version: "1",
      organizationId: "org_observation_scheduler",
      operationId: "operation_observation_scheduler",
      correlationId: "correlation_observation_scheduler",
      traceContext: {
        traceparent: "invalid-protected-carrier",
        baggage: "not-allowed",
      },
    });

    expect(queueNames).toEqual([
      "foundation-health.v1",
      "observation-request.v1",
      "muster.simulator.live-observation.v1",
    ]);
    expect(sends).toEqual([
      {
        name: "observation-request.v1",
        data: {
          version: "1",
          organizationId: "org_observation_scheduler",
          operationId: "operation_observation_scheduler",
          correlationId: "correlation_observation_scheduler",
          traceContext: {
            traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            tracestate: "vendor=opaque",
          },
        },
        options: {
          singletonKey: '["org_observation_scheduler","operation_observation_scheduler"]',
        },
      },
    ]);
  });
});
