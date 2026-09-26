import { describe, expect, it } from "vitest";

import * as boundaryApi from "./simulator-production-boundary.js";

describe("Phase 3 simulator-provider production exclusion", () => {
  it("detects simulator-host and CALL-E provider mutations in production manifests and source graphs", async () => {
    const inspect = (boundaryApi as Record<string, unknown>)["inspectProductionProviderExclusion"];
    expect(inspect).toBeTypeOf("function");

    const result = await (inspect as CallableFunction)({
      repositoryRoot: new URL("../..", import.meta.url).pathname.replace(
        /^\/(?:[A-Za-z]:)/u,
        (value) => value.slice(1),
      ),
      productionManifestMutations: Object.freeze({
        "apps/api/package.json": '"@muster/infrastructure-calle":"0.0.0"',
        "apps/worker/package.json": '"@muster/simulator-host":"0.0.0"',
        "apps/web/package.json": '"@call-e/calle":"0.2.0"',
      }),
      productionSourceMutations: Object.freeze({
        "apps/api/src/main.ts": 'import "@muster/simulator-host";',
        "apps/worker/src/main.ts": 'import "@muster/infrastructure-calle";',
        "apps/web/src/main.tsx": 'import "@muster/simulator-host";',
      }),
    });

    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/infrastructure-calle/u),
        expect.stringMatching(/simulator-host/u),
        expect.stringMatching(/apps\/worker/u),
        expect.stringMatching(/apps\/web/u),
      ]),
    );
  });

  it("traverses workspaceDirectory public roots from every production application entry", async () => {
    const inspect = (boundaryApi as Record<string, unknown>)["inspectProductionApplicationGraphs"];
    expect(inspect).toBeTypeOf("function");
    const repositoryRoot = new URL("../..", import.meta.url).pathname.replace(
      /^\/(?:[A-Za-z]:)/u,
      (value) => value.slice(1),
    );
    const clean = await (inspect as CallableFunction)({ repositoryRoot });
    expect(clean.violations).toEqual([]);
    expect(clean.importGraphs["apps/api/src/main.ts"]).toEqual(
      expect.arrayContaining(["apps/api/src/main.ts", "packages/application/src/index.ts"]),
    );
    expect(clean.importGraphs["apps/worker/src/main.ts"]).toEqual(
      expect.arrayContaining(["apps/worker/src/main.ts", "packages/application/src/index.ts"]),
    );
    expect(clean.importGraphs["apps/web/src/main.tsx"]).toEqual(
      expect.arrayContaining(["apps/web/src/main.tsx", "packages/api-client/src/index.ts"]),
    );

    for (const entry of [
      "apps/api/src/main.ts",
      "apps/worker/src/main.ts",
      "apps/web/src/main.tsx",
    ]) {
      const mutated = await (inspect as CallableFunction)({
        repositoryRoot,
        productionEntryMutations: { [entry]: 'import "@muster/infrastructure-calle";' },
      });
      expect(mutated.violations).toContain(
        `${entry} reaches @muster/infrastructure-calle through public root packages/infrastructure-calle/src/index.ts`,
      );
    }
  });
});
