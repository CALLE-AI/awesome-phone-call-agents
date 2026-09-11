import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface ToolchainViolation {
  readonly code: string;
  readonly message: string;
}

interface ToolchainPolicyModule {
  inspectToolchain(input: {
    readonly nodeVersion: string;
    readonly pnpmVersion: string;
  }): readonly ToolchainViolation[];
}

interface ScriptResult {
  readonly exitCode: number;
  readonly output: string;
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const generatedPrismaRoot = join(
  repositoryRoot,
  "packages",
  "infrastructure-postgres",
  "src",
  "generated",
  "prisma",
);

async function listTypeScriptFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

async function readGeneratedPrismaSources(): Promise<Readonly<Record<string, string>>> {
  const files = await listTypeScriptFiles(generatedPrismaRoot);
  return Object.freeze(
    Object.fromEntries(
      await Promise.all(
        files.map(async (path) => [
          relative(generatedPrismaRoot, path),
          await readFile(path, "utf8"),
        ]),
      ),
    ),
  );
}

async function runPnpmScriptWithoutDatabaseConfiguration(script: string): Promise<ScriptResult> {
  const environment = { ...process.env };
  delete environment["DATABASE_URL"];
  delete environment["MIGRATION_DATABASE_URL"];

  return await new Promise<ScriptResult>((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", script], {
      cwd: repositoryRoot,
      env: environment,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, output: Buffer.concat(output).toString("utf8") });
    });
  });
}

async function loadToolchainPolicy(): Promise<ToolchainPolicyModule> {
  const moduleUrl = new URL("./verify-toolchain.mjs", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as ToolchainPolicyModule;
}

describe("exact foundation toolchain", () => {
  it("accepts exactly Node 24.18.0 with pnpm 11.20.0", async () => {
    const { inspectToolchain } = await loadToolchainPolicy();

    expect(inspectToolchain({ nodeVersion: "24.18.0", pnpmVersion: "11.20.0" })).toEqual([]);
  });

  it("rejects every Node or pnpm mismatch deterministically", async () => {
    const { inspectToolchain } = await loadToolchainPolicy();

    expect(inspectToolchain({ nodeVersion: "22.17.0", pnpmVersion: "11.20.0" })).toEqual([
      expect.objectContaining({ code: "toolchain/node-version" }),
    ]);
    expect(inspectToolchain({ nodeVersion: "24.18.0", pnpmVersion: "11.9.0" })).toEqual([
      expect.objectContaining({ code: "toolchain/pnpm-version" }),
    ]);
    expect(inspectToolchain({ nodeVersion: "24.14.0", pnpmVersion: "11.9.0" })).toEqual([
      expect.objectContaining({ code: "toolchain/node-version" }),
      expect.objectContaining({ code: "toolchain/pnpm-version" }),
    ]);
  });

  it("runs non-connecting Prisma schema tooling without caller database configuration", async () => {
    // Test strategy: exercise the two pre-test Prisma stages owned by the aggregate command
    // and retain the migration boundary as an independent fail-closed oracle. A live database,
    // runtime composition, and Prisma internals are deliberately not tested here.
    const validation = await runPnpmScriptWithoutDatabaseConfiguration("prisma:validate");
    const generation = await runPnpmScriptWithoutDatabaseConfiguration("prisma:generate");
    const migration = await runPnpmScriptWithoutDatabaseConfiguration("prisma:migrate:deploy");

    expect(validation, validation.output).toMatchObject({ exitCode: 0 });
    expect(generation, generation.output).toMatchObject({ exitCode: 0 });
    expect(migration.exitCode).not.toBe(0);
    expect(migration.output).toContain("MIGRATION_DATABASE_URL");
  }, 30_000);

  it("generates byte-stable Prisma TypeScript with LF lines and no trailing whitespace", async () => {
    const preGenerationSources = await readGeneratedPrismaSources();
    const firstGeneration = await runPnpmScriptWithoutDatabaseConfiguration("prisma:generate");
    const firstSources = await readGeneratedPrismaSources();
    const secondGeneration = await runPnpmScriptWithoutDatabaseConfiguration("prisma:generate");
    const secondSources = await readGeneratedPrismaSources();
    const hygieneViolations = Object.entries(secondSources).flatMap(([path, source]) => {
      const violations: string[] = [];
      if (source.includes("\r")) {
        violations.push(`${path}: contains CR characters`);
      }
      if (source.split("\n").some((line) => /[\t ]+$/u.test(line))) {
        violations.push(`${path}: contains trailing whitespace`);
      }
      return violations;
    });

    expect(firstGeneration, firstGeneration.output).toMatchObject({ exitCode: 0 });
    expect(secondGeneration, secondGeneration.output).toMatchObject({ exitCode: 0 });
    expect(firstSources).toEqual(preGenerationSources);
    expect(secondSources).toEqual(firstSources);
    expect(hygieneViolations).toEqual([]);
  }, 30_000);
});
