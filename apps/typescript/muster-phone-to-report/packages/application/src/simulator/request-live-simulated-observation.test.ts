import { describe, expect, it } from "vitest";

describe("RequestLiveSimulatedObservation", () => {
  // Test strategy: this phase proves only the application-owned reservation seam and its
  // fail-closed result. Host/provider construction and dispatch ordering belong to Phase 3.
  it("returns only a database-established operation for an exact reserved authorization", async () => {
    const application = (await import("../index.js")) as Record<string, unknown>;
    const Constructor = application["RequestLiveSimulatedObservation"] as
      | (new (dependencies: Record<string, unknown>) => {
          execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
        })
      | undefined;
    if (Constructor === undefined) {
      throw new Error("Phase 2 live request use case is not implemented");
    }
    const reservationInputs: unknown[] = [];
    const useCase = new Constructor({
      authorizations: {
        async reserve(input: unknown) {
          reservationInputs.push(input);
          return Object.freeze({ outcome: "reserved", operationId: "operation-live-001" });
        },
      },
      clock: { now: () => "2026-08-10T01:00:01.000Z" },
    });
    const request = {
      nonceDigest: "a".repeat(64),
      semanticDigest: "b".repeat(64),
      operationId: "operation-live-001",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      audience: "muster-simulator-host",
      endpointAlias: "synthetic-demo-endpoint",
      predecessorOperationId: null,
    };

    await expect(useCase.execute(request)).resolves.toEqual({
      outcome: "reserved",
      operationId: "operation-live-001",
    });
    expect(reservationInputs).toEqual([{ ...request, now: "2026-08-10T01:00:01.000Z" }]);

    const denied = new Constructor({
      authorizations: {
        async reserve() {
          return Object.freeze({ outcome: "conflict" });
        },
      },
      clock: { now: () => "2026-08-10T01:00:01.000Z" },
    });
    await expect(denied.execute(request)).rejects.toMatchObject({
      name: "ApplicationError",
      kind: "validation",
      code: "live_authorization_invalid",
      retryable: false,
    });
  });
});
