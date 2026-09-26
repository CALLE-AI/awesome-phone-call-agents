import { describe, expect, it, vi } from "vitest";

describe("executable simulator-host composition", () => {
  it("fails closed across callback, authorization, and provider entry points after secret revocation", async () => {
    const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
    let revoked = false;
    let httpInput: Record<string, unknown> | undefined;
    let jobHandler: ((payload: unknown, context: unknown) => Promise<void>) | undefined;
    const createProvider = vi.fn(() => ({ dispatch: vi.fn() }));
    const factories = {
      createPostgres: vi.fn(() => ({
        liveSimulatorAuthorizations: {},
        liveSimulatorProviderFacts: {},
        callAttempts: {},
        observationProfiles: {
          establish: vi.fn(async (value: unknown) => ({ outcome: "established", value })),
        },
        evidence: {},
        observations: {},
        disconnect: vi.fn(),
      })),
      createCustody: vi.fn(() => ({ write: vi.fn() })),
      createObservability: vi.fn(() => ({ close: vi.fn(), record: vi.fn() })),
      createProvider,
      createTwilioEndpoint: vi.fn(() => ({
        handleVoice: vi.fn(),
        handleCanary: vi.fn(),
        handleStatus: vi.fn(),
      })),
      createJobs: vi.fn(() => ({
        start: vi.fn(),
        scheduleLiveSimulator: vi.fn(),
        workLiveSimulator: async (handler: typeof jobHandler) => {
          jobHandler = handler;
        },
        stop: vi.fn(),
      })),
      startHttp: vi.fn(async (input: Record<string, unknown>) => {
        httpInput = input;
        return { baseUrl: "http://127.0.0.1:1", close: vi.fn() };
      }),
    };
    const runtime = (await (api["startSimulatorHostRuntime"] as CallableFunction)({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        publicBaseUrl: "https://simulator.invalid",
        demoOrigin: "http://127.0.0.1:4173",
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 60_000,
        providerTerminalTimeoutMs: 180_000,
        custodyRoot: "C:\\safe\\custody",
        custodyMaxTranscriptBytes: 16_384,
        custodyMaxEntries: 8,
        connectionString: "postgresql://disposable.invalid/muster",
        jobsSchema: "simulator_jobs",
        organizationId: "org-simulator-host",
        listenHost: "127.0.0.1",
        listenPort: 0,
        apiToken: "protected-calle-token",
        targetAddress: "protected-target",
        authorizedTargetDigest: "a".repeat(64),
        callbackIdentityHmacKey: "protected-callback-key-with-at-least-32-bytes",
        authorizationSigningKey: "protected-signing-key-with-at-least-32-bytes",
        twilioAuthToken: "protected-twilio-token",
        killSwitch: { assertDispatchAllowed: vi.fn() },
      },
      assertRuntimeSecretsAvailable: () => {
        if (revoked) throw new Error("Live-smoke runtime is unavailable");
      },
      factories,
    })) as { close(): Promise<void> };
    revoked = true;

    const twilioController = httpInput?.["twilioController"] as Record<string, CallableFunction>;
    const liveController = httpInput?.["liveController"] as Record<string, CallableFunction>;
    await expect(twilioController["voice"]!({})).rejects.toThrow(
      "Live-smoke runtime is unavailable",
    );
    await expect(
      liveController["request"]!(
        {
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          permit: "revoked-permit",
        },
        {
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      ),
    ).resolves.toEqual({
      statusCode: 500,
      body: {
        error: {
          code: "unexpected_error",
          message: "Live observation could not be started safely.",
        },
      },
    });
    await expect(
      jobHandler?.(
        {
          version: "1",
          operationId: "operation-revoked",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          runAuthorization: "revoked",
        },
        { retryCount: 0, retryLimit: 0 },
      ),
    ).rejects.toThrow("Live-smoke runtime is unavailable");
    expect(createProvider).not.toHaveBeenCalled();

    await runtime.close();
  });

  it("attempts the pool close after persistence disconnect fails", async () => {
    const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
    expect(api["createPostgresDisconnect"]).toBeTypeOf("function");
    const events: string[] = [];
    const disconnectPersistence = vi.fn(async () => {
      events.push("persistence:disconnect");
      throw new Error("protected persistence detail");
    });
    const endPool = vi.fn(async () => {
      events.push("pool:end");
      throw new Error("protected pool detail");
    });
    const disconnect = (api["createPostgresDisconnect"] as CallableFunction)({
      disconnectPersistence,
      endPool,
    }) as () => Promise<void>;

    await expect(disconnect()).rejects.toThrowError(
      /^Simulator host PostgreSQL cleanup failed \(2\)$/u,
    );

    expect(events).toEqual(["persistence:disconnect", "pool:end"]);
    expect(disconnectPersistence).toHaveBeenCalledOnce();
    expect(endPool).toHaveBeenCalledOnce();
  });

  it("bounds persistence and pool cleanup independently when persistence disconnect stalls", async () => {
    vi.useFakeTimers();
    const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
    const disconnectPersistence = vi.fn(async () => await new Promise<void>(() => undefined));
    const endPool = vi.fn(async () => undefined);
    const disconnect = (api["createPostgresDisconnect"] as CallableFunction)({
      disconnectPersistence,
      endPool,
      cleanupTimeoutMs: 25,
    }) as () => Promise<void>;
    let outcome: "resolved" | "rejected" | undefined;

    void disconnect().then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );
    await vi.advanceTimersByTimeAsync(25);

    expect(outcome).toBe("rejected");
    expect(disconnectPersistence).toHaveBeenCalledOnce();
    expect(endPool).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("composes repositories, custody, CALL-E, Twilio, observability, jobs, and listener with safe shutdown", async () => {
    const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
    expect(api["startSimulatorHostRuntime"]).toBeTypeOf("function");
    const events: string[] = [];
    let jobHandler: ((payload: unknown, context: unknown) => Promise<void>) | undefined;
    const closeHttp = vi.fn(async () => events.push("http:close"));
    const stopJobs = vi.fn(async () => events.push("jobs:stop"));
    const disconnect = vi.fn(async () => events.push("postgres:close"));
    const closeObservability = vi.fn(async () => events.push("observability:close"));
    const establishProfile = vi.fn(async (value: unknown) => ({ outcome: "established", value }));
    const factories = {
      createPostgres: vi.fn(() => {
        events.push("postgres:create");
        return {
          liveSimulatorAuthorizations: {},
          callAttempts: {},
          observationProfiles: { establish: establishProfile },
          evidence: {},
          observations: {},
          disconnect,
        };
      }),
      createCustody: vi.fn(() => {
        events.push("custody:create");
        return { write: vi.fn() };
      }),
      createObservability: vi.fn(() => {
        events.push("observability:create");
        return { close: closeObservability, record: vi.fn() };
      }),
      createProvider: vi.fn(() => {
        events.push("provider:create");
        return { dispatch: vi.fn() };
      }),
      createTwilioEndpoint: vi.fn(() => {
        events.push("twilio:create");
        return { handleVoice: vi.fn(), handleCanary: vi.fn() };
      }),
      createJobs: vi.fn(() => ({
        start: async () => events.push("jobs:start"),
        scheduleLiveSimulator: vi.fn(async () => ({ outcome: "scheduled" })),
        workLiveSimulator: async (handler: typeof jobHandler) => {
          jobHandler = handler;
          events.push("jobs:work");
        },
        stop: stopJobs,
      })),
      startHttp: vi.fn(async () => {
        events.push("http:start");
        return { baseUrl: "http://127.0.0.1:1", close: closeHttp };
      }),
    };

    const runtime = (await (api["startSimulatorHostRuntime"] as CallableFunction)({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        publicBaseUrl: "https://simulator.invalid",
        demoOrigin: "http://127.0.0.1:4173",
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 60_000,
        custodyRoot: "C:\\safe\\custody",
        custodyMaxTranscriptBytes: 16_384,
        custodyMaxEntries: 8,
        connectionString: "postgresql://disposable.invalid/muster",
        jobsSchema: "simulator_jobs",
        organizationId: "org-simulator-host",
        apiToken: "protected-calle-token",
        targetAddress: "protected-target",
        authorizationSigningKey: "protected-signing-key-with-at-least-32-bytes",
        twilioAuthToken: "protected-twilio-token",
        killSwitch: { assertDispatchAllowed: vi.fn() },
      },
      factories,
    })) as { close(): Promise<void> };

    expect(jobHandler).toBeTypeOf("function");
    expect(establishProfile).toHaveBeenCalledOnce();
    expect(establishProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: "greenhouse-synthetic",
        provenance: "SIMULATED",
        compatibility: "simulator-tested",
        dtmfPolicy: { kind: "forbidden" },
      }),
    );
    expect(events).toEqual([
      "postgres:create",
      "custody:create",
      "observability:create",
      "twilio:create",
      "jobs:start",
      "jobs:work",
      "http:start",
    ]);
    expect(factories.createProvider).not.toHaveBeenCalled();
    expect(factories.createTwilioEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        onProviderFactPersistenceFailure: expect.any(Function),
      }),
    );
    expect(factories.startHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedDemoOrigin: "http://127.0.0.1:4173",
        liveController: expect.objectContaining({
          capability: expect.any(Function),
          request: expect.any(Function),
          status: expect.any(Function),
        }),
      }),
    );

    await runtime.close();
    await runtime.close();
    expect(events.slice(-4)).toEqual([
      "http:close",
      "jobs:stop",
      "observability:close",
      "postgres:close",
    ]);
    expect(closeHttp).toHaveBeenCalledOnce();
    expect(stopJobs).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(closeObservability).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).not.toMatch(/protected-|postgresql:\/\//u);
  });

  it.each([
    ["createCustody", ["postgres:close"]],
    ["createObservability", ["custody:close", "postgres:close"]],
    ["createTwilioEndpoint", ["observability:close", "custody:close", "postgres:close"]],
    ["createJobs", ["twilio:close", "observability:close", "custody:close", "postgres:close"]],
  ] as const)(
    "rolls back every acquired closeable once when %s fails",
    async (failedFactory, expectedCleanup) => {
      const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
      const cleanupEvents: string[] = [];
      const closePostgres = vi.fn(async () => cleanupEvents.push("postgres:close"));
      const closeCustody = vi.fn(async () => cleanupEvents.push("custody:close"));
      const closeObservability = vi.fn(async () => cleanupEvents.push("observability:close"));
      const closeTwilio = vi.fn(async () => cleanupEvents.push("twilio:close"));
      const fail = (stage: string): void => {
        if (failedFactory === stage) throw new Error(`${stage} failed`);
      };
      const factories = {
        createPostgres: vi.fn(() => ({
          liveSimulatorAuthorizations: {},
          callAttempts: {},
          observationProfiles: {
            establish: vi.fn(async (value: unknown) => ({ outcome: "established", value })),
          },
          evidence: {},
          observations: {},
          disconnect: closePostgres,
        })),
        createCustody: vi.fn(() => {
          fail("createCustody");
          return { write: vi.fn(), close: closeCustody };
        }),
        createObservability: vi.fn(() => {
          fail("createObservability");
          return { close: closeObservability, record: vi.fn() };
        }),
        createProvider: vi.fn(() => ({ dispatch: vi.fn() })),
        createTwilioEndpoint: vi.fn(() => {
          fail("createTwilioEndpoint");
          return { handleVoice: vi.fn(), handleCanary: vi.fn(), close: closeTwilio };
        }),
        createJobs: vi.fn(() => {
          fail("createJobs");
          return {
            start: vi.fn(),
            workLiveSimulator: vi.fn(),
            stop: vi.fn(),
          };
        }),
        startHttp: vi.fn(),
      };

      await expect(
        (api["startSimulatorHostRuntime"] as CallableFunction)({
          configuration: {
            runtimeProfile: "test",
            enabled: true,
            publicBaseUrl: "https://simulator.invalid",
            endpointAlias: "greenhouse-synthetic",
            authorizationAudience: "muster-live-simulator",
            callBudget: 1,
            concurrency: 1,
            timeoutMs: 60_000,
            custodyRoot: "C:\\safe\\custody",
            custodyMaxTranscriptBytes: 16_384,
            custodyMaxEntries: 8,
            connectionString: "postgresql://disposable.invalid/muster",
            jobsSchema: "simulator_jobs",
            organizationId: "org-simulator-host",
            apiToken: "protected-calle-token",
            targetAddress: "protected-target",
            authorizationSigningKey: "protected-signing-key-with-at-least-32-bytes",
            twilioAuthToken: "protected-twilio-token",
            killSwitch: { assertDispatchAllowed: vi.fn() },
          },
          factories,
        }),
      ).rejects.toThrow(new RegExp(`^${failedFactory} failed$`, "u"));

      expect(cleanupEvents).toEqual(expectedCleanup);
      expect(closePostgres).toHaveBeenCalledOnce();
      expect(closeCustody).toHaveBeenCalledTimes(
        ["createObservability", "createTwilioEndpoint", "createJobs"].includes(failedFactory)
          ? 1
          : 0,
      );
      expect(closeObservability).toHaveBeenCalledTimes(
        ["createTwilioEndpoint", "createJobs"].includes(failedFactory) ? 1 : 0,
      );
      expect(closeTwilio).toHaveBeenCalledTimes(failedFactory === "createJobs" ? 1 : 0);
    },
  );

  it("bounds a stalled cleanup and continues reverse-order ownership unwinding", async () => {
    const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
    const events: string[] = [];
    let releaseHttp: (() => void) | undefined;
    const stalledHttpClose = new Promise<void>((resolve) => {
      releaseHttp = resolve;
    });
    const stopJobs = vi.fn(async () => events.push("jobs:stop"));
    const closeObservability = vi.fn(async () => events.push("observability:close"));
    const disconnect = vi.fn(async () => events.push("postgres:close"));
    const factories = {
      createPostgres: vi.fn(() => ({
        liveSimulatorAuthorizations: {},
        callAttempts: {},
        observationProfiles: {
          establish: vi.fn(async (value: unknown) => ({ outcome: "established", value })),
        },
        evidence: {},
        observations: {},
        disconnect,
      })),
      createCustody: vi.fn(() => ({ write: vi.fn() })),
      createObservability: vi.fn(() => ({ close: closeObservability, record: vi.fn() })),
      createProvider: vi.fn(() => ({ dispatch: vi.fn() })),
      createTwilioEndpoint: vi.fn(() => ({ handleVoice: vi.fn(), handleCanary: vi.fn() })),
      createJobs: vi.fn(() => ({
        start: vi.fn(),
        workLiveSimulator: vi.fn(),
        stop: stopJobs,
      })),
      startHttp: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:1",
        close: vi.fn(async () => {
          events.push("http:close");
          await stalledHttpClose;
        }),
      })),
    };
    const runtime = (await (api["startSimulatorHostRuntime"] as CallableFunction)({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        publicBaseUrl: "https://simulator.invalid",
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 60_000,
        custodyRoot: "C:\\safe\\custody",
        custodyMaxTranscriptBytes: 16_384,
        custodyMaxEntries: 8,
        connectionString: "postgresql://disposable.invalid/muster",
        jobsSchema: "simulator_jobs",
        organizationId: "org-simulator-host",
        apiToken: "protected-calle-token",
        targetAddress: "protected-target",
        authorizationSigningKey: "protected-signing-key-with-at-least-32-bytes",
        twilioAuthToken: "protected-twilio-token",
        killSwitch: { assertDispatchAllowed: vi.fn() },
      },
      cleanupTimeoutMs: 25,
      factories,
    })) as { close(): Promise<void> };

    vi.useFakeTimers();
    const closeOutcome = runtime.close().then(
      () => "resolved",
      () => "rejected",
    );
    await vi.advanceTimersByTimeAsync(25);
    const continuedAtDeadline = stopJobs.mock.calls.length === 1;
    releaseHttp?.();
    const outcome = await closeOutcome;
    vi.useRealTimers();

    expect({ continuedAtDeadline, outcome }).toEqual({
      continuedAtDeadline: true,
      outcome: "rejected",
    });
    expect(events).toEqual(["http:close", "jobs:stop", "observability:close", "postgres:close"]);
    expect(stopJobs).toHaveBeenCalledOnce();
    expect(closeObservability).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("fails closed for a missing CallAttempt and returns its authoritative dispatch and adapter identities", async () => {
    const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
    expect(api["createSimulatorHostCallAttemptBoundaries"]).toBeTypeOf("function");
    let attempt:
      | Readonly<{
          stage: "calling";
          providerDispatchIdentity: string;
          adapterVersionId: string;
        }>
      | undefined = {
      stage: "calling",
      providerDispatchIdentity: "provider-dispatch-db",
      adapterVersionId: "adapter-version-db",
    };
    const recordTerminalFailure = vi.fn();
    const boundaries = (api["createSimulatorHostCallAttemptBoundaries"] as CallableFunction)({
      organizationId: "org-simulator-host",
      callAttempts: {
        findById: vi.fn(async () => attempt),
        recordCalling: vi.fn(),
        recordTerminalFailure,
      },
      now: () => "2026-08-10T12:00:00.000Z",
    }) as {
      readonly dispatchAttempts: {
        claim(input: { readonly operationId: string }): Promise<unknown>;
      };
      readonly terminalAttempts: {
        recordFailure(input: {
          readonly operationId: string;
          readonly outcome: "provider_failed";
          readonly retryable: false;
        }): Promise<void>;
      };
    };

    await expect(
      boundaries.dispatchAttempts.claim({ operationId: "operation-db" }),
    ).resolves.toEqual({
      providerDispatchIdentity: "provider-dispatch-db",
      adapterVersionId: "adapter-version-db",
    });
    attempt = undefined;
    await expect(
      boundaries.dispatchAttempts.claim({ operationId: "operation-missing" }),
    ).rejects.toThrow(/CallAttempt is unavailable/u);
    await expect(
      boundaries.terminalAttempts.recordFailure({
        operationId: "operation-missing",
        outcome: "provider_failed",
        retryable: false,
      }),
    ).rejects.toThrow(/CallAttempt is unavailable/u);
    expect(recordTerminalFailure).not.toHaveBeenCalled();
  });

  it("keeps a DTMF safety stop inside the durable result transaction completion barrier", async () => {
    const api = (await import("./start-simulator-host-runtime.js")) as Record<string, unknown>;
    expect(api["createAtomicLiveResultPersistence"]).toBeTypeOf("function");
    let safetyClear = true;
    let releaseResult: (() => void) | undefined;
    const resultRelease = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    let reportResultPending: (() => void) | undefined;
    const resultPending = new Promise<void>((resolve) => {
      reportResultPending = resolve;
    });
    const committedResults: unknown[] = [];
    const runObservationResultTransaction = vi.fn(
      async (
        operation: (repositories: Readonly<Record<string, unknown>>) => Promise<unknown>,
        canCommit: () => boolean,
      ) => {
        const stagedResults: unknown[] = [];
        const result = await operation({ stagedResults });
        if (!canCommit()) return undefined;
        committedResults.push(...stagedResults);
        return result;
      },
    );
    const createRecordResult = vi.fn((repositories: Readonly<Record<string, unknown>>) => ({
      execute: vi.fn(async (input: unknown) => {
        reportResultPending?.();
        await resultRelease;
        (repositories["stagedResults"] as unknown[]).push(input);
        return { kind: "observation_recorded" as const };
      }),
    }));
    const persistence = (api["createAtomicLiveResultPersistence"] as CallableFunction)({
      organizationId: "org-simulator-host",
      callAttempts: { findById: vi.fn(async () => undefined) },
      runObservationResultTransaction,
      createRecordResult,
    }) as {
      commitAtomically(
        input: Readonly<{ operationId: string; result: unknown }>,
        canCommit: () => boolean,
      ): Promise<Readonly<{ disposition: "committed" | "blocked" }>>;
    };

    const pending = persistence.commitAtomically(
      { operationId: "operation-dtmf-transaction", result: { kind: "evidence" } },
      () => safetyClear,
    );
    await resultPending;
    safetyClear = false;
    releaseResult?.();

    await expect(pending).resolves.toEqual({ disposition: "blocked" });
    expect(runObservationResultTransaction).toHaveBeenCalledOnce();
    expect(createRecordResult).toHaveBeenCalledOnce();
    expect(committedResults).toEqual([]);
  });
});
