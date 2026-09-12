import { describe, expect, it } from "vitest";

import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";
import type { GetSystemHealth, HealthAccessPolicy, LoggerPort } from "@muster/application";

import {
  SystemHealthController,
  type SystemHealthHttpTelemetry,
} from "./system-health.controller.js";

interface SystemHealthHttpRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

interface SystemHealthHttpModule {
  readonly startSystemHealthHttpRuntime: (options: {
    readonly connectionString: string;
    readonly jobsSchema: string;
    readonly runtimeProfile: "test";
    readonly healthExposure: "test-harness";
    readonly startJobs: boolean;
    readonly requestAuthorizer?: (input: {
      readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
      readonly peerScope: "loopback" | "non-loopback";
    }) => Promise<boolean>;
  }) => Promise<SystemHealthHttpRuntime>;
}

async function loadHttpModule(): Promise<SystemHealthHttpModule> {
  const moduleUrl = new URL("../composition/start-system-health-http-runtime.ts", import.meta.url)
    .href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<SystemHealthHttpModule>;
  if (loaded.startSystemHealthHttpRuntime === undefined) {
    throw new Error("startSystemHealthHttpRuntime is not implemented");
  }
  return { startSystemHealthHttpRuntime: loaded.startSystemHealthHttpRuntime };
}

async function startRuntime(
  jobsSchema: string,
  startJobs: boolean,
): Promise<SystemHealthHttpRuntime> {
  const http = await loadHttpModule();
  await deployMigrations(getPostgresTestConnectionUrls().repository);
  return await http.startSystemHealthHttpRuntime({
    connectionString: getPostgresTestConnectionUrls().repository,
    jobsSchema,
    runtimeProfile: "test",
    healthExposure: "test-harness",
    startJobs,
  });
}

function expectSafeHealthHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

describe.sequential("GET /api/v1/system/health", () => {
  it("returns the exact ready contract through NestJS/Fastify and real dependencies", async () => {
    const runtime = await startRuntime("pgboss_phase5_http_ready", true);
    try {
      const response = await fetch(`${runtime.baseUrl}/api/v1/system/health`, {
        headers: {
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ready" });
      expectSafeHealthHeaders(response);
    } finally {
      await runtime.close();
    }
  }, 15_000);

  it("returns the exact degraded contract with 503 when a real required adapter is unready", async () => {
    const runtime = await startRuntime("pgboss_phase5_http_degraded", false);
    try {
      const response = await fetch(`${runtime.baseUrl}/api/v1/system/health`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "degraded" });
      expectSafeHealthHeaders(response);
    } finally {
      await runtime.close();
    }
  });

  it("uses the standardized low-detail error schema for an ordinary concealed 404", async () => {
    const runtime = await startRuntime("pgboss_phase5_http_not_found", true);
    try {
      const response = await fetch(`${runtime.baseUrl}/api/v1/system/not-present`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(404);
      expectSafeHealthHeaders(response);
      expect(body).toEqual({
        error: {
          code: "not_found",
          message: "Resource not found",
          correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        },
      });
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(JSON.stringify(body)).not.toMatch(
        /postgres|pgboss|schema|localhost|exception|stack/iu,
      );
    } finally {
      await runtime.close();
    }
  });

  it("conceals denied and failed request authorization without probing dependencies", async () => {
    const http = await loadHttpModule();
    await deployMigrations(getPostgresTestConnectionUrls().repository);
    for (const requestAuthorizer of [
      async () => false,
      async () => {
        throw new Error("synthetic protected policy detail");
      },
    ]) {
      const runtime = await http.startSystemHealthHttpRuntime({
        connectionString: getPostgresTestConnectionUrls().repository,
        jobsSchema: `p5_policy_${Math.random().toString(36).slice(2, 10)}`,
        runtimeProfile: "test",
        healthExposure: "test-harness",
        startJobs: false,
        requestAuthorizer,
      });
      try {
        const response = await fetch(`${runtime.baseUrl}/api/v1/system/health`);
        expect(response.status).toBe(404);
        expectSafeHealthHeaders(response);
        expect(JSON.stringify(await response.json())).not.toMatch(/protected|policy|postgres/iu);
      } finally {
        await runtime.close();
      }
    }
  });

  it("logs and records the completed request while the inbound trace span is active", async () => {
    let active = false;
    let loggedWhileActive = false;
    let measuredWhileActive = false;
    const telemetry: SystemHealthHttpTelemetry = {
      run: async (_headers, operation) => {
        active = true;
        try {
          return await operation();
        } finally {
          active = false;
        }
      },
      recordRequest: () => {
        measuredWhileActive = active;
      },
    };
    const logger = {
      info: () => {
        loggedWhileActive = active;
      },
      debug: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child() {
        return this;
      },
    } satisfies LoggerPort;
    const controller = new SystemHealthController(
      { execute: async () => ({ status: "ready" as const }) } as unknown as GetSystemHealth,
      { evaluate: async () => "allowed" as const } satisfies HealthAccessPolicy,
      async () => true,
      "loopback",
      logger,
      telemetry,
      750,
    );
    const reply = {
      code: () => reply,
      header: () => reply,
    };
    await controller.readSystemHealth({ headers: {}, ip: "127.0.0.1" }, reply);
    expect({ loggedWhileActive, measuredWhileActive }).toEqual({
      loggedWhileActive: true,
      measuredWhileActive: true,
    });
  });
});
