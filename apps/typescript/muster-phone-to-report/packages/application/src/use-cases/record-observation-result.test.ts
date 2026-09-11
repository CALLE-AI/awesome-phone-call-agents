import { describe, expect, it } from "vitest";

import { CallAttempt, EndpointObservationProfile, OrganizationId } from "@muster/domain";

function profile(): EndpointObservationProfile {
  return EndpointObservationProfile.create({
    endpointId: "endpoint_result",
    organizationId: OrganizationId.create("org_result"),
    adapterVersionId: "adapter_version_simulated_v1",
    expectedZones: [
      {
        zoneId: "zone-01",
        ordinal: 0,
        applicability: "required",
        requiredFacet: "measurement",
        allowedUnitMappings: [
          {
            ruleId: "unit_rule_fahrenheit_v1",
            spokenUnit: "degrees fahrenheit",
            normalizedUnit: "degF",
          },
        ],
      },
      {
        zoneId: "zone-02",
        ordinal: 1,
        applicability: "required",
        requiredFacet: "measurement",
        allowedUnitMappings: [
          {
            ruleId: "unit_rule_fahrenheit_v1",
            spokenUnit: "degrees fahrenheit",
            normalizedUnit: "degF",
          },
        ],
      },
    ],
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: "authorization_result",
  });
}

async function loadHarness() {
  const application = await import("../index.js");
  const testing = await import("@muster/testing");
  const RecordObservationResult = Reflect.get(application, "RecordObservationResult");
  const names = [
    "FakeObservationProfileRepository",
    "FakeCallAttemptRepository",
    "FakeEvidenceRepository",
    "FakeObservationRepository",
    "FakeClock",
    "FakeIdentifierGenerator",
    "FakeVoiceCallPort",
  ] as const;
  const values = Object.fromEntries(names.map((name) => [name, Reflect.get(testing, name)]));
  if (
    RecordObservationResult === undefined ||
    Object.values(values).some((value) => value === undefined)
  ) {
    throw new Error("Phase 3 observation result workflow is not implemented");
  }
  return { RecordObservationResult, ...values };
}

function callingAttempt(observationProfile: EndpointObservationProfile, id: string): CallAttempt {
  return CallAttempt.establish({
    id,
    organizationId: observationProfile.organizationId,
    endpointId: observationProfile.endpointId,
    adapterVersionId: observationProfile.adapterVersionId,
    trigger: "manual",
    provenance: "SIMULATED",
    semanticFingerprint: `fingerprint_${id}`,
    providerDispatchIdentity: `provider_dispatch_${id}`,
    acceptedAt: "2026-08-06T14:00:00.000Z",
  }).transitionToCalling("2026-08-06T14:00:01.000Z");
}

async function evidenceResultAt(
  harness: Awaited<ReturnType<typeof loadHarness>>,
  observationProfile: EndpointObservationProfile,
  operationId: string,
  capturedAt: string,
) {
  const provider = new harness.FakeVoiceCallPort({ fixtureIndexes: [0] });
  const result = await provider.createOrReconcile({
    operationId,
    organizationId: observationProfile.organizationId,
    providerDispatchIdentity: `provider_dispatch_${operationId}`,
    instructionFingerprint: "dtmf-forbidden.v1",
    dtmfPolicy: observationProfile.dtmfPolicy,
    correlationId: `correlation_${operationId}`,
  });
  if (result.kind !== "evidence") {
    throw new Error("Expected deterministic evidence result");
  }
  return Object.freeze({ ...result, capturedAt });
}

describe("RecordObservationResult", () => {
  it.each([
    [
      "a normal past capture",
      "past_capture",
      "2026-08-06T14:00:01.000Z",
      "2026-08-06T14:00:02.000Z",
      "2026-08-06T14:00:02.000Z",
    ],
    [
      "the observed 141 ms positive skew",
      "positive_skew_141ms",
      "2026-08-06T14:00:02.141Z",
      "2026-08-06T14:00:02.000Z",
      "2026-08-06T14:00:02.141Z",
    ],
    [
      "the exact 5,000 ms positive-skew boundary",
      "positive_skew_5000ms",
      "2026-08-06T14:00:07.000Z",
      "2026-08-06T14:00:02.000Z",
      "2026-08-06T14:00:07.000Z",
    ],
  ])(
    "normalizes %s with one clock sample while preserving capturedAt",
    async (_label, suffix, capturedAt, localNow, expectedRetainedAt) => {
      const harness = await loadHarness();
      const observationProfile = profile();
      const operationId = `operation_${suffix}`;
      const attempts = new harness.FakeCallAttemptRepository();
      attempts.seed(callingAttempt(observationProfile, operationId), `idempotency_${suffix}`);
      const evidence = new harness.FakeEvidenceRepository();
      const observations = new harness.FakeObservationRepository(attempts);
      let clockSamples = 0;
      const recorder = new harness.RecordObservationResult({
        attempts,
        profiles: new harness.FakeObservationProfileRepository([observationProfile]),
        evidence,
        observations,
        clock: {
          now(): string {
            clockSamples += 1;
            return localNow;
          },
        },
        identifiers: new harness.FakeIdentifierGenerator([
          `evidence_${suffix}`,
          `observation_${suffix}`,
        ]),
      });
      const providerResult = await evidenceResultAt(
        harness,
        observationProfile,
        operationId,
        capturedAt,
      );

      const result = await recorder.execute({
        organizationId: observationProfile.organizationId,
        operationId,
        result: providerResult,
      });

      expect(result).toMatchObject({
        kind: "observation_recorded",
        evidence: { capturedAt, retainedAt: expectedRetainedAt },
        observation: { createdAt: expectedRetainedAt, quality: "complete" },
      });
      expect(
        result.observation.readings.map(({ derivedAt }: { derivedAt: string }) => derivedAt),
      ).toEqual([expectedRetainedAt, expectedRetainedAt]);
      expect(clockSamples).toBe(1);
      expect(evidence.records).toHaveLength(1);
      expect(observations.observations).toHaveLength(1);
    },
  );

  it.each([
    [
      "a 5,001 ms positive skew",
      "excessive_skew",
      "2026-08-06T14:00:07.001Z",
      "2026-08-06T14:00:02.000Z",
    ],
    [
      "a malformed provider instant",
      "malformed_provider",
      "not-a-timestamp",
      "2026-08-06T14:00:02.000Z",
    ],
    [
      "a non-canonical provider instant",
      "noncanonical_provider",
      "2026-08-06T14:00:02Z",
      "2026-08-06T14:00:02.000Z",
    ],
    ["a malformed local instant", "malformed_local", "2026-08-06T14:00:02.000Z", "not-a-timestamp"],
  ])(
    "fails closed for %s before creating evidence or observations",
    async (_label, suffix, capturedAt, localNow) => {
      const harness = await loadHarness();
      const observationProfile = profile();
      const operationId = `operation_${suffix}`;
      const attempts = new harness.FakeCallAttemptRepository();
      attempts.seed(callingAttempt(observationProfile, operationId), `idempotency_${suffix}`);
      const evidence = new harness.FakeEvidenceRepository();
      const observations = new harness.FakeObservationRepository(attempts);
      let clockSamples = 0;
      const recorder = new harness.RecordObservationResult({
        attempts,
        profiles: new harness.FakeObservationProfileRepository([observationProfile]),
        evidence,
        observations,
        clock: {
          now(): string {
            clockSamples += 1;
            return localNow;
          },
        },
        identifiers: new harness.FakeIdentifierGenerator([
          `evidence_${suffix}`,
          `observation_${suffix}`,
        ]),
      });
      const providerResult = await evidenceResultAt(
        harness,
        observationProfile,
        operationId,
        capturedAt,
      );

      await expect(
        recorder.execute({
          organizationId: observationProfile.organizationId,
          operationId,
          result: providerResult,
        }),
      ).rejects.toMatchObject({
        name: "ApplicationError",
        message: "Application validation failed",
        kind: "validation",
        code: "evidence_timestamp_invalid",
        retryable: false,
      });
      expect(clockSamples).toBe(1);
      expect(evidence.records).toHaveLength(0);
      expect(observations.observations).toHaveLength(0);
      expect(attempts.attempts[0]).toMatchObject({ stage: "calling", terminalOutcome: null });
    },
  );

  it("redelivers bounded-skew evidence idempotently without resampling within either execution", async () => {
    const harness = await loadHarness();
    const observationProfile = profile();
    const operationId = "operation_bounded_skew_redelivery";
    const attempts = new harness.FakeCallAttemptRepository();
    attempts.seed(callingAttempt(observationProfile, operationId), "idempotency_skew_redelivery");
    const evidence = new harness.FakeEvidenceRepository();
    const observations = new harness.FakeObservationRepository(attempts);
    let clockSamples = 0;
    const recorder = new harness.RecordObservationResult({
      attempts,
      profiles: new harness.FakeObservationProfileRepository([observationProfile]),
      evidence,
      observations,
      clock: {
        now(): string {
          clockSamples += 1;
          return "2026-08-06T14:00:02.000Z";
        },
      },
      identifiers: new harness.FakeIdentifierGenerator([
        "evidence_bounded_skew_redelivery",
        "observation_bounded_skew_redelivery",
      ]),
    });
    const providerResult = await evidenceResultAt(
      harness,
      observationProfile,
      operationId,
      "2026-08-06T14:00:02.141Z",
    );
    const input = {
      organizationId: observationProfile.organizationId,
      operationId,
      result: providerResult,
    };

    const original = await recorder.execute(input);
    const redelivery = await recorder.execute(input);

    expect(redelivery).toMatchObject({
      kind: "observation_recorded",
      evidence: {
        id: "evidence_bounded_skew_redelivery",
        capturedAt: "2026-08-06T14:00:02.141Z",
        retainedAt: "2026-08-06T14:00:02.141Z",
      },
      observation: { id: "observation_bounded_skew_redelivery", version: 1 },
    });
    expect(redelivery.evidence).toBe(original.evidence);
    expect(redelivery.observation).toBe(original.observation);
    expect(clockSamples).toBe(2);
    expect(evidence.records).toHaveLength(1);
    expect(observations.observations).toHaveLength(1);
  });

  it("derives input-specific readings and treats duplicate versus late provider revisions append-only", async () => {
    const harness = await loadHarness();
    const observationProfile = profile();
    const attempts = new harness.FakeCallAttemptRepository();
    attempts.seed(callingAttempt(observationProfile, "operation_result"), "idempotency_result");
    const evidence = new harness.FakeEvidenceRepository();
    const observations = new harness.FakeObservationRepository(attempts);
    const clock = new harness.FakeClock("2026-08-06T14:00:02.000Z");
    const recorder = new harness.RecordObservationResult({
      attempts,
      profiles: new harness.FakeObservationProfileRepository([observationProfile]),
      evidence,
      observations,
      clock,
      identifiers: new harness.FakeIdentifierGenerator([
        "evidence_alpha",
        "observation_alpha",
        "evidence_duplicate_candidate",
        "observation_duplicate_candidate",
        "evidence_beta",
        "observation_beta",
      ]),
    });
    const provider = new harness.FakeVoiceCallPort({ fixtureIndexes: [0, 0, 1] });
    const dispatch = {
      operationId: "operation_result",
      organizationId: observationProfile.organizationId,
      providerDispatchIdentity: "provider_dispatch_operation_result",
      instructionFingerprint: "dtmf-forbidden.v1",
      dtmfPolicy: observationProfile.dtmfPolicy,
      correlationId: "correlation_result",
    };
    const originalResult = await provider.createOrReconcile(dispatch);
    const duplicateResult = await provider.createOrReconcile(dispatch);
    const lateResult = await provider.createOrReconcile(dispatch);

    const original = await recorder.execute({
      organizationId: observationProfile.organizationId,
      operationId: "operation_result",
      result: originalResult,
    });
    const duplicate = await recorder.execute({
      organizationId: observationProfile.organizationId,
      operationId: "operation_result",
      result: duplicateResult,
    });
    clock.set("2026-08-06T14:00:03.000Z");
    const corrected = await recorder.execute({
      organizationId: observationProfile.organizationId,
      operationId: "operation_result",
      result: lateResult,
    });

    expect(original).toMatchObject({
      kind: "observation_recorded",
      observation: { version: 1, quality: "complete" },
    });
    expect(duplicate.observation).toBe(original.observation);
    expect(corrected).toMatchObject({
      kind: "observation_recorded",
      observation: {
        version: 2,
        predecessorObservationId: "observation_alpha",
        quality: "complete",
      },
    });
    expect(
      original.observation.readings.map(({ value }: { value: string | null }) => value),
    ).toEqual(["71.5", "68.0"]);
    expect(
      corrected.observation.readings.map(({ value }: { value: string | null }) => value),
    ).toEqual(["73.25", "69.5"]);
    expect(corrected.observation.evidenceId).not.toBe(original.observation.evidenceId);
    expect(evidence.records).toHaveLength(2);
    expect(observations.observations).toHaveLength(2);
  });

  it("persists each provider/evidence failure terminally without creating an observation", async () => {
    const harness = await loadHarness();
    const observationProfile = profile();
    const failures = [
      ["no_answer", false],
      ["busy", false],
      ["provider_failed", true],
      ["evidence_unavailable", true],
    ] as const;

    for (const [index, [outcome, retryable]] of failures.entries()) {
      const attempts = new harness.FakeCallAttemptRepository();
      const operationId = `operation_failure_${String(index)}`;
      attempts.seed(
        callingAttempt(observationProfile, operationId),
        `idempotency_failure_${String(index)}`,
      );
      const evidence = new harness.FakeEvidenceRepository();
      const observations = new harness.FakeObservationRepository(attempts);
      const recorder = new harness.RecordObservationResult({
        attempts,
        profiles: new harness.FakeObservationProfileRepository([observationProfile]),
        evidence,
        observations,
        clock: new harness.FakeClock("2026-08-06T14:10:00.000Z"),
        identifiers: new harness.FakeIdentifierGenerator([]),
      });

      const result = await recorder.execute({
        organizationId: observationProfile.organizationId,
        operationId,
        result: { kind: "terminal_failure", outcome, retryable },
      });

      expect(result).toMatchObject({
        kind: "terminal_failure",
        attempt: { terminalOutcome: outcome },
      });
      expect(evidence.records).toHaveLength(0);
      expect(observations.observations).toHaveLength(0);
      expect(attempts.attempts[0]).toMatchObject({
        stage: "terminal",
        terminalOutcome: outcome,
        latestObservationId: null,
      });
    }
  });

  it("treats a terminal failure CAS winner as authoritative over late evidence", async () => {
    const harness = await loadHarness();
    const observationProfile = profile();
    const attempts = new harness.FakeCallAttemptRepository();
    const operationId = "operation_failure_winner";
    attempts.seed(callingAttempt(observationProfile, operationId), "idempotency_failure_winner");
    await attempts.recordTerminalFailure({
      organizationId: observationProfile.organizationId,
      operationId,
      outcome: "provider_failed",
      retryable: false,
      transitionedAt: "2026-08-06T14:20:00.000Z",
    });
    const evidence = new harness.FakeEvidenceRepository();
    const observations = new harness.FakeObservationRepository(attempts);
    const recorder = new harness.RecordObservationResult({
      attempts,
      profiles: new harness.FakeObservationProfileRepository([observationProfile]),
      evidence,
      observations,
      clock: new harness.FakeClock("2026-08-06T14:20:01.000Z"),
      identifiers: new harness.FakeIdentifierGenerator([
        "evidence_failure_winner",
        "observation_failure_winner",
      ]),
    });
    const provider = new harness.FakeVoiceCallPort({ fixtureIndexes: [0] });
    const lateEvidence = await provider.createOrReconcile({
      operationId,
      organizationId: observationProfile.organizationId,
      providerDispatchIdentity: `provider_dispatch_${operationId}`,
      instructionFingerprint: "dtmf-forbidden.v1",
      dtmfPolicy: observationProfile.dtmfPolicy,
      correlationId: "correlation_failure_winner",
    });

    const result = await recorder.execute({
      organizationId: observationProfile.organizationId,
      operationId,
      result: lateEvidence,
    });

    expect(result).toMatchObject({
      kind: "terminal_failure",
      attempt: { terminalOutcome: "provider_failed", retryable: false },
    });
    expect(evidence.records).toHaveLength(0);
    expect(observations.observations).toHaveLength(0);
    expect(attempts.attempts[0]).toMatchObject({
      stage: "terminal",
      terminalOutcome: "provider_failed",
      latestObservationId: null,
    });
  });

  it("finalizes a repository-established observation after a crash before the terminal transition", async () => {
    const harness = await loadHarness();
    const observationProfile = profile();
    const attempts = new harness.FakeCallAttemptRepository();
    const operationId = "operation_observation_append_crash";
    attempts.seed(
      callingAttempt(observationProfile, operationId),
      "idempotency_observation_append_crash",
    );
    const recordTerminalObservation = attempts.recordTerminalObservation.bind(attempts);
    let terminalTransitionCalls = 0;
    attempts.recordTerminalObservation = async (input: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
      readonly observationId: string;
      readonly transitionedAt: string;
    }) => {
      terminalTransitionCalls += 1;
      if (terminalTransitionCalls === 1) {
        throw new Error("simulated crash after observation append");
      }
      return await recordTerminalObservation(input);
    };
    const evidence = new harness.FakeEvidenceRepository();
    const observations = new harness.FakeObservationRepository(attempts);
    const recorder = new harness.RecordObservationResult({
      attempts,
      profiles: new harness.FakeObservationProfileRepository([observationProfile]),
      evidence,
      observations,
      clock: new harness.FakeClock("2026-08-06T17:00:00.000Z"),
      identifiers: new harness.FakeIdentifierGenerator([
        "evidence_observation_append_crash",
        "observation_append_crash",
      ]),
    });
    const provider = new harness.FakeVoiceCallPort({ fixtureIndexes: [0] });
    const providerResult = await provider.createOrReconcile({
      operationId,
      organizationId: observationProfile.organizationId,
      providerDispatchIdentity: `provider_dispatch_${operationId}`,
      instructionFingerprint: "dtmf-forbidden.v1",
      dtmfPolicy: observationProfile.dtmfPolicy,
      correlationId: "correlation_observation_append_crash",
    });
    const input = {
      organizationId: observationProfile.organizationId,
      operationId,
      result: providerResult,
    };

    await expect(recorder.execute(input)).rejects.toThrowError(
      "simulated crash after observation append",
    );
    expect(attempts.attempts[0]).toMatchObject({
      stage: "extracting",
      terminalOutcome: null,
    });
    expect(observations.observations).toHaveLength(1);

    const replay = await recorder.execute(input);

    expect(replay).toMatchObject({
      kind: "observation_recorded",
      attempt: {
        stage: "terminal",
        terminalOutcome: "observation_recorded",
        latestObservationId: "observation_append_crash",
      },
      observation: { id: "observation_append_crash", version: 1 },
    });
    expect(terminalTransitionCalls).toBe(2);
    expect(evidence.records).toHaveLength(1);
    expect(observations.observations).toHaveLength(1);
  });

  it("returns the terminal failure when it wins the final observation transition CAS", async () => {
    const harness = await loadHarness();
    const observationProfile = profile();
    const attempts = new harness.FakeCallAttemptRepository();
    const operationId = "operation_final_failure_cas_winner";
    attempts.seed(
      callingAttempt(observationProfile, operationId),
      "idempotency_final_failure_cas_winner",
    );
    attempts.recordTerminalObservation = async (input: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
    }) => {
      const winner = callingAttempt(observationProfile, input.operationId).transitionToTerminal({
        outcome: "provider_failed",
        retryable: false,
        transitionedAt: "2026-08-06T18:00:00.000Z",
      });
      return Object.freeze({ outcome: "replayed" as const, value: winner });
    };
    const evidence = new harness.FakeEvidenceRepository();
    const observations = new harness.FakeObservationRepository(attempts);
    const recorder = new harness.RecordObservationResult({
      attempts,
      profiles: new harness.FakeObservationProfileRepository([observationProfile]),
      evidence,
      observations,
      clock: new harness.FakeClock("2026-08-06T17:59:59.000Z"),
      identifiers: new harness.FakeIdentifierGenerator([
        "evidence_final_failure_cas_winner",
        "observation_final_failure_cas_winner",
      ]),
    });
    const provider = new harness.FakeVoiceCallPort({ fixtureIndexes: [0] });
    const providerResult = await provider.createOrReconcile({
      operationId,
      organizationId: observationProfile.organizationId,
      providerDispatchIdentity: `provider_dispatch_${operationId}`,
      instructionFingerprint: "dtmf-forbidden.v1",
      dtmfPolicy: observationProfile.dtmfPolicy,
      correlationId: "correlation_final_failure_cas_winner",
    });

    await expect(
      recorder.execute({
        organizationId: observationProfile.organizationId,
        operationId,
        result: providerResult,
      }),
    ).resolves.toMatchObject({
      kind: "terminal_failure",
      attempt: { stage: "terminal", terminalOutcome: "provider_failed" },
    });
  });
});
