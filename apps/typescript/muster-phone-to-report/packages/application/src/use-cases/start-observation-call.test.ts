import { describe, expect, it } from "vitest";

import { CallAttempt, EndpointObservationProfile, OrganizationId } from "@muster/domain";

function profile(organizationId: string, endpointId: string): EndpointObservationProfile {
  return EndpointObservationProfile.create({
    endpointId,
    organizationId: OrganizationId.create(organizationId),
    adapterVersionId: "adapter_start_v1",
    expectedZones: [
      {
        zoneId: "zone-01",
        ordinal: 0,
        applicability: "required",
        requiredFacet: "measurement",
        allowedUnitMappings: [
          {
            ruleId: "fahrenheit-v1",
            spokenUnit: "degrees fahrenheit",
            normalizedUnit: "degF",
          },
        ],
      },
    ],
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: "authorization_start",
  });
}

describe("StartObservationCall", () => {
  it("returns the terminal CAS winner before constructing or calling the provider", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const observationProfile = profile("org_claim_race", "endpoint_claim_race");
    const attempts = new testing.FakeCallAttemptRepository();
    const scheduled = CallAttempt.establish({
      id: "operation_claim_race",
      organizationId: observationProfile.organizationId,
      endpointId: observationProfile.endpointId,
      adapterVersionId: observationProfile.adapterVersionId,
      trigger: "scheduled",
      provenance: "SIMULATED",
      semanticFingerprint: "fingerprint_claim_race",
      providerDispatchIdentity: "provider_dispatch_claim_race",
      acceptedAt: "2026-08-06T15:10:00.000Z",
    });
    attempts.seed(scheduled, "idempotency_claim_race");
    const terminalWinner = scheduled.transitionToTerminal({
      outcome: "provider_failed",
      retryable: false,
      transitionedAt: "2026-08-06T15:10:01.000Z",
    });
    attempts.recordCalling = async () =>
      Object.freeze({ outcome: "replayed" as const, value: terminalWinner });
    const providerFactory = new testing.FakeVoiceCallPortFactory({
      kind: "terminal_failure",
      outcome: "provider_failed",
      retryable: false,
    });
    let recordResultCalls = 0;
    const useCase = new application.StartObservationCall({
      attempts,
      profiles: new testing.FakeObservationProfileRepository([observationProfile]),
      policy: new testing.FakeObservationDispatchPolicy({ outcome: "allowed" }),
      providerFactory,
      clock: new testing.FakeClock("2026-08-06T15:10:01.000Z"),
      recordResult: {
        execute: async () => {
          recordResultCalls += 1;
          throw new Error("result recorder must not run after a terminal CAS replay");
        },
      },
    });

    const result = await useCase.execute({
      organizationId: observationProfile.organizationId,
      operationId: scheduled.id,
      correlationId: "correlation_claim_race",
    });

    expect(result.toValue()).toEqual(terminalWinner.toValue());
    expect(providerFactory.constructionCount).toBe(0);
    expect(providerFactory.port.dispatches).toHaveLength(0);
    expect(recordResultCalls).toBe(0);
  });

  it("blocks profile loss and every closed policy reason after calling without invoking the provider", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const blockReasons = [
      "ineligible_profile",
      "authorization_inactive",
      "dtmf_not_approved",
      "capacity_unavailable",
      "kill_switch_active",
      "provider_binding_unapproved",
    ] as const;
    const cases = ["profile_unavailable", ...blockReasons] as const;

    for (const [index, blockedCase] of cases.entries()) {
      const observationProfile = profile(
        `org_calling_block_${String(index)}`,
        `endpoint_calling_block_${String(index)}`,
      );
      const attempts = new testing.FakeCallAttemptRepository();
      const operationId = `operation_calling_block_${String(index)}`;
      attempts.seed(
        CallAttempt.establish({
          id: operationId,
          organizationId: observationProfile.organizationId,
          endpointId: observationProfile.endpointId,
          adapterVersionId: observationProfile.adapterVersionId,
          trigger: "scheduled",
          provenance: "SIMULATED",
          semanticFingerprint: `fingerprint_calling_block_${String(index)}`,
          providerDispatchIdentity: `provider_dispatch_calling_block_${String(index)}`,
          acceptedAt: "2026-08-06T15:20:00.000Z",
        }).transitionToCalling("2026-08-06T15:20:01.000Z"),
        `idempotency_calling_block_${String(index)}`,
      );
      const providerFactory = new testing.FakeVoiceCallPortFactory({
        kind: "terminal_failure",
        outcome: "provider_failed",
        retryable: false,
      });
      const useCase = new application.StartObservationCall({
        attempts,
        profiles: new testing.FakeObservationProfileRepository(
          blockedCase === "profile_unavailable" ? [] : [observationProfile],
        ),
        policy: new testing.FakeObservationDispatchPolicy(
          blockedCase === "profile_unavailable"
            ? { outcome: "allowed" }
            : { outcome: "blocked", reason: blockedCase },
        ),
        providerFactory,
        clock: new testing.FakeClock("2026-08-06T15:20:02.000Z"),
        recordResult: {
          execute: async () => {
            throw new Error("result recorder not expected for a blocked dispatch");
          },
        },
      });

      const result = await useCase.execute({
        organizationId: observationProfile.organizationId,
        operationId,
        correlationId: `correlation_calling_block_${String(index)}`,
      });

      expect(result).toMatchObject({ stage: "terminal", terminalOutcome: "blocked" });
      expect(providerFactory.constructionCount).toBe(0);
      expect(providerFactory.port.dispatches).toHaveLength(0);
    }
  });

  it("persists every safety block before provider construction or call", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const StartObservationCall = Reflect.get(application, "StartObservationCall") as
      | (new (dependencies: Record<string, unknown>) => {
          execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
        })
      | undefined;
    const FakeObservationProfileRepository = Reflect.get(
      testing,
      "FakeObservationProfileRepository",
    ) as (new (profiles: readonly EndpointObservationProfile[]) => unknown) | undefined;
    const FakeCallAttemptRepository = Reflect.get(testing, "FakeCallAttemptRepository") as
      | (new () => {
          seed(attempt: CallAttempt, idempotencyKey: string): void;
          readonly attempts: readonly CallAttempt[];
        })
      | undefined;
    const FakeObservationDispatchPolicy = Reflect.get(testing, "FakeObservationDispatchPolicy") as
      (new (decision: Record<string, unknown>) => unknown) | undefined;
    const FakeVoiceCallPortFactory = Reflect.get(testing, "FakeVoiceCallPortFactory") as
      (new (result: Record<string, unknown>) => { readonly constructionCount: number }) | undefined;
    const FakeClock = Reflect.get(testing, "FakeClock") as
      (new (instant: string) => unknown) | undefined;
    if (
      StartObservationCall === undefined ||
      FakeObservationProfileRepository === undefined ||
      FakeCallAttemptRepository === undefined ||
      FakeObservationDispatchPolicy === undefined ||
      FakeVoiceCallPortFactory === undefined ||
      FakeClock === undefined
    ) {
      throw new Error("Phase 3 safe observation dispatch is not implemented");
    }
    const blockReasons = [
      "ineligible_profile",
      "authorization_inactive",
      "dtmf_not_approved",
      "capacity_unavailable",
      "kill_switch_active",
      "provider_binding_unapproved",
    ] as const;

    for (const [index, reason] of blockReasons.entries()) {
      const organizationId = `org_block_${String(index)}`;
      const endpointId = `endpoint_block_${String(index)}`;
      const observationProfile = profile(organizationId, endpointId);
      const attempts = new FakeCallAttemptRepository();
      attempts.seed(
        CallAttempt.establish({
          id: `operation_block_${String(index)}`,
          organizationId: observationProfile.organizationId,
          endpointId,
          adapterVersionId: observationProfile.adapterVersionId,
          trigger: "manual",
          provenance: "SIMULATED",
          semanticFingerprint: `fingerprint_block_${String(index)}`,
          providerDispatchIdentity: `provider_dispatch_block_${String(index)}`,
          acceptedAt: "2026-08-06T13:20:00.000Z",
        }),
        `idempotency_block_${String(index)}`,
      );
      const providerFactory = new FakeVoiceCallPortFactory({
        kind: "terminal_failure",
        outcome: "provider_failed",
        retryable: true,
      });
      const useCase = new StartObservationCall({
        profiles: new FakeObservationProfileRepository([observationProfile]),
        attempts,
        policy: new FakeObservationDispatchPolicy({ outcome: "blocked", reason }),
        providerFactory,
        clock: new FakeClock("2026-08-06T13:20:01.000Z"),
        recordResult: {
          execute: async () => {
            throw new Error("result recorder not expected");
          },
        },
      });

      const result = await useCase.execute({
        organizationId: observationProfile.organizationId,
        operationId: `operation_block_${String(index)}`,
        correlationId: `correlation_block_${String(index)}`,
      });

      expect(result).toMatchObject({ stage: "terminal", terminalOutcome: "blocked" });
      expect(providerFactory.constructionCount).toBe(0);
      expect(attempts.attempts[0]).toMatchObject({
        stage: "terminal",
        terminalOutcome: "blocked",
      });
    }
  });

  it("propagates W3C context and makes redelivery reuse one provider dispatch", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const StartObservationCall = Reflect.get(application, "StartObservationCall") as
      | (new (dependencies: Record<string, unknown>) => {
          execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
        })
      | undefined;
    const RecordObservationResult = Reflect.get(application, "RecordObservationResult") as
      (new (dependencies: Record<string, unknown>) => unknown) | undefined;
    const required = [
      "FakeObservationProfileRepository",
      "FakeCallAttemptRepository",
      "FakeEvidenceRepository",
      "FakeObservationRepository",
      "FakeObservationDispatchPolicy",
      "FakeVoiceCallPortFactory",
      "FakeClock",
      "FakeIdentifierGenerator",
    ] as const;
    if (StartObservationCall === undefined || RecordObservationResult === undefined) {
      throw new Error("Phase 3 observation start/result workflow is not implemented");
    }
    const loaded = Object.fromEntries(required.map((name) => [name, Reflect.get(testing, name)]));
    if (Object.values(loaded).some((value) => value === undefined)) {
      throw new Error("Phase 3 observation test fakes are not implemented");
    }
    const observationProfile = profile("org_redelivery", "endpoint_redelivery");
    const attempts = new loaded.FakeCallAttemptRepository();
    attempts.seed(
      CallAttempt.establish({
        id: "operation_redelivery",
        organizationId: observationProfile.organizationId,
        endpointId: observationProfile.endpointId,
        adapterVersionId: observationProfile.adapterVersionId,
        trigger: "scheduled",
        provenance: "SIMULATED",
        semanticFingerprint: "fingerprint_redelivery",
        providerDispatchIdentity: "provider_dispatch_redelivery",
        acceptedAt: "2026-08-06T13:30:00.000Z",
      }),
      "idempotency_redelivery",
    );
    const providerFactory = new loaded.FakeVoiceCallPortFactory({
      kind: "terminal_failure",
      outcome: "no_answer",
      retryable: false,
    });
    const clock = new loaded.FakeClock("2026-08-06T13:30:01.000Z");
    const recordResult = new RecordObservationResult({
      attempts,
      profiles: new loaded.FakeObservationProfileRepository([observationProfile]),
      evidence: new loaded.FakeEvidenceRepository(),
      observations: new loaded.FakeObservationRepository(attempts),
      clock,
      identifiers: new loaded.FakeIdentifierGenerator([]),
    });
    const useCase = new StartObservationCall({
      attempts,
      profiles: new loaded.FakeObservationProfileRepository([observationProfile]),
      policy: new loaded.FakeObservationDispatchPolicy({ outcome: "allowed" }),
      providerFactory,
      clock,
      recordResult,
    });
    const traceContext = {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=opaque",
    };
    const input = {
      organizationId: observationProfile.organizationId,
      operationId: "operation_redelivery",
      correlationId: "correlation_redelivery",
      traceContext,
    };

    const first = await useCase.execute(input);
    const replay = await useCase.execute(input);

    expect(first).toMatchObject({ stage: "terminal", terminalOutcome: "no_answer" });
    expect(replay).toEqual(first);
    expect(providerFactory.constructionCount).toBe(1);
    expect(providerFactory.port.dispatches).toHaveLength(1);
    expect(providerFactory.port.dispatches[0]?.traceContext).toEqual(traceContext);
  });

  it("terminalizes an unknown provider factory failure without exposing its detail", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const observationProfile = profile("org_factory_failure", "endpoint_factory_failure");
    const attempts = new testing.FakeCallAttemptRepository();
    const operationId = "operation_factory_failure";
    attempts.seed(
      CallAttempt.establish({
        id: operationId,
        organizationId: observationProfile.organizationId,
        endpointId: observationProfile.endpointId,
        adapterVersionId: observationProfile.adapterVersionId,
        trigger: "scheduled",
        provenance: "SIMULATED",
        semanticFingerprint: "fingerprint_factory_failure",
        providerDispatchIdentity: "provider_dispatch_factory_failure",
        acceptedAt: "2026-08-06T15:30:00.000Z",
      }),
      "idempotency_factory_failure",
    );
    const useCase = new application.StartObservationCall({
      attempts,
      profiles: new testing.FakeObservationProfileRepository([observationProfile]),
      policy: new testing.FakeObservationDispatchPolicy({ outcome: "allowed" }),
      providerFactory: {
        create: () => {
          throw new Error("vendor credential and endpoint detail must stay private");
        },
      },
      clock: new testing.FakeClock("2026-08-06T15:30:01.000Z"),
      recordResult: {
        execute: async () => {
          throw new Error("result recorder not expected after factory failure");
        },
      },
    });

    const result = await useCase.execute({
      organizationId: observationProfile.organizationId,
      operationId,
      correlationId: "correlation_factory_failure",
      delivery: { attemptNumber: 1, finalAttempt: false },
    });

    expect(result).toMatchObject({
      stage: "terminal",
      terminalOutcome: "provider_failed",
      retryable: false,
    });
  });

  it("rethrows a safe retryable provider failure before the final delivery", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const VoiceCallDispatchError = Reflect.get(application, "VoiceCallDispatchError") as
      { providerFailed(input: { readonly retryable: boolean }): Error } | undefined;
    if (VoiceCallDispatchError === undefined) {
      throw new Error("Typed safe provider failures are not implemented");
    }
    const observationProfile = profile("org_retryable_provider", "endpoint_retryable_provider");
    const attempts = new testing.FakeCallAttemptRepository();
    const operationId = "operation_retryable_provider";
    attempts.seed(
      CallAttempt.establish({
        id: operationId,
        organizationId: observationProfile.organizationId,
        endpointId: observationProfile.endpointId,
        adapterVersionId: observationProfile.adapterVersionId,
        trigger: "scheduled",
        provenance: "SIMULATED",
        semanticFingerprint: "fingerprint_retryable_provider",
        providerDispatchIdentity: "provider_dispatch_retryable_provider",
        acceptedAt: "2026-08-06T15:40:00.000Z",
      }),
      "idempotency_retryable_provider",
    );
    const failure = VoiceCallDispatchError.providerFailed({ retryable: true });
    const useCase = new application.StartObservationCall({
      attempts,
      profiles: new testing.FakeObservationProfileRepository([observationProfile]),
      policy: new testing.FakeObservationDispatchPolicy({ outcome: "allowed" }),
      providerFactory: {
        create: () => ({ createOrReconcile: async () => Promise.reject(failure) }),
      },
      clock: new testing.FakeClock("2026-08-06T15:40:01.000Z"),
      recordResult: { execute: async () => Promise.reject(new Error("not expected")) },
    });

    await expect(
      useCase.execute({
        organizationId: observationProfile.organizationId,
        operationId,
        correlationId: "correlation_retryable_provider",
        delivery: { attemptNumber: 1, finalAttempt: false },
      }),
    ).rejects.toBe(failure);
    expect(attempts.attempts[0]).toMatchObject({ stage: "calling", terminalOutcome: null });
  });

  it("terminalizes a retryable provider failure on the final delivery", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const VoiceCallDispatchError = Reflect.get(application, "VoiceCallDispatchError") as
      { providerFailed(input: { readonly retryable: boolean }): Error } | undefined;
    if (VoiceCallDispatchError === undefined) {
      throw new Error("Typed safe provider failures are not implemented");
    }
    const observationProfile = profile("org_exhausted_provider", "endpoint_exhausted_provider");
    const attempts = new testing.FakeCallAttemptRepository();
    const operationId = "operation_exhausted_provider";
    attempts.seed(
      CallAttempt.establish({
        id: operationId,
        organizationId: observationProfile.organizationId,
        endpointId: observationProfile.endpointId,
        adapterVersionId: observationProfile.adapterVersionId,
        trigger: "scheduled",
        provenance: "SIMULATED",
        semanticFingerprint: "fingerprint_exhausted_provider",
        providerDispatchIdentity: "provider_dispatch_exhausted_provider",
        acceptedAt: "2026-08-06T15:50:00.000Z",
      }),
      "idempotency_exhausted_provider",
    );
    const failure = VoiceCallDispatchError.providerFailed({ retryable: true });
    const useCase = new application.StartObservationCall({
      attempts,
      profiles: new testing.FakeObservationProfileRepository([observationProfile]),
      policy: new testing.FakeObservationDispatchPolicy({ outcome: "allowed" }),
      providerFactory: {
        create: () => ({ createOrReconcile: async () => Promise.reject(failure) }),
      },
      clock: new testing.FakeClock("2026-08-06T15:50:01.000Z"),
      recordResult: { execute: async () => Promise.reject(new Error("not expected")) },
    });

    const result = await useCase.execute({
      organizationId: observationProfile.organizationId,
      operationId,
      correlationId: "correlation_exhausted_provider",
      delivery: { attemptNumber: 3, finalAttempt: true },
    });

    expect(result).toMatchObject({
      stage: "terminal",
      terminalOutcome: "provider_failed",
      retryable: true,
    });
  });

  it("reconciles the same provider identity and revision after a crash before persistence", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const observationProfile = profile("org_provider_resume", "endpoint_provider_resume");
    const attempts = new testing.FakeCallAttemptRepository();
    const operationId = "operation_provider_resume";
    const calling = CallAttempt.establish({
      id: operationId,
      organizationId: observationProfile.organizationId,
      endpointId: observationProfile.endpointId,
      adapterVersionId: observationProfile.adapterVersionId,
      trigger: "scheduled",
      provenance: "SIMULATED",
      semanticFingerprint: "fingerprint_provider_resume",
      providerDispatchIdentity: "provider_dispatch_provider_resume",
      acceptedAt: "2026-08-06T16:00:00.000Z",
    }).transitionToCalling("2026-08-06T16:00:01.000Z");
    attempts.seed(calling, "idempotency_provider_resume");
    const providerFactory = new testing.FakeVoiceCallPortFactory({ fixtureIndexes: [0, 0] });
    const providerResults: Record<string, unknown>[] = [];
    let persistAttempts = 0;
    const terminal = calling.transitionToTerminal({
      outcome: "evidence_unavailable",
      retryable: true,
      transitionedAt: "2026-08-06T16:00:03.000Z",
    });
    const useCase = new application.StartObservationCall({
      attempts,
      profiles: new testing.FakeObservationProfileRepository([observationProfile]),
      policy: new testing.FakeObservationDispatchPolicy({ outcome: "allowed" }),
      providerFactory,
      clock: new testing.FakeClock("2026-08-06T16:00:02.000Z"),
      recordResult: {
        execute: async (input: { readonly result: Record<string, unknown> }) => {
          providerResults.push(input.result);
          persistAttempts += 1;
          if (persistAttempts === 1) {
            throw application.ApplicationError.dependencyUnavailable(
              "observation_repository_unavailable",
            );
          }
          return { kind: "terminal_failure", attempt: terminal };
        },
      },
    });
    const input = {
      organizationId: observationProfile.organizationId,
      operationId,
      correlationId: "correlation_provider_resume",
      delivery: { attemptNumber: 1, finalAttempt: false },
    };

    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: "observation_repository_unavailable",
    });
    const result = await useCase.execute({
      ...input,
      delivery: { attemptNumber: 2, finalAttempt: true },
    });

    expect(result.toValue()).toEqual(terminal.toValue());
    expect(providerFactory.port.dispatches).toHaveLength(2);
    expect(
      providerFactory.port.dispatches.map(
        ({ providerDispatchIdentity }) => providerDispatchIdentity,
      ),
    ).toEqual(["provider_dispatch_provider_resume", "provider_dispatch_provider_resume"]);
    expect(
      providerResults.map(({ providerRunId, providerRevisionId }) => ({
        providerRunId,
        providerRevisionId,
      })),
    ).toEqual([
      {
        providerRunId: "simulated_provider_run_operation_provider_resume",
        providerRevisionId: "revision-1",
      },
      {
        providerRunId: "simulated_provider_run_operation_provider_resume",
        providerRevisionId: "revision-1",
      },
    ]);
  });
});
