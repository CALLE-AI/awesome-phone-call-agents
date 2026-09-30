import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SIMULATOR_SCENARIO_CATALOG } from "../../packages/testing/dist/index.js";

interface ProjectionGeneratorModule {
  readonly buildSimulatorDemoProjection: (
    scenarios: typeof SIMULATOR_SCENARIO_CATALOG,
  ) => Promise<unknown>;
}

async function loadProjectionGenerator(): Promise<Partial<ProjectionGeneratorModule>> {
  const moduleUrl = new URL("../simulator/generate-demo-projection.ts", import.meta.url).href;
  try {
    return (await import(/* @vite-ignore */ moduleUrl)) as Partial<ProjectionGeneratorModule>;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/iu.test(error.message)) {
      return {};
    }
    throw error;
  }
}

describe("simulator demo projection", () => {
  it("is reproducibly generated from every canonical scenario without browser-source fixture facts", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const generator = await loadProjectionGenerator();

    expect(generator.buildSimulatorDemoProjection).toBeDefined();
    const expected = await generator.buildSimulatorDemoProjection?.(SIMULATOR_SCENARIO_CATALOG);
    const committedText = await readFile(
      path.join(repositoryRoot, "apps/web/src/generated/simulator-demo-projection.json"),
      "utf8",
    ).catch(() => "");
    expect(committedText).not.toBe("");
    expect(JSON.parse(committedText)).toEqual(expected);

    const projection = expected as {
      readonly scenarios: readonly {
        readonly scenarioId: string;
        readonly revision: number;
        readonly provenance: { readonly kind: string };
        readonly sourceEvidence: readonly { readonly span: unknown }[];
        readonly readings: readonly unknown[];
        readonly reconciliation: readonly unknown[];
        readonly observation: { readonly quality: string; readonly confidence: string };
        readonly versions: { readonly adapter: string; readonly extractor: string };
        readonly dispositions: unknown;
        readonly recoveryPredecessor: unknown;
      }[];
    };
    expect(projection.scenarios).toHaveLength(6);
    expect(projection.scenarios.map(({ scenarioId }) => scenarioId)).toEqual([
      "synthetic-normal",
      "synthetic-abnormal",
      "synthetic-ambiguous",
      "synthetic-no-answer",
      "synthetic-truncated",
      "synthetic-recovery",
    ]);
    expect(new Set(projection.scenarios.map(({ scenarioId }) => scenarioId)).size).toBe(6);
    expect(projection.scenarios.every(({ revision }) => revision === 2)).toBe(true);
    for (const scenario of projection.scenarios) {
      expect(scenario.provenance.kind).toBe("SIMULATED");
      expect(scenario.reconciliation).not.toHaveLength(0);
      expect(scenario.observation).toMatchObject({
        quality: expect.any(String),
        confidence: expect.any(String),
      });
      expect(scenario.versions).toEqual({
        adapter: "simulator_adapter_v1",
        extractor: "extractor_version_deterministic_v1",
      });
      expect(scenario.dispositions).toBeDefined();
      expect(scenario).toHaveProperty("recoveryPredecessor");
      for (const source of scenario.sourceEvidence) expect(source.span).toBeDefined();
    }

    const panelSource = await readFile(
      path.join(repositoryRoot, "apps/web/src/features/simulator/SimulatorScenarioPanel.tsx"),
      "utf8",
    );
    for (const scenario of SIMULATOR_SCENARIO_CATALOG) {
      for (const expectedValue of scenario.expectedValues) {
        expect(panelSource).not.toContain(expectedValue.value);
      }
      for (const segment of scenario.reportSegments) {
        expect(panelSource).not.toContain(segment.text);
      }
    }
  });
});
