import { describe, expect, it } from "vitest";

async function loadScenarioApi() {
  const [contracts, scenarios] = await Promise.all([
    import("@muster/contracts"),
    import("./simulator-scenarios.js"),
  ]);
  return { ...contracts, ...scenarios };
}

describe("synthetic phone simulator scenarios", () => {
  // Phase 1 test strategy: keep revision 1 behavior under its existing tests, then use
  // an inline expected-value oracle for the immutable greenhouse revision 2 catalog.
  // These tests deliberately do not exercise provider, host, secret, persistence, or
  // browser behavior; those boundaries belong to later phases.
  it("publishes the six stable, unique, exactly versioned scenarios", async () => {
    const { SIMULATOR_SCENARIO_CATALOG, findSimulatorScenario } = await loadScenarioApi();
    const revisionOne = SIMULATOR_SCENARIO_CATALOG.filter(({ revision }) => revision === 1);
    expect(revisionOne.map(({ scenarioId }) => scenarioId)).toEqual([
      "synthetic-normal",
      "synthetic-abnormal",
      "synthetic-ambiguous",
      "synthetic-no-answer",
      "synthetic-truncated",
      "synthetic-recovery",
    ]);
    expect(
      new Set(
        SIMULATOR_SCENARIO_CATALOG.map(
          ({ scenarioId, revision }) => `${scenarioId}@${String(revision)}`,
        ),
      ),
    ).toHaveLength(12);
    expect(findSimulatorScenario("synthetic-normal", 1)).toBe(revisionOne[0]);
    expect(() => findSimulatorScenario("unknown", 1)).toThrow(
      "Unknown simulator scenario: unknown@1",
    );
  });

  it("builds immutable deterministic data with distinct normal and abnormal values", async () => {
    const { buildAbnormalSimulatorScenario, buildNormalSimulatorScenario, renderSyntheticReport } =
      await loadScenarioApi();
    const firstNormal = buildNormalSimulatorScenario();
    const secondNormal = buildNormalSimulatorScenario();
    const abnormal = buildAbnormalSimulatorScenario();

    expect(firstNormal).toEqual(secondNormal);
    expect(renderSyntheticReport(firstNormal)).toBe(renderSyntheticReport(secondNormal));
    expect(renderSyntheticReport(firstNormal)).not.toBe(renderSyntheticReport(abnormal));
    expect(firstNormal.expectedValues).toEqual([
      { zoneId: "zone-01", value: "71.5", normalizedUnit: "degF" },
      { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF" },
    ]);
    expect(abnormal.expectedValues).toEqual([
      { zoneId: "zone-01", value: "91.25", normalizedUnit: "degF" },
      { zoneId: "zone-02", value: "84.5", normalizedUnit: "degF" },
    ]);
    expect(Object.isFrozen(firstNormal)).toBe(true);
    expect(Object.isFrozen(firstNormal.reportSegments)).toBe(true);
    expect(Object.isFrozen(firstNormal.reportSegments[0])).toBe(true);
  });

  it("declares omissions and contradictions instead of defaulting incomplete evidence to normal", async () => {
    const { SIMULATOR_SCENARIO_CATALOG } = await loadScenarioApi();
    const byId = new Map(
      SIMULATOR_SCENARIO_CATALOG.filter(({ revision }) => revision === 1).map((scenario) => [
        scenario.scenarioId,
        scenario,
      ]),
    );

    expect(byId.get("synthetic-ambiguous")).toMatchObject({
      expectedEvidenceQuality: "invalid",
      expectedOutcomeFamily: "ambiguous",
      omissions: [],
      contradictions: [{ zoneId: "zone-01", values: ["71.5", "75.5"] }],
    });
    expect(byId.get("synthetic-no-answer")).toMatchObject({
      expectedEvidenceQuality: "not-produced",
      expectedOutcomeFamily: "no-answer",
      omissions: ["zone-01", "zone-02"],
      reportSegments: [],
    });
    expect(byId.get("synthetic-truncated")).toMatchObject({
      expectedEvidenceQuality: "partial",
      expectedOutcomeFamily: "truncated",
      omissions: ["zone-02"],
      contradictions: [],
    });
  });

  it("keeps simulation, supported modes, forbidden DTMF, and compatibility limits explicit", async () => {
    const { SIMULATOR_SCENARIO_CATALOG, SIMULATOR_SCENARIO_SCHEMA_VERSION, renderSyntheticReport } =
      await loadScenarioApi();
    for (const scenario of SIMULATOR_SCENARIO_CATALOG.filter(({ revision }) => revision === 1)) {
      expect(scenario).toMatchObject({
        schemaVersion: SIMULATOR_SCENARIO_SCHEMA_VERSION,
        origin: "SIMULATED",
        supportedModes:
          scenario.scenarioId === "synthetic-normal"
            ? ["DETERMINISTIC_REPLAY", "LIVE_SMOKE"]
            : ["DETERMINISTIC_REPLAY"],
        dtmf: { policy: "forbidden", allowlist: [] },
        interpretationLimit: {
          compatibility: "simulator-tested",
          hardwareCompatibility: "unverified",
        },
      });
      expect(renderSyntheticReport(scenario)).not.toContain("Sensaphone");
    }
  });

  it("links recovery to the exact preceding simulated anomalous scenario", async () => {
    const { findSimulatorScenario } = await loadScenarioApi();
    const recovery = findSimulatorScenario("synthetic-recovery", 1);

    expect(recovery.recoveryPredecessor).toEqual({
      scenarioId: "synthetic-abnormal",
      revision: 1,
    });
    expect(recovery.expectedEvidenceQuality).toBe("complete");
    expect(recovery.expectedOutcomeFamily).toBe("recovery-candidate");
  });

  it("fails closed for malformed contracts, versions, and mixed simulation lineage", async () => {
    const {
      assertConsistentSimulationLineage,
      buildNormalSimulatorScenario,
      createSimulationOrigin,
      validateSimulatorScenario,
    } = await loadScenarioApi();
    const malformed = structuredClone(buildNormalSimulatorScenario()) as unknown as Record<
      string,
      unknown
    >;
    malformed["schemaVersion"] = "simulator-scenario.v999";
    expect(() => validateSimulatorScenario(malformed)).toThrow(
      "Unsupported simulator scenario schemaVersion",
    );

    const malformedRevision = structuredClone(buildNormalSimulatorScenario()) as unknown as Record<
      string,
      unknown
    >;
    malformedRevision["revision"] = 0;
    expect(() => validateSimulatorScenario(malformedRevision)).toThrow(
      "Simulator scenario revision must be a positive integer",
    );

    const invalidDtmf = structuredClone(buildNormalSimulatorScenario()) as unknown as Record<
      string,
      unknown
    >;
    invalidDtmf["dtmf"] = { policy: "forbidden", allowlist: ["1"] };
    expect(() => validateSimulatorScenario(invalidDtmf)).toThrow(
      "Simulator scenario DTMF allowlist must be empty",
    );

    const root = createSimulationOrigin({
      kind: "SIMULATED",
      mode: "DETERMINISTIC_REPLAY",
      scenarioId: "synthetic-normal",
      scenarioRevision: 1,
      simulationRunId: "simulated_run_normal_001",
      compatibility: "simulator-tested",
    });
    const mixed = createSimulationOrigin({
      ...root,
      scenarioId: "synthetic-abnormal",
    });
    expect(() => assertConsistentSimulationLineage([root, mixed])).toThrow(
      "Mixed simulation lineage is forbidden",
    );
    expect(() =>
      createSimulationOrigin({
        ...root,
        kind: "PROVIDER_OBSERVED" as "SIMULATED",
      }),
    ).toThrow("Simulation origin kind must be SIMULATED");
  });

  it("preserves revision 1 while publishing immutable revision 2 for all six scenarios", async () => {
    const { SIMULATOR_SCENARIO_CATALOG, findSimulatorScenario } = await loadScenarioApi();
    const identities = SIMULATOR_SCENARIO_CATALOG.map(
      ({ scenarioId, revision }) => `${scenarioId}@${String(revision)}`,
    );

    expect(identities).toEqual([
      "synthetic-normal@1",
      "synthetic-abnormal@1",
      "synthetic-ambiguous@1",
      "synthetic-no-answer@1",
      "synthetic-truncated@1",
      "synthetic-recovery@1",
      "synthetic-normal@2",
      "synthetic-abnormal@2",
      "synthetic-ambiguous@2",
      "synthetic-no-answer@2",
      "synthetic-truncated@2",
      "synthetic-recovery@2",
    ]);
    expect(findSimulatorScenario("synthetic-normal", 1).expectedValues).toEqual([
      { zoneId: "zone-01", value: "71.5", normalizedUnit: "degF" },
      { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF" },
    ]);
    expect(Object.isFrozen(findSimulatorScenario("synthetic-normal", 2))).toBe(true);
  });

  it("publishes the exact independent four-zone normal greenhouse oracle", async () => {
    const { findSimulatorScenario } = await loadScenarioApi();
    const normal = findSimulatorScenario("synthetic-normal", 2);

    expect(normal.expectedZones).toEqual([
      {
        zoneId: "zone-01",
        ordinal: 0,
        label: "North house air temperature",
        normalizedUnit: "degF",
      },
      {
        zoneId: "zone-02",
        ordinal: 1,
        label: "Propagation bench temperature",
        normalizedUnit: "degF",
      },
      {
        zoneId: "zone-03",
        ordinal: 2,
        label: "Greenhouse relative humidity",
        normalizedUnit: "percent",
      },
      {
        zoneId: "zone-04",
        ordinal: 3,
        label: "Irrigation reservoir level",
        normalizedUnit: "percent",
      },
    ]);
    expect(normal.expectedValues).toEqual([
      { zoneId: "zone-01", value: "71.5", normalizedUnit: "degF", status: "OK" },
      { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF", status: "OK" },
      { zoneId: "zone-03", value: "68", normalizedUnit: "percent", status: "OK" },
      { zoneId: "zone-04", value: "82", normalizedUnit: "percent", status: "OK" },
    ]);
    expect(normal.expectedAuxiliaryStatuses).toEqual([
      { statusId: "sound", value: "normal" },
      { statusId: "power", value: "mains-available" },
      { statusId: "battery", value: "normal" },
      { statusId: "output", value: "off" },
    ]);
    expect(normal.auxiliaryStatusOmissions).toEqual([]);
  });

  it("publishes exact evidence-distinct oracles for abnormal, ambiguous, truncated, no-answer, and recovery", async () => {
    const { findSimulatorScenario } = await loadScenarioApi();
    const oracle = [
      {
        scenarioId: "synthetic-abnormal",
        expectedEvidenceQuality: "complete",
        expectedValues: [
          { zoneId: "zone-01", value: "95.0", normalizedUnit: "degF", status: "ALARM" },
          { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-03", value: "91", normalizedUnit: "percent", status: "ALARM" },
          { zoneId: "zone-04", value: "20", normalizedUnit: "percent", status: "LOW" },
        ],
        omissions: [],
        contradictions: [],
        expectedAuxiliaryStatuses: [
          { statusId: "sound", value: "alarm-active" },
          { statusId: "power", value: "mains-available" },
          { statusId: "battery", value: "normal" },
          { statusId: "output", value: "on" },
        ],
        auxiliaryStatusOmissions: [],
      },
      {
        scenarioId: "synthetic-ambiguous",
        expectedEvidenceQuality: "invalid",
        expectedValues: [
          { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-03", value: "68", normalizedUnit: "percent", status: "OK" },
          { zoneId: "zone-04", value: "82", normalizedUnit: "percent", status: "OK" },
        ],
        omissions: [],
        contradictions: [{ zoneId: "zone-01", values: ["71.5", "75.5"] }],
        expectedAuxiliaryStatuses: [
          { statusId: "sound", value: "normal" },
          { statusId: "power", value: "mains-available" },
          { statusId: "battery", value: "normal" },
          { statusId: "output", value: "off" },
        ],
        auxiliaryStatusOmissions: [],
      },
      {
        scenarioId: "synthetic-no-answer",
        expectedEvidenceQuality: "not-produced",
        expectedValues: [],
        omissions: ["zone-01", "zone-02", "zone-03", "zone-04"],
        contradictions: [],
        expectedAuxiliaryStatuses: [],
        auxiliaryStatusOmissions: ["sound", "power", "battery", "output"],
      },
      {
        scenarioId: "synthetic-truncated",
        expectedEvidenceQuality: "partial",
        expectedValues: [
          { zoneId: "zone-01", value: "72.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-02", value: "67.5", normalizedUnit: "degF", status: "OK" },
        ],
        omissions: ["zone-03", "zone-04"],
        contradictions: [],
        expectedAuxiliaryStatuses: [],
        auxiliaryStatusOmissions: ["sound", "power", "battery", "output"],
      },
      {
        scenarioId: "synthetic-recovery",
        expectedEvidenceQuality: "complete",
        expectedValues: [
          { zoneId: "zone-01", value: "70.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-02", value: "67.5", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-03", value: "66", normalizedUnit: "percent", status: "OK" },
          { zoneId: "zone-04", value: "80", normalizedUnit: "percent", status: "OK" },
        ],
        omissions: [],
        contradictions: [],
        expectedAuxiliaryStatuses: [
          { statusId: "sound", value: "normal" },
          { statusId: "power", value: "mains-available" },
          { statusId: "battery", value: "normal" },
          { statusId: "output", value: "off" },
        ],
        auxiliaryStatusOmissions: [],
      },
    ] as const;

    for (const expected of oracle) {
      expect(findSimulatorScenario(expected.scenarioId, 2)).toMatchObject(expected);
    }
  });

  it("makes exactly five revision-2 scenarios live-capable and keeps no-answer replay-only", async () => {
    const { SIMULATOR_SCENARIO_CATALOG } = await loadScenarioApi();
    const revisionTwo = SIMULATOR_SCENARIO_CATALOG.filter(({ revision }) => revision === 2);
    const liveScenarioIds = revisionTwo
      .filter(({ supportedModes }) => supportedModes.includes("LIVE_SMOKE"))
      .map(({ scenarioId }) => scenarioId);

    expect(liveScenarioIds).toEqual([
      "synthetic-normal",
      "synthetic-abnormal",
      "synthetic-ambiguous",
      "synthetic-truncated",
      "synthetic-recovery",
    ]);
    expect(
      revisionTwo.find(({ scenarioId }) => scenarioId === "synthetic-no-answer")?.supportedModes,
    ).toEqual(["DETERMINISTIC_REPLAY"]);
  });

  it("binds live recovery to the exact revision-2 abnormal predecessor without weakening safety ceilings", async () => {
    const { SIMULATOR_SCENARIO_CATALOG, findSimulatorScenario } = await loadScenarioApi();
    const abnormal = findSimulatorScenario("synthetic-abnormal", 2);
    const recovery = findSimulatorScenario("synthetic-recovery", 2);

    expect(abnormal.supportedModes).toEqual(["DETERMINISTIC_REPLAY", "LIVE_SMOKE"]);
    expect(abnormal.recoveryPredecessor).toBeNull();
    expect(recovery.recoveryPredecessor).toEqual({
      scenarioId: "synthetic-abnormal",
      revision: 2,
    });
    for (const scenario of SIMULATOR_SCENARIO_CATALOG.filter(({ revision }) => revision === 2)) {
      expect(scenario).toMatchObject({
        origin: "SIMULATED",
        dtmf: { policy: "forbidden", allowlist: [] },
        interpretationLimit: {
          compatibility: "simulator-tested",
          hardwareCompatibility: "unverified",
        },
      });
    }
  });

  it.each([
    {
      name: "an unaccounted expected zone",
      scenarioId: "synthetic-ambiguous",
      mutate(scenario: Record<string, unknown>) {
        scenario["expectedValues"] = (scenario["expectedValues"] as unknown[]).filter(
          (value) => (value as { zoneId: string }).zoneId !== "zone-04",
        );
      },
      error: "Revision-2 scenarios must classify every expected zone exactly once",
    },
    {
      name: "a zone classified as both a value and a contradiction",
      scenarioId: "synthetic-ambiguous",
      mutate(scenario: Record<string, unknown>) {
        scenario["expectedValues"] = [
          ...(scenario["expectedValues"] as unknown[]),
          { zoneId: "zone-01", value: "71.5", normalizedUnit: "degF", status: "UNKNOWN" },
        ];
      },
      error: "Revision-2 scenarios must classify every expected zone exactly once",
    },
    {
      name: "fabricated no-answer auxiliary evidence",
      scenarioId: "synthetic-no-answer",
      mutate(scenario: Record<string, unknown>) {
        scenario["expectedAuxiliaryStatuses"] = [{ statusId: "sound", value: "normal" }];
        scenario["auxiliaryStatusOmissions"] = ["power", "battery", "output"];
      },
      error: "No-answer scenarios must omit the complete auxiliary-status inventory",
    },
    {
      name: "a missing no-answer auxiliary omission",
      scenarioId: "synthetic-no-answer",
      mutate(scenario: Record<string, unknown>) {
        scenario["auxiliaryStatusOmissions"] = ["sound", "power", "battery"];
      },
      error: "No-answer scenarios must omit the complete auxiliary-status inventory",
    },
  ])(
    "rejects revision-2 evidence partition mutation: $name",
    async ({ scenarioId, mutate, error }) => {
      const { findSimulatorScenario, validateSimulatorScenario } = await loadScenarioApi();
      const scenario = structuredClone(findSimulatorScenario(scenarioId, 2)) as unknown as Record<
        string,
        unknown
      >;
      mutate(scenario);

      expect(() => validateSimulatorScenario(scenario)).toThrow(error);
    },
  );
});
