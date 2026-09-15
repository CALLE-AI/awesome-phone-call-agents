import { describe, expect, it, vi } from "vitest";

import { createSimulatorLiveClient } from "./simulator-live-client.js";

const acceptedLocation = "/api/v1/live-simulator/operations/operation-live-001";

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function completeProjection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: "operation-live-001",
    resourceVersion: 4,
    stage: "terminal",
    terminal: true,
    terminalOutcome: "observation_recorded",
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    provenance: "SIMULATED",
    transcript: [{ speaker: "device", text: "Four-zone greenhouse report." }],
    evidence: { quality: "complete", opaqueReference: "custody-ref-001" },
    readings: [
      {
        zoneId: "zone-01",
        label: "North house air temperature",
        value: "71.5",
        unit: "degF",
        status: "OK",
        disposition: "grounded",
      },
      {
        zoneId: "zone-02",
        label: "Propagation bench temperature",
        value: "68.0",
        unit: "degF",
        status: "OK",
        disposition: "grounded",
      },
      {
        zoneId: "zone-03",
        label: "Greenhouse relative humidity",
        value: "68",
        unit: "percent",
        status: "OK",
        disposition: "grounded",
      },
      {
        zoneId: "zone-04",
        label: "Irrigation reservoir level",
        value: "82",
        unit: "percent",
        status: "OK",
        disposition: "grounded",
      },
    ],
    reconciliation: [
      { zoneId: "zone-01", disposition: "matched" },
      { zoneId: "zone-02", disposition: "matched" },
      { zoneId: "zone-03", disposition: "matched" },
      { zoneId: "zone-04", disposition: "matched" },
    ],
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

describe("Simulator live client review regressions", () => {
  it("uses an exact no-store GET and exposes only validated fixed review metadata for cleanup", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(completeProjection(), 200, {
          "x-muster-review-capability": "closed",
          "x-muster-review-ready-at": "2026-09-02T12:00:00.000Z",
          "x-muster-review-expires-at": "2026-09-02T12:30:00.000Z",
          "x-muster-review-cleanup-path": "/api/v1/live-demo-review/sessions/review-session-001",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ outcome: "deleted", message: "Protected demo result deleted" }),
      );
    const client = createSimulatorLiveClient({
      baseUrl: "http://127.0.0.1:43111",
      fetch: request,
    });

    await expect(
      client.getLiveObservation("operation-live-001", {
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
      }),
    ).resolves.toMatchObject({
      ok: true,
      headers: {
        review: {
          capabilityClosed: true,
          reviewReadyAt: "2026-09-02T12:00:00.000Z",
          reviewExpiresAt: "2026-09-02T12:30:00.000Z",
          cleanupPath: "/api/v1/live-demo-review/sessions/review-session-001",
        },
      },
    });
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: { "cache-control": "no-store" },
    });

    await expect(
      client.finishLiveDemoReview("/api/v1/live-demo-review/sessions/review-session-001"),
    ).resolves.toEqual({
      ok: true,
      status: 200,
      data: { outcome: "deleted", message: "Protected demo result deleted" },
      headers: { location: null, retryAfterSeconds: null },
    });
    expect(request.mock.calls[1]).toEqual([
      "http://127.0.0.1:43111/api/v1/live-demo-review/sessions/review-session-001",
      { method: "DELETE", headers: { "cache-control": "no-store" } },
    ]);
  });

  it("rejects drifted review expiry metadata and unsafe cleanup paths", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(completeProjection(), 200, {
        "x-muster-review-capability": "closed",
        "x-muster-review-ready-at": "2026-09-02T12:00:00.000Z",
        "x-muster-review-expires-at": "2026-09-02T12:31:00.000Z",
        "x-muster-review-cleanup-path": "/api/v1/live-demo-review/sessions/latest",
      }),
    );
    const client = createSimulatorLiveClient({ baseUrl: "", fetch: request });

    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: true,
      headers: { review: null },
    });
    await expect(
      client.finishLiveDemoReview("/api/v1/live-demo-review/sessions/latest"),
    ).resolves.toMatchObject({ ok: false, status: 400 });
    expect(request).toHaveBeenCalledOnce();
  });

  it("requires a matching 202 Location and retains that validated server status location for GET", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ operationId: "operation-live-001", resourceVersion: 0 }, 202),
      )
      .mockResolvedValueOnce(
        jsonResponse({ operationId: "operation-live-001", resourceVersion: 0 }, 202, {
          location: "/api/v1/live-simulator/operations/another-operation",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ operationId: "operation-live-001", resourceVersion: 0 }, 202, {
          location: acceptedLocation,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(completeProjection()));
    const client = createSimulatorLiveClient({
      baseUrl: "https://simulator.invalid",
      fetch: request,
    });
    const input = {
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      permit: "one-use-permit",
    };

    await expect(client.requestLiveObservation(input)).resolves.toMatchObject({
      ok: false,
      status: "transport_error",
    });
    await expect(client.requestLiveObservation(input)).resolves.toMatchObject({
      ok: false,
      status: "transport_error",
    });
    await expect(client.requestLiveObservation(input)).resolves.toMatchObject({
      ok: true,
      data: { operationId: "operation-live-001", statusLocation: acceptedLocation },
    });
    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: true,
    });
    expect(String(request.mock.calls[3]?.[0])).toBe(`https://simulator.invalid${acceptedLocation}`);
  });

  it("bounds response bytes before JSON parsing and never reflects a server-supplied secret", async () => {
    const secret = "permit-secret-must-not-be-reflected";
    const oversized = new Response(`{"padding":"${"x".repeat(70_000)}"}`, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const parseSpy = vi.spyOn(oversized, "json");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(oversized)
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "authorization_invalid", message: secret } }, 400),
      );
    const client = createSimulatorLiveClient({
      baseUrl: "https://simulator.invalid",
      fetch: request,
    });

    await expect(client.getAvailability()).resolves.toMatchObject({
      ok: false,
      status: "transport_error",
    });
    expect(parseSpy).not.toHaveBeenCalled();
    const denied = await client.requestLiveObservation({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      permit: secret,
    });
    expect(JSON.stringify(denied)).not.toContain(secret);
    expect(denied).toMatchObject({
      ok: false,
      status: 400,
      error: {
        code: "authorization_invalid",
        message: "Permit rejected. Mint a fresh scenario-bound permit.",
      },
    });
  });

  it("accepts only a complete four-zone plus auxiliary-status projection", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(completeProjection()))
      .mockResolvedValueOnce(
        jsonResponse(
          completeProjection({
            readings: (completeProjection()["readings"] as unknown[]).slice(0, 3),
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          completeProjection({
            reconciliation: [],
          }),
        ),
      );
    const client = createSimulatorLiveClient({
      baseUrl: "https://simulator.invalid",
      fetch: request,
    });

    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: true,
      data: {
        terminalOutcome: "observation_recorded",
        auxiliaryStatus: { sound: "normal", output: "off" },
      },
    });
    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: false,
      status: "transport_error",
    });
    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: false,
      status: "transport_error",
    });
  });

  it("keeps ambiguous and truncated evidence incomplete and rejects inconsistent terminal envelopes", async () => {
    const incompleteReadings = (completeProjection()["readings"] as Record<string, unknown>[]).map(
      (reading, index) =>
        index === 0
          ? { ...reading, value: null, unit: null, status: "UNKNOWN", disposition: "ambiguous" }
          : reading,
    );
    const incompleteReconciliation = (
      completeProjection()["reconciliation"] as Record<string, unknown>[]
    ).map((item, index) => (index === 0 ? { ...item, disposition: "ambiguous" } : item));
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          completeProjection({
            terminalOutcome: "evidence_incomplete",
            evidence: { quality: "invalid", opaqueReference: "custody-ref-ambiguous" },
            readings: incompleteReadings,
            reconciliation: incompleteReconciliation,
            auxiliaryStatus: {
              sound: "unknown",
              power: "mains_available",
              battery: "normal",
              output: "off",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          completeProjection({
            terminalOutcome: "evidence_incomplete",
            evidence: { quality: "partial", opaqueReference: "custody-ref-truncated" },
            readings: incompleteReadings,
            reconciliation: incompleteReconciliation,
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(completeProjection({ stage: "calling", terminal: true })))
      .mockResolvedValueOnce(
        jsonResponse(completeProjection({ terminal: false, terminalOutcome: null })),
      );
    const client = createSimulatorLiveClient({
      baseUrl: "https://simulator.invalid",
      fetch: request,
    });

    const ambiguous = await client.getLiveObservation("operation-live-001");
    const truncated = await client.getLiveObservation("operation-live-001");
    expect(ambiguous).toMatchObject({
      ok: true,
      data: { terminalOutcome: "evidence_incomplete", evidence: { quality: "invalid" } },
    });
    expect(truncated).toMatchObject({
      ok: true,
      data: { terminalOutcome: "evidence_incomplete", evidence: { quality: "partial" } },
    });
    expect(JSON.stringify([ambiguous, truncated])).not.toMatch(
      /"terminalOutcome":"observation_recorded"/u,
    );
    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: false,
      status: "transport_error",
    });
    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: false,
      status: "transport_error",
    });
  });

  it("fails closed on empty-state, pairwise, outcome-lineage, and requested GET identity mismatches", async () => {
    const base = completeProjection();
    const readings = base["readings"] as Record<string, unknown>[];
    const reconciliation = base["reconciliation"] as Record<string, unknown>[];
    const invalid = [
      completeProjection({ stage: "calling", terminal: false, terminalOutcome: null }),
      completeProjection({
        readings: readings.map((reading, index) =>
          index === 0 ? { ...reading, status: "UNKNOWN" } : reading,
        ),
      }),
      completeProjection({
        readings: readings.map((reading, index) =>
          index === 0 ? { ...reading, value: null } : reading,
        ),
      }),
      completeProjection({
        readings: readings.map((reading, index) =>
          index === 0 ? { ...reading, unit: "percent" } : reading,
        ),
      }),
      completeProjection({
        reconciliation: reconciliation.map((item, index) =>
          index === 0 ? { ...item, disposition: "missing" } : item,
        ),
      }),
      completeProjection({ predecessorOperationId: "operation-abnormal-001" }),
      completeProjection({ terminalOutcome: "recovery_candidate", predecessorOperationId: null }),
      completeProjection({ operationId: "operation-other-001" }),
    ];
    const request = vi.fn<typeof fetch>();
    for (const body of invalid) request.mockResolvedValueOnce(jsonResponse(body));
    request
      .mockResolvedValueOnce(
        jsonResponse(
          completeProjection({
            terminalOutcome: "recovery_candidate",
            predecessorOperationId: "operation-abnormal-001",
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          completeProjection({
            terminalOutcome: "provider_failed",
            transcript: [],
            evidence: null,
            readings: [],
            reconciliation: [],
            auxiliaryStatus: null,
            predecessorOperationId: "operation-abnormal-001",
          }),
        ),
      );
    const client = createSimulatorLiveClient({
      baseUrl: "https://simulator.invalid",
      fetch: request,
    });

    for (let index = 0; index < invalid.length; index += 1) {
      await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
        ok: false,
        status: "transport_error",
      });
    }
    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: true,
      data: {
        terminalOutcome: "recovery_candidate",
        predecessorOperationId: "operation-abnormal-001",
      },
    });
    await expect(client.getLiveObservation("operation-live-001")).resolves.toMatchObject({
      ok: true,
      data: {
        terminalOutcome: "provider_failed",
        predecessorOperationId: "operation-abnormal-001",
      },
    });
  });
});
