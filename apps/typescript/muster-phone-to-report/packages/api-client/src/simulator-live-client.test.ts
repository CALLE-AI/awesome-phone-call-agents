import { describe, expect, it, vi } from "vitest";

interface LiveClientModule {
  readonly createSimulatorLiveClient: (options: {
    readonly baseUrl: string;
    readonly fetch: typeof fetch;
  }) => {
    getAvailability(): Promise<unknown>;
    requestLiveObservation(input: {
      readonly scenarioId: string;
      readonly scenarioRevision: number;
      readonly permit: string;
    }): Promise<unknown>;
    getLiveObservation(operationId: string): Promise<unknown>;
  };
}

async function loadLiveClient(): Promise<Partial<LiveClientModule>> {
  try {
    return (await import("./simulator-live-client.js")) as Partial<LiveClientModule>;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/iu.test(error.message)) {
      return {};
    }
    throw error;
  }
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Simulator Lab live client", () => {
  it("publishes bounded capability, one POST acceptance, and server-identity GET results", async () => {
    const api = await loadLiveClient();
    expect(api.createSimulatorLiveClient).toBeTypeOf("function");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          enabled: true,
          runtimeProfile: "development",
          supportedScenarioRevisions: [
            { scenarioId: "synthetic-normal", revision: 2 },
            { scenarioId: "synthetic-recovery", revision: 2 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({ operationId: "operation-live-001", resourceVersion: 0 }, 202, {
          location: "/api/v1/live-simulator/operations/operation-live-001",
          "retry-after": "1",
        }),
      )
      .mockResolvedValueOnce(
        response({
          operationId: "operation-live-001",
          resourceVersion: 2,
          stage: "calling",
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
        }),
      );
    const client = api.createSimulatorLiveClient?.({
      baseUrl: "https://simulator.invalid",
      fetch: request,
    });

    await expect(client?.getAvailability()).resolves.toMatchObject({ ok: true, status: 200 });
    await expect(
      client?.requestLiveObservation({
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        permit: "transient-one-use-permit",
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 202,
      data: { operationId: "operation-live-001", resourceVersion: 0 },
      headers: {
        location: "/api/v1/live-simulator/operations/operation-live-001",
        retryAfterSeconds: 1,
      },
    });
    await expect(client?.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: true,
      status: 200,
      data: { operationId: "operation-live-001", resourceVersion: 2, provenance: "SIMULATED" },
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET"])).toEqual([
      ["https://simulator.invalid/api/v1/live-simulator/capability", "GET"],
      ["https://simulator.invalid/api/v1/live-simulator/operations", "POST"],
      ["https://simulator.invalid/api/v1/live-simulator/operations/operation-live-001", "GET"],
    ]);
    expect(String(request.mock.calls[1]?.[0])).not.toContain("transient-one-use-permit");
  });

  it("fails closed on hostile or oversized responses and returns only safe pre-dispatch feedback", async () => {
    const api = await loadLiveClient();
    expect(api.createSimulatorLiveClient).toBeTypeOf("function");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: "authorization_invalid",
              message: "Permit rejected. Mint a fresh scenario-bound permit.",
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        response({
          operationId: "operation-live-001",
          resourceVersion: 2,
          stage: "terminal",
          terminal: true,
          terminalOutcome: "observation_recorded",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          provenance: "SIMULATED",
          transcript: Array.from({ length: 101 }, () => ({ speaker: "device", text: "x" })),
          evidence: null,
          readings: [],
          reconciliation: [],
          predecessorOperationId: null,
        }),
      );
    const client = api.createSimulatorLiveClient?.({
      baseUrl: "https://simulator.invalid/",
      fetch: request,
    });

    await expect(
      client?.requestLiveObservation({
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        permit: "invalid-permit",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: {
        code: "authorization_invalid",
        message: "Permit rejected. Mint a fresh scenario-bound permit.",
      },
      headers: { location: null, retryAfterSeconds: null },
    });
    await expect(client?.getLiveObservation("operation-live-001")).resolves.toEqual({
      ok: false,
      status: "transport_error",
      error: null,
      headers: { location: null, retryAfterSeconds: null },
    });
  });
});
