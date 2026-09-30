import { describe, expect, it } from "vitest";

import { OrganizationId, EndpointObservationProfile } from "@muster/domain";
import * as testing from "@muster/testing";

type Runner = {
  execute(input: {
    readonly organizationId: OrganizationId;
    readonly endpointId: string;
    readonly scenarioId: string;
    readonly revision: number;
    readonly simulationRunId: string;
    readonly correlationId: string;
    readonly predecessorOrigin?: unknown;
  }): Promise<{
    readonly origin: {
      readonly kind: "SIMULATED";
      readonly mode: "DETERMINISTIC_REPLAY";
      readonly scenarioId: string;
      readonly scenarioRevision: number;
      readonly simulationRunId: string;
      readonly compatibility: "simulator-tested";
    };
    readonly attempt: {
      readonly id: string;
      readonly provenance: string;
      readonly terminalOutcome: string | null;
    };
    readonly evidence: { readonly id: string; readonly provenance: string } | null;
    readonly observation: {
      readonly id: string;
      readonly provenance: string;
      readonly quality: string;
      readonly readings: readonly { readonly disposition: string; readonly value: string | null }[];
    } | null;
    readonly recovery: {
      readonly kind: "recovery_candidate";
      readonly predecessorSimulationRunId: string;
    } | null;
  }>;
};

function profile(organizationId: OrganizationId, endpointId: string): EndpointObservationProfile {
  return EndpointObservationProfile.create({
    endpointId,
    organizationId,
    adapterVersionId: "simulator_adapter_v1",
    expectedZones: ["zone-01", "zone-02"].map((zoneId, ordinal) => ({
      zoneId,
      ordinal,
      applicability: "required" as const,
      requiredFacet: "measurement" as const,
      allowedUnitMappings: [
        {
          ruleId: "fahrenheit-v1",
          spokenUnit: "degrees fahrenheit",
          normalizedUnit: "degF",
        },
      ],
    })),
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: "synthetic-fixture-authorization",
  });
}

async function createHarness(identifierPrefix: string): Promise<{
  readonly runner: Runner;
  readonly organizationId: OrganizationId;
  readonly endpointId: string;
  readonly attempts: testing.FakeCallAttemptRepository;
  readonly evidence: testing.FakeEvidenceRepository;
  readonly observations: testing.FakeObservationRepository;
  readonly persistenceOrder: readonly string[];
}> {
  const application = await import("@muster/application");
  const Catalog = Reflect.get(application, "SimulatorScenarioCatalog") as
    (new (scenarios: readonly unknown[]) => unknown) | undefined;
  const Run = Reflect.get(application, "RunSimulatedObservation") as
    (new (dependencies: Record<string, unknown>) => Runner) | undefined;
  if (Catalog === undefined || Run === undefined) {
    throw new Error("Phase 2 deterministic simulator replay is not implemented");
  }

  const organizationId = OrganizationId.create(`org-${identifierPrefix}`);
  const endpointId = `endpoint-${identifierPrefix}`;
  const attempts = new testing.FakeCallAttemptRepository();
  const evidence = new testing.FakeEvidenceRepository();
  const observations = new testing.FakeObservationRepository(attempts);
  const persistenceOrder: string[] = [];
  const appendEvidence = evidence.append.bind(evidence);
  evidence.append = async (record) => {
    persistenceOrder.push("evidence");
    return await appendEvidence(record);
  };
  const appendObservation = observations.append.bind(observations);
  observations.append = async (input) => {
    persistenceOrder.push("observation");
    return await appendObservation(input);
  };

  const catalog = new Catalog(testing.SIMULATOR_SCENARIO_CATALOG);
  const runner = new Run({
    catalog,
    profiles: new testing.FakeObservationProfileRepository([profile(organizationId, endpointId)]),
    attempts,
    scheduler: new testing.FakeObservationJobScheduler(),
    evidence,
    observations,
    policy: new testing.FakeObservationDispatchPolicy({ outcome: "allowed" }),
    clock: new testing.FakeClock("2026-08-07T04:00:00.000Z"),
    identifiers: new testing.FakeIdentifierGenerator(
      Array.from({ length: 30 }, (_, index) => `${identifierPrefix}-${String(index + 1)}`),
    ),
  });
  return { runner, organizationId, endpointId, attempts, evidence, observations, persistenceOrder };
}

async function replay(
  harness: Awaited<ReturnType<typeof createHarness>>,
  scenarioId: string,
  simulationRunId: string,
  predecessorOrigin?: unknown,
) {
  return await harness.runner.execute({
    organizationId: harness.organizationId,
    endpointId: harness.endpointId,
    scenarioId,
    revision: 1,
    simulationRunId,
    correlationId: `correlation-${simulationRunId}`,
    ...(predecessorOrigin === undefined ? {} : { predecessorOrigin }),
  });
}

describe("transparent device simulator deterministic replay", () => {
  it("persists SIMULATED evidence before interpretation and derives input-specific readings", async () => {
    const normalHarness = await createHarness("normal");
    const abnormalHarness = await createHarness("abnormal");

    const normal = await replay(normalHarness, "synthetic-normal", "run-normal");
    const abnormal = await replay(abnormalHarness, "synthetic-abnormal", "run-abnormal");

    expect(normalHarness.persistenceOrder).toEqual(["evidence", "observation"]);
    expect(normal.origin).toMatchObject({ kind: "SIMULATED", compatibility: "simulator-tested" });
    expect([
      normal.attempt.provenance,
      normal.evidence?.provenance,
      normal.observation?.provenance,
    ]).toEqual(["SIMULATED", "SIMULATED", "SIMULATED"]);
    expect(normal.observation?.readings.map(({ value }) => value)).toEqual(["71.5", "68.0"]);
    expect(abnormal.observation?.readings.map(({ value }) => value)).toEqual(["91.25", "84.5"]);
  });

  it("fails closed for contradictory and truncated fixture evidence", async () => {
    const ambiguous = await replay(
      await createHarness("ambiguous"),
      "synthetic-ambiguous",
      "run-ambiguous",
    );
    const truncated = await replay(
      await createHarness("truncated"),
      "synthetic-truncated",
      "run-truncated",
    );

    expect(ambiguous.observation).toMatchObject({ quality: "partial" });
    expect(
      ambiguous.observation?.readings.some(({ disposition }) => disposition === "contradictory"),
    ).toBe(true);
    expect(truncated.observation).toMatchObject({ quality: "partial" });
    expect(
      truncated.observation?.readings.some(({ disposition }) => disposition === "missing"),
    ).toBe(true);
    expect(
      [ambiguous, truncated].some(({ observation }) => observation?.quality === "complete"),
    ).toBe(false);
  });

  it("records no-answer as a terminal provider fact without fabricating evidence", async () => {
    const result = await replay(
      await createHarness("no-answer"),
      "synthetic-no-answer",
      "run-no-answer",
    );

    expect(result.attempt).toMatchObject({ terminalOutcome: "no_answer", provenance: "SIMULATED" });
    expect(result.evidence).toBeNull();
    expect(result.observation).toBeNull();
  });

  it("replays one simulation run idempotently without duplicate attempts, evidence, or observations", async () => {
    const harness = await createHarness("idempotent");

    await expect(replay(harness, "synthetic-normal", "unsafe/run-id")).rejects.toThrow(
      "Simulation run ID must be an opaque repository-safe identifier",
    );
    await expect(
      harness.runner.execute({
        organizationId: harness.organizationId,
        endpointId: harness.endpointId,
        scenarioId: "synthetic-normal",
        revision: 1,
        simulationRunId: "run-safe",
        correlationId: "x".repeat(129),
      }),
    ).rejects.toThrow("Correlation ID must be an opaque repository-safe identifier");
    expect(harness.attempts.attempts).toHaveLength(0);

    const first = await replay(harness, "synthetic-normal", "run-idempotent");
    const second = await replay(harness, "synthetic-normal", "run-idempotent");

    expect(second.attempt.id).toBe(first.attempt.id);
    expect(harness.attempts.attempts).toHaveLength(1);
    expect(harness.evidence.records).toHaveLength(1);
    expect(harness.observations.observations).toHaveLength(1);
  });

  it("requires an exact simulated predecessor before producing a recovery candidate", async () => {
    const harness = await createHarness("recovery");
    const predecessor = await replay(harness, "synthetic-abnormal", "run-recovery-predecessor");

    await expect(
      replay(harness, "synthetic-recovery", "run-recovery-without-predecessor"),
    ).rejects.toThrow("Recovery simulator replay requires its exact simulated predecessor");

    const recovery = await replay(
      harness,
      "synthetic-recovery",
      "run-recovery",
      predecessor.origin,
    );
    expect(recovery.recovery).toEqual({
      kind: "recovery_candidate",
      predecessorSimulationRunId: "run-recovery-predecessor",
    });
    expect(recovery.observation).toMatchObject({ quality: "complete", provenance: "SIMULATED" });
  });
});
