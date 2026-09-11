import { describe, expect, it } from "vitest";

interface SimulatorPanelModule {
  readonly renderSimulatorScenarioMarkup: (scenarioId: string) => Promise<string>;
}

async function loadSimulatorPanel(): Promise<Partial<SimulatorPanelModule>> {
  const moduleUrl = new URL("./SimulatorScenarioPanel.test-support.tsx", import.meta.url).href;
  try {
    return (await import(/* @vite-ignore */ moduleUrl)) as Partial<SimulatorPanelModule>;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/iu.test(error.message)) {
      return {};
    }
    throw error;
  }
}

describe("SimulatorScenarioPanel", () => {
  it("renders an accessible abnormal result with explicit simulation and compatibility limits", async () => {
    const panel = await loadSimulatorPanel();

    expect(panel.renderSimulatorScenarioMarkup).toBeDefined();
    const markup = await panel.renderSimulatorScenarioMarkup?.("synthetic-abnormal");

    expect(markup).toContain('data-provenance="simulated"');
    expect(markup).toContain('aria-label="Simulated data—not physical hardware evidence"');
    expect(markup).toMatch(/SIMULATED/gu);
    expect(markup).toMatch(/Threshold exceeded/gu);
    expect(markup).toMatch(/Zone 3: 91 percent/gu);
    expect(markup).toMatch(/Zone 4: 20 percent/gu);
    expect(markup).toMatch(/simulator-tested/gu);
    expect(markup).toMatch(/does not prove physical hardware behavior/giu);
    expect(markup).toMatch(/Source span/gu);
    expect(markup).toMatch(/Expected-zone reconciliation/gu);
    expect(markup).toMatch(/Evidence quality/gu);
    expect(markup).toMatch(/Confidence/gu);
    expect(markup).toMatch(/simulator_adapter_v1/gu);
    expect(markup).toMatch(/extractor_version_deterministic_v1/gu);
    expect(markup?.indexOf('data-evidence-role="source"')).toBeLessThan(
      markup?.indexOf('data-evidence-role="interpretation"') ?? -1,
    );
  });

  it("fails closed for ambiguous evidence instead of rendering normal semantics", async () => {
    const panel = await loadSimulatorPanel();

    expect(panel.renderSimulatorScenarioMarkup).toBeDefined();
    const markup = await panel.renderSimulatorScenarioMarkup?.("synthetic-ambiguous");

    expect(markup).toMatch(/Observation incomplete—no operational decision made/gu);
    expect(markup).toMatch(/Zone 1/gu);
    expect(markup).toMatch(/contradictory/giu);
    expect(markup).toMatch(/SIMULATED/gu);
    expect(markup).not.toMatch(/>Healthy</gu);
    expect(markup).not.toMatch(/>Normal</gu);
  });

  it("fails closed when an explicit scenario ID is not in the generated catalog", async () => {
    const panel = await loadSimulatorPanel();

    expect(panel.renderSimulatorScenarioMarkup).toBeDefined();
    const markup = await panel.renderSimulatorScenarioMarkup?.("synthetic-unknown");

    expect(markup).toMatch(/Unrecognized result\u2014no operational decision made/gu);
    expect(markup).toMatch(/Cannot safely start this simulated run/gu);
    expect(markup).not.toMatch(/>Observation complete</gu);
    expect(markup).not.toMatch(/>Healthy</gu);
    expect(markup).not.toMatch(/>Normal</gu);
  });
});
