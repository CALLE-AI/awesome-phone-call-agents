import { describe, expect, it, vi } from "vitest";

async function loadJobsApi(): Promise<Record<string, unknown>> {
  return (await import("./index.js")) as Record<string, unknown>;
}

describe("pg-boss live simulator job handler", () => {
  it("executes one no-retry delivery and returns only a bounded terminal disposition", async () => {
    const api = await loadJobsApi();
    expect(api["LiveSimulatorJobHandler"]).toBeTypeOf("function");
    const execute = vi.fn().mockResolvedValue({
      status: "failed",
      reason: "provider_timeout",
      retryable: false,
      authorizationConsumed: true,
    });
    const handler = new (api["LiveSimulatorJobHandler"] as CallableFunction)({ execute }) as {
      handle(payload: unknown, context: unknown): Promise<unknown>;
    };

    await expect(
      handler.handle(
        {
          version: "1",
          operationId: "operation-live-001",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          runAuthorization: "transient-permit",
        },
        { retryCount: 0, retryLimit: 0 },
      ),
    ).resolves.toEqual({
      version: "1",
      operationId: "operation-live-001",
      terminalOutcome: "provider_timeout",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("acknowledges repeated safe application-persistence outcomes without requesting pg-boss redelivery", async () => {
    const api = await loadJobsApi();
    const execute = vi.fn().mockResolvedValue({
      status: "failed",
      reason: "application_persistence_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    const terminalizePreReservation = vi.fn(async () => undefined);
    const handler = new (api["LiveSimulatorJobHandler"] as CallableFunction)(
      { execute },
      { recordFailure: terminalizePreReservation },
    ) as { handle(payload: unknown, context: unknown): Promise<unknown> };
    const payload = {
      version: "1",
      operationId: "operation-application-persistence-failed",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      runAuthorization: "transient-permit",
    };

    await expect(handler.handle(payload, { retryCount: 0, retryLimit: 1 })).resolves.toEqual({
      version: "1",
      operationId: payload.operationId,
      terminalOutcome: "application_persistence_failed",
    });
    await expect(handler.handle(payload, { retryCount: 1, retryLimit: 1 })).resolves.toEqual({
      version: "1",
      operationId: payload.operationId,
      terminalOutcome: "application_persistence_failed",
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(terminalizePreReservation).not.toHaveBeenCalled();
  });

  it("allows a bounded queue redelivery before reservation while preserving one provider operation identity", async () => {
    const api = await loadJobsApi();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        status: "blocked",
        reason: "authorization_store_unavailable",
        retryable: true,
        authorizationConsumed: false,
      })
      .mockResolvedValueOnce({ status: "completed", authorizationConsumed: true });
    const handler = new (api["LiveSimulatorJobHandler"] as CallableFunction)({ execute }) as {
      handle(payload: unknown, context: unknown): Promise<unknown>;
    };
    const payload = {
      version: "1",
      operationId: "operation-live-redelivery",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      runAuthorization: "transient-permit",
    };

    await expect(handler.handle(payload, { retryCount: 0, retryLimit: 1 })).rejects.toThrowError(
      /Live simulator pre-reservation delivery must be redelivered/u,
    );
    await expect(handler.handle(payload, { retryCount: 1, retryLimit: 1 })).resolves.toEqual({
      version: "1",
      operationId: "operation-live-redelivery",
      terminalOutcome: "completed",
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      operationId: "operation-live-redelivery",
    });
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      operationId: "operation-live-redelivery",
    });
  });

  it("durably terminalizes the final authorization-store outage before acknowledging the job", async () => {
    const api = await loadJobsApi();
    const execute = vi.fn().mockResolvedValue({
      status: "blocked",
      reason: "authorization_store_unavailable",
    });
    const recordFailure = vi.fn(async () => undefined);
    const handler = new (api["LiveSimulatorJobHandler"] as CallableFunction)(
      { execute },
      { recordFailure },
    ) as { handle(payload: unknown, context: unknown): Promise<unknown> };
    const payload = {
      version: "1",
      operationId: "operation-final-outage",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      runAuthorization: "transient-permit",
    };

    await expect(handler.handle(payload, { retryCount: 0, retryLimit: 1 })).rejects.toThrow();
    expect(recordFailure).not.toHaveBeenCalled();
    await expect(handler.handle(payload, { retryCount: 1, retryLimit: 1 })).resolves.toMatchObject({
      terminalOutcome: "authorization_store_unavailable",
    });
    expect(recordFailure).toHaveBeenCalledWith({
      operationId: "operation-final-outage",
      outcome: "blocked",
      retryable: false,
    });
  });
});
