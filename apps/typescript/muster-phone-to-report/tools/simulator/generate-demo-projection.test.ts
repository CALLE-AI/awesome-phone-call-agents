import { describe, expect, it } from "vitest";

import { SIMULATOR_SCENARIO_CATALOG } from "../../packages/testing/dist/index.js";
import { buildSimulatorDemoProjection } from "./generate-demo-projection.js";

describe("Simulator Lab projection generation", () => {
  // Focused strategy: verify the UI-facing identity boundary and exact evidence
  // lineage. Browser rendering and live provider behavior remain outside Phase 1.
  it("selects exactly the latest revision for each unique Simulator Lab scenario ID", async () => {
    const projection = await buildSimulatorDemoProjection(SIMULATOR_SCENARIO_CATALOG);
    const identities = projection.scenarios.map(({ scenarioId, revision }) => ({
      scenarioId,
      revision,
    }));

    expect(identities).toEqual([
      { scenarioId: "synthetic-normal", revision: 2 },
      { scenarioId: "synthetic-abnormal", revision: 2 },
      { scenarioId: "synthetic-ambiguous", revision: 2 },
      { scenarioId: "synthetic-no-answer", revision: 2 },
      { scenarioId: "synthetic-truncated", revision: 2 },
      { scenarioId: "synthetic-recovery", revision: 2 },
    ]);
    expect(new Set(identities.map(({ scenarioId }) => scenarioId)).size).toBe(6);
  });

  it.each([
    { scenarioId: "synthetic-normal", sourceSpanId: "segment-04-full" },
    { scenarioId: "synthetic-ambiguous", sourceSpanId: "segment-05-full" },
  ])(
    "anchors revision-2 $scenarioId Zone 3 value 68 only to its exact zone evidence",
    async ({ scenarioId, sourceSpanId }) => {
      const scenario = SIMULATOR_SCENARIO_CATALOG.find(
        (candidate) => candidate.scenarioId === scenarioId && candidate.revision === 2,
      );
      expect(scenario).toBeDefined();

      const projection = await buildSimulatorDemoProjection(
        scenario === undefined ? [] : [scenario],
      );
      const projected = projection.scenarios[0];
      const reading = projected?.readings.find(({ zoneId }) => zoneId === "zone-03");
      const reconciliation = projected?.reconciliation.find(({ zoneId }) => zoneId === "zone-03");

      expect(reading?.value).toBe("68");
      expect(reading?.sourceSpanIds).toEqual([sourceSpanId]);
      expect(reconciliation?.values).toEqual(["68"]);
      expect(reconciliation?.sourceSpanIds).toEqual([sourceSpanId]);
    },
  );

  it("keeps revision-2 truncated greenhouse evidence partial with explicit missing zones", async () => {
    const truncated = SIMULATOR_SCENARIO_CATALOG.find(
      ({ scenarioId, revision }) => scenarioId === "synthetic-truncated" && revision === 2,
    );
    expect(truncated).toBeDefined();

    const projection = await buildSimulatorDemoProjection(
      truncated === undefined ? [] : [truncated],
    );
    const scenario = projection.scenarios[0];

    expect(scenario).toMatchObject({
      scenarioId: "synthetic-truncated",
      revision: 2,
      observation: {
        outcome: "truncated",
        quality: "partial",
      },
      readings: [
        { zoneId: "zone-01", disposition: "grounded", value: "72.0" },
        { zoneId: "zone-02", disposition: "grounded", value: "67.5" },
        { zoneId: "zone-03", disposition: "missing", value: null },
        { zoneId: "zone-04", disposition: "missing", value: null },
      ],
      reconciliation: [
        { zoneId: "zone-01", disposition: "grounded", reasonCodes: [] },
        { zoneId: "zone-02", disposition: "grounded", reasonCodes: [] },
        {
          zoneId: "zone-03",
          disposition: "missing",
          values: [],
          reasonCodes: ["SOURCE_TRUNCATED"],
        },
        {
          zoneId: "zone-04",
          disposition: "missing",
          values: [],
          reasonCodes: ["SOURCE_TRUNCATED"],
        },
      ],
    });
  });
});
