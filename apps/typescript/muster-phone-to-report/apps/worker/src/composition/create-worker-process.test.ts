import { beforeEach, describe, expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({
  jobOptions: [] as Record<string, unknown>[],
}));

vi.mock("@muster/infrastructure-jobs", async () => {
  const actual = await vi.importActual<typeof import("@muster/infrastructure-jobs")>(
    "@muster/infrastructure-jobs",
  );
  return {
    ...actual,
    createPgBossJobInfrastructure: (options: Record<string, unknown>) => {
      observed.jobOptions.push(options);
      return {
        scheduler: {},
        health: { getReadiness: async () => "ready" as const },
        start: async () => undefined,
        work: async () => undefined,
        workObservation: async () => undefined,
        stop: async () => undefined,
      };
    },
  };
});

vi.mock("@muster/observability", () => ({
  createGlobalFoundationMetrics: () => ({
    recordReadiness: () => undefined,
    recordJobQueueDelay: () => undefined,
    recordJobExecution: () => undefined,
  }),
  createPinoLoggerRuntime: () => ({
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    close: async () => undefined,
  }),
  injectActiveW3CTraceContext: () => undefined,
  parseObservabilityConfig: () => ({
    serviceName: "muster-worker-test",
    serviceVersion: "test",
    deploymentEnvironment: "test",
    logging: { level: "info" as const },
  }),
  runWithConsumerSpan: async (input: { readonly operation: () => Promise<unknown> }) =>
    await input.operation(),
  runWithProducerSpan: async (input: { readonly operation: () => Promise<unknown> }) =>
    await input.operation(),
}));

vi.mock("./create-worker-postgres.js", () => ({
  parseWorkerPostgresConfig: () => "postgresql://worker.test/muster",
  createWorkerPostgresBinding: () => ({
    auditEvents: {},
    databaseHealth: { getReadiness: async () => "ready" as const },
    close: async () => undefined,
  }),
}));

describe("createWorkerProcess job composition", () => {
  beforeEach(() => {
    observed.jobOptions.length = 0;
  });

  it("binds explicit observation concurrency and otherwise inherits general concurrency", async () => {
    const { createWorkerProcess } = await import("./create-worker-process.js");
    const telemetry = { start: () => undefined, shutdown: async () => undefined };
    const environment = {
      RUNTIME_PROFILE: "test",
      DATABASE_URL: "postgresql://worker.test/muster",
      JOB_CONCURRENCY: "7",
    };

    createWorkerProcess({ ...environment, OBSERVATION_JOB_CONCURRENCY: "3" }, telemetry);
    createWorkerProcess(environment, telemetry);

    expect(observed.jobOptions).toHaveLength(2);
    expect(observed.jobOptions[0]).toMatchObject({
      concurrency: 7,
      observationConcurrency: 3,
    });
    expect(observed.jobOptions[1]).toMatchObject({
      concurrency: 7,
      observationConcurrency: 7,
    });
  });
});
