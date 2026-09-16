import { describe, expect, it, vi } from "vitest";

interface LiveHttpModule {
  readonly createLiveSimulatorController: (
    input: Record<string, unknown>,
  ) => Record<string, unknown>;
  readonly startSimulatorHostHttpRuntime: (input: Record<string, unknown>) => Promise<{
    readonly baseUrl: string;
    close(): Promise<void>;
  }>;
}

async function loadLiveHttp(): Promise<Partial<LiveHttpModule>> {
  try {
    return (await import("./live-simulator-http-runtime.js")) as Partial<LiveHttpModule>;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/iu.test(error.message)) {
      return {};
    }
    throw error;
  }
}

const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("simulator-host live REST contract", () => {
  it("accepts an exact bracketed IPv6 loopback demo origin", async () => {
    const api = await loadLiveHttp();
    expect(api.createLiveSimulatorController).toBeTypeOf("function");
    expect(api.startSimulatorHostHttpRuntime).toBeTypeOf("function");
    const ipv6DemoOrigin = "http://[::1]:4173";
    const controller = api.createLiveSimulatorController?.({
      runtimeProfile: "test",
      enabled: true,
      scenarios: [{ scenarioId: "synthetic-normal", revision: 2, supportedModes: ["LIVE_SMOKE"] }],
      requestLiveObservation: vi.fn(),
      getLiveObservation: vi.fn(),
    });
    const runtime = await api.startSimulatorHostHttpRuntime?.({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      allowedDemoOrigin: ipv6DemoOrigin,
      maxBodyBytes: 16_384,
      liveController: controller,
      twilioController: { voice: vi.fn(), canary: vi.fn(), status: vi.fn() },
      establishTraceContext: vi.fn(() => ({ traceparent })),
      runRestSpan: vi.fn(
        async (_input: unknown, operation: () => Promise<unknown>) => await operation(),
      ),
      recordHttpRequest: vi.fn(),
    });
    if (runtime === undefined) throw new Error("live HTTP runtime unavailable");

    try {
      const response = await fetch(`${runtime.baseUrl}/api/v1/live-simulator/capability`, {
        headers: { origin: ipv6DemoOrigin, traceparent },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(ipv6DemoOrigin);
    } finally {
      await runtime.close();
    }
  });

  it("serves capability, accepted mutation, and server-identity status through actual HTTP without a provider", async () => {
    const api = await loadLiveHttp();
    expect(api.createLiveSimulatorController).toBeTypeOf("function");
    expect(api.startSimulatorHostHttpRuntime).toBeTypeOf("function");
    const requestLiveObservation = vi.fn(async () => ({
      operationId: "operation-live-http-001",
      resourceVersion: 0,
    }));
    const getLiveObservation = vi.fn(async () => ({
      operationId: "operation-live-http-001",
      resourceVersion: 1,
      stage: "scheduled",
      terminal: false,
      terminalOutcome: null,
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      provenance: "SIMULATED",
      transcript: [],
      evidence: null,
      readings: [],
      reconciliation: [],
      auxiliaryStatus: null,
      predecessorOperationId: null,
    }));
    const controller = api.createLiveSimulatorController?.({
      runtimeProfile: "test",
      enabled: true,
      scenarios: [
        {
          scenarioId: "synthetic-normal",
          revision: 2,
          supportedModes: ["DETERMINISTIC_REPLAY", "LIVE_SMOKE"],
        },
        {
          scenarioId: "synthetic-no-answer",
          revision: 2,
          supportedModes: ["DETERMINISTIC_REPLAY"],
        },
      ],
      requestLiveObservation,
      getLiveObservation,
    });
    const establishTraceContext = vi.fn(() => ({ traceparent }));
    const runRestSpan = vi.fn(
      async (_input: unknown, operation: () => Promise<unknown>) => await operation(),
    );
    const recordHttpRequest = vi.fn();
    const observeViewerReadiness = vi.fn();
    const runtime = await api.startSimulatorHostHttpRuntime?.({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      allowedDemoOrigin: "http://127.0.0.1:4173",
      maxBodyBytes: 16_384,
      liveController: controller,
      twilioController: {
        voice: vi.fn(),
        canary: vi.fn(),
      },
      establishTraceContext,
      runRestSpan,
      recordHttpRequest,
      observeViewerReadiness,
    });
    if (runtime === undefined) throw new Error("live HTTP runtime unavailable");

    try {
      const capability = await fetch(`${runtime.baseUrl}/api/v1/live-simulator/capability`, {
        headers: { origin: "http://127.0.0.1:4173", traceparent },
      });
      expect(capability.status).toBe(200);
      expect(capability.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4173");
      await expect(capability.json()).resolves.toEqual({
        enabled: true,
        runtimeProfile: "test",
        supportedScenarioRevisions: [{ scenarioId: "synthetic-normal", revision: 2 }],
      });

      const accepted = await fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:4173",
          "content-type": "application/json",
          traceparent,
        },
        body: JSON.stringify({
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          permit: "test-only-permit-never-dispatched",
        }),
      });
      expect(accepted.status).toBe(202);
      expect(accepted.headers.get("location")).toBe(
        "/api/v1/live-simulator/operations/operation-live-http-001",
      );
      expect(await accepted.json()).toEqual({
        operationId: "operation-live-http-001",
        resourceVersion: 0,
      });
      expect(requestLiveObservation).toHaveBeenCalledOnce();

      const status = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/operation-live-http-001`,
        { headers: { origin: "http://127.0.0.1:4173", traceparent } },
      );
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        operationId: "operation-live-http-001",
        provenance: "SIMULATED",
      });
      expect(getLiveObservation).toHaveBeenCalledWith("operation-live-http-001");
      expect(observeViewerReadiness).toHaveBeenCalledOnce();
      expect(observeViewerReadiness).toHaveBeenCalledWith({
        source: "server_http_runtime",
        method: "GET",
        route: "/api/v1/live-simulator/operations/operation-live-http-001",
        statusCode: 200,
        projectionIdentity: {
          operationId: "operation-live-http-001",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
        },
      });
      expect(establishTraceContext).toHaveBeenCalledTimes(3);
      expect(runRestSpan.mock.calls.map(([input]) => input)).toEqual([
        {
          method: "GET",
          route: "/api/v1/live-simulator/capability",
          traceContext: { traceparent },
        },
        {
          method: "POST",
          route: "/api/v1/live-simulator/operations",
          traceContext: { traceparent },
        },
        {
          method: "GET",
          route: "/api/v1/live-simulator/operations/{operationId}",
          traceContext: { traceparent },
        },
      ]);
      expect(recordHttpRequest.mock.calls.map(([input]) => input)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            route: "/api/v1/live-simulator/capability",
            statusCode: 200,
          }),
          expect.objectContaining({
            method: "POST",
            route: "/api/v1/live-simulator/operations",
            statusCode: 202,
          }),
          expect.objectContaining({
            method: "GET",
            route: "/api/v1/live-simulator/operations/{operationId}",
            statusCode: 200,
          }),
        ]),
      );
      expect(JSON.stringify(recordHttpRequest.mock.calls)).not.toMatch(
        /test-only-permit|operation-live-http-001|4bf92f/iu,
      );
    } finally {
      await runtime.close();
    }
  });

  it("bounds bodies and returns safe closed errors for malformed requests and missing operations", async () => {
    const api = await loadLiveHttp();
    expect(api.createLiveSimulatorController).toBeTypeOf("function");
    expect(api.startSimulatorHostHttpRuntime).toBeTypeOf("function");
    const controller = api.createLiveSimulatorController?.({
      runtimeProfile: "test",
      enabled: true,
      scenarios: [],
      requestLiveObservation: vi.fn(),
      getLiveObservation: vi.fn(async () => undefined),
    });
    const runtime = await api.startSimulatorHostHttpRuntime?.({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      allowedDemoOrigin: "http://127.0.0.1:4173",
      maxBodyBytes: 64,
      liveController: controller,
      twilioController: { voice: vi.fn(), canary: vi.fn() },
      establishTraceContext: () => ({ traceparent }),
    });
    if (runtime === undefined) throw new Error("live HTTP runtime unavailable");

    try {
      const malformed = await fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(malformed.status).toBe(400);
      await expect(malformed.json()).resolves.toEqual({
        error: { code: "validation_error", message: "Live observation request is invalid." },
      });
      const oversized = await fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permit: "secret".repeat(20) }),
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.text()).not.toContain("secret");
      const missing = await fetch(
        `${runtime.baseUrl}/api/v1/live-simulator/operations/operation-missing`,
      );
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toEqual({
        error: { code: "not_found", message: "Live observation was not found." },
      });
    } finally {
      await runtime.close();
    }
  });

  it("records bounded truthful spans and metrics for every known-route validation outcome", async () => {
    const api = await loadLiveHttp();
    const controller = api.createLiveSimulatorController?.({
      runtimeProfile: "test",
      enabled: true,
      scenarios: [{ scenarioId: "synthetic-normal", revision: 2, supportedModes: ["LIVE_SMOKE"] }],
      requestLiveObservation: vi.fn(),
      getLiveObservation: vi.fn(),
    });
    const runRestSpan = vi.fn(
      async (_input: unknown, operation: () => Promise<unknown>) => await operation(),
    );
    const recordHttpRequest = vi.fn();
    const runtime = await api.startSimulatorHostHttpRuntime?.({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      allowedDemoOrigin: "http://127.0.0.1:4173",
      maxBodyBytes: 256,
      liveController: controller,
      twilioController: { voice: vi.fn(), canary: vi.fn() },
      establishTraceContext: () => ({ traceparent }),
      runRestSpan,
      recordHttpRequest,
    });
    if (runtime === undefined) throw new Error("live HTTP runtime unavailable");

    try {
      const requests = [
        fetch(`${runtime.baseUrl}/api/v1/live-simulator/capability`, {
          method: "OPTIONS",
          headers: { origin: "http://127.0.0.1:4173" },
        }),
        fetch(`${runtime.baseUrl}/api/v1/live-simulator/capability`, {
          headers: { origin: "https://rejected.invalid" },
        }),
        fetch(`${runtime.baseUrl}/api/v1/live-simulator/capability`, { method: "PUT" }),
        fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "bounded",
        }),
        fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      ];
      await expect(
        Promise.all(requests).then((responses) => responses.map(({ status }) => status)),
      ).resolves.toEqual([204, 403, 405, 415, 400]);
      expect(runRestSpan.mock.calls.map(([input]) => input)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "OPTIONS",
            route: "/api/v1/live-simulator/capability",
          }),
          expect.objectContaining({ method: "GET", route: "/api/v1/live-simulator/capability" }),
          expect.objectContaining({ method: "OTHER", route: "/api/v1/live-simulator/capability" }),
          expect.objectContaining({ method: "POST", route: "/api/v1/live-simulator/operations" }),
        ]),
      );
      expect(runRestSpan).toHaveBeenCalledTimes(5);
      expect(recordHttpRequest).toHaveBeenCalledTimes(5);
      expect(recordHttpRequest.mock.calls.map(([input]) => input.statusCode).toSorted()).toEqual([
        204, 400, 403, 405, 415,
      ]);
      expect(JSON.stringify(recordHttpRequest.mock.calls)).not.toMatch(
        /rejected\.invalid|operation-live|4bf92f/iu,
      );
    } finally {
      await runtime.close();
    }
  });
});
