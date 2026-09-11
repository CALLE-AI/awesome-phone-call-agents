import path from "node:path";

import { describe, expect, it } from "vitest";

interface ProductionBoundaryModule {
  readonly inspectProductionSimulatorBoundary: (input: {
    readonly repositoryRoot: string;
    readonly productionEntryMutation?: string;
  }) => Promise<{
    readonly importGraph: readonly string[];
    readonly violations: readonly string[];
  }>;
  readonly buildAndInspectProductionWeb: (repositoryRoot: string) => Promise<{
    readonly files: readonly string[];
    readonly forbiddenMarkers: readonly string[];
  }>;
  readonly buildAndInspectProductionArtifacts: (repositoryRoot: string) => Promise<{
    readonly applications: Readonly<
      Record<
        string,
        { readonly files: readonly string[]; readonly forbiddenMarkers: readonly string[] }
      >
    >;
    readonly forbiddenMarkers: readonly string[];
  }>;
}

async function loadProductionBoundary(): Promise<Partial<ProductionBoundaryModule>> {
  const moduleUrl = new URL("./simulator-production-boundary.ts", import.meta.url).href;
  try {
    return (await import(/* @vite-ignore */ moduleUrl)) as Partial<ProductionBoundaryModule>;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/iu.test(error.message)) {
      return {};
    }
    throw error;
  }
}

describe("simulator web composition boundary", () => {
  it("rejects a simulator import mutation and proves a fresh production artifact is clean", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const boundary = await loadProductionBoundary();

    expect(boundary.inspectProductionSimulatorBoundary).toBeDefined();
    expect(boundary.buildAndInspectProductionArtifacts).toBeDefined();
    const clean = await boundary.inspectProductionSimulatorBoundary?.({ repositoryRoot });
    expect(clean?.violations).toEqual([]);
    expect(clean?.importGraph).toContain("apps/web/src/App.tsx");
    expect(clean?.importGraph).not.toContain("apps/web/src/SimulatorApp.tsx");

    const mutated = await boundary.inspectProductionSimulatorBoundary?.({
      repositoryRoot,
      productionEntryMutation: 'import "./simulator-main.js";',
    });
    expect(mutated?.violations).toContain(
      "Production web import graph reaches demo-only simulator-main.tsx",
    );

    const artifact = await boundary.buildAndInspectProductionArtifacts?.(repositoryRoot);
    expect(artifact?.applications["web"]?.files).toContain("index.html");
    expect(artifact?.applications["web"]?.files).not.toContain("simulator.html");
    expect(artifact?.applications["web"]?.files.some((file) => /simulator/iu.test(file))).toBe(
      false,
    );
    expect(artifact?.applications["api"]?.files).toContain("main.js");
    expect(artifact?.applications["worker"]?.files).toContain("main.js");
    expect(artifact?.forbiddenMarkers).toEqual([]);
  }, 30_000);
});
