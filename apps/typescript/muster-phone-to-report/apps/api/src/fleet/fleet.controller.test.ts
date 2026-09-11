import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@muster/application";
import type { FleetHealthResponse } from "@muster/contracts";
import { getPostgresTestConnectionUrls } from "@muster/testing";

interface FleetHttpDependencies {
  readonly getFleetHealth: { execute(organizationId: unknown): Promise<FleetHealthResponse> };
  readonly requestAuthorizer: (input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly resource: Readonly<{ kind: "fleet" }>;
  }) => Promise<Readonly<{ organizationId: unknown }> | undefined>;
  readonly logger?: {
    debug(event: unknown): void;
    info(event: unknown): void;
    warn(event: unknown): void;
    error(event: unknown): void;
    child(): FleetHttpDependencies["logger"];
  };
  readonly telemetry?: {
    run<T>(input: { readonly operation: () => Promise<T> }): Promise<T>;
    recordRequest(input: unknown): void;
  };
}

interface FleetHttpRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

interface FleetHttpModule {
  readonly startSystemHealthHttpRuntime: (options: {
    readonly connectionString: string;
    readonly jobsSchema: string;
    readonly runtimeProfile: "test";
    readonly healthExposure: "disabled";
    readonly startJobs: false;
    readonly fleet?: FleetHttpDependencies;
    readonly fleetMaxEndpoints?: number;
    readonly fleetRetryAfterSeconds?: number;
  }) => Promise<FleetHttpRuntime>;
}

const organizationId = Object.freeze({
  value: "org_fleet_http",
  equals: (other: { readonly value: string }) => other.value === "org_fleet_http",
  toString: () => "org_fleet_http",
});

const response: FleetHealthResponse = {
  contractVersion: "1",
  generatedAt: "2026-08-08T16:00:00.000Z",
  schedulerHeartbeat: {
    status: "unavailable",
    observedAt: null,
    checkOutcome: null,
    evidenceKind: "foundation_health_job_completion",
  },
  endpoints: [
    {
      endpointId: "endpoint_fleet_http",
      siteDisplayName: "North campus",
      endpointDisplayName: "Boiler room monitor",
      provenance: "SIMULATED",
      operationalState: "not_observed",
      freshness: {
        status: "not_observed",
        observedAt: null,
        expiresAt: null,
        windowSeconds: 900,
      },
      lastAttempt: null,
      lastCompleteObservation: null,
      activeManualOperation: null,
      incident: { status: "unavailable" },
    },
  ],
};

const runtimes: FleetHttpRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => await runtime.close()));
});

async function start(
  fleet: FleetHttpDependencies,
  overrides: {
    readonly fleetMaxEndpoints?: number;
    readonly fleetRetryAfterSeconds?: number;
  } = {},
): Promise<FleetHttpRuntime> {
  const moduleUrl = new URL("../composition/start-system-health-http-runtime.ts", import.meta.url)
    .href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<FleetHttpModule>;
  if (loaded.startSystemHealthHttpRuntime === undefined) {
    throw new Error("startSystemHealthHttpRuntime is not implemented");
  }
  const runtime = await loaded.startSystemHealthHttpRuntime({
    connectionString: getPostgresTestConnectionUrls().repository,
    jobsSchema: "pgboss_fleet_http",
    runtimeProfile: "test",
    healthExposure: "disabled",
    startJobs: false,
    fleet,
    ...overrides,
  });
  runtimes.push(runtime);
  return runtime;
}

function dependencies(overrides: Partial<FleetHttpDependencies> = {}): FleetHttpDependencies {
  return {
    getFleetHealth: { execute: vi.fn().mockResolvedValue(response) },
    requestAuthorizer: vi.fn().mockResolvedValue({ organizationId }),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child() {
        return this;
      },
    },
    telemetry: {
      run: async ({ operation }) => await operation(),
      recordRequest: vi.fn(),
    },
    ...overrides,
  };
}

function expectSafeHeaders(headers: Headers): void {
  expect(headers.get("cache-control")).toBe("no-store, max-age=0");
  expect(headers.get("pragma")).toBe("no-cache");
  expect(headers.get("expires")).toBe("0");
  expect(headers.get("x-content-type-options")).toBe("nosniff");
}

describe("GET /api/v1/fleet", () => {
  it("returns the authorized canonical fleet projection with one bounded completion record", async () => {
    const getFleetHealth = { execute: vi.fn().mockResolvedValue(response) };
    const requestAuthorizer = vi.fn().mockResolvedValue({ organizationId });
    const logger = dependencies().logger!;
    const telemetry = dependencies().telemetry!;
    const runtime = await start(
      dependencies({ getFleetHealth, requestAuthorizer, logger, telemetry }),
    );

    const result = await fetch(`${runtime.baseUrl}/api/v1/fleet`, {
      headers: {
        authorization: "Bearer protected",
        "x-correlation-id": "00000000-0000-4000-8000-000000000001",
      },
    });

    expect(result.status).toBe(200);
    expectSafeHeaders(result.headers);
    await expect(result.json()).resolves.toEqual(response);
    expect(requestAuthorizer).toHaveBeenCalledWith(
      expect.objectContaining({ resource: { kind: "fleet" } }),
    );
    expect(getFleetHealth.execute).toHaveBeenCalledWith(organizationId);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(telemetry.recordRequest).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({
      event: "http.request.completed",
      correlationId: "00000000-0000-4000-8000-000000000001",
      method: "GET",
      route: "/api/v1/fleet",
      statusClass: "2xx",
      outcome: "found",
      duration: expect.any(Number),
    });
    const completionLog = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(completionLog).sort()).toEqual([
      "correlationId",
      "duration",
      "event",
      "method",
      "outcome",
      "route",
      "statusClass",
    ]);
    expect(completionLog).not.toHaveProperty("statusCode");
    const emitted = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (telemetry.recordRequest as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(emitted).toContain('"route":"/api/v1/fleet"');
    expect(emitted).not.toMatch(
      /org_fleet|endpoint_fleet|North campus|Boiler room|SIMULATED|not_observed|authorization/iu,
    );
  });

  it("conceals denied, thrown, and unknown authorization as the identical safe 404", async () => {
    const bodies: unknown[] = [];
    for (const requestAuthorizer of [
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(new Error("protected authorization detail")),
      vi.fn().mockResolvedValue({}),
    ]) {
      const runtime = await start(dependencies({ requestAuthorizer }));
      const result = await fetch(`${runtime.baseUrl}/api/v1/fleet`);
      expect(requestAuthorizer).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(404);
      expectSafeHeaders(result.headers);
      const body = await result.json();
      expect(body).toMatchObject({ error: { code: "not_found", message: "Resource not found" } });
      bodies.push({
        ...(body as Record<string, unknown>),
        error: { ...(body as { error: Record<string, unknown> }).error, correlationId: "bounded" },
      });
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it("maps dependency and fleet-bound failures to retryable safe 503 without truncating", async () => {
    for (const getFleetHealth of [
      {
        execute: vi
          .fn()
          .mockRejectedValue(
            ApplicationError.dependencyUnavailable("fleet_repository_unavailable" as never),
          ),
      },
      {
        execute: vi.fn().mockResolvedValue({
          ...response,
          endpoints: [response.endpoints[0]!, response.endpoints[0]!],
        }),
      },
    ]) {
      const runtime = await start(dependencies({ getFleetHealth }), {
        fleetMaxEndpoints: 1,
        fleetRetryAfterSeconds: 3,
      });
      const result = await fetch(`${runtime.baseUrl}/api/v1/fleet`);
      expect(result.status).toBe(503);
      expect(result.headers.get("retry-after")).toBe("3");
      expectSafeHeaders(result.headers);
      await expect(result.json()).resolves.toMatchObject({
        error: { code: "dependency_unavailable", message: "Service unavailable" },
      });
    }
  });

  it("maps an unknown application failure to the safe 500 contract and closed telemetry", async () => {
    const logger = dependencies().logger!;
    const telemetry = dependencies().telemetry!;
    const runtime = await start(
      dependencies({
        getFleetHealth: {
          execute: vi.fn().mockRejectedValue(new Error("protected repository failure")),
        },
        logger,
        telemetry,
      }),
    );

    const result = await fetch(`${runtime.baseUrl}/api/v1/fleet`);

    expect(result.status).toBe(500);
    expectSafeHeaders(result.headers);
    const body = await result.json();
    expect(body).toMatchObject({
      error: { code: "unexpected_error", message: "Unexpected error" },
    });
    expect(JSON.stringify(body)).not.toContain("protected repository failure");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/v1/fleet",
        statusClass: "5xx",
        outcome: "unexpected_error",
      }),
    );
    expect(telemetry.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/v1/fleet",
        statusCode: 500,
        outcome: "unexpected_error",
      }),
    );
  });

  it("isolates logger, metric, and span-wrapper failures without duplicating fleet work", async () => {
    const telemetryFailures: readonly NonNullable<FleetHttpDependencies["telemetry"]>[] = [
      {
        async run<T>(): Promise<T> {
          throw new Error("synthetic span startup failure");
        },
        recordRequest: vi.fn(),
      },
      {
        async run<T>(input: { readonly operation: () => Promise<T> }): Promise<T> {
          await input.operation();
          throw new Error("synthetic span completion failure");
        },
        recordRequest: vi.fn(),
      },
      {
        async run<T>(input: { readonly operation: () => Promise<T> }): Promise<T> {
          return await input.operation();
        },
        recordRequest: vi.fn(() => {
          throw new Error("synthetic metric failure");
        }),
      },
    ];
    for (const [index, telemetry] of telemetryFailures.entries()) {
      const getFleetHealth = { execute: vi.fn().mockResolvedValue(response) };
      const logger = dependencies().logger!;
      if (index === 2) {
        (logger.info as ReturnType<typeof vi.fn>).mockImplementation(() => {
          throw new Error("synthetic logger failure");
        });
      }
      const runtime = await start(dependencies({ getFleetHealth, logger, telemetry }));

      const result = await fetch(`${runtime.baseUrl}/api/v1/fleet`);

      expect(result.status).toBe(200);
      expectSafeHeaders(result.headers);
      await expect(result.json()).resolves.toEqual(response);
      expect(getFleetHealth.execute).toHaveBeenCalledTimes(1);
    }
  });
});
