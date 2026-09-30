import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";

import { createMusterApiClient } from "./index.js";

const safeError = Object.freeze({
  error: {
    code: "unexpected_error",
    message: "Request failed safely",
    correlationId: "00000000-0000-4000-8000-000000000001",
  },
});

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function startObservationContractServer(): Promise<{
  readonly baseUrl: string;
  close(): Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.method === "POST") {
      const key = request.headers["idempotency-key"];
      const status = Number(typeof key === "string" ? key.replace("status_", "") : "400");
      if (status === 202) {
        sendJson(
          response,
          202,
          {
            contractVersion: "1",
            operationId: "operation_client_opaque",
            statusUrl: "/api/v1/observations/operation_client_opaque",
            stage: "calling",
            terminalOutcome: null,
            acceptedAt: "2026-08-06T16:00:00.000Z",
          },
          {
            Location: "/api/v1/observations/operation_client_opaque",
            "Retry-After": "2",
          },
        );
        return;
      }
      sendJson(
        response,
        status,
        status === 500
          ? {
              ...safeError,
              error: { ...safeError.error, stack: "protected vendor stack" },
              vendorPayload: "protected provider response",
            }
          : safeError,
        {
          ...(status === 400
            ? { Location: "https://vendor.invalid/protected", "Retry-After": "999" }
            : {}),
          ...(status === 409 ? { Location: "/api/v1/observations/operation_blocked_opaque" } : {}),
          ...(status === 503 ? { "Retry-After": "3" } : {}),
        },
      );
      return;
    }
    const matched = /^\/api\/v1\/observations\/operation_status_(?<status>\d+)$/u.exec(
      request.url ?? "",
    );
    const status = Number(matched?.groups?.["status"] ?? "404");
    if (status === 200) {
      sendJson(
        response,
        200,
        {
          contractVersion: "1",
          operationId: "operation_status_200",
          resourceVersion: 2,
          stage: "calling",
          terminal: false,
          lastTransitionAt: "2026-08-06T16:00:01.000Z",
          latestRevisionAt: null,
          attempt: {
            trigger: "manual",
            provenance: "SIMULATED",
            acceptedAt: "2026-08-06T16:00:00.000Z",
            retryable: null,
          },
          terminalOutcome: null,
          evidence: null,
          observation: null,
          recommendedAction: "poll",
        },
        { "Retry-After": "2" },
      );
      return;
    }
    sendJson(response, status, safeError, status === 503 ? { "Retry-After": "3" } : {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not bind");
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function startFleetContractServer(): Promise<{
  readonly baseUrl: string;
  close(): Promise<void>;
}> {
  const server = createServer((request, response) => {
    const authorization = request.headers.authorization;
    if (request.method !== "GET" || request.url !== "/api/v1/fleet") {
      sendJson(response, 404, safeError);
      return;
    }
    if (authorization === "Bearer found") {
      sendJson(response, 200, {
        contractVersion: "1",
        generatedAt: "2026-08-08T16:00:00.000Z",
        schedulerHeartbeat: {
          status: "missing",
          observedAt: null,
          checkOutcome: null,
          evidenceKind: "foundation_health_job_completion",
        },
        endpoints: [],
      });
      return;
    }
    const status =
      authorization === "Bearer unavailable"
        ? 503
        : authorization === "Bearer unexpected"
          ? 500
          : 404;
    sendJson(response, status, safeError, status === 503 ? { "Retry-After": "3" } : {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not bind");
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

interface HttpRuntimeModule {
  readonly startSystemHealthHttpRuntime: (options: {
    readonly connectionString: string;
    readonly jobsSchema: string;
    readonly runtimeProfile: "test";
    readonly healthExposure: "test-harness";
    readonly startJobs: true;
  }) => Promise<{ readonly baseUrl: string; close(): Promise<void> }>;
}

describe("generated system-health client", () => {
  it("calls the real Fastify endpoint through the generated Fetch operation", async () => {
    await deployMigrations(getPostgresTestConnectionUrls().repository);
    const runtimeUrl = new URL(
      "../../../apps/api/src/composition/start-system-health-http-runtime.ts",
      import.meta.url,
    ).href;
    const runtimeModule = (await import(
      /* @vite-ignore */ runtimeUrl
    )) as Partial<HttpRuntimeModule>;
    if (runtimeModule.startSystemHealthHttpRuntime === undefined) {
      throw new Error("startSystemHealthHttpRuntime is not implemented");
    }
    const runtime = await runtimeModule.startSystemHealthHttpRuntime({
      connectionString: getPostgresTestConnectionUrls().repository,
      jobsSchema: "pgboss_phase5_generated_client",
      runtimeProfile: "test",
      healthExposure: "test-harness",
      startJobs: true,
    });
    try {
      const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
      const script = `
        const { createMusterApiClient } = await import(${JSON.stringify(moduleUrl)});
        const result = await createMusterApiClient({ baseUrl: ${JSON.stringify(
          runtime.baseUrl,
        )} }).getSystemHealth();
        process.stdout.write(JSON.stringify(result));
      `;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--input-type=module", "--eval", script],
        { timeout: 10_000 },
      );
      expect(JSON.parse(stdout) as unknown).toEqual({ status: "ready" });
    } finally {
      await runtime.close();
    }
  }, 10_000);
});

describe("generated observation client wrapper", () => {
  it("returns typed POST status, safe failure, Location, and polling guidance", async () => {
    const server = await startObservationContractServer();
    try {
      const client = createMusterApiClient({ baseUrl: server.baseUrl });
      const accepted = await client.requestObservation({
        endpointId: "endpoint_client_opaque",
        idempotencyKey: "status_202",
        pollWindowId: "poll_window_client_opaque",
      });
      expect(accepted).toMatchObject({
        ok: true,
        status: 202,
        data: { stage: "calling", terminalOutcome: null },
        headers: {
          location: "/api/v1/observations/operation_client_opaque",
          retryAfterSeconds: 2,
        },
      });

      for (const status of [400, 404, 409, 500, 503] as const) {
        const failure = await client.requestObservation({
          endpointId: "endpoint_client_opaque",
          idempotencyKey: `status_${String(status)}`,
          pollWindowId: "poll_window_client_opaque",
        });
        expect(failure).toMatchObject({
          ok: false,
          status,
          error: safeError,
          headers: {
            location: status === 409 ? "/api/v1/observations/operation_blocked_opaque" : null,
            retryAfterSeconds: status === 503 ? 3 : null,
          },
        });
        expect(failure.error).toEqual(safeError);
        expect(JSON.stringify(failure.error)).not.toMatch(
          /vendor|payload|stack|provider response/iu,
        );
      }
    } finally {
      await server.close();
    }
  });

  it("returns typed GET status, safe failure, and bounded polling guidance", async () => {
    const server = await startObservationContractServer();
    try {
      const client = createMusterApiClient({ baseUrl: server.baseUrl });
      const found = await client.getObservationOperation("operation_status_200");
      expect(found).toMatchObject({
        ok: true,
        status: 200,
        data: { stage: "calling", terminalOutcome: null },
        headers: { location: null, retryAfterSeconds: 2 },
      });

      for (const status of [400, 404, 500, 503] as const) {
        const failure = await client.getObservationOperation(`operation_status_${String(status)}`);
        expect(failure).toMatchObject({
          ok: false,
          status,
          error: safeError,
          headers: {
            location: null,
            retryAfterSeconds: status === 503 ? 3 : null,
          },
        });
      }
    } finally {
      await server.close();
    }
  });
});

describe("generated fleet client wrapper", () => {
  it("returns the bounded Fleet result and closed error union", async () => {
    const server = await startFleetContractServer();
    try {
      const found = await createMusterApiClient({
        baseUrl: server.baseUrl,
        authorization: "Bearer found",
      }).getFleetHealth();
      expect(found).toMatchObject({
        ok: true,
        status: 200,
        data: { contractVersion: "1", endpoints: [] },
      });
      for (const [authorization, status] of [
        ["Bearer concealed", 404],
        ["Bearer unexpected", 500],
        ["Bearer unavailable", 503],
      ] as const) {
        const failure = await createMusterApiClient({
          baseUrl: server.baseUrl,
          authorization,
        }).getFleetHealth();
        expect(failure).toMatchObject({
          ok: false,
          status,
          error: safeError,
          headers: { retryAfterSeconds: status === 503 ? 3 : null },
        });
      }
    } finally {
      await server.close();
    }
  });
});
