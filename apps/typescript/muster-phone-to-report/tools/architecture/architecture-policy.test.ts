import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface PolicyViolation {
  readonly code: string;
  readonly filePath: string;
  readonly message: string;
}

interface ArchitecturePolicyModule {
  analyzeArchitectureSource(input: {
    readonly filePath: string;
    readonly source: string;
  }): readonly PolicyViolation[];
  validateManifestDependencies(input: {
    readonly workspaceDirectory: string;
    readonly dependencies: Readonly<Record<string, string>>;
  }): readonly PolicyViolation[];
  validateToolchainPolicy(repositoryRoot: string): Promise<readonly PolicyViolation[]>;
  validateWorkspacePolicy(repositoryRoot: string): Promise<readonly PolicyViolation[]>;
}

interface SourcePolicyModule {
  analyzeProductionSource(input: {
    readonly filePath: string;
    readonly source: string;
  }): readonly PolicyViolation[];
  scanProductionSource(repositoryRoot: string): Promise<readonly PolicyViolation[]>;
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const expectedOverrides = {
  "deepmerge-ts": "8.0.2",
  "fast-uri@3.1.5": "3.1.6",
  "fast-uri@4.1.2": "4.1.3",
  "find-my-way": "9.7.0",
  "js-yaml": "4.3.2",
  mysql2: "3.24.2",
  nanoid: "3.3.18",
  qs: "6.16.0",
} as const;

async function loadArchitecturePolicy(): Promise<ArchitecturePolicyModule> {
  const moduleUrl = new URL("./architecture-policy.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as ArchitecturePolicyModule;
}

async function loadSourcePolicy(): Promise<SourcePolicyModule> {
  const moduleUrl = new URL("./forbidden-query-policy.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as SourcePolicyModule;
}

async function validateOverrideMutation(
  overrides: Readonly<Record<string, string>>,
): Promise<readonly PolicyViolation[]> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "muster-override-policy-"));
  const workspaceText = [
    "overrides:",
    ...Object.entries(overrides).map(
      ([packageName, version]) => `  ${JSON.stringify(packageName)}: ${JSON.stringify(version)}`,
    ),
    "",
  ].join("\n");

  try {
    await writeFile(join(temporaryRoot, "pnpm-workspace.yaml"), workspaceText, "utf8");
    const { validateToolchainPolicy } = await loadArchitecturePolicy();
    return (await validateToolchainPolicy(temporaryRoot)).filter(
      ({ code }) => code === "supply-chain/overrides",
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function expectCodes(
  violations: readonly PolicyViolation[],
  expectedCodes: readonly string[],
): void {
  const actualCodes = violations.map(({ code }) => code);
  for (const expectedCode of expectedCodes) {
    expect(actualCodes).toContain(expectedCode);
  }
}

describe("Phase 1 foundation policy", () => {
  // Test strategy: behavior-level cases cover the complete Phase 1 gate. Synthetic
  // mutations are independent oracles for each static policy. Later-phase runtime,
  // persistence, job, HTTP, OpenAPI generation, and observability behavior is deliberately
  // not tested here because Phase 1 must not pre-implement those capabilities.
  it("pins the supported toolchain, frozen install policy, supply-chain settings, and CI aggregate command", async () => {
    const { validateToolchainPolicy } = await loadArchitecturePolicy();

    const violations = await validateToolchainPolicy(repositoryRoot);

    expect(violations).toEqual([]);
  });

  it("keeps dependency lifecycle execution on the exact reviewed allow and deny map", async () => {
    const workspaceConfig = await readFile(
      new URL("../../pnpm-workspace.yaml", import.meta.url),
      "utf8",
    );
    const adr = await readFile(
      new URL("../../docs/adr/0001-modular-monolith-foundation.md", import.meta.url),
      "utf8",
    );

    expect(workspaceConfig).toContain('"@prisma/engines": true');
    expect(workspaceConfig).toContain("prisma: true");
    expect(workspaceConfig).toContain("cpu-features: false");
    expect(workspaceConfig).toContain("protobufjs: false");
    expect(workspaceConfig).toContain("ssh2: false");
    expect(workspaceConfig).not.toContain("dangerouslyAllowAllBuilds");
    expect(adr).toContain("exact lifecycle-script review map");
  });

  it("accepts the complete exact reviewed supply-chain override map", async () => {
    expect(await validateOverrideMutation(expectedOverrides)).toEqual([]);
  });

  it("rejects deletion of every reviewed supply-chain override", async () => {
    for (const packageName of Object.keys(expectedOverrides)) {
      const mutation = Object.fromEntries(
        Object.entries(expectedOverrides).filter(([name]) => name !== packageName),
      );

      expectCodes(await validateOverrideMutation(mutation), ["supply-chain/overrides"]);
    }
  });

  it("rejects the confirmed vulnerable dependency baselines", async () => {
    for (const [packageName, vulnerableVersion] of [
      ["nanoid", "3.3.17"],
      ["deepmerge-ts", "7.1.5"],
      ["fast-uri@3.1.5", "3.1.5"],
      ["fast-uri@4.1.2", "4.1.2"],
      ["js-yaml", "4.3.1"],
      ["mysql2", "3.15.3"],
      ["qs", "6.15.3"],
    ] as const) {
      expectCodes(
        await validateOverrideMutation({
          ...expectedOverrides,
          [packageName]: vulnerableVersion,
        }),
        ["supply-chain/overrides"],
      );
    }
  });

  it("rejects ranged or otherwise non-exact override values", async () => {
    for (const [packageName, nonExactVersion] of [
      ["nanoid", ">=3.3.18"],
      ["deepmerge-ts", "^8.0.2"],
      ["find-my-way", "~9.7.0"],
      ["js-yaml", "4.3.2 || 4.3.3"],
    ] as const) {
      expectCodes(
        await validateOverrideMutation({
          ...expectedOverrides,
          [packageName]: nonExactVersion,
        }),
        ["supply-chain/overrides"],
      );
    }
  });

  it("rejects an unreviewed extra supply-chain override", async () => {
    expectCodes(await validateOverrideMutation({ ...expectedOverrides, lodash: "4.17.21" }), [
      "supply-chain/overrides",
    ]);
  });

  it("defines strict native-ESM workspaceDirectory projects with explicit public exports and web-only bundler resolution", async () => {
    const { validateWorkspacePolicy } = await loadArchitecturePolicy();

    const violations = await validateWorkspacePolicy(repositoryRoot);

    expect(violations).toEqual([]);
  });

  it("rejects a representative forbidden import mutation at every package and composition boundary", async () => {
    const { analyzeArchitectureSource } = await loadArchitecturePolicy();
    const mutations = [
      ["packages/domain/src/mutation.ts", 'import "@muster/application";'],
      ["packages/domain/src/vendor-mutation.ts", 'import "@nestjs/common";'],
      ["packages/contracts/src/mutation.ts", 'import "@muster/domain";'],
      ["packages/application/src/mutation.ts", 'import "@muster/infrastructure-postgres";'],
      ["packages/application/src/vendor-mutation.ts", 'import "@prisma/client";'],
      ["packages/infrastructure-postgres/src/mutation.ts", 'import "@muster/infrastructure-jobs";'],
      ["packages/infrastructure-jobs/src/mutation.ts", 'import "@muster/infrastructure-postgres";'],
      ["packages/infrastructure-calle/src/mutation.ts", 'import "@muster/testing";'],
      [
        "packages/infrastructure-twilio-simulator/src/mutation.ts",
        'import "@muster/infrastructure-calle";',
      ],
      ["packages/observability/src/mutation.ts", 'import "@muster/infrastructure-postgres";'],
      ["packages/testing/src/mutation.ts", 'import "@muster/api";'],
      ["packages/api-client/src/mutation.ts", 'import "@muster/contracts";'],
      ["apps/web/src/mutation.ts", 'import "@muster/application";'],
      ["apps/api/src/system-health/mutation.ts", 'import "@muster/infrastructure-postgres";'],
      ["apps/worker/src/foundation-health/mutation.ts", 'import "@muster/infrastructure-jobs";'],
      ["apps/simulator-host/src/runtime/mutation.ts", 'import "@muster/testing";'],
    ] as const;

    for (const [filePath, source] of mutations) {
      expectCodes(analyzeArchitectureSource({ filePath, source }), [
        "architecture/dependency-direction",
      ]);
    }

    const allowedCompositionImports = [
      ["apps/api/src/composition/create-api-application.ts", "@muster/infrastructure-postgres"],
      ["apps/worker/src/composition/create-worker.ts", "@muster/infrastructure-jobs"],
      [
        "apps/simulator-host/src/composition/create-simulator-host.ts",
        "@muster/infrastructure-calle",
      ],
    ] as const;
    for (const [filePath, packageName] of allowedCompositionImports) {
      expect(analyzeArchitectureSource({ filePath, source: `import "${packageName}";` })).toEqual(
        [],
      );
    }
  });

  it("rejects cross-workspaceDirectory source-path shortcuts while accepting public package entry points", async () => {
    const { analyzeArchitectureSource } = await loadArchitecturePolicy();
    const publicImport = analyzeArchitectureSource({
      filePath: "packages/application/src/public.ts",
      source: 'import "@muster/domain";',
    });
    const sourceShortcut = analyzeArchitectureSource({
      filePath: "packages/application/src/shortcut.ts",
      source: 'import "@muster/domain/src/shared/internal.js";',
    });
    const relativeShortcut = analyzeArchitectureSource({
      filePath: "apps/api/src/shortcut.ts",
      source: 'import "../../../packages/application/src/index.js";',
    });

    expect(publicImport).toEqual([]);
    expectCodes(sourceShortcut, ["architecture/public-entry-only"]);
    expectCodes(relativeShortcut, ["architecture/public-entry-only"]);
  });

  it("keeps cross-cutting acceptance harnesses on public package-root test boundaries", async () => {
    const harness = await readFile(
      new URL("../../tests/e2e/support/fleet-health-test-runtime.ts", import.meta.url),
      "utf8",
    );
    const browserJourney = await readFile(
      new URL("../../tests/e2e/fleet-health-operations-view.spec.ts", import.meta.url),
      "utf8",
    );
    const phaseFourIntegration = await readFile(
      new URL(
        "../../tests/e2e/calle-twilio-greenhouse-qualification.integration.test.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const acceptanceSources = `${harness}\n${browserJourney}\n${phaseFourIntegration}`;

    expect(acceptanceSources).not.toMatch(/packages\/(?:[^/]+)\/(?:src|dist)\//u);
    expect(acceptanceSources).not.toMatch(/apps\/(?:[^/]+)\/(?:src|dist)\//u);
    for (const packageRoot of [
      "@muster/api",
      "@muster/api-client",
      "@muster/application",
      "@muster/domain",
      "@muster/infrastructure-jobs",
      "@muster/simulator-host",
      "@muster/testing",
      "@muster/worker",
    ]) {
      expect(acceptanceSources).toContain(`from "${packageRoot}"`);
    }
  });

  it("rejects external, Node-only, vendor, and environment access outside approved roles", async () => {
    const { analyzeArchitectureSource } = await loadArchitecturePolicy();
    const rejectedMutations = [
      ["packages/contracts/src/prisma-leak.ts", 'import type { Prisma } from "@prisma/client";'],
      ["packages/api-client/src/server-leak.ts", 'import type { FastifyInstance } from "fastify";'],
      ["apps/web/src/node-leak.ts", 'import { readFile } from "node:fs/promises";'],
      ["packages/infrastructure-postgres/src/job-leak.ts", 'import PgBoss from "pg-boss";'],
      [
        "packages/infrastructure-jobs/src/prisma-leak.ts",
        'import { PrismaClient } from "@prisma/client";',
      ],
      [
        "packages/observability/src/prisma-leak.ts",
        'import { PrismaClient } from "@prisma/client";',
      ],
    ] as const;

    for (const [filePath, source] of rejectedMutations) {
      expectCodes(analyzeArchitectureSource({ filePath, source }), [
        "architecture/external-dependency",
      ]);
    }

    for (const filePath of [
      "packages/domain/src/config.ts",
      "packages/application/src/config.ts",
      "packages/contracts/src/config.ts",
      "packages/api-client/src/config.ts",
      "apps/web/src/config.ts",
    ]) {
      expectCodes(
        analyzeArchitectureSource({
          filePath,
          source: 'export const value = process.env["DATABASE_URL"];',
        }),
        ["architecture/environment-access"],
      );
    }

    const allowedMutations = [
      [
        "packages/infrastructure-postgres/src/adapter.ts",
        'import { PrismaClient } from "@prisma/client";',
      ],
      ["packages/infrastructure-jobs/src/adapter.ts", 'import PgBoss from "pg-boss";'],
      ["packages/observability/src/logger.ts", 'import pino from "pino";'],
      ["apps/api/src/http/controller.ts", 'import type { FastifyRequest } from "fastify";'],
      ["apps/web/src/view.tsx", 'import React from "react";'],
    ] as const;
    for (const [filePath, source] of allowedMutations) {
      expect(analyzeArchitectureSource({ filePath, source })).toEqual([]);
    }
  });

  it("rejects forbidden external packages declared in workspaceDirectory manifests", async () => {
    const { validateManifestDependencies } = await loadArchitecturePolicy();
    const rejectedDependencies = [
      ["packages/contracts", "@prisma/client"],
      ["packages/api-client", "fastify"],
      ["apps/web", "@nestjs/common"],
      ["packages/infrastructure-postgres", "pg-boss"],
      ["packages/infrastructure-jobs", "@prisma/client"],
    ] as const;
    for (const [workspaceDirectory, packageName] of rejectedDependencies) {
      expectCodes(
        validateManifestDependencies({
          workspaceDirectory,
          dependencies: { [packageName]: "1.0.0" },
        }),
        ["workspace/external-dependency"],
      );
    }

    expect(
      validateManifestDependencies({
        workspaceDirectory: "packages/infrastructure-postgres",
        dependencies: { "@prisma/client": "7.0.0" },
      }),
    ).toEqual([]);
    expect(
      validateManifestDependencies({
        workspaceDirectory: "packages/infrastructure-jobs",
        dependencies: { "pg-boss": "12.27.0" },
      }),
    ).toEqual([]);
  });

  it("rejects Prisma raw-query APIs and inline SQL without flagging ordinary strings", async () => {
    const { analyzeProductionSource, scanProductionSource } = await loadSourcePolicy();
    const mutations = [
      "await prisma.$queryRaw`SELECT 1`;",
      "await prisma.$queryRawUnsafe(query);",
      "await prisma.$executeRaw`DELETE FROM audit_events`;",
      "await prisma.$executeRawUnsafe(query);",
      "const fragment = Prisma.sql`SELECT id FROM audit_events`;",
      'const query = "SELECT id FROM audit_events WHERE id = ?";',
      "const queryRaw = prisma.$queryRaw;",
      "const { $executeRaw: executeRaw } = prisma;",
      'const queryRawUnsafe = prisma["$queryRawUnsafe"];',
      "aliases.execute = prisma.$executeRawUnsafe;",
    ];

    for (const source of mutations) {
      expect(
        analyzeProductionSource({
          filePath: "packages/infrastructure-postgres/src/mutation.ts",
          source,
        }),
      ).not.toEqual([]);
    }
    expect(
      analyzeProductionSource({
        filePath: "packages/domain/src/message.ts",
        source: 'export const message = "select an organization";',
      }),
    ).toEqual([]);
    expect(await scanProductionSource(repositoryRoot)).toEqual([]);
  });

  it("rejects production console calls while excluding tests and non-production policy tooling", async () => {
    const { analyzeProductionSource } = await loadSourcePolicy();
    const productionSource = "console.log('unsafe'); console.error('unsafe');";

    expectCodes(
      analyzeProductionSource({
        filePath: "apps/api/src/main.ts",
        source: productionSource,
      }),
      ["source/no-console"],
    );
    expect(
      analyzeProductionSource({
        filePath: "apps/api/src/main.test.ts",
        source: productionSource,
      }),
    ).toEqual([]);
    expect(
      analyzeProductionSource({
        filePath: "tools/architecture/synthetic-fixture.ts",
        source: productionSource,
      }),
    ).toEqual([]);

    const taskText = await readFile(
      new URL("../../docs/architecture/foundation-safety.md", import.meta.url),
      "utf8",
    );
    expect(taskText).toContain("NO-GO");
  });

  it("ratifies the approved boundary-driven coding rules in durable system patterns", async () => {
    const systemPatterns = await readFile(
      new URL("../../docs/architecture/system-patterns.md", import.meta.url),
      "utf8",
    );

    for (const rule of [
      "Repository-only persistence",
      "Secret-safe operations",
      "Dependency inversion",
      "SOLID capability boundaries",
      "Versioned extensibility",
      "No speculative framework",
      "Mechanical evidence",
    ]) {
      expect(systemPatterns).toContain(rule);
    }
  });

  it("rejects service locators, empty capabilities, and generic base repositories as boundary mutations", async () => {
    const { analyzeArchitectureSource } = await loadArchitecturePolicy();
    const mutations = [
      [
        "packages/application/src/simulator/service-locator-mutation.ts",
        'export const repository = ServiceLocator.get("live-simulator-authorization");',
        "architecture/service-locator",
      ],
      [
        "packages/application/src/ports/empty-capability-mutation.ts",
        "export interface EvidenceCustody {}",
        "architecture/speculative-abstraction",
      ],
      [
        "packages/application/src/ports/generic-repository-mutation.ts",
        "export interface BaseRepository<T> { save(value: T): Promise<void>; }",
        "architecture/speculative-abstraction",
      ],
    ] as const;

    for (const [filePath, source, expectedCode] of mutations) {
      expectCodes(analyzeArchitectureSource({ filePath, source }), [expectedCode]);
    }
  });
});
