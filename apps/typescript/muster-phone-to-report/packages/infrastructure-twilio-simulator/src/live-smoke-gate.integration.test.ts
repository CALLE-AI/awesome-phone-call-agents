import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";

const organizationId = OrganizationId.create("org-live-smoke-gate");

async function loadSimulatorApi(): Promise<Record<string, (...args: never[]) => unknown>> {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as Record<
    string,
    (...args: never[]) => unknown
  >;
}

function completedCalleOutput(value: string, providerCallId = "provider-call-opaque") {
  const values = [value, "68.0", "68", "82"];
  return {
    providerCallId,
    terminalStatus: "completed",
    observedAt: "2026-08-07T14:00:00.000Z",
    evidence: {
      providerRevisionId: "provider-revision-opaque",
      opaqueCustodyRef: "custody-reference-opaque",
      sourceCompleteness: "complete",
      transcript: [
        {
          speaker: "device",
          text: "Four-zone synthetic greenhouse report. ".repeat(9).trim(),
        },
      ],
      readings: values.map((readingValue, index) => ({
        zoneId: `zone-0${String(index + 1)}`,
        value: readingValue,
        spokenUnit: index < 2 ? "degrees fahrenheit" : "percent",
        normalizedUnit: index < 2 ? "degF" : "percent",
        status: "OK",
        confidenceToken: "provider-observed",
        sourceAnchor: {
          anchorId: `anchor-zone-0${String(index + 1)}`,
          valueToken: readingValue,
          spokenUnitToken: index < 2 ? "degrees fahrenheit" : "percent",
          opaqueSourceRef: `custody-reference-opaque#turn=${String(index)}`,
        },
      })),
      auxiliaryStatus: {
        sound: "normal",
        power: "mains_available",
        battery: "normal",
        output: "off",
      },
    },
  };
}

function enabledConfiguration(timeoutMs = 500) {
  return {
    runtimeProfile: "test",
    enabled: true,
    killSwitchAllows: true,
    syntheticTargetAuthorized: true,
    callBudget: 1,
    concurrency: 1,
    timeoutMs,
    endpointAlias: "synthetic-demo-endpoint",
    authorizationAudience: "muster-live-smoke",
  };
}

function enabledDependencies(events: unknown[] = []) {
  return {
    authorizationBoundary: { reserve: async () => "reserved" },
    evidencePersistence: { persistAdmission: async () => undefined },
    terminalAttempts: { recordFailure: async () => undefined },
    dispatchAttempts: {
      claim: async ({ operationId }: { operationId: string }) => ({
        providerDispatchIdentity: `provider-dispatch-${operationId}`,
        adapterVersionId: "adapter-version-db",
      }),
    },
    dtmfSafetyStop: {
      observe: () => ({ status: "clear", actionsObserved: 0, compatibility: "simulator-tested" }),
      isBlocked: () => false,
      assertDispatchAllowed: () => undefined,
    },
    reviewedConfidenceTokens: ["provider-observed"],
    observability: {
      establishTraceContext: (traceContext: unknown) => traceContext,
      record: (event: unknown) => events.push(event),
    },
  };
}

function executeInput(operationId: string) {
  return {
    operationId,
    scenarioId: "synthetic-normal",
    scenarioRevision: 1,
    runAuthorization: `signed-${operationId}`,
    traceContext: {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("guarded CALL-E live smoke", () => {
  it("defaults off and fails closed for production, missing secrets, or unauthorized configuration", async () => {
    const api = await loadSimulatorApi();
    let dispatches = 0;
    const dispatch = async () => {
      dispatches += 1;
      return completedCalleOutput("71.5");
    };
    const createRunner = api["createLiveSmokeRunner"] as CallableFunction;
    const disabled = createRunner({
      configuration: { runtimeProfile: "test" },
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const missingSecrets = createRunner({
      configuration: enabledConfiguration(),
      ...enabledDependencies(),
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const production = createRunner({
      configuration: { ...enabledConfiguration(), runtimeProfile: "production" },
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(disabled.execute(executeInput("run-disabled"))).resolves.toMatchObject({
      status: "blocked",
      reason: "live_smoke_disabled",
    });
    await expect(missingSecrets.execute(executeInput("run-secrets"))).resolves.toMatchObject({
      status: "blocked",
      reason: "required_secret_unresolved",
    });
    await expect(production.execute(executeInput("run-production"))).resolves.toMatchObject({
      status: "blocked",
      reason: "production_forbidden",
    });
    expect(dispatches).toBe(0);

    const [manifest, appModule, productionBootstrap] = await Promise.all([
      readFile(new URL("../../../apps/api/package.json", import.meta.url), "utf8"),
      readFile(new URL("../../../apps/api/src/app.module.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../apps/api/src/composition/start-api.ts", import.meta.url), "utf8"),
    ]);
    expect(`${manifest}\n${appModule}\n${productionBootstrap}`).not.toMatch(
      /infrastructure-twilio-simulator|TwilioSynthetic|SimulatorModule|simulator\.controller/iu,
    );
  });

  it("enforces concurrency one, a one-call budget, same-run idempotency, trace propagation, and no keypad or retry plan", async () => {
    const api = await loadSimulatorApi();
    let release: ((value: unknown) => void) | undefined;
    const dispatched: unknown[] = [];
    const providerResult = new Promise((resolve) => {
      release = resolve;
    });
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      dispatch: async (request: unknown) => {
        dispatched.push(request);
        return await providerResult;
      },
    }) as { execute(input: unknown): Promise<unknown> };

    const firstPromise = runner.execute(executeInput("run-authorized"));
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    await expect(runner.execute(executeInput("run-concurrent"))).resolves.toMatchObject({
      status: "blocked",
      reason: "concurrency_slot_occupied",
    });
    expect(dispatched[0]).toMatchObject({
      endpointAlias: "synthetic-demo-endpoint",
      timeoutMs: 500,
      retryLimit: 0,
      dtmfPolicy: { kind: "forbidden", allowlist: [] },
      traceContext: executeInput("run-authorized").traceContext,
    });
    expect(JSON.stringify(dispatched[0])).not.toMatch(/digit|keypad|dtmfPlan/iu);

    release?.(completedCalleOutput("71.5"));
    const first = await firstPromise;
    await expect(runner.execute(executeInput("run-authorized"))).resolves.toEqual(first);
    await expect(runner.execute(executeInput("run-after-budget"))).resolves.toMatchObject({
      status: "blocked",
      reason: "call_budget_exhausted",
    });
    expect(dispatched).toHaveLength(1);
  });

  it("consumes the authorization on timeout and never retries the provider dispatch", async () => {
    vi.useFakeTimers();
    const api = await loadSimulatorApi();
    let dispatches = 0;
    const terminalAttempts = {
      recordFailure: vi.fn(async () => ({ terminalOutcome: "provider_failed" as const })),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(25),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      terminalAttempts,
      dispatch: async () => {
        dispatches += 1;
        return await new Promise(() => undefined);
      },
    }) as { execute(input: unknown): Promise<unknown> };

    const pending = runner.execute(executeInput("run-timeout"));
    await vi.advanceTimersByTimeAsync(26);
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      reason: "provider_timeout",
      retryable: false,
      authorizationConsumed: true,
    });
    await expect(runner.execute(executeInput("run-timeout-second"))).resolves.toMatchObject({
      status: "blocked",
      reason: "call_budget_exhausted",
    });
    expect(dispatches).toBe(1);
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: "run-timeout",
      outcome: "provider_failed",
      retryable: false,
    });
  });

  it("reconciles an already-claimed provider operation without another dispatch", async () => {
    const api = await loadSimulatorApi();
    const dispatch = vi.fn();
    const reconcile = vi.fn(async () => completedCalleOutput("71.5"));
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      dispatchAttempts: {
        claim: async () => ({
          outcome: "reconcile" as const,
          providerDispatchIdentity: "provider-dispatch-existing",
          adapterVersionId: "adapter-version-db",
        }),
      },
      dispatch,
      reconcile,
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(runner.execute(executeInput("run-reconcile-existing"))).resolves.toMatchObject({
      status: "completed",
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    "provider_insufficient_balance",
    "provider_evidence_invalid",
    "provider_evidence_unavailable",
  ] as const)(
    "records the allowlisted %s terminal class while persisting generic failure",
    async (providerClass) => {
      const api = await loadSimulatorApi();
      const events: Array<{ readonly outcome?: string; readonly reason?: string }> = [];
      const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
      const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
        configuration: enabledConfiguration(),
        resolvedSecrets: {
          calleApiToken: "resolved-test-token",
          targetAddress: "resolved-synthetic-target",
        },
        ...enabledDependencies(events),
        terminalAttempts,
        dispatch: async () => {
          throw new Error(`CALL-E provider terminal: ${providerClass}`);
        },
      }) as { execute(input: unknown): Promise<unknown> };

      await expect(
        runner.execute(executeInput("run-safe-provider-failure")),
      ).resolves.toMatchObject({
        status: "failed",
        reason: "provider_failed",
        authorizationConsumed: true,
      });
      expect(events).toContainEqual(
        expect.objectContaining({ outcome: "failed", reason: providerClass }),
      );
      expect(terminalAttempts.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "provider_failed", retryable: false }),
      );
    },
  );

  it("records the bounded structured-admission cause without exposing provider evidence", async () => {
    const api = await loadSimulatorApi();
    const events: Array<{ readonly outcome?: string; readonly reason?: string }> = [];
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(events),
      dispatch: async () => {
        throw new Error("CALL-E provider terminal: provider_evidence_invalid", {
          cause: "anchor_value",
        });
      },
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(
      runner.execute(executeInput("run-safe-admission-diagnostic")),
    ).resolves.toMatchObject({ status: "failed", reason: "provider_failed" });
    expect(events).toContainEqual(
      expect.objectContaining({
        outcome: "failed",
        reason: "provider_evidence_invalid_anchor_value",
      }),
    );
    expect(JSON.stringify(events)).not.toContain("resolved-synthetic-target");
  });

  it("records only bounded create-response diagnostics while persisting generic failure", async () => {
    const api = await loadSimulatorApi();
    const events: unknown[] = [];
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "private-provider-credential",
        targetAddress: "private-synthetic-target",
      },
      ...enabledDependencies(events),
      terminalAttempts,
      dispatch: async () => {
        throw new Error("CALL-E provider terminal: provider_create_response_invalid", {
          cause: Object.freeze({
            diagnostics: Object.freeze({
              statusCode: 204,
              contentType: "missing",
              body: "absent",
              location: "exact_call_resource",
              requestIdPresent: true,
            }),
            rawLocation: "https://private.example/v1/calls/private-provider-call",
            rawBody: "private provider body",
            authorization: "Bearer private-provider-credential",
          }),
        });
      },
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(
      runner.execute(executeInput("run-create-response-diagnostic")),
    ).resolves.toMatchObject({ status: "failed", reason: "provider_failed" });
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "simulator.live_smoke",
        outcome: "failed",
        reason: "provider_create_response_invalid",
        providerResponseStatusCode: 204,
        providerResponseContentType: "missing",
        providerResponseBody: "absent",
        providerResponseLocation: "exact_call_resource",
        providerRequestIdPresent: true,
      }),
    );
    expect(JSON.stringify(events)).not.toMatch(
      /private\.example|private provider body|private-provider-credential|private-provider-call/iu,
    );
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "provider_failed", retryable: false }),
    );
  });

  it("admits a bounded 120-second callback deadline and rejects anything longer", async () => {
    const api = await loadSimulatorApi();
    const createRunner = api["createLiveSmokeRunner"] as CallableFunction;
    const bounded = createRunner({
      configuration: enabledConfiguration(120_000),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      dispatch: async () => completedCalleOutput("71.5"),
    }) as { execute(input: unknown): Promise<unknown> };
    const overlong = createRunner({
      configuration: enabledConfiguration(120_001),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      dispatch: async () => completedCalleOutput("71.5"),
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(bounded.execute(executeInput("run-bounded-watchdog"))).resolves.toMatchObject({
      status: "completed",
    });
    await expect(overlong.execute(executeInput("run-overlong-watchdog"))).resolves.toMatchObject({
      status: "blocked",
      reason: "safety_configuration_invalid",
    });
  });

  it("preserves DTMF safety-stop precedence when CALL-E rejects its aborted dispatch", async () => {
    const api = await loadSimulatorApi();
    const safetyStop = (api["createDtmfSafetyStop"] as CallableFunction)() as {
      observe(form: Readonly<Record<string, string>>): unknown;
      isBlocked(): boolean;
      assertDispatchAllowed(): void;
      onBlocked(listener: () => void): () => void;
    };
    const dispatch = vi.fn(
      async ({ signal }: { readonly signal: AbortSignal }): Promise<never> =>
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("CALL-E dispatch was aborted")), {
            once: true,
          });
          safetyStop.observe({ Digits: "redacted-observed-value" });
        }),
    );
    const resultPersistence = { commitAtomically: vi.fn() };
    const terminalAttempts = {
      recordFailure: vi.fn(async () => ({ terminalOutcome: "blocked" as const })),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      ...enabledDependencies(),
      terminalAttempts,
      dtmfSafetyStop: safetyStop,
      resultPersistence,
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const input = executeInput("operation-dtmf-abort");

    const first = await runner.execute(input);
    const replay = await runner.execute(input);

    expect(first).toEqual({
      status: "failed",
      reason: "dtmf_safety_stop",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(replay).toEqual(first);
    expect(safetyStop.isBlocked()).toBe(true);
    expect(() => safetyStop.assertDispatchAllowed()).toThrowError(/DTMF safety stop is active/u);
    expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    expect(resultPersistence.commitAtomically).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("lets late DTMF win while admitted evidence is being persisted and prevents result persistence", async () => {
    const api = await loadSimulatorApi();
    const safetyStop = (api["createDtmfSafetyStop"] as CallableFunction)() as {
      observe(form: Readonly<Record<string, string>>): unknown;
      isBlocked(): boolean;
      assertDispatchAllowed(): void;
      onBlocked(listener: () => void): () => void;
    };
    const resultPersistence = { commitAtomically: vi.fn() };
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const evidencePersistence = {
      persistAdmission: vi.fn(async () => {
        safetyStop.observe({ Digits: "protected-dtmf-value" });
      }),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      ...enabledDependencies(),
      terminalAttempts,
      dtmfSafetyStop: safetyStop,
      evidencePersistence,
      resultPersistence,
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      dispatch: vi.fn(async () => completedCalleOutput("71.5")),
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(runner.execute(executeInput("operation-late-dtmf"))).resolves.toEqual({
      status: "failed",
      reason: "dtmf_safety_stop",
      retryable: false,
      authorizationConsumed: true,
    });

    expect(evidencePersistence.persistAdmission).toHaveBeenCalledOnce();
    expect(resultPersistence.commitAtomically).not.toHaveBeenCalled();
    expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    expect(safetyStop.isBlocked()).toBe(true);
    expect(JSON.stringify(terminalAttempts.recordFailure.mock.calls)).not.toContain(
      "protected-dtmf-value",
    );
  });

  it("lets DTMF observed during pending result commitment prevent an operational result", async () => {
    const api = await loadSimulatorApi();
    const safetyStop = (api["createDtmfSafetyStop"] as CallableFunction)() as {
      observe(form: Readonly<Record<string, string>>): unknown;
      isBlocked(): boolean;
      assertDispatchAllowed(): void;
      onBlocked(listener: () => void): () => void;
    };
    let releaseCommit: (() => void) | undefined;
    const commitRelease = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let reportCommitPending: (() => void) | undefined;
    const commitPending = new Promise<void>((resolve) => {
      reportCommitPending = resolve;
    });
    const committedResults: unknown[] = [];
    const resultPersistence = {
      persist: vi.fn(async (input: unknown) => {
        reportCommitPending?.();
        await commitRelease;
        committedResults.push(input);
      }),
      commitAtomically: vi.fn(async (input: unknown, canCommit: () => boolean) => {
        reportCommitPending?.();
        await commitRelease;
        if (!canCommit()) return { disposition: "blocked" as const };
        committedResults.push(input);
        return {
          disposition: "committed" as const,
          winner: "observation_recorded" as const,
        };
      }),
    };
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      ...enabledDependencies(),
      terminalAttempts,
      dtmfSafetyStop: safetyStop,
      resultPersistence,
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      dispatch: vi.fn(async () => completedCalleOutput("71.5")),
    }) as { execute(input: unknown): Promise<unknown> };

    const pending = runner.execute(executeInput("operation-dtmf-during-commit"));
    await commitPending;
    safetyStop.observe({ Digits: "protected-dtmf-value" });
    releaseCommit?.();

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "dtmf_safety_stop",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(committedResults).toEqual([]);
    expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    expect(
      JSON.stringify({ committedResults, calls: terminalAttempts.recordFailure.mock.calls }),
    ).not.toContain("protected-dtmf-value");
  });

  it.each([
    ["evidence_timestamp_invalid", "evidence_timestamp_invalid"],
    ["application_persistence_failed", "application_persistence_failed"],
  ] as const)(
    "classifies post-provider result failure as %s, terminalizes evidence unavailable, and never redials",
    async (expectedReason, failureKind) => {
      const api = await loadSimulatorApi();
      const PersistenceError = api["LiveSmokeResultPersistenceError"] as unknown as new (
        reason: "evidence_timestamp_invalid" | "application_persistence_failed",
      ) => Error;
      expect(PersistenceError).toBeTypeOf("function");
      const events: unknown[] = [];
      const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
      const recordDisposition = vi.fn(async () => undefined);
      const terminalAttempts = {
        recordFailure: vi.fn(async () => ({ terminalOutcome: "evidence_unavailable" as const })),
      };
      const resultPersistence = {
        commitAtomically: vi.fn(async () => {
          if (failureKind === "evidence_timestamp_invalid") {
            throw new PersistenceError("evidence_timestamp_invalid");
          }
          throw new Error("protected persistence detail");
        }),
      };
      const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
        configuration: enabledConfiguration(),
        resolvedSecrets: {
          calleApiToken: "resolved-test-token",
          targetAddress: "resolved-synthetic-target",
        },
        ...enabledDependencies(events),
        dispatchAttempts: {
          claim: async ({ operationId }: { operationId: string }) => ({
            providerDispatchIdentity: `provider-dispatch-${operationId}`,
            adapterVersionId: "adapter-version-db",
          }),
          recordDisposition,
        },
        terminalAttempts,
        resultPersistence,
        dispatch,
      }) as { execute(input: unknown): Promise<unknown> };
      const execution = executeInput(`operation-${failureKind}`);

      const first = await runner.execute(execution);
      await expect(runner.execute(execution)).resolves.toEqual(first);
      await expect(
        runner.execute(executeInput(`operation-after-${failureKind}`)),
      ).resolves.toMatchObject({ status: "blocked", reason: "call_budget_exhausted" });

      expect(first).toEqual({
        status: "failed",
        reason: expectedReason,
        retryable: false,
        authorizationConsumed: true,
      });
      expect(recordDisposition).toHaveBeenCalledOnce();
      expect(recordDisposition).toHaveBeenCalledWith({
        operationId: execution.operationId,
        outcome: "provider_returned",
      });
      expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
        operationId: execution.operationId,
        outcome: "evidence_unavailable",
        retryable: false,
      });
      expect(
        terminalAttempts.recordFailure.mock.calls.filter(
          ([failure]) => failure.operationId === execution.operationId,
        ),
      ).toHaveLength(1);
      expect(resultPersistence.commitAtomically).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(events).toContainEqual(
        expect.objectContaining({ outcome: "failed", reason: expectedReason }),
      );
      expect(
        JSON.stringify({ events, calls: terminalAttempts.recordFailure.mock.calls }),
      ).not.toMatch(/protected persistence detail|resolved-test-token|resolved-synthetic-target/iu);
    },
  );

  it("classifies failed provider-return disposition persistence without rewriting transport outcome or redialing", async () => {
    const api = await loadSimulatorApi();
    const events: unknown[] = [];
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const claim = vi.fn(async ({ operationId }: { operationId: string }) => ({
      providerDispatchIdentity: `provider-dispatch-${operationId}`,
      adapterVersionId: "adapter-version-db",
    }));
    const recordDisposition = vi.fn(async () => {
      throw new Error("protected disposition repository detail");
    });
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(events),
      dispatchAttempts: { claim, recordDisposition },
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-return-disposition-failed");

    const first = await runner.execute(execution);
    await expect(runner.execute(execution)).resolves.toEqual(first);

    expect(first).toEqual({
      status: "failed",
      reason: "application_persistence_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(recordDisposition).toHaveBeenCalledOnce();
    expect(recordDisposition).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "provider_returned",
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "evidence_unavailable",
      retryable: false,
    });
    expect(claim).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.stringify({ first, events })).not.toContain(
      "protected disposition repository detail",
    );
  });

  it("preserves DTMF precedence when disposition persistence fails after provider return", async () => {
    const api = await loadSimulatorApi();
    const safetyStop = (api["createDtmfSafetyStop"] as CallableFunction)() as {
      observe(form: Readonly<Record<string, string>>): unknown;
      isBlocked(): boolean;
      assertDispatchAllowed(): void;
      onBlocked(listener: () => void): () => void;
    };
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      dtmfSafetyStop: safetyStop,
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        })),
        recordDisposition: vi.fn(async () => {
          safetyStop.observe({ Digits: "protected-dtmf-value" });
          throw new Error("protected disposition repository detail");
        }),
      },
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(
      runner.execute(executeInput("operation-dtmf-disposition-failed")),
    ).resolves.toEqual({
      status: "failed",
      reason: "dtmf_safety_stop",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: "operation-dtmf-disposition-failed",
      outcome: "blocked",
      retryable: false,
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.stringify(terminalAttempts.recordFailure.mock.calls)).not.toMatch(
      /protected-dtmf-value|protected disposition repository detail/iu,
    );
  });

  it("resolves and caches the safe application classification when failure terminalization rejects", async () => {
    const api = await loadSimulatorApi();
    const events: unknown[] = [];
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const claim = vi.fn(async ({ operationId }: { operationId: string }) => ({
      providerDispatchIdentity: `provider-dispatch-${operationId}`,
      adapterVersionId: "adapter-version-db",
    }));
    const recordFailure = vi.fn(async () => {
      throw new Error("protected terminal repository detail");
    });
    const resultPersistence = {
      commitAtomically: vi.fn(async () => {
        throw new Error("protected result repository detail");
      }),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(events),
      dispatchAttempts: { claim, recordDisposition: vi.fn(async () => undefined) },
      terminalAttempts: { recordFailure },
      resultPersistence,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-terminalization-failed");

    const first = await runner.execute(execution);
    await expect(runner.execute(execution)).resolves.toEqual(first);

    expect(first).toEqual({
      status: "failed",
      reason: "application_persistence_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(recordFailure).toHaveBeenCalledOnce();
    expect(resultPersistence.commitAtomically).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({ outcome: "failed", reason: "application_persistence_failed" }),
    );
    expect(JSON.stringify({ first, events })).not.toMatch(
      /protected terminal repository detail|protected result repository detail/iu,
    );
  });

  it.each(["recordCalleTerminal", "assertReady", "readinessPersistenceResult"] as const)(
    "classifies post-provider evidence coordinator %s persistence failure as application unavailable",
    async (failedOperation) => {
      const api = await loadSimulatorApi();
      const EvidencePersistenceError = api["LiveSmokeEvidencePersistenceError"] as unknown as new (
        ...args: never[]
      ) => Error;
      expect(EvidencePersistenceError).toBeTypeOf("function");
      const events: unknown[] = [];
      const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
      const claim = vi.fn(async ({ operationId }: { operationId: string }) => ({
        providerDispatchIdentity: `provider-dispatch-${operationId}`,
        adapterVersionId: "adapter-version-db",
      }));
      const evidenceCoordinator = {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(() => () => undefined),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin: vi.fn(),
        recordCalleTerminal: vi.fn(async () => {
          if (failedOperation === "recordCalleTerminal") {
            throw new EvidencePersistenceError();
          }
        }),
        assertReady: vi.fn(async () => {
          if (failedOperation === "assertReady") {
            throw new EvidencePersistenceError();
          }
          if (failedOperation === "readinessPersistenceResult") {
            return { outcome: "blocked" as const, reason: "persistence_unavailable" as const };
          }
          return { outcome: "ready" as const, dtmfActions: 0 as const };
        }),
      };
      const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
      const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
        configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
        resolvedSecrets: {
          calleApiToken: "test-only-token",
          targetAddress: "test-only-synthetic-target",
        },
        ...enabledDependencies(events),
        runGate: { assertOpen: vi.fn() },
        dispatchAttempts: { claim, recordDisposition: vi.fn(async () => undefined) },
        evidenceCoordinator,
        terminalAttempts,
        dispatch,
      }) as { execute(input: unknown): Promise<unknown> };
      const execution = executeInput(`operation-coordinator-${failedOperation}`);

      const first = await runner.execute(execution);
      await expect(runner.execute(execution)).resolves.toEqual(first);

      expect(first).toEqual({
        status: "failed",
        reason: "application_persistence_failed",
        retryable: false,
        authorizationConsumed: true,
      });
      expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
        operationId: execution.operationId,
        outcome: "evidence_unavailable",
        retryable: false,
      });
      expect(claim).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(evidenceCoordinator.settle).toHaveBeenCalledWith({
        operationId: execution.operationId,
      });
      expect(JSON.stringify({ first, events })).not.toMatch(/persistence is unavailable/iu);
    },
  );

  it("gives the runner sole terminal-write ownership when provider-fact failure races the deadline", async () => {
    const api = await loadSimulatorApi();
    const createCoordinator = api["createLiveSmokeEvidenceCoordinator"] as CallableFunction;
    let deadline: (() => void) | undefined;
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const closeRunGate = vi.fn();
    const cleanup = vi.fn(async () => undefined);
    const coordinator = createCoordinator({
      organizationId,
      providerFacts: {
        append: vi.fn(async (fact: Readonly<{ phase: string }>) => {
          if (fact.phase === "calle_terminal") {
            deadline?.();
            throw new Error("protected provider fact repository detail");
          }
          return { outcome: "appended" as const };
        }),
        listForOperation: vi.fn(async () => []),
      },
      terminalAttempts,
      closeRunGate,
      cleanup,
      admitCalleEvidence: vi.fn(async () => ({ outcome: "admissible" as const })),
      startTimer: vi.fn((callback: () => void) => {
        deadline = callback;
        return { unref: vi.fn() };
      }),
      now: () => "2026-08-07T14:00:00.000Z",
    }) as {
      claimTerminalPersistence(input: unknown): "runner" | "coordinator";
      onTerminal(input: unknown, listener: (reason: "provider_failed") => void): () => void;
      settle(input: unknown): "runner" | "coordinator";
      completeTerminalPersistence(input: unknown): Promise<void>;
      begin(input: unknown): void;
      recordCalleTerminal(input: unknown): Promise<void>;
      waitUntilReady(input: unknown): Promise<unknown>;
    };
    const evidenceCoordinator = {
      claimTerminalPersistence: ({ operationId }: { operationId: string }) =>
        coordinator.claimTerminalPersistence({ organizationId, operationId }),
      onTerminal: (
        { operationId }: { operationId: string },
        listener: (reason: "provider_failed") => void,
      ) => coordinator.onTerminal({ organizationId, operationId }, listener),
      settle: ({ operationId }: { operationId: string }) =>
        coordinator.settle({ organizationId, operationId }),
      completeTerminalPersistence: ({ operationId }: { operationId: string }) =>
        coordinator.completeTerminalPersistence({ organizationId, operationId }),
      begin: (input: Readonly<{ operationId: string; deadlineMs: number }>) =>
        coordinator.begin({ organizationId, ...input }),
      recordCalleTerminal: async (input: unknown) => await coordinator.recordCalleTerminal(input),
      assertReady: async ({ operationId }: { operationId: string }) =>
        await coordinator.waitUntilReady({ organizationId, operationId }),
    };
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        })),
        recordDisposition: vi.fn(async () => undefined),
      },
      evidenceCoordinator,
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-deadline-persistence-race");

    const first = await runner.execute(execution);
    await expect(runner.execute(execution)).resolves.toEqual(first);

    expect(first).toEqual({
      status: "failed",
      reason: "provider_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "provider_failed",
      retryable: false,
    });
    expect(closeRunGate).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("preserves one provider-failed write when the runner-owned evidence deadline expires", async () => {
    const api = await loadSimulatorApi();
    const createCoordinator = api["createLiveSmokeEvidenceCoordinator"] as CallableFunction;
    let deadline: (() => void) | undefined;
    const facts: unknown[] = [];
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const closeRunGate = vi.fn();
    const cleanup = vi.fn(async () => undefined);
    const coordinator = createCoordinator({
      organizationId,
      providerFacts: {
        append: vi.fn(async (fact: unknown) => {
          facts.push(fact);
          return { outcome: "appended" as const };
        }),
        listForOperation: vi.fn(async () => {
          deadline?.();
          return facts;
        }),
      },
      terminalAttempts,
      closeRunGate,
      cleanup,
      admitCalleEvidence: vi.fn(async () => ({ outcome: "admissible" as const })),
      startTimer: vi.fn((callback: () => void) => {
        deadline = callback;
        return { unref: vi.fn() };
      }),
      now: () => "2026-08-07T14:00:00.000Z",
    }) as {
      claimTerminalPersistence(input: unknown): "runner" | "coordinator";
      onTerminal(input: unknown, listener: (reason: "provider_failed") => void): () => void;
      settle(input: unknown): "runner" | "coordinator";
      completeTerminalPersistence(input: unknown): Promise<void>;
      begin(input: unknown): void;
      recordCalleTerminal(input: unknown): Promise<void>;
      waitUntilReady(input: unknown): Promise<unknown>;
    };
    const evidenceCoordinator = {
      claimTerminalPersistence: ({ operationId }: { operationId: string }) =>
        coordinator.claimTerminalPersistence({ organizationId, operationId }),
      onTerminal: (
        { operationId }: { operationId: string },
        listener: (reason: "provider_failed") => void,
      ) => coordinator.onTerminal({ organizationId, operationId }, listener),
      settle: ({ operationId }: { operationId: string }) =>
        coordinator.settle({ organizationId, operationId }),
      completeTerminalPersistence: ({ operationId }: { operationId: string }) =>
        coordinator.completeTerminalPersistence({ organizationId, operationId }),
      begin: (input: Readonly<{ operationId: string; deadlineMs: number }>) =>
        coordinator.begin({ organizationId, ...input }),
      recordCalleTerminal: async (input: unknown) => await coordinator.recordCalleTerminal(input),
      assertReady: async ({ operationId }: { operationId: string }) =>
        await coordinator.waitUntilReady({ organizationId, operationId }),
    };
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        })),
        recordDisposition: vi.fn(async () => undefined),
      },
      evidenceCoordinator,
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-runner-owned-deadline");

    const first = await runner.execute(execution);
    await expect(runner.execute(execution)).resolves.toEqual(first);

    expect(first).toEqual({
      status: "failed",
      reason: "provider_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "provider_failed",
      retryable: false,
    });
    expect(closeRunGate).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("aborts a pending provider dispatch when the runner-owned evidence deadline expires", async () => {
    const api = await loadSimulatorApi();
    const createCoordinator = api["createLiveSmokeEvidenceCoordinator"] as CallableFunction;
    let deadline: (() => void) | undefined;
    const order: string[] = [];
    const terminalAttempts = {
      recordFailure: vi.fn(async () => {
        order.push("terminal-write");
      }),
    };
    const closeRunGate = vi.fn(() => order.push("gate-closed"));
    const cleanup = vi.fn(async () => {
      order.push("cleanup");
    });
    const coordinator = createCoordinator({
      organizationId,
      providerFacts: {
        append: vi.fn(async () => ({ outcome: "appended" as const })),
        listForOperation: vi.fn(async () => []),
      },
      terminalAttempts,
      closeRunGate,
      cleanup,
      startTimer: vi.fn((callback: () => void) => {
        deadline = callback;
        return { unref: vi.fn() };
      }),
      now: () => "2026-08-07T14:00:00.000Z",
    }) as {
      claimTerminalPersistence(input: unknown): "runner" | "coordinator";
      onTerminal(input: unknown, listener: (reason: "provider_failed") => void): () => void;
      settle(input: unknown): "runner" | "coordinator";
      completeTerminalPersistence(input: unknown): Promise<void>;
      begin(input: unknown): void;
      recordCalleTerminal(input: unknown): Promise<void>;
      waitUntilReady(input: unknown): Promise<unknown>;
    };
    const evidenceCoordinator = {
      claimTerminalPersistence: ({ operationId }: { operationId: string }) =>
        coordinator.claimTerminalPersistence({ organizationId, operationId }),
      onTerminal: (
        { operationId }: { operationId: string },
        listener: (reason: "provider_failed") => void,
      ) => coordinator.onTerminal({ organizationId, operationId }, listener),
      settle: ({ operationId }: { operationId: string }) =>
        coordinator.settle({ organizationId, operationId }),
      completeTerminalPersistence: ({ operationId }: { operationId: string }) =>
        coordinator.completeTerminalPersistence({ organizationId, operationId }),
      begin: (input: Readonly<{ operationId: string; deadlineMs: number }>) =>
        coordinator.begin({ organizationId, ...input }),
      recordCalleTerminal: async (input: unknown) => await coordinator.recordCalleTerminal(input),
      assertReady: async ({ operationId }: { operationId: string }) =>
        await coordinator.waitUntilReady({ organizationId, operationId }),
    };
    let providerSignal: AbortSignal | undefined;
    let releaseProvider: ((output: unknown) => void) | undefined;
    const providerPending = new Promise<unknown>((resolve) => {
      releaseProvider = resolve;
    });
    const dispatch = vi.fn(async (request: { readonly signal: AbortSignal }) => {
      providerSignal = request.signal;
      return await providerPending;
    });
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        })),
        recordDisposition: vi.fn(async () => undefined),
      },
      evidenceCoordinator,
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-pending-dispatch-deadline");
    let settled: unknown;

    const pending = runner.execute(execution).then((result) => {
      settled = result;
      return result;
    });
    try {
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
      deadline?.();
      await vi.waitFor(() => expect(settled).toBeDefined(), { timeout: 50, interval: 1 });

      await expect(pending).resolves.toEqual({
        status: "failed",
        reason: "provider_failed",
        retryable: false,
        authorizationConsumed: true,
      });
      await expect(runner.execute(execution)).resolves.toEqual(settled);
      expect(providerSignal?.aborted).toBe(true);
      expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
      expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
        operationId: execution.operationId,
        outcome: "provider_failed",
        retryable: false,
      });
      expect(order).toEqual(["terminal-write", "gate-closed", "cleanup"]);
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      releaseProvider?.(completedCalleOutput("71.5"));
      await Promise.allSettled([pending]);
    }
  });

  it.each(["disposition", "evidence", "readiness", "admission"] as const)(
    "keeps the terminal signal active while %s is pending and ignores late success",
    async (pendingStage) => {
      const api = await loadSimulatorApi();
      let terminalListener:
        ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
      let releaseStage: (() => void) | undefined;
      let rejectStage: ((error: Error) => void) | undefined;
      const stagePending = new Promise<void>((resolve, reject) => {
        releaseStage = resolve;
        rejectStage = reject;
      });
      const events: unknown[] = [];
      const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
      const completeTerminalPersistence = vi.fn(async () => undefined);
      const recordDisposition = vi.fn(
        async ({ outcome }: { readonly outcome: "provider_returned" | "provider_failed" }) => {
          if (pendingStage === "disposition" && outcome === "provider_returned") {
            await stagePending;
          }
        },
      );
      const recordCalleTerminal = vi.fn(async () => {
        if (pendingStage === "evidence") await stagePending;
      });
      const assertReady = vi.fn(async () => {
        if (pendingStage === "readiness") await stagePending;
        return {
          outcome: "ready" as const,
          dtmfActions: 0 as const,
          twilioReconciliation: "1 matching call" as const,
        };
      });
      const evidencePersistence = {
        persistAdmission: vi.fn(async () => {
          if (pendingStage === "admission") await stagePending;
        }),
      };
      const resultPersistence = {
        commitAtomically: vi.fn(async () => ({
          disposition: "committed" as const,
          winner: "observation_recorded" as const,
        })),
      };
      const evidenceCoordinator = {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(
          (
            _input: unknown,
            listener: (reason: "provider_failed" | "persistence_unavailable") => void,
          ) => {
            terminalListener = listener;
            return () => undefined;
          },
        ),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence,
        begin: vi.fn(),
        recordCalleTerminal,
        assertReady,
      };
      const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
      const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
        configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
        resolvedSecrets: {
          calleApiToken: "test-only-token",
          targetAddress: "test-only-synthetic-target",
        },
        ...enabledDependencies(events),
        runGate: { assertOpen: vi.fn() },
        evidencePersistence,
        resultPersistence,
        dispatchAttempts: {
          claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
            providerDispatchIdentity: `provider-dispatch-${operationId}`,
            adapterVersionId: "adapter-version-db",
          })),
          recordDisposition,
        },
        evidenceCoordinator,
        terminalAttempts,
        dispatch,
      }) as { execute(input: unknown): Promise<unknown> };
      const execution = executeInput(`operation-pending-${pendingStage}`);
      const stageSpy =
        pendingStage === "disposition"
          ? recordDisposition
          : pendingStage === "evidence"
            ? recordCalleTerminal
            : pendingStage === "readiness"
              ? assertReady
              : evidencePersistence.persistAdmission;
      let settled: unknown;
      const pending = runner.execute(execution).then((result) => {
        settled = result;
        return result;
      });

      try {
        await vi.waitFor(() => expect(stageSpy).toHaveBeenCalledOnce());
        terminalListener?.("provider_failed");
        await vi.waitFor(() => expect(settled).toBeDefined(), { timeout: 50, interval: 1 });

        await expect(pending).resolves.toEqual({
          status: "failed",
          reason: "provider_failed",
          retryable: false,
          authorizationConsumed: true,
        });
        await expect(runner.execute(execution)).resolves.toEqual(settled);
        expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
        expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
          operationId: execution.operationId,
          outcome: "provider_failed",
          retryable: false,
        });
        expect(completeTerminalPersistence).toHaveBeenCalledOnce();
        expect(dispatch).toHaveBeenCalledOnce();
        expect(recordDisposition.mock.calls).toEqual([
          [{ operationId: execution.operationId, outcome: "provider_returned" }],
        ]);
      } finally {
        if (pendingStage === "disposition") {
          rejectStage?.(new Error("protected late disposition detail"));
        } else {
          releaseStage?.();
        }
        await Promise.allSettled([pending]);
      }

      expect(resultPersistence.commitAtomically).not.toHaveBeenCalled();
      expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
      expect(JSON.stringify({ settled, events })).not.toContain(
        "protected late disposition detail",
      );
    },
  );

  it("awaits the durable commit and lets an observation win a later terminal signal", async () => {
    const api = await loadSimulatorApi();
    let terminalListener:
      ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
    let releaseCommit: (() => void) | undefined;
    const commitRelease = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let reportBarrierPassed: (() => void) | undefined;
    const barrierPassed = new Promise<void>((resolve) => {
      reportBarrierPassed = resolve;
    });
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const settle = vi.fn(() => "runner" as const);
    const resultPersistence = {
      commitAtomically: vi.fn(async (_input: unknown, canCommit: () => boolean) => {
        expect(canCommit()).toBe(true);
        reportBarrierPassed?.();
        await commitRelease;
        return {
          disposition: "committed" as const,
          winner: "observation_recorded" as const,
        };
      }),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(
          (
            _input: unknown,
            listener: (reason: "provider_failed" | "persistence_unavailable") => void,
          ) => {
            terminalListener = listener;
            return () => undefined;
          },
        ),
        settle,
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin: vi.fn(),
        recordCalleTerminal: vi.fn(async () => undefined),
        assertReady: vi.fn(async () => ({
          outcome: "ready" as const,
          dtmfActions: 0 as const,
          twilioReconciliation: "1 matching call" as const,
        })),
      },
      terminalAttempts,
      resultPersistence,
      dispatch: vi.fn(async () => completedCalleOutput("71.5")),
    }) as { execute(input: unknown): Promise<unknown> };
    let settled = false;
    const pending = runner
      .execute(executeInput("operation-result-wins-after-barrier"))
      .finally(() => {
        settled = true;
      });

    await barrierPassed;
    terminalListener?.("provider_failed");
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCommit?.();

    await expect(pending).resolves.toMatchObject({ status: "completed" });
    expect(terminalAttempts.recordFailure).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
  });

  it("awaits a blocked transaction before persisting the first terminal signal", async () => {
    const api = await loadSimulatorApi();
    let terminalListener:
      ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
    let releaseCommit: (() => void) | undefined;
    const commitRelease = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let reportCommitStarted: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      reportCommitStarted = resolve;
    });
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const resultPersistence = {
      commitAtomically: vi.fn(async (_input: unknown, canCommit: () => boolean) => {
        reportCommitStarted?.();
        await commitRelease;
        return canCommit()
          ? {
              disposition: "committed" as const,
              winner: "observation_recorded" as const,
            }
          : { disposition: "blocked" as const };
      }),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(
          (
            _input: unknown,
            listener: (reason: "provider_failed" | "persistence_unavailable") => void,
          ) => {
            terminalListener = listener;
            return () => undefined;
          },
        ),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin: vi.fn(),
        recordCalleTerminal: vi.fn(async () => undefined),
        assertReady: vi.fn(async () => ({
          outcome: "ready" as const,
          dtmfActions: 0 as const,
          twilioReconciliation: "1 matching call" as const,
        })),
      },
      terminalAttempts,
      resultPersistence,
      dispatch: vi.fn(async () => completedCalleOutput("71.5")),
    }) as { execute(input: unknown): Promise<unknown> };
    let settled = false;
    const execution = executeInput("operation-terminal-wins-before-barrier");
    const pending = runner.execute(execution).finally(() => {
      settled = true;
    });

    await commitStarted;
    terminalListener?.("provider_failed");
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCommit?.();

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "provider_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
  });

  it("preserves the first terminal signal when the awaited result transaction later rejects", async () => {
    const api = await loadSimulatorApi();
    const PersistenceError = api["LiveSmokeResultPersistenceError"] as unknown as new (
      reason: "application_persistence_failed",
    ) => Error;
    let terminalListener:
      ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
    let releaseCommit: (() => void) | undefined;
    const commitRelease = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let reportCommitStarted: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      reportCommitStarted = resolve;
    });
    const terminalAttempts = {
      recordFailure: vi.fn(async () => ({ terminalOutcome: "provider_failed" as const })),
    };
    const resultPersistence = {
      commitAtomically: vi.fn(async () => {
        reportCommitStarted?.();
        await commitRelease;
        throw new PersistenceError("application_persistence_failed");
      }),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(
          (
            _input: unknown,
            listener: (reason: "provider_failed" | "persistence_unavailable") => void,
          ) => {
            terminalListener = listener;
            return () => undefined;
          },
        ),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin: vi.fn(),
        recordCalleTerminal: vi.fn(async () => undefined),
        assertReady: vi.fn(async () => ({
          outcome: "ready" as const,
          dtmfActions: 0 as const,
          twilioReconciliation: "1 matching call" as const,
        })),
      },
      terminalAttempts,
      resultPersistence,
      dispatch: vi.fn(async () => completedCalleOutput("71.5")),
    }) as { execute(input: unknown): Promise<unknown> };
    let settled = false;
    const execution = executeInput("operation-terminal-signal-before-result-rejection");
    const pending = runner.execute(execution).finally(() => {
      settled = true;
    });

    await commitStarted;
    terminalListener?.("provider_failed");
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCommit?.();

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "provider_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "provider_failed",
      retryable: false,
    });
  });

  it("does not claim or dispatch when the coordinator already owns terminal persistence", async () => {
    const api = await loadSimulatorApi();
    let releaseCompletion: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    const dispatchClaim = vi.fn();
    const dispatch = vi.fn();
    const completeTerminalPersistence = vi.fn(async () => await completion);
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      dispatchAttempts: { claim: dispatchClaim },
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "coordinator" as const),
        onTerminal: vi.fn(
          (
            _input: unknown,
            listener: (reason: "provider_failed" | "persistence_unavailable") => void,
          ) => {
            listener("provider_failed");
            return () => undefined;
          },
        ),
        settle: vi.fn(() => "coordinator" as const),
        completeTerminalPersistence,
        begin: vi.fn(),
        recordCalleTerminal: vi.fn(),
        assertReady: vi.fn(),
      },
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    let settled = false;
    const pending = runner
      .execute(executeInput("operation-coordinator-owned-before-dispatch"))
      .finally(() => {
        settled = true;
      });

    await vi.waitFor(() => expect(completeTerminalPersistence).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(dispatchClaim).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    releaseCompletion?.();

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      reason: "provider_failed",
    });
  });

  it("keeps one runner deadline active through readiness and the result transaction", async () => {
    vi.useFakeTimers();
    try {
      const api = await loadSimulatorApi();
      let releaseCommit: (() => void) | undefined;
      const commitRelease = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      let reportCommitStarted: (() => void) | undefined;
      const commitStarted = new Promise<void>((resolve) => {
        reportCommitStarted = resolve;
      });
      const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
      const resultPersistence = {
        commitAtomically: vi.fn(async (_input: unknown, canCommit: () => boolean) => {
          reportCommitStarted?.();
          await commitRelease;
          return canCommit()
            ? {
                disposition: "committed" as const,
                winner: "observation_recorded" as const,
              }
            : { disposition: "blocked" as const };
        }),
      };
      const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
        configuration: { ...enabledConfiguration(20), requireCallbackEvidence: true },
        resolvedSecrets: {
          calleApiToken: "test-only-token",
          targetAddress: "test-only-synthetic-target",
        },
        ...enabledDependencies(),
        runGate: { assertOpen: vi.fn() },
        evidenceCoordinator: {
          claimTerminalPersistence: vi.fn(() => "runner" as const),
          onTerminal: vi.fn(() => () => undefined),
          settle: vi.fn(() => "runner" as const),
          completeTerminalPersistence: vi.fn(async () => undefined),
          begin: vi.fn(),
          recordCalleTerminal: vi.fn(async () => undefined),
          assertReady: vi.fn(async () => ({
            outcome: "ready" as const,
            dtmfActions: 0 as const,
            twilioReconciliation: "1 matching call" as const,
          })),
        },
        terminalAttempts,
        resultPersistence,
        dispatch: vi.fn(async () => completedCalleOutput("71.5")),
      }) as { execute(input: unknown): Promise<unknown> };
      let settled = false;
      const pending = runner
        .execute(executeInput("operation-post-readiness-deadline"))
        .finally(() => {
          settled = true;
        });

      await commitStarted;
      await vi.advanceTimersByTimeAsync(20);
      expect(settled).toBe(false);
      releaseCommit?.();

      await expect(pending).resolves.toEqual({
        status: "failed",
        reason: "application_persistence_failed",
        retryable: false,
        authorizationConsumed: true,
      });
      expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("interrupts a pending dispatch claim without starting provider dispatch", async () => {
    const api = await loadSimulatorApi();
    let terminalListener:
      ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
    let releaseClaim: (() => void) | undefined;
    const claimRelease = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    let reportClaimStarted: (() => void) | undefined;
    const claimStarted = new Promise<void>((resolve) => {
      reportClaimStarted = resolve;
    });
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const dispatch = vi.fn();
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => {
          reportClaimStarted?.();
          await claimRelease;
          return {
            providerDispatchIdentity: `provider-dispatch-${operationId}`,
            adapterVersionId: "adapter-version-db",
          };
        }),
      },
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(
          (
            _input: unknown,
            listener: (reason: "provider_failed" | "persistence_unavailable") => void,
          ) => {
            terminalListener = listener;
            return () => undefined;
          },
        ),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin: vi.fn(),
        recordCalleTerminal: vi.fn(),
        assertReady: vi.fn(),
      },
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const pending = runner.execute(executeInput("operation-pending-dispatch-claim"));

    try {
      await claimStarted;
      terminalListener?.("provider_failed");
      await expect(pending).resolves.toMatchObject({
        status: "failed",
        reason: "provider_failed",
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
    } finally {
      releaseClaim?.();
      await Promise.allSettled([pending]);
    }
  });

  it("preserves the first terminal signal when a pending evidence operation rejects in the same turn", async () => {
    const api = await loadSimulatorApi();
    const EvidencePersistenceError = api[
      "LiveSmokeEvidencePersistenceError"
    ] as unknown as new () => Error;
    let terminalListener:
      ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
    let rejectEvidence: ((error: Error) => void) | undefined;
    const evidencePending = new Promise<void>((_resolve, reject) => {
      rejectEvidence = reject;
    });
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const recordCalleTerminal = vi.fn(async () => await evidencePending);
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(
          (
            _input: unknown,
            listener: (reason: "provider_failed" | "persistence_unavailable") => void,
          ) => {
            terminalListener = listener;
            return () => undefined;
          },
        ),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin: vi.fn(),
        recordCalleTerminal,
        assertReady: vi.fn(),
      },
      terminalAttempts,
      dispatch: vi.fn(async () => completedCalleOutput("71.5")),
    }) as { execute(input: unknown): Promise<unknown> };
    const pending = runner.execute(executeInput("operation-first-terminal-signal"));

    await vi.waitFor(() => expect(recordCalleTerminal).toHaveBeenCalledOnce());
    terminalListener?.("provider_failed");
    rejectEvidence?.(new EvidencePersistenceError());

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      reason: "provider_failed",
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "provider_failed" }),
    );
  });

  it("maps signed callback fact persistence failure to cached application persistence failure", async () => {
    const api = await loadSimulatorApi();
    let terminalListener:
      ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
    let releaseProvider: ((output: unknown) => void) | undefined;
    const providerPending = new Promise<unknown>((resolve) => {
      releaseProvider = resolve;
    });
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const evidenceCoordinator = {
      claimTerminalPersistence: vi.fn(() => "runner" as const),
      onTerminal: vi.fn(
        (
          _input: unknown,
          listener: (reason: "provider_failed" | "persistence_unavailable") => void,
        ) => {
          terminalListener = listener;
          return () => undefined;
        },
      ),
      settle: vi.fn(() => "runner" as const),
      completeTerminalPersistence: vi.fn(async () => undefined),
      begin: vi.fn(),
      recordCalleTerminal: vi.fn(async () => undefined),
      assertReady: vi.fn(async () => ({ outcome: "blocked", reason: "incomplete" }) as const),
    };
    const dispatch = vi.fn(async () => await providerPending);
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        })),
        recordDisposition: vi.fn(async () => undefined),
      },
      evidenceCoordinator,
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-callback-persistence-signal");
    let settled: unknown;
    const pending = runner.execute(execution).then((result) => {
      settled = result;
      return result;
    });

    try {
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
      terminalListener?.("persistence_unavailable");
      await vi.waitFor(() => expect(settled).toBeDefined(), { timeout: 50, interval: 1 });

      await expect(pending).resolves.toEqual({
        status: "failed",
        reason: "application_persistence_failed",
        retryable: false,
        authorizationConsumed: true,
      });
      await expect(runner.execute(execution)).resolves.toEqual(settled);
      expect(terminalAttempts.recordFailure).toHaveBeenCalledOnce();
      expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
        operationId: execution.operationId,
        outcome: "evidence_unavailable",
        retryable: false,
      });
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      releaseProvider?.(completedCalleOutput("71.5"));
      await Promise.allSettled([pending]);
    }
  });

  it("keeps DTMF authoritative when it activates during the coordinator readiness wait", async () => {
    const api = await loadSimulatorApi();
    const safetyStop = (api["createDtmfSafetyStop"] as CallableFunction)() as {
      observe(form: Readonly<Record<string, string>>): unknown;
      isBlocked(): boolean;
      assertDispatchAllowed(): void;
      onBlocked(listener: () => void): () => void;
    };
    let resolveReadiness:
      ((result: Readonly<{ outcome: "blocked"; reason: "provider_failed" }>) => void) | undefined;
    const readiness = new Promise<Readonly<{ outcome: "blocked"; reason: "provider_failed" }>>(
      (resolve) => {
        resolveReadiness = resolve;
      },
    );
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const evidenceCoordinator = {
      claimTerminalPersistence: vi.fn(() => "runner" as const),
      onTerminal: vi.fn(() => () => undefined),
      settle: vi.fn(() => "runner" as const),
      completeTerminalPersistence: vi.fn(async () => undefined),
      begin: vi.fn(),
      recordCalleTerminal: vi.fn(async () => undefined),
      assertReady: vi.fn(async () => await readiness),
    };
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      runGate: { assertOpen: vi.fn() },
      dtmfSafetyStop: safetyStop,
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        })),
        recordDisposition: vi.fn(async () => undefined),
      },
      evidenceCoordinator,
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-dtmf-readiness-wait");

    const pending = runner.execute(execution);
    await vi.waitFor(() => expect(evidenceCoordinator.assertReady).toHaveBeenCalledOnce());
    safetyStop.observe({ Digits: "protected-dtmf-value" });
    resolveReadiness?.({ outcome: "blocked", reason: "provider_failed" });

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "dtmf_safety_stop",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "blocked",
      retryable: false,
    });
    expect(evidenceCoordinator.settle).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.stringify(terminalAttempts.recordFailure.mock.calls)).not.toContain(
      "protected-dtmf-value",
    );
  });

  it("preserves provider classification for non-persistence reconciliation failure", async () => {
    const api = await loadSimulatorApi();
    const events: unknown[] = [];
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: { ...enabledConfiguration(), requireCallbackEvidence: true },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(events),
      runGate: { assertOpen: vi.fn() },
      dispatchAttempts: {
        claim: vi.fn(async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        })),
        recordDisposition: vi.fn(async () => undefined),
      },
      evidenceCoordinator: {
        claimTerminalPersistence: vi.fn(() => "runner" as const),
        onTerminal: vi.fn(() => () => undefined),
        settle: vi.fn(() => "runner" as const),
        completeTerminalPersistence: vi.fn(async () => undefined),
        begin: vi.fn(),
        recordCalleTerminal: vi.fn(async () => undefined),
        assertReady: vi.fn(async () => {
          throw new Error("protected reconciliation transport detail");
        }),
      },
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };

    const result = await runner.execute(executeInput("operation-reconciliation-failed"));

    expect(result).toEqual({
      status: "failed",
      reason: "provider_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "provider_failed", retryable: false }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.stringify({ result, events })).not.toContain(
      "protected reconciliation transport detail",
    );
  });

  it("classifies post-provider admission persistence failure without exposing repository detail", async () => {
    const api = await loadSimulatorApi();
    const events: unknown[] = [];
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const claim = vi.fn(async ({ operationId }: { operationId: string }) => ({
      providerDispatchIdentity: `provider-dispatch-${operationId}`,
      adapterVersionId: "adapter-version-db",
    }));
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(events),
      evidencePersistence: {
        persistAdmission: vi.fn(async () => {
          throw new Error("protected admission repository detail");
        }),
      },
      dispatchAttempts: { claim, recordDisposition: vi.fn(async () => undefined) },
      terminalAttempts,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };
    const execution = executeInput("operation-admission-persistence-failed");

    const first = await runner.execute(execution);
    await expect(runner.execute(execution)).resolves.toEqual(first);

    expect(first).toEqual({
      status: "failed",
      reason: "application_persistence_failed",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: execution.operationId,
      outcome: "evidence_unavailable",
      retryable: false,
    });
    expect(claim).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.stringify({ first, events })).not.toContain(
      "protected admission repository detail",
    );
  });

  it("preserves DTMF precedence when the safety stop activates as result persistence rejects", async () => {
    const api = await loadSimulatorApi();
    const PersistenceError = api["LiveSmokeResultPersistenceError"] as unknown as new (
      reason: "evidence_timestamp_invalid",
    ) => Error;
    expect(PersistenceError).toBeTypeOf("function");
    const safetyStop = (api["createDtmfSafetyStop"] as CallableFunction)() as {
      observe(form: Readonly<Record<string, string>>): unknown;
      isBlocked(): boolean;
      assertDispatchAllowed(): void;
      onBlocked(listener: () => void): () => void;
    };
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const terminalAttempts = { recordFailure: vi.fn(async () => undefined) };
    const recordDisposition = vi.fn(async () => undefined);
    const resultPersistence = {
      commitAtomically: vi.fn(async () => {
        safetyStop.observe({ Digits: "protected-dtmf-value" });
        throw new PersistenceError("evidence_timestamp_invalid");
      }),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      ...enabledDependencies(),
      dispatchAttempts: {
        claim: async ({ operationId }: { operationId: string }) => ({
          providerDispatchIdentity: `provider-dispatch-${operationId}`,
          adapterVersionId: "adapter-version-db",
        }),
        recordDisposition,
      },
      terminalAttempts,
      dtmfSafetyStop: safetyStop,
      resultPersistence,
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(runner.execute(executeInput("operation-dtmf-result-failure"))).resolves.toEqual({
      status: "failed",
      reason: "dtmf_safety_stop",
      retryable: false,
      authorizationConsumed: true,
    });
    expect(recordDisposition).toHaveBeenCalledWith({
      operationId: "operation-dtmf-result-failure",
      outcome: "provider_returned",
    });
    expect(terminalAttempts.recordFailure).toHaveBeenCalledWith({
      operationId: "operation-dtmf-result-failure",
      outcome: "blocked",
      retryable: false,
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("maps actual CALL-E terminal facts separately from input-specific evidence and fails closed for null or contradictory readings", async () => {
    const api = await loadSimulatorApi();
    const mapTerminal = api["mapCalleTerminalOutput"] as CallableFunction;
    const context = {
      operationId: "operation-live-smoke",
      adapterVersionId: "calle-adapter-v1",
      simulationRunId: "run-mapping",
    };
    const mappingDependencies = {
      reviewedConfidenceTokens: ["provider-observed"],
      persistAdmission: async () => undefined,
    };
    const normal = (await mapTerminal(
      completedCalleOutput("71.5", "provider-call-normal"),
      context,
      mappingDependencies,
    )) as {
      readonly providerFacts: unknown;
      readonly result: { readonly candidates?: readonly { readonly value: string }[] | null };
    };
    const abnormal = (await mapTerminal(
      completedCalleOutput("91.25", "provider-call-abnormal"),
      context,
      mappingDependencies,
    )) as {
      readonly result: { readonly candidates?: readonly { readonly value: string }[] | null };
    };
    expect(normal.providerFacts).toEqual({
      providerCallId: "provider-call-normal",
      terminalStatus: "completed",
      observedAt: "2026-08-07T14:00:00.000Z",
    });
    expect(normal.result.candidates?.map(({ value }) => value)).toEqual([
      "71.5",
      "68.0",
      "68",
      "82",
    ]);
    expect(abnormal.result.candidates?.map(({ value }) => value)).toEqual([
      "91.25",
      "68.0",
      "68",
      "82",
    ]);

    const missing = await mapTerminal(
      {
        providerCallId: "provider-call-missing",
        terminalStatus: "completed",
        observedAt: "2026-08-07T14:00:00.000Z",
        evidence: null,
      },
      context,
      mappingDependencies,
    );
    expect(missing).toMatchObject({
      providerFacts: { terminalStatus: "completed" },
      result: { kind: "terminal_failure", outcome: "evidence_unavailable", retryable: false },
    });

    const ambiguous = completedCalleOutput("71.5", "provider-call-ambiguous");
    ambiguous.evidence.readings[0]!.status = "UNKNOWN";
    await expect(mapTerminal(ambiguous, context, mappingDependencies)).resolves.toMatchObject({
      result: { kind: "evidence", sourceCompleteness: "unknown", candidates: null },
    });
  });

  it("preserves percent-symbol anchors and selects only the reviewed symbol mapping", async () => {
    const api = await loadSimulatorApi();
    const mapTerminal = api["mapCalleTerminalOutput"] as CallableFunction;
    const context = {
      operationId: "operation-percent-symbol",
      adapterVersionId: "calle-adapter-v1",
      simulationRunId: "run-percent-symbol",
    };
    const admissions: unknown[] = [];
    const dependencies = {
      reviewedConfidenceTokens: ["provider-observed"],
      persistAdmission: async (admission: unknown) => admissions.push(admission),
    };
    const percentSymbol = completedCalleOutput("71.5", "provider-call-percent-symbol");
    percentSymbol.evidence.readings[2]!.sourceAnchor.spokenUnitToken = "%";
    percentSymbol.evidence.readings[3]!.sourceAnchor.spokenUnitToken = "%";

    await expect(mapTerminal(percentSymbol, context, dependencies)).resolves.toMatchObject({
      result: {
        admittedAnchors: [
          expect.any(Object),
          expect.any(Object),
          { spokenUnitToken: "%" },
          { spokenUnitToken: "%" },
        ],
        candidates: [
          expect.any(Object),
          expect.any(Object),
          {
            spokenUnit: "%",
            normalizedUnit: "percent",
            unitMappingRuleId: "calle-provider-percent-symbol.v1",
          },
          {
            spokenUnit: "%",
            normalizedUnit: "percent",
            unitMappingRuleId: "calle-provider-percent-symbol.v1",
          },
        ],
      },
    });
    expect(admissions).toHaveLength(1);
    expect(admissions[0]).toMatchObject({
      evidence: {
        readings: [
          expect.any(Object),
          expect.any(Object),
          { sourceAnchor: { spokenUnitToken: "%" } },
          { sourceAnchor: { spokenUnitToken: "%" } },
        ],
      },
    });

    const unsupported = completedCalleOutput("71.5", "provider-call-unsupported-unit");
    unsupported.evidence.readings[2]!.sourceAnchor.spokenUnitToken = "pct";
    await expect(mapTerminal(unsupported, context, dependencies)).resolves.toMatchObject({
      result: {
        candidates: [
          expect.any(Object),
          expect.any(Object),
          { spokenUnit: "pct", normalizedUnit: "percent", unitMappingRuleId: null },
          expect.any(Object),
        ],
      },
    });
  });

  it("requires atomic exact-claim authorization reservation before provider creation", async () => {
    const api = await loadSimulatorApi();
    const createRunner = api["createLiveSmokeRunner"] as CallableFunction;
    let dispatches = 0;
    const base = {
      configuration: {
        ...enabledConfiguration(),
        authorizationAudience: "muster-live-smoke",
      },
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      evidencePersistence: { persistAdmission: async () => undefined },
      terminalAttempts: { recordFailure: async () => undefined },
      dispatchAttempts: enabledDependencies().dispatchAttempts,
      dtmfSafetyStop: enabledDependencies().dtmfSafetyStop,
      reviewedConfidenceTokens: ["provider-observed"],
      observability: {
        establishTraceContext: (traceContext: unknown) => traceContext,
        record: () => undefined,
      },
      dispatch: async () => {
        dispatches += 1;
        return completedCalleOutput("71.5");
      },
    };
    const absent = createRunner(base) as { execute(input: unknown): Promise<unknown> };
    await expect(absent.execute(executeInput("run-no-authorization-store"))).resolves.toMatchObject(
      {
        status: "blocked",
        reason: "authorization_store_unavailable",
      },
    );
    expect(dispatches).toBe(0);

    const reservations: unknown[] = [];
    const authorized = createRunner({
      ...base,
      authorizationBoundary: {
        reserve: async (input: unknown) => {
          reservations.push(input);
          return "reserved";
        },
      },
    }) as { execute(input: unknown): Promise<unknown> };
    await expect(authorized.execute(executeInput("run-exact-claims"))).resolves.toMatchObject({
      status: "completed",
    });
    expect(reservations).toEqual([
      {
        token: "signed-run-exact-claims",
        runId: "run-exact-claims",
        scenarioId: "synthetic-normal",
        scenarioRevision: 1,
        audience: "muster-live-smoke",
        endpointAlias: "synthetic-demo-endpoint",
      },
    ]);
    expect(dispatches).toBe(1);
  });

  it("rejects a reused run ID when any semantic request field changes", async () => {
    const api = await loadSimulatorApi();
    let dispatches = 0;
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: {
        ...enabledConfiguration(),
        authorizationAudience: "muster-live-smoke",
      },
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      authorizationBoundary: { reserve: async () => "reserved" },
      evidencePersistence: { persistAdmission: async () => undefined },
      terminalAttempts: { recordFailure: async () => undefined },
      dispatchAttempts: enabledDependencies().dispatchAttempts,
      dtmfSafetyStop: enabledDependencies().dtmfSafetyStop,
      reviewedConfidenceTokens: ["provider-observed"],
      observability: {
        establishTraceContext: (traceContext: unknown) => traceContext,
        record: () => undefined,
      },
      dispatch: async () => {
        dispatches += 1;
        return completedCalleOutput("71.5");
      },
    }) as { execute(input: unknown): Promise<unknown> };
    const canonical = executeInput("run-semantic-replay");
    await expect(runner.execute(canonical)).resolves.toMatchObject({ status: "completed" });
    await expect(runner.execute({ ...canonical, scenarioRevision: 2 })).resolves.toMatchObject({
      status: "blocked",
      reason: "semantic_replay_conflict",
    });
    expect(dispatches).toBe(1);
  });

  it("rejects unknown CALL-E statuses, fields, completeness values, and malformed evidence", async () => {
    const api = await loadSimulatorApi();
    const mapTerminal = api["mapCalleTerminalOutput"] as CallableFunction;
    const context = {
      operationId: "operation-hostile-provider",
      adapterVersionId: "calle-adapter-v1",
      simulationRunId: "run-hostile-provider",
    };
    const dependencies = {
      reviewedConfidenceTokens: ["provider-observed"],
      persistAdmission: async () => undefined,
    };
    const valid = completedCalleOutput("71.5");
    const hostile = [
      { ...valid, terminalStatus: "mystery" },
      { ...valid, unexpected: "field" },
      { ...valid, observedAt: "not-rfc3339" },
      { ...valid, observedAt: "2026-02-30T14:00:00.000Z" },
      { ...valid, evidence: { ...valid.evidence, sourceCompleteness: "mostly" } },
      {
        ...valid,
        evidence: {
          ...valid.evidence,
          readings: [{ ...valid.evidence.readings[0], value: "not-a-decimal" }],
        },
      },
    ];
    for (const value of hostile) {
      await expect(Promise.resolve(mapTerminal(value, context, dependencies))).rejects.toThrow(
        /^Invalid CALL-E output:/u,
      );
    }
  });

  it("normalizes valid microsecond timestamps and admits provider transcript turns over 256 characters", async () => {
    const api = await loadSimulatorApi();
    const mapTerminal = api["mapCalleTerminalOutput"] as CallableFunction;
    const valid = completedCalleOutput("71.5");

    await expect(
      mapTerminal(
        { ...valid, observedAt: "2026-08-07T14:00:00.123456Z" },
        {
          operationId: "operation-provider-shape",
          adapterVersionId: "calle-adapter-v1",
          simulationRunId: "run-provider-shape",
        },
        {
          reviewedConfidenceTokens: ["provider-observed"],
          persistAdmission: async () => undefined,
        },
      ),
    ).resolves.toMatchObject({
      providerFacts: { observedAt: "2026-08-07T14:00:00.123Z" },
      result: { kind: "evidence" },
    });
  });

  it("fails closed with zero dispatch for every non-reserved real authorization outcome", async () => {
    const api = await loadSimulatorApi();
    const createBoundary = api["createRunAuthorizationReservationBoundary"] as CallableFunction;
    const createRunner = api["createLiveSmokeRunner"] as CallableFunction;
    const issue = api["issueRunAuthorization"] as CallableFunction;
    const signingKey = "test-only-run-authorization-signing-key-32-bytes";
    const issueStore = {
      issue: async (input: { readonly operationId: string }) => ({
        outcome: "issued" as const,
        operationId: input.operationId,
      }),
    };
    const authorization = (await issue({
      runId: "run-real-boundary",
      scenarioId: "synthetic-normal",
      scenarioRevision: 1,
      endpointAlias: "synthetic-demo-endpoint",
      audience: "muster-live-smoke",
      signingKey,
      nonce: "nonce-real-boundary",
      nowEpochSeconds: 1_786_000_000,
      ttlSeconds: 30,
      organizationId,
      authorizationIssuer: issueStore,
      authorizedTargetDigest: "b".repeat(64),
      publicOrigin: "https://synthetic.invalid",
      purpose: "non-production-synthetic-live-smoke",
      callBudget: 1,
      concurrency: 1,
      retryBudget: 0,
      dtmfPolicy: "forbidden",
      terminalDeadlineSeconds: 120,
    })) as { readonly token: string };
    for (const disposition of ["missing", "expired", "conflict", "throws"] as const) {
      let dispatches = 0;
      const boundary = createBoundary({
        signingKey,
        audience: "muster-live-smoke",
        endpointAlias: "synthetic-demo-endpoint",
        organizationId,
        authorizedTargetDigest: "b".repeat(64),
        publicOrigin: "https://synthetic.invalid",
        authorizationReservations: {
          reserve: async () => {
            if (disposition === "throws") throw new Error("durable store unavailable");
            return disposition === "replayed"
              ? { outcome: disposition, operationId: "run-real-boundary" }
              : { outcome: disposition };
          },
        },
        nowEpochSeconds: () => 1_786_000_001,
      });
      const runner = createRunner({
        configuration: enabledConfiguration(),
        resolvedSecrets: {
          calleApiToken: "resolved-test-token",
          targetAddress: "resolved-synthetic-target",
        },
        authorizationBoundary: boundary,
        evidencePersistence: { persistAdmission: async () => undefined },
        terminalAttempts: { recordFailure: async () => undefined },
        dispatchAttempts: enabledDependencies().dispatchAttempts,
        dtmfSafetyStop: enabledDependencies().dtmfSafetyStop,
        reviewedConfidenceTokens: ["provider-observed"],
        observability: enabledDependencies().observability,
        dispatch: async () => {
          dispatches += 1;
          return completedCalleOutput("71.5");
        },
      }) as { execute(input: unknown): Promise<unknown> };
      await expect(
        runner.execute({
          ...executeInput("run-real-boundary"),
          runAuthorization: authorization.token,
        }),
      ).resolves.toMatchObject({
        status: "blocked",
        reason:
          disposition === "throws" ? "authorization_store_unavailable" : "authorization_rejected",
      });
      expect(dispatches).toBe(0);
    }
  });

  it("persists admitted provider evidence before deriving only reviewed-confidence candidates", async () => {
    const api = await loadSimulatorApi();
    const mapTerminal = api["mapCalleTerminalOutput"] as CallableFunction;
    const context = {
      operationId: "operation-persistence-order",
      adapterVersionId: "calle-adapter-v1",
      simulationRunId: "run-persistence-order",
    };
    const admissions: unknown[] = [];
    const dependencies = {
      reviewedConfidenceTokens: ["reviewed-confidence"],
      persistAdmission: async (admission: unknown) => admissions.push(admission),
    };
    const unreviewed = (await mapTerminal(completedCalleOutput("71.5"), context, dependencies)) as {
      readonly result: {
        readonly candidates: readonly unknown[] | null;
        readonly confidencePolicy: { readonly acceptableTokens: readonly string[] };
      };
    };
    expect(admissions).toHaveLength(1);
    expect(JSON.stringify(admissions[0])).not.toContain("candidates");
    expect(unreviewed.result).toMatchObject({
      candidates: null,
      confidencePolicy: { acceptableTokens: ["reviewed-confidence"] },
    });

    const reviewedOutput = completedCalleOutput("71.5");
    for (const reading of reviewedOutput.evidence.readings) {
      reading.confidenceToken = "reviewed-confidence";
    }
    const reviewed = (await mapTerminal(reviewedOutput, context, dependencies)) as {
      readonly result: { readonly candidates: readonly unknown[] | null };
    };
    expect(admissions).toHaveLength(2);
    expect(reviewed.result.candidates).toHaveLength(4);
  });

  it("carries the database-authoritative adapter version through admission and mapped readings", async () => {
    const api = await loadSimulatorApi();
    const admissions: unknown[] = [];
    const resultPersistence = {
      commitAtomically: vi.fn(async (_input: unknown, canCommit: () => boolean) =>
        canCommit()
          ? {
              disposition: "committed" as const,
              winner: "observation_recorded" as const,
            }
          : { disposition: "blocked" as const },
      ),
    };
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      dispatchAttempts: {
        claim: async () => ({
          providerDispatchIdentity: "provider-dispatch-db",
          adapterVersionId: "adapter-version-db",
        }),
      },
      evidencePersistence: {
        persistAdmission: async (admission: unknown) => admissions.push(admission),
      },
      resultPersistence,
      dispatch: async () => completedCalleOutput("71.5"),
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(runner.execute(executeInput("operation-adapter-version"))).resolves.toMatchObject({
      status: "completed",
      mapped: {
        result: {
          candidates: [
            expect.objectContaining({ adapterVersionId: "adapter-version-db" }),
            expect.objectContaining({ adapterVersionId: "adapter-version-db" }),
            expect.objectContaining({ adapterVersionId: "adapter-version-db" }),
            expect.objectContaining({ adapterVersionId: "adapter-version-db" }),
          ],
        },
      },
    });
    expect(admissions).toEqual([
      expect.objectContaining({
        operationId: "operation-adapter-version",
        adapterVersionId: "adapter-version-db",
      }),
    ]);
    expect(resultPersistence.commitAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          candidates: expect.arrayContaining([
            expect.objectContaining({ adapterVersionId: "adapter-version-db" }),
          ]),
        }),
      }),
      expect.any(Function),
    );
  });

  it("requires trace-correlated observability for every enabled gate, dispatch, persistence, and terminal event", async () => {
    const api = await loadSimulatorApi();
    const createRunner = api["createLiveSmokeRunner"] as CallableFunction;
    let dispatches = 0;
    const base = {
      configuration: {
        ...enabledConfiguration(),
        authorizationAudience: "muster-live-smoke",
      },
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      authorizationBoundary: { reserve: async () => "reserved" },
      evidencePersistence: { persistAdmission: async () => undefined },
      terminalAttempts: { recordFailure: async () => undefined },
      dispatchAttempts: enabledDependencies().dispatchAttempts,
      dtmfSafetyStop: enabledDependencies().dtmfSafetyStop,
      reviewedConfidenceTokens: ["provider-observed"],
      dispatch: async () => {
        dispatches += 1;
        return completedCalleOutput("71.5");
      },
    };
    const missing = createRunner(base) as { execute(input: unknown): Promise<unknown> };
    await expect(missing.execute(executeInput("run-no-observability"))).resolves.toMatchObject({
      status: "blocked",
      reason: "observability_unavailable",
    });
    expect(dispatches).toBe(0);

    const events: unknown[] = [];
    const traced = createRunner({
      ...base,
      observability: {
        establishTraceContext: (traceContext: unknown) => traceContext,
        record: (event: unknown) => events.push(event),
      },
    }) as { execute(input: unknown): Promise<unknown> };
    await expect(traced.execute(executeInput("run-observed"))).resolves.toMatchObject({
      status: "completed",
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "gate_passed", traceId: expect.any(String) }),
        expect.objectContaining({ outcome: "authorization_reserved", traceId: expect.any(String) }),
        expect.objectContaining({ outcome: "dispatch_attempted", traceId: expect.any(String) }),
        expect.objectContaining({ outcome: "evidence_persisted", traceId: expect.any(String) }),
        expect.objectContaining({ outcome: "completed", traceId: expect.any(String) }),
      ]),
    );
    expect(JSON.stringify(events)).not.toMatch(
      /run-observed|signed-run|resolved-test|synthetic-target|provider-call/iu,
    );
  });

  it("keeps throwing event and span telemetry from changing or duplicating a live dispatch", async () => {
    const api = await loadSimulatorApi();
    const dispatch = vi.fn(async () => completedCalleOutput("71.5"));
    const runJobSpan = vi.fn(async (operation: () => Promise<unknown>): Promise<unknown> => {
      await operation();
      await operation();
      throw new Error("job tracing unavailable");
    });
    const runProviderSpan = vi.fn(async (operation: () => Promise<unknown>): Promise<unknown> => {
      await operation();
      await operation();
      throw new Error("provider tracing unavailable");
    });
    const runner = (api["createLiveSmokeRunner"] as CallableFunction)({
      configuration: enabledConfiguration(),
      resolvedSecrets: {
        calleApiToken: "resolved-test-token",
        targetAddress: "resolved-synthetic-target",
      },
      ...enabledDependencies(),
      observability: {
        establishTraceContext: () => {
          throw new Error("trace context unavailable");
        },
        record: () => {
          throw new Error("event telemetry unavailable");
        },
        runJobSpan,
        runProviderSpan,
      },
      dispatch,
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(runner.execute(executeInput("run-throwing-telemetry"))).resolves.toMatchObject({
      status: "completed",
      authorizationConsumed: true,
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(runJobSpan).toHaveBeenCalledOnce();
    expect(runProviderSpan).toHaveBeenCalledOnce();
  });
});
