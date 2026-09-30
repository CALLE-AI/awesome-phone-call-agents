import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { LIVE_DEMO_REVIEW_PRODUCTION_MARKERS } from "./live-demo-review-isolation.js";

const sourceImportPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
const forbiddenProductionMarkers = [
  "Simulator Lab",
  "simulator-main",
  "simulator.html",
  "/simulator",
  "simulator-demo-projection",
  "Replay simulated scenario",
  "Run live observation",
  "simulator-live-client",
  "LiveSimulatorControls",
  "/api/v1/live-simulator/",
  "/twilio/voice",
  "/twilio/canary",
  "/twilio/status",
  "simulator:live-smoke:preflight",
  "twilio-live-smoke-control",
  "live-smoke-evidence-coordinator",
  "SIMULATOR_RUN_GATE",
  "NGROK",
  "synthetic-normal",
  "@muster/infrastructure-calle",
  "@muster/simulator-host",
  "@call-e/calle",
  ...LIVE_DEMO_REVIEW_PRODUCTION_MARKERS,
] as const;

const productionProviderMarkers = [
  "@muster/infrastructure-calle",
  "@muster/simulator-host",
  "@call-e/calle",
] as const;

const productionBuildEnvironmentAllowlist = Object.freeze([
  "CI",
  "COMSPEC",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "WINDIR",
] as const);

export function createProductionBuildEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const name of productionBuildEnvironmentAllowlist) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return Object.freeze(environment);
}

export async function inspectProductionProviderExclusion(input: {
  readonly repositoryRoot: string;
  readonly productionManifestMutations?: Readonly<Record<string, string>>;
  readonly productionSourceMutations?: Readonly<Record<string, string>>;
}): Promise<{ readonly violations: readonly string[] }> {
  const productionFiles = [
    "apps/api/package.json",
    "apps/worker/package.json",
    "apps/web/package.json",
    "apps/api/src/main.ts",
    "apps/worker/src/main.ts",
    "apps/web/src/main.tsx",
  ] as const;
  const violations: string[] = [];
  for (const filePath of productionFiles) {
    let source = await readFile(path.join(input.repositoryRoot, filePath), "utf8");
    source += `\n${input.productionManifestMutations?.[filePath] ?? ""}`;
    source += `\n${input.productionSourceMutations?.[filePath] ?? ""}`;
    for (const marker of productionProviderMarkers) {
      if (source.includes(marker)) {
        violations.push(`Production file ${filePath} reaches ${marker}`);
      }
    }
  }
  return Object.freeze({ violations: Object.freeze(violations) });
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

async function sourceFileForSpecifier(
  repositoryRoot: string,
  importer: string,
  specifier: string,
): Promise<string | undefined> {
  if (specifier.startsWith("@muster/")) {
    const packageDirectories = ["apps", "packages"] as const;
    for (const directory of packageDirectories) {
      const entries = await readdir(path.join(repositoryRoot, directory), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const packageRoot = path.join(repositoryRoot, directory, entry.name);
        try {
          const manifest = JSON.parse(
            await readFile(path.join(packageRoot, "package.json"), "utf8"),
          ) as {
            readonly name?: string;
          };
          if (manifest.name !== specifier) continue;
          return normalizePath(
            path.relative(repositoryRoot, path.join(packageRoot, "src/index.ts")),
          );
        } catch {
          // Ignore directories that are not workspaceDirectory packages.
        }
      }
    }
    return undefined;
  }
  if (!specifier.startsWith(".")) return undefined;
  const unresolved = path.resolve(repositoryRoot, path.dirname(importer), specifier);
  const extension = path.extname(unresolved);
  const candidates =
    extension === ".js"
      ? [`${unresolved.slice(0, -3)}.ts`, `${unresolved.slice(0, -3)}.tsx`]
      : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`];
  for (const candidate of candidates) {
    try {
      const status = await readFile(candidate, "utf8");
      if (status.length >= 0) return normalizePath(path.relative(repositoryRoot, candidate));
    } catch {
      // A non-source or missing relative import is outside this TypeScript import graph.
    }
  }
  return undefined;
}

async function collectProductionImportGraph(input: {
  readonly repositoryRoot: string;
  readonly entry: string;
  readonly productionEntryMutation?: string;
}): Promise<readonly string[]> {
  const entry = input.entry;
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const filePath = pending.shift();
    if (filePath === undefined || visited.has(filePath)) continue;
    visited.add(filePath);
    let source = await readFile(path.join(input.repositoryRoot, filePath), "utf8");
    if (filePath === entry && input.productionEntryMutation !== undefined) {
      source = `${source}\n${input.productionEntryMutation}`;
    }
    for (const match of source.matchAll(sourceImportPattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = await sourceFileForSpecifier(input.repositoryRoot, filePath, specifier);
      if (resolved !== undefined && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return [...visited].sort();
}

export async function inspectProductionSimulatorBoundary(input: {
  readonly repositoryRoot: string;
  readonly productionEntryMutation?: string;
}): Promise<{
  readonly importGraph: readonly string[];
  readonly violations: readonly string[];
}> {
  const importGraph = await collectProductionImportGraph({
    ...input,
    entry: "apps/web/src/main.tsx",
  });
  const simulatorEntry = importGraph.find((filePath) =>
    /(?:^|\/)simulator-main\.tsx$/iu.test(filePath),
  );
  const simulatorModule = importGraph.find((filePath) =>
    /(?:^|\/)(?:SimulatorApp|features\/simulator\/[^/]+)\.tsx$/u.test(filePath),
  );
  const violations = [
    ...(simulatorEntry === undefined
      ? []
      : ["Production web import graph reaches demo-only simulator-main.tsx"]),
    ...(simulatorModule === undefined
      ? []
      : [`Production web import graph reaches demo-only module ${simulatorModule}`]),
  ];
  return { importGraph, violations };
}

export async function inspectProductionApplicationGraphs(input: {
  readonly repositoryRoot: string;
  readonly productionEntryMutations?: Readonly<Record<string, string>>;
}): Promise<{
  readonly importGraphs: Readonly<Record<string, readonly string[]>>;
  readonly violations: readonly string[];
}> {
  const entries = ["apps/api/src/main.ts", "apps/worker/src/main.ts", "apps/web/src/main.tsx"];
  const importGraphs: Record<string, readonly string[]> = {};
  const violations: string[] = [];
  for (const entry of entries) {
    const mutation = input.productionEntryMutations?.[entry];
    const graph = await collectProductionImportGraph({
      repositoryRoot: input.repositoryRoot,
      entry,
      ...(mutation === undefined ? {} : { productionEntryMutation: mutation }),
    });
    importGraphs[entry] = graph;
    for (const filePath of graph) {
      if (filePath.startsWith("packages/infrastructure-calle/")) {
        violations.push(
          `${entry} reaches @muster/infrastructure-calle through public root ${filePath}`,
        );
      }
      if (filePath.startsWith("apps/simulator-host/")) {
        violations.push(`${entry} reaches @muster/simulator-host through public root ${filePath}`);
      }
      const source = await readFile(path.join(input.repositoryRoot, filePath), "utf8");
      for (const marker of productionProviderMarkers) {
        if (source.includes(marker)) {
          violations.push(`${entry} reaches ${marker} through public root ${filePath}`);
        }
      }
    }
  }
  return Object.freeze({
    importGraphs: Object.freeze(importGraphs),
    violations: Object.freeze(violations),
  });
}

async function runProductionBuild(repositoryRoot: string): Promise<void> {
  const typescriptCli = path.join(repositoryRoot, "node_modules/typescript/bin/tsc");
  const viteCli = path.join(repositoryRoot, "apps/web/node_modules/vite/bin/vite.js");
  await runNodeCli(
    repositoryRoot,
    typescriptCli,
    ["-b", "packages/api-client", "--pretty", "false"],
    "API client build",
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [viteCli, "build", "apps/web", "--mode", "production"], {
      cwd: repositoryRoot,
      env: createProductionBuildEnvironment(process.env),
      stdio: "pipe",
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (value: string) => {
      errorOutput += value;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Production web build failed: ${errorOutput.trim()}`));
    });
  });
}

async function runNodeCli(
  repositoryRoot: string,
  executable: string,
  args: readonly string[],
  label: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: repositoryRoot,
      env: createProductionBuildEnvironment(process.env),
      stdio: "pipe",
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (value: string) => {
      errorOutput += value;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed: ${errorOutput.trim()}`));
    });
  });
}

async function listFiles(directory: string, base = directory): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(absolutePath, base)));
    else files.push(normalizePath(path.relative(base, absolutePath)));
  }
  return files.sort();
}

export async function buildAndInspectProductionWeb(repositoryRoot: string): Promise<{
  readonly files: readonly string[];
  readonly forbiddenMarkers: readonly string[];
}> {
  await runProductionBuild(repositoryRoot);
  const outputDirectory = path.join(repositoryRoot, "apps/web/dist");
  const files = await listFiles(outputDirectory);
  const forbiddenMarkers: string[] = [];
  for (const file of files) {
    const content = await readFile(path.join(outputDirectory, file), "utf8");
    for (const marker of forbiddenProductionMarkers) {
      if (content.includes(marker)) forbiddenMarkers.push(`${file}: ${marker}`);
    }
  }
  return { files, forbiddenMarkers };
}

export async function buildAndInspectProductionArtifacts(repositoryRoot: string): Promise<{
  readonly applications: Readonly<
    Record<
      string,
      { readonly files: readonly string[]; readonly forbiddenMarkers: readonly string[] }
    >
  >;
  readonly forbiddenMarkers: readonly string[];
}> {
  const typescriptCli = path.join(repositoryRoot, "node_modules/typescript/bin/tsc");
  await runNodeCli(
    repositoryRoot,
    typescriptCli,
    ["-b", "apps/api", "apps/worker", "--pretty", "false"],
    "Production API/worker build",
  );
  await runProductionBuild(repositoryRoot);

  const applications: Record<
    string,
    { readonly files: readonly string[]; readonly forbiddenMarkers: readonly string[] }
  > = {};
  const aggregate: string[] = [];
  for (const application of ["api", "worker", "web"] as const) {
    const outputDirectory = path.join(repositoryRoot, "apps", application, "dist");
    const files = await listFiles(outputDirectory);
    const violations: string[] = [];
    for (const file of files.filter((candidate) =>
      /\.(?:c?m?js|html|json|map)$/iu.test(candidate),
    )) {
      const content = await readFile(path.join(outputDirectory, file), "utf8");
      for (const marker of forbiddenProductionMarkers) {
        if (content.includes(marker)) violations.push(`${file}: ${marker}`);
      }
    }
    applications[application] = Object.freeze({
      files,
      forbiddenMarkers: Object.freeze(violations),
    });
    aggregate.push(...violations.map((violation) => `${application}/${violation}`));
  }
  return Object.freeze({
    applications: Object.freeze(applications),
    forbiddenMarkers: Object.freeze(aggregate),
  });
}
