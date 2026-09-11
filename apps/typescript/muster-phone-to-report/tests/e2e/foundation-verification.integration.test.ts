import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  deployMigrations,
  getPostgresTestConnectionUrls,
  hasMigrationDrift,
} from "@muster/testing";

import { analyzeArchitectureSource } from "../../tools/architecture/architecture-policy.js";
import { analyzeProductionSource } from "../../tools/architecture/forbidden-query-policy.js";
import { checkGeneratedClient } from "../../tools/openapi/check-generated-client.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const committedGeneratedClient = join(repositoryRoot, "packages/api-client/src/generated");
const committedPrismaSchema = join(repositoryRoot, "prisma/schema.prisma");
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

describe.sequential("clean-checkout and CI verification evidence", () => {
  it("declares the exact supply-chain policy, frozen lockfile, and aggregate CI commands", async () => {
    const manifest = JSON.parse(await readFile(`${repositoryRoot}/package.json`, "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const workspace = parse(await readFile(`${repositoryRoot}/pnpm-workspace.yaml`, "utf8")) as {
      readonly overrides?: Readonly<Record<string, string>>;
    };
    const lockfile = parse(await readFile(`${repositoryRoot}/pnpm-lock.yaml`, "utf8")) as {
      readonly overrides?: Readonly<Record<string, string>>;
    };
    const workflow = await readFile(
      `${repositoryRoot}/.github/workflows/verify-foundation.yml`,
      "utf8",
    );
    const workflowRunCommands = [...workflow.matchAll(/^\s*run:\s*([^\r\n]+?)\s*$/gmu)].map(
      (match) => match[1]?.trim(),
    );

    expect(manifest.scripts["verify:foundation"]).toContain("test:e2e");
    expect(manifest.scripts["verify:foundation"]).toContain("test:browser");
    expect(manifest.scripts["verify:supply-chain"]).toBe("corepack pnpm audit --audit-level high");
    expect(manifest.scripts["verify:foundation"]).toContain(
      "corepack pnpm run verify:supply-chain",
    );
    expect(workspace.overrides).toEqual(expectedOverrides);
    expect(lockfile.overrides).toEqual(expectedOverrides);
    expect(
      workflowRunCommands.filter((command) => command?.includes("pnpm verify:foundation")),
    ).toEqual(["corepack pnpm verify:foundation"]);
    expect(workflowRunCommands.filter((command) => command?.includes("pnpm install"))).toEqual([
      "corepack pnpm install --frozen-lockfile",
    ]);
    expect(workflow).toContain("playwright install --with-deps chromium");
    expect(workflow).not.toMatch(/DATABASE_URL|MIGRATION_DATABASE_URL|CALL-E|Sensaphone/iu);
  });

  it("proves boundary, query, generated-client, and migration mutations have independent gates", async () => {
    expect(
      analyzeArchitectureSource({
        filePath: "packages/application/src/mutation.ts",
        source: 'import "@muster/infrastructure-postgres";',
      }).map(({ code }) => code),
    ).toContain("architecture/dependency-direction");
    expect(
      analyzeProductionSource({
        filePath: "packages/infrastructure-postgres/src/mutation.ts",
        source: "await prisma.$queryRaw`SELECT 1`;",
      }).map(({ code }) => code),
    ).toContain("source/raw-query-api");

    const temporaryRoot = await mkdtemp(join(tmpdir(), "muster-foundation-drift-"));
    const generatedClientTarget = join(temporaryRoot, "generated");
    const generatedSchemaTarget = join(generatedClientTarget, "schema.ts");
    const prismaSchemaTarget = join(temporaryRoot, "schema.prisma");
    const committedGeneratedSchema = join(committedGeneratedClient, "schema.ts");
    const committedGeneratedSource = await readFile(committedGeneratedSchema, "utf8");
    const committedPrismaSource = await readFile(committedPrismaSchema, "utf8");
    try {
      await cp(committedGeneratedClient, generatedClientTarget, { recursive: true });
      await writeFile(
        generatedSchemaTarget,
        `${committedGeneratedSource}// intentional temporary drift\n`,
        "utf8",
      );
      const driftedPrismaSource = committedPrismaSource.replace(
        /([ ]{2}outcome[ ]{8}AuditEventOutcome)(\r?\n)/u,
        '$1$2  reviewDriftProbe String? @map("review_drift_probe")$2',
      );
      expect(driftedPrismaSource).not.toBe(committedPrismaSource);
      await writeFile(prismaSchemaTarget, driftedPrismaSource, "utf8");

      const databaseUrl = getPostgresTestConnectionUrls().repository;
      await deployMigrations(databaseUrl);
      const generatedClientResult = await checkGeneratedClient(generatedClientTarget);
      const migrationDrift = await hasMigrationDrift(databaseUrl, prismaSchemaTarget);

      expect.soft(generatedClientResult).toEqual({ valid: true, drift: true });
      expect.soft(migrationDrift).toBe(true);
      expect(await readFile(committedGeneratedSchema, "utf8")).toBe(committedGeneratedSource);
      expect(await readFile(committedPrismaSchema, "utf8")).toBe(committedPrismaSource);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }, 30_000);
});
