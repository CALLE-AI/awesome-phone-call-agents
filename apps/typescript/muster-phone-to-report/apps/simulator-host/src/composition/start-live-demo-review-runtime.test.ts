import { describe, expect, it, vi } from "vitest";

import { establishLiveDemoReviewLease } from "../live-runs/live-demo-review-session.js";
import {
  startLiveDemoReviewRuntime,
  type LiveDemoReviewProjection,
} from "./start-live-demo-review-runtime.js";

const identity = Object.freeze({
  operationId: "operation-review-001",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
});
const sessionId = "review-session-001";
const allowedBrowserOrigin = "http://127.0.0.1:4173";
const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const lease = establishLiveDemoReviewLease({
  identity,
  reviewReadyAt: "2026-09-01T16:00:00.000Z",
});

function completeProjection(
  overrides: Partial<LiveDemoReviewProjection> = {},
): LiveDemoReviewProjection {
  const readings = ["zone-1", "zone-2", "zone-3", "zone-4"].map((zoneId, index) => ({
    zoneId,
    label: `Synthetic zone ${String(index + 1)}`,
    value: String(70 + index),
    unit: "F",
    status: "OK" as const,
    disposition: "grounded" as const,
  }));
  return {
    ...identity,
    resourceVersion: 9,
    stage: "terminal",
    provenance: "SIMULATED",
    terminal: true,
    terminalOutcome: "observation_recorded",
    transcript: [{ speaker: "device", text: "Synthetic greenhouse report." }],
    evidence: { quality: "complete" },
    readings,
    reconciliation: readings.map(({ zoneId }) => ({ zoneId, disposition: "matched" as const })),
    auxiliaryStatus: {
      sound: "normal",
      power: "mains_available",
      battery: "normal",
      output: "off",
    },
    predecessorOperationId: null,
    ...overrides,
  };
}

async function start(overrides: Partial<Parameters<typeof startLiveDemoReviewRuntime>[0]> = {}) {
  return await startLiveDemoReviewRuntime({
    host: "127.0.0.1",
    port: 0,
    allowedBrowserOrigin,
    sessionId,
    lease,
    now: () => new Date("2026-09-01T16:01:00.000Z"),
    readExactProjection: vi.fn(async (): Promise<LiveDemoReviewProjection> => completeProjection()),
    cleanup: vi.fn(async () => ({
      outcome: "deleted" as const,
      message: "Protected demo result deleted" as const,
    })),
    ...overrides,
  });
}

describe("provider-incapable live demo review runtime", () => {
  it("marks absent provider callback routes as review-only without accepting them", async () => {
    const runtime = await start();
    try {
      const response = await fetch(`${runtime.baseUrl}/twilio/voice`, { method: "POST" });
      expect(response.status).toBe(404);
      expect(response.headers.get("x-muster-runtime-mode")).toBe("review-only");
      expect(await response.json()).toEqual({
        error: { code: "not_found", message: "Resource not found." },
      });
    } finally {
      await runtime.close();
    }
  });

  it("starts on loopback without acquiring poison provider, credential, tunnel, callback, or dispatch capabilities", async () => {
    const acquisitions: string[] = [];
    const forbiddenCapabilities = new Set([
      "createCalleClient",
      "createTwilioClient",
      "loadProviderCredentials",
      "openTunnel",
      "acceptProviderCallback",
      "dispatchCall",
      "mintAuthorization",
    ]);
    const input = new Proxy(
      {
        host: "127.0.0.1",
        port: 0,
        allowedBrowserOrigin,
        sessionId,
        lease,
        now: () => new Date("2026-09-01T16:01:00.000Z"),
        readExactProjection: vi.fn(async () => undefined),
        cleanup: vi.fn(async () => ({
          outcome: "deleted" as const,
          message: "Protected demo result deleted" as const,
        })),
      },
      {
        get(target, property, receiver) {
          if (typeof property === "string" && forbiddenCapabilities.has(property)) {
            acquisitions.push(property);
            throw new Error(`forbidden provider capability acquired: ${property}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const runtime = await startLiveDemoReviewRuntime(input);
    try {
      expect(runtime.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(runtime.routes).toEqual([
        "GET /api/v1/live-simulator/operations/{operationId}",
        "DELETE /api/v1/live-demo-review/sessions/{sessionId}",
      ]);
      expect(runtime.routes.some((route) => /^POST\s/u.test(route))).toBe(false);
      expect(acquisitions).toEqual([]);
    } finally {
      await runtime.close();
    }
    expect(acquisitions).toEqual([]);
  });

  it("accepts an exact bracketed IPv6 loopback browser origin", async () => {
    const ipv6BrowserOrigin = "http://[::1]:4173";
    const runtime = await start({ allowedBrowserOrigin: ipv6BrowserOrigin });
    try {
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`,
        { headers: { origin: ipv6BrowserOrigin } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(ipv6BrowserOrigin);
    } finally {
      await runtime.close();
    }
  });

  it("serves only the configured exact operation over loopback GET with no-store", async () => {
    const readExactProjection = vi.fn(async (): Promise<LiveDemoReviewProjection> =>
      completeProjection(),
    );
    const runtime = await start({ readExactProjection });
    try {
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`,
        { headers: { origin: allowedBrowserOrigin } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBe(allowedBrowserOrigin);
      expect(response.headers.get("x-muster-review-capability")).toBe("closed");
      expect(response.headers.get("x-muster-review-ready-at")).toBe(lease.reviewReadyAt);
      expect(response.headers.get("x-muster-review-expires-at")).toBe(lease.reviewExpiresAt);
      expect(response.headers.get("x-muster-review-cleanup-path")).toBe(
        `/api/v1/live-demo-review/sessions/${sessionId}`,
      );
      expect(response.headers.get("access-control-expose-headers")).toContain(
        "x-muster-review-expires-at",
      );
      await expect(response.json()).resolves.toMatchObject(identity);
      expect(readExactProjection).toHaveBeenCalledWith(identity);
    } finally {
      await runtime.close();
    }
  });

  it("conceals every other operation and rejects projection identity drift", async () => {
    const runtime = await start({
      readExactProjection: vi.fn(async (): Promise<LiveDemoReviewProjection> =>
        completeProjection({ scenarioRevision: 3 }),
      ),
    });
    try {
      expect(
        (
          await fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations/operation-other`, {
            headers: { origin: allowedBrowserOrigin },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await fetch(
            `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`,
            { headers: { origin: allowedBrowserOrigin } },
          )
        ).status,
      ).toBe(409);
    } finally {
      await runtime.close();
    }
  });

  it("exposes one exact-session teardown route and no dispatch or callback routes", async () => {
    const cleanup = vi.fn(async () => ({
      outcome: "deleted" as const,
      message: "Protected demo result deleted" as const,
    }));
    const runtime = await start({ cleanup });
    try {
      expect(runtime.routes).toEqual([
        "GET /api/v1/live-simulator/operations/{operationId}",
        "DELETE /api/v1/live-demo-review/sessions/{sessionId}",
      ]);
      expect(
        (
          await fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations`, {
            method: "POST",
            headers: { origin: allowedBrowserOrigin },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await fetch(`${runtime.baseUrl}/twilio/status`, {
            method: "POST",
            headers: { origin: allowedBrowserOrigin },
          })
        ).status,
      ).toBe(404);
      const deleted = await fetch(
        `${runtime.baseUrl}/api/v1/live-demo-review/sessions/${sessionId}`,
        { method: "DELETE", headers: { origin: allowedBrowserOrigin } },
      );
      expect(deleted.status).toBe(200);
      await expect(deleted.json()).resolves.toEqual({
        outcome: "deleted",
        message: "Protected demo result deleted",
      });
      expect(cleanup).toHaveBeenCalledWith("finish");
    } finally {
      await runtime.close();
    }
  });

  it("flushes a successful Finish response before revoking projection memory and closing the host", async () => {
    const revokeProjection = vi.fn();
    const closeObservability = vi.fn(async () => undefined);
    const runtime = await start({ revokeProjection, closeObservability });
    const operationUrl = `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`;
    try {
      const deleted = await fetch(
        `${runtime.baseUrl}/api/v1/live-demo-review/sessions/${sessionId}`,
        { method: "DELETE", headers: { origin: allowedBrowserOrigin } },
      );
      expect(deleted.status).toBe(200);
      await expect(deleted.json()).resolves.toEqual({
        outcome: "deleted",
        message: "Protected demo result deleted",
      });
      await vi.waitFor(() => {
        expect(revokeProjection).toHaveBeenCalledOnce();
        expect(closeObservability).toHaveBeenCalledOnce();
      });
      await vi.waitFor(async () => {
        await expect(
          fetch(operationUrl, { headers: { origin: allowedBrowserOrigin } }),
        ).rejects.toThrow();
      });
    } finally {
      await runtime.close();
    }
  });

  it("runs successful TTL cleanup in a root span and makes the protected projection unreachable", async () => {
    let now = new Date("2026-09-01T16:01:00.000Z");
    const cleanup = vi.fn(async () => ({
      outcome: "deleted" as const,
      message: "Protected demo result deleted" as const,
    }));
    const runCleanupSpanSpy = vi.fn();
    const runCleanupSpan = async <T>(
      span: Readonly<{ trigger: "ttl" | "finish" | "interrupt" | "restart" }>,
      operation: () => Promise<T>,
    ): Promise<T> => {
      runCleanupSpanSpy(span);
      return await operation();
    };
    const revokeProjection = vi.fn();
    const runtime = await start({
      now: () => now,
      cleanup,
      runCleanupSpan,
      revokeProjection,
      closeObservability: vi.fn(async () => undefined),
    });
    const operationUrl = `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`;
    try {
      now = new Date(lease.reviewExpiresAt);
      const expired = await fetch(operationUrl, { headers: { origin: allowedBrowserOrigin } });
      expect(expired.status).toBe(410);
      expect(JSON.stringify(await expired.json())).not.toContain("Synthetic greenhouse report");
      await vi.waitFor(() => expect(revokeProjection).toHaveBeenCalledOnce());
      expect(runCleanupSpanSpy).toHaveBeenCalledWith({ trigger: "ttl" });
      await vi.waitFor(async () => {
        await expect(
          fetch(operationUrl, { headers: { origin: allowedBrowserOrigin } }),
        ).rejects.toThrow();
      });
    } finally {
      await runtime.close();
    }
  });

  it("keeps expired projection data concealed and reports a truthful blocked TTL state", async () => {
    let now = new Date("2026-09-01T16:01:00.000Z");
    const cleanup = vi.fn(async () => ({
      outcome: "blocked" as const,
      message: "Cleanup requires attention" as const,
      recoveryIdentity: {
        sessionId,
        operationId: identity.operationId,
        scenarioId: identity.scenarioId,
        scenarioRevision: identity.scenarioRevision,
        reviewReadyAt: lease.reviewReadyAt,
        reviewExpiresAt: lease.reviewExpiresAt,
        custodyOwnershipDigest: "a".repeat(64),
        databaseOwnershipDigest: "b".repeat(64),
      },
    }));
    const runtime = await start({ now: () => now, cleanup });
    const operationUrl = `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`;
    try {
      now = new Date(lease.reviewExpiresAt);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(operationUrl, { headers: { origin: allowedBrowserOrigin } });
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          outcome: "blocked",
          message: "Cleanup requires attention",
        });
      }
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      await runtime.close();
    }
  });

  it("returns truthful cleanup attention without a false deletion claim", async () => {
    const runtime = await start({
      cleanup: vi.fn(async () => ({
        outcome: "blocked" as const,
        message: "Cleanup requires attention" as const,
        recoveryIdentity: {
          sessionId,
          operationId: identity.operationId,
          scenarioId: identity.scenarioId,
          scenarioRevision: identity.scenarioRevision,
          reviewReadyAt: lease.reviewReadyAt,
          reviewExpiresAt: lease.reviewExpiresAt,
          custodyOwnershipDigest: "a".repeat(64),
          databaseOwnershipDigest: "b".repeat(64),
        },
      })),
    });
    try {
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/live-demo-review/sessions/${sessionId}`,
        { method: "DELETE", headers: { origin: allowedBrowserOrigin } },
      );
      expect(response.status).toBe(503);
      const body = JSON.stringify(await response.json());
      expect(body).toContain("Cleanup requires attention");
      expect(body).not.toContain("Protected demo result deleted");
    } finally {
      await runtime.close();
    }
  });

  it("rejects non-loopback binding before acquiring projection or cleanup dependencies", async () => {
    const readExactProjection = vi.fn();
    const cleanup = vi.fn();
    await expect(start({ host: "0.0.0.0", readExactProjection, cleanup })).rejects.toThrow(
      "Live demo review runtime configuration is invalid",
    );
    expect(readExactProjection).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("reconstructs an explicit bounded allowlisted projection and drops protected extras", async () => {
    const runtime = await start({
      readExactProjection: vi.fn(
        async (): Promise<
          LiveDemoReviewProjection & {
            providerPayload: Readonly<{ forbidden: true }>;
            credential: string;
            custodyPath: string;
          }
        > => ({
          ...completeProjection(),
          providerPayload: { forbidden: true },
          credential: "forbidden-test-secret",
          custodyPath: "forbidden-test-path",
        }),
      ),
    });
    try {
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`,
        { headers: { origin: allowedBrowserOrigin } },
      );
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      expect(body).toContain("Synthetic greenhouse report.");
      expect(body).not.toMatch(/providerPayload|credential|custodyPath|forbidden-test/iu);
    } finally {
      await runtime.close();
    }
  });

  it("fails closed when an allowlisted projection collection or field exceeds its bound", async () => {
    const runtime = await start({
      readExactProjection: vi.fn(async (): Promise<LiveDemoReviewProjection> =>
        completeProjection({ transcript: [{ speaker: "device", text: "x".repeat(4_097) }] }),
      ),
    });
    try {
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`,
        { headers: { origin: allowedBrowserOrigin } },
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: { code: "review_unavailable", message: "Exact demo review is unavailable." },
      });
    } finally {
      await runtime.close();
    }
  });

  it("enforces one exact browser origin including preflight and rejects wrong or missing origin", async () => {
    const readExactProjection = vi.fn();
    const runtime = await start({ readExactProjection });
    const operationUrl = `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`;
    try {
      const preflight = await fetch(operationUrl, {
        method: "OPTIONS",
        headers: {
          origin: allowedBrowserOrigin,
          "access-control-request-method": "GET",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(allowedBrowserOrigin);
      expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, DELETE, OPTIONS");
      expect((await fetch(operationUrl)).status).toBe(403);
      expect(
        (await fetch(operationUrl, { headers: { origin: "http://127.0.0.1:4174" } })).status,
      ).toBe(403);
      expect(readExactProjection).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });

  it.each([
    ["GET", `/api/v1/live-simulator/operations/${identity.operationId}?permit=secret-permit`],
    ["DELETE", `/api/v1/live-demo-review/sessions/${sessionId}?target=secret-target`],
    ["OPTIONS", `/api/v1/live-simulator/operations/${identity.operationId}?credential=secret`],
  ] as const)(
    "rejects %s routes with any query component before routing or telemetry",
    async (method, path) => {
      const readExactProjection = vi.fn();
      const cleanup = vi.fn(async () => ({
        outcome: "deleted" as const,
        message: "Protected demo result deleted" as const,
      }));
      const runRequestSpanSpy = vi.fn();
      const runRequestSpan: NonNullable<
        Parameters<typeof startLiveDemoReviewRuntime>[0]["runRequestSpan"]
      > = async <T>(span: unknown, operation: () => Promise<T>): Promise<T> => {
        runRequestSpanSpy(span);
        return await operation();
      };
      const recordHttpRequest = vi.fn();
      const runtime = await start({
        readExactProjection,
        cleanup,
        runRequestSpan,
        recordHttpRequest,
      });
      try {
        const response = await fetch(`${runtime.baseUrl}${path}`, {
          method,
          headers: {
            origin: allowedBrowserOrigin,
            ...(method === "OPTIONS" ? { "access-control-request-method": "GET" } : {}),
          },
        });
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
          error: { code: "not_found", message: "Resource not found." },
        });
        expect(readExactProjection).not.toHaveBeenCalled();
        expect(cleanup).not.toHaveBeenCalled();
        expect(runRequestSpanSpy).not.toHaveBeenCalled();
        expect(recordHttpRequest).not.toHaveBeenCalled();
        expect(JSON.stringify(recordHttpRequest.mock.calls)).not.toMatch(
          /secret-permit|secret-target|credential/iu,
        );
      } finally {
        await runtime.close();
      }
    },
  );

  it("extracts W3C context, runs request spans, and records fixed-route duration metrics", async () => {
    const establishTraceContext = vi.fn(() => ({ traceparent, tracestate: "vendor=opaque" }));
    const runRequestSpanSpy = vi.fn();
    const runRequestSpan: NonNullable<
      Parameters<typeof startLiveDemoReviewRuntime>[0]["runRequestSpan"]
    > = async <T>(span: unknown, operation: () => Promise<T>): Promise<T> => {
      runRequestSpanSpy(span, operation);
      return await operation();
    };
    const recordHttpRequest = vi.fn();
    const runtime = await start({ establishTraceContext, runRequestSpan, recordHttpRequest });
    try {
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`,
        {
          headers: {
            origin: allowedBrowserOrigin,
            traceparent,
            tracestate: "vendor=opaque",
          },
        },
      );
      expect(response.status).toBe(200);
      expect(establishTraceContext).toHaveBeenCalledWith(
        expect.objectContaining({ traceparent, tracestate: "vendor=opaque" }),
      );
      expect(runRequestSpanSpy).toHaveBeenCalledWith(
        {
          method: "GET",
          route: "GET /api/v1/live-simulator/operations/{operationId}",
          traceContext: { traceparent, tracestate: "vendor=opaque" },
        },
        expect.any(Function),
      );
      expect(recordHttpRequest).toHaveBeenCalledWith({
        method: "GET",
        route: "GET /api/v1/live-simulator/operations/{operationId}",
        statusCode: 200,
        durationSeconds: expect.any(Number),
      });
      expect(JSON.stringify(recordHttpRequest.mock.calls)).not.toMatch(
        /operation-review-001|4bf92f|vendor=opaque/iu,
      );
    } finally {
      await runtime.close();
    }
  });

  it("rejects localhost aliases so the advertised URL always matches the bound listener", async () => {
    await expect(start({ host: "localhost" })).rejects.toThrow(
      "Live demo review runtime configuration is invalid",
    );
  });

  it.each([
    ["partial evidence", { evidence: { quality: "partial" as const } }],
    ["three readings", { readings: completeProjection().readings.slice(0, 3) }],
    [
      "ungrounded reading",
      {
        readings: completeProjection().readings.map((reading, index) =>
          index === 0 ? { ...reading, disposition: "missing" as const } : reading,
        ),
      },
    ],
    [
      "unknown auxiliary state",
      {
        auxiliaryStatus: {
          sound: "unknown" as const,
          power: "mains_available" as const,
          battery: "normal" as const,
          output: "off" as const,
        },
      },
    ],
  ])("rejects observation_recorded with %s", async (_case, projectionOverride) => {
    const runtime = await start({
      readExactProjection: vi.fn(async () => completeProjection(projectionOverride)),
    });
    try {
      const response = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/${identity.operationId}`,
        { headers: { origin: allowedBrowserOrigin } },
      );
      expect(response.status).toBe(409);
      expect(JSON.stringify(await response.json())).not.toContain("Synthetic greenhouse report");
    } finally {
      await runtime.close();
    }
  });
});
