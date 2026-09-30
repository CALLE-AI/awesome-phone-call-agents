import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";
import { parse } from "yaml";

export interface PolicyViolation {
  readonly code: string;
  readonly filePath: string;
  readonly message: string;
}

interface ArchitectureSourceInput {
  readonly filePath: string;
  readonly source: string;
}

interface ManifestDependenciesInput {
  readonly workspaceDirectory: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

interface WorkspaceDefinition {
  readonly directory: string;
  readonly entryPoint: string;
  readonly publicPackage: boolean;
  readonly resolution: "bundler" | "node";
}

type JsonObject = Record<string, unknown>;

const expectedWorkspaces: readonly WorkspaceDefinition[] = [
  {
    directory: "packages/domain",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/contracts",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/application",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/infrastructure-postgres",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/infrastructure-local-evidence",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/infrastructure-jobs",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/infrastructure-calle",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/infrastructure-twilio-simulator",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/observability",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/testing",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  {
    directory: "packages/api-client",
    entryPoint: "src/index.ts",
    publicPackage: true,
    resolution: "node",
  },
  { directory: "apps/api", entryPoint: "src/main.ts", publicPackage: false, resolution: "node" },
  { directory: "apps/worker", entryPoint: "src/main.ts", publicPackage: false, resolution: "node" },
  {
    directory: "apps/simulator-host",
    entryPoint: "src/main.ts",
    publicPackage: false,
    resolution: "node",
  },
  {
    directory: "apps/web",
    entryPoint: "src/main.tsx",
    publicPackage: false,
    resolution: "bundler",
  },
];

const allowedWorkspaceImports: Readonly<Record<string, ReadonlySet<string>>> = {
  "packages/domain": new Set(),
  "packages/contracts": new Set(),
  "packages/application": new Set(["@muster/domain", "@muster/contracts"]),
  "packages/infrastructure-postgres": new Set(["@muster/domain", "@muster/application"]),
  "packages/infrastructure-local-evidence": new Set(["@muster/application"]),
  "packages/infrastructure-jobs": new Set(["@muster/application", "@muster/contracts"]),
  "packages/infrastructure-calle": new Set(["@muster/application"]),
  "packages/infrastructure-twilio-simulator": new Set([
    "@muster/application",
    "@muster/contracts",
    "@muster/domain",
  ]),
  "packages/observability": new Set(["@muster/application"]),
  "packages/testing": new Set(["@muster/domain", "@muster/application", "@muster/contracts"]),
  "packages/api-client": new Set(["@muster/testing"]),
  "apps/api": new Set(["@muster/application", "@muster/contracts"]),
  "apps/worker": new Set(["@muster/application", "@muster/contracts"]),
  "apps/simulator-host": new Set(["@muster/application", "@muster/contracts", "@muster/domain"]),
  "apps/web": new Set(["@muster/api-client"]),
};

const compositionOnlyPackages = new Set([
  "@muster/infrastructure-postgres",
  "@muster/infrastructure-jobs",
  "@muster/infrastructure-local-evidence",
  "@muster/infrastructure-calle",
  "@muster/infrastructure-twilio-simulator",
  "@muster/observability",
  "@muster/testing",
]);

const allowedExternalPackages: Readonly<Record<string, ReadonlySet<string>>> = {
  "packages/domain": new Set(),
  "packages/contracts": new Set(),
  "packages/application": new Set(),
  "packages/infrastructure-postgres": new Set(["@prisma/adapter-pg", "@prisma/client", "pg"]),
  "packages/infrastructure-local-evidence": new Set(),
  "packages/infrastructure-jobs": new Set(["pg-boss"]),
  "packages/infrastructure-calle": new Set(["@call-e/calle"]),
  "packages/infrastructure-twilio-simulator": new Set(["twilio"]),
  "packages/observability": new Set(["pino"]),
  "packages/testing": new Set(["@testcontainers/postgresql", "testcontainers", "vitest"]),
  "packages/api-client": new Set(),
  "apps/api": new Set(["@nestjs/common", "@nestjs/core", "@nestjs/platform-fastify", "fastify"]),
  "apps/worker": new Set(["@nestjs/common", "@nestjs/core"]),
  "apps/simulator-host": new Set(["pg"]),
  "apps/web": new Set(["react", "react-dom", "vite"]),
};

const compositionOnlyExternalPackages = new Set([
  "@prisma/adapter-pg",
  "@prisma/client",
  "pg",
  "pg-boss",
  "pino",
  "reflect-metadata",
]);

const allowedManifestOnlyExternalPackages: Readonly<Record<string, ReadonlySet<string>>> = {
  "packages/api-client": new Set(["vite"]),
  "apps/api": new Set(["rxjs"]),
  "apps/web": new Set(["@types/react", "@types/react-dom"]),
  "apps/simulator-host": new Set(["@types/pg"]),
};

const nodeImportForbiddenWorkspaces = new Set([
  "packages/application",
  "packages/contracts",
  "packages/api-client",
  "apps/web",
]);

const environmentAccessForbiddenWorkspaces = new Set([
  "packages/domain",
  "packages/application",
  "packages/contracts",
  "packages/api-client",
  "apps/web",
]);

const allowedManifestDependencies: Readonly<Record<string, ReadonlySet<string>>> = {
  ...allowedWorkspaceImports,
  "apps/api": new Set([
    "@muster/application",
    "@muster/contracts",
    "@muster/infrastructure-postgres",
    "@muster/infrastructure-jobs",
    "@muster/observability",
    "@muster/testing",
  ]),
  "apps/worker": new Set([
    "@muster/application",
    "@muster/contracts",
    "@muster/infrastructure-postgres",
    "@muster/infrastructure-jobs",
    "@muster/observability",
  ]),
  "apps/simulator-host": new Set([
    "@muster/application",
    "@muster/contracts",
    "@muster/domain",
    "@muster/infrastructure-calle",
    "@muster/infrastructure-jobs",
    "@muster/infrastructure-local-evidence",
    "@muster/infrastructure-postgres",
    "@muster/infrastructure-twilio-simulator",
    "@muster/observability",
    "@muster/testing",
  ]),
};

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function valueAt(object: JsonObject | undefined, ...keys: readonly string[]): unknown {
  let value: unknown = object;
  for (const key of keys) {
    if (!isJsonObject(value)) {
      return undefined;
    }
    value = value[key];
  }
  return value;
}

function violation(code: string, filePath: string, message: string): PolicyViolation {
  return { code, filePath, message };
}

async function readRequiredText(
  repositoryRoot: string,
  filePath: string,
  violations: PolicyViolation[],
): Promise<string | undefined> {
  try {
    return await readFile(path.join(repositoryRoot, filePath), "utf8");
  } catch {
    violations.push(
      violation("foundation/missing-file", filePath, `Required file is missing: ${filePath}`),
    );
    return undefined;
  }
}

async function readRequiredJson(
  repositoryRoot: string,
  filePath: string,
  violations: PolicyViolation[],
): Promise<JsonObject | undefined> {
  const text = await readRequiredText(repositoryRoot, filePath, violations);
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isJsonObject(parsed)) {
      throw new TypeError("JSON root must be an object");
    }
    return parsed;
  } catch {
    violations.push(
      violation("foundation/invalid-json", filePath, `Invalid JSON object: ${filePath}`),
    );
    return undefined;
  }
}

function requireValue(
  actual: unknown,
  expected: unknown,
  code: string,
  filePath: string,
  field: string,
  violations: PolicyViolation[],
): void {
  if (actual !== expected) {
    violations.push(
      violation(
        code,
        filePath,
        `${field} must be ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      ),
    );
  }
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (!specifier.startsWith("@muster/")) {
    return undefined;
  }
  const segments = specifier.split("/");
  return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
}

function externalPackageName(specifier: string): string {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }
  return segments[0] ?? specifier;
}

function workspaceForFile(filePath: string): string | undefined {
  const normalized = normalizePath(filePath);
  return expectedWorkspaces.find(
    ({ directory }) => normalized === directory || normalized.startsWith(`${directory}/`),
  )?.directory;
}

function collectModuleSpecifiers(filePath: string, source: string): readonly string[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function usesProcessEnvironment(filePath: string, source: string): boolean {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  let found = false;

  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.name.text === "env"
    ) {
      found = true;
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.argumentExpression !== undefined &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "env"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function analyzeBoundaryAbstractions(filePath: string, source: string): readonly PolicyViolation[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const violations: PolicyViolation[] = [];
  let serviceLocatorReported = false;

  function visit(node: ts.Node): void {
    if (!serviceLocatorReported && ts.isIdentifier(node) && node.text === "ServiceLocator") {
      serviceLocatorReported = true;
      violations.push(
        violation(
          "architecture/service-locator",
          filePath,
          "Service locators are forbidden; inject narrow capabilities at the composition root",
        ),
      );
    }

    if (ts.isInterfaceDeclaration(node)) {
      if (node.members.length === 0) {
        violations.push(
          violation(
            "architecture/speculative-abstraction",
            filePath,
            `Empty capability ${node.name.text} is forbidden`,
          ),
        );
      }
      if (/^(?:Base|Generic).*Repository$/u.test(node.name.text)) {
        violations.push(
          violation(
            "architecture/speculative-abstraction",
            filePath,
            `Generic repository abstraction ${node.name.text} is forbidden`,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function isCompositionRoot(workspaceDirectory: string, filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    (workspaceDirectory === "apps/api" ||
      workspaceDirectory === "apps/worker" ||
      workspaceDirectory === "apps/simulator-host") &&
    normalized.startsWith(`${workspaceDirectory}/src/composition/`)
  );
}

function isExternalPackage(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("node:") && !specifier.startsWith("/");
}

function isAllowedExternalImport(
  workspaceDirectory: string,
  filePath: string,
  specifier: string,
): boolean {
  const packageName = externalPackageName(specifier);
  if (allowedExternalPackages[workspaceDirectory]?.has(packageName) ?? false) {
    return true;
  }
  if (
    workspaceDirectory === "packages/observability" &&
    packageName.startsWith("@opentelemetry/")
  ) {
    return true;
  }
  return (
    isCompositionRoot(workspaceDirectory, filePath) &&
    (compositionOnlyExternalPackages.has(packageName) || packageName.startsWith("@opentelemetry/"))
  );
}

function isAllowedManifestExternal(workspaceDirectory: string, packageName: string): boolean {
  if (allowedManifestOnlyExternalPackages[workspaceDirectory]?.has(packageName) ?? false) {
    return true;
  }
  if (allowedExternalPackages[workspaceDirectory]?.has(packageName) ?? false) {
    return true;
  }
  if (
    (workspaceDirectory === "packages/observability" ||
      workspaceDirectory === "apps/api" ||
      workspaceDirectory === "apps/worker" ||
      workspaceDirectory === "apps/simulator-host") &&
    packageName.startsWith("@opentelemetry/")
  ) {
    return true;
  }
  return (
    (workspaceDirectory === "apps/api" ||
      workspaceDirectory === "apps/worker" ||
      workspaceDirectory === "apps/simulator-host") &&
    compositionOnlyExternalPackages.has(packageName)
  );
}

export function validateManifestDependencies(
  input: ManifestDependenciesInput,
): readonly PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const filePath = `${input.workspaceDirectory}/package.json`;
  for (const dependencyName of Object.keys(input.dependencies)) {
    if (dependencyName.startsWith("@muster/")) {
      if (!(allowedManifestDependencies[input.workspaceDirectory]?.has(dependencyName) ?? false)) {
        violations.push(
          violation(
            "workspace/dependency-matrix",
            filePath,
            `${input.workspaceDirectory} manifest may not depend on ${dependencyName}`,
          ),
        );
      }
    } else if (!isAllowedManifestExternal(input.workspaceDirectory, dependencyName)) {
      violations.push(
        violation(
          "workspace/external-dependency",
          filePath,
          `${input.workspaceDirectory} manifest may not depend on external package ${dependencyName}`,
        ),
      );
    }
  }
  return violations;
}

export function analyzeArchitectureSource(
  input: ArchitectureSourceInput,
): readonly PolicyViolation[] {
  const filePath = normalizePath(input.filePath);
  const workspaceDirectory = workspaceForFile(filePath);
  if (workspaceDirectory === undefined) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  if (
    workspaceDirectory === "packages/domain" ||
    workspaceDirectory === "packages/application" ||
    workspaceDirectory === "packages/contracts"
  ) {
    violations.push(...analyzeBoundaryAbstractions(filePath, input.source));
  }
  if (
    environmentAccessForbiddenWorkspaces.has(workspaceDirectory) &&
    usesProcessEnvironment(filePath, input.source)
  ) {
    violations.push(
      violation(
        "architecture/environment-access",
        filePath,
        `${workspaceDirectory} may not read process.env; configuration belongs at an outer boundary`,
      ),
    );
  }
  for (const specifier of collectModuleSpecifiers(filePath, input.source)) {
    const importedWorkspacePackage = packageNameFromSpecifier(specifier);
    const isSourceSubpath = /^@muster\/[^/]+\/(?:src|dist)(?:\/|$)/u.test(specifier);
    if (isSourceSubpath) {
      violations.push(
        violation(
          "architecture/public-entry-only",
          filePath,
          `Import ${specifier} bypasses the package's public exports`,
        ),
      );
    }

    if (specifier.startsWith(".")) {
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(filePath), specifier),
      );
      const targetWorkspace = workspaceForFile(resolved);
      if (targetWorkspace !== undefined && targetWorkspace !== workspaceDirectory) {
        violations.push(
          violation(
            "architecture/public-entry-only",
            filePath,
            `Relative import ${specifier} crosses from ${workspaceDirectory} into ${targetWorkspace}`,
          ),
        );
      }
      const isBundlerAsset =
        workspaceDirectory === "apps/web" &&
        /\.(?:css|svg|png|jpe?g|webp|woff2?)$/u.test(specifier);
      if (!/\.(?:c|m)?js$|\.json$/u.test(specifier) && !isBundlerAsset) {
        violations.push(
          violation(
            "architecture/esm-extension",
            filePath,
            `Relative ESM import ${specifier} must include its emitted .js extension`,
          ),
        );
      }
    }

    if (importedWorkspacePackage !== undefined) {
      const allowed =
        allowedWorkspaceImports[workspaceDirectory]?.has(importedWorkspacePackage) ?? false;
      const allowedAtComposition =
        compositionOnlyPackages.has(importedWorkspacePackage) &&
        isCompositionRoot(workspaceDirectory, filePath);
      if (!allowed && !allowedAtComposition) {
        violations.push(
          violation(
            "architecture/dependency-direction",
            filePath,
            `${workspaceDirectory} may not import ${importedWorkspacePackage}`,
          ),
        );
      }
    } else if (specifier.startsWith("node:")) {
      if (nodeImportForbiddenWorkspaces.has(workspaceDirectory)) {
        violations.push(
          violation(
            "architecture/external-dependency",
            filePath,
            `${workspaceDirectory} may not import Node-only module ${specifier}`,
          ),
        );
      }
    } else if (
      isExternalPackage(specifier) &&
      !isAllowedExternalImport(workspaceDirectory, filePath, specifier)
    ) {
      violations.push(
        violation(
          "architecture/external-dependency",
          filePath,
          `${workspaceDirectory} may not import external package ${specifier}`,
        ),
      );
      if (
        workspaceDirectory === "packages/domain" ||
        workspaceDirectory === "packages/application"
      ) {
        violations.push(
          violation(
            "architecture/dependency-direction",
            filePath,
            `${workspaceDirectory} may not import external package ${specifier}`,
          ),
        );
      }
    }
  }

  return violations;
}

function validateExactDependencies(
  manifest: JsonObject,
  filePath: string,
  violations: PolicyViolation[],
): void {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const dependencies = asJsonObject(manifest[field]);
    if (dependencies === undefined) {
      continue;
    }
    for (const [packageName, version] of Object.entries(dependencies)) {
      if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
        violations.push(
          violation(
            "toolchain/exact-dependency-pin",
            filePath,
            `${field}.${packageName} must use an exact version`,
          ),
        );
      }
    }
  }
}

function validateActionPins(workflow: string, violations: PolicyViolation[]): void {
  const usesLines = workflow.split(/\r?\n/u).filter((line) => /^\s*uses:/u.test(line));
  if (usesLines.length === 0) {
    violations.push(
      violation(
        "ci/action-pin",
        ".github/workflows/verify-foundation.yml",
        "CI must use pinned actions",
      ),
    );
  }
  for (const line of usesLines) {
    if (!/uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s+#\s+\S.*)?$/u.test(line)) {
      violations.push(
        violation(
          "ci/action-pin",
          ".github/workflows/verify-foundation.yml",
          `Action reference is not pinned to a full SHA: ${line.trim()}`,
        ),
      );
    }
  }
}

export async function validateToolchainPolicy(
  repositoryRoot: string,
): Promise<readonly PolicyViolation[]> {
  const violations: PolicyViolation[] = [];
  const nodeVersion = await readRequiredText(repositoryRoot, ".node-version", violations);
  if (nodeVersion !== undefined) {
    requireValue(
      nodeVersion.trim(),
      "24.18.0",
      "toolchain/node-pin",
      ".node-version",
      "Node version",
      violations,
    );
  }

  const rootManifest = await readRequiredJson(repositoryRoot, "package.json", violations);
  if (rootManifest !== undefined) {
    requireValue(
      rootManifest["private"],
      true,
      "toolchain/root-manifest",
      "package.json",
      "private",
      violations,
    );
    requireValue(
      rootManifest["type"],
      "module",
      "toolchain/esm",
      "package.json",
      "type",
      violations,
    );
    requireValue(
      valueAt(rootManifest, "engines", "node"),
      "24.18.0",
      "toolchain/node-pin",
      "package.json",
      "engines.node",
      violations,
    );
    requireValue(
      valueAt(rootManifest, "engines", "pnpm"),
      "11.20.0",
      "toolchain/pnpm-pin",
      "package.json",
      "engines.pnpm",
      violations,
    );
    if (
      !/^pnpm@11\.20\.0(?:\+sha(?:256|512)\.[0-9a-fA-F]+)?$/u.test(
        String(rootManifest["packageManager"]),
      )
    ) {
      violations.push(
        violation(
          "toolchain/pnpm-pin",
          "package.json",
          "packageManager must pin pnpm 11.20.0 exactly",
        ),
      );
    }
    const aggregateScript = valueAt(rootManifest, "scripts", "verify:foundation");
    if (
      typeof aggregateScript !== "string" ||
      ![
        "verify:format",
        "verify:supply-chain",
        "lint",
        "typecheck",
        "build",
        "verify:policies",
        "test",
        "verify:diff",
      ].every((step) => aggregateScript.includes(`pnpm run ${step}`))
    ) {
      violations.push(
        violation(
          "toolchain/aggregate-script",
          "package.json",
          "verify:foundation must transparently compose every Phase 1 gate",
        ),
      );
    }
    if (
      typeof aggregateScript !== "string" ||
      !aggregateScript.startsWith("corepack pnpm run verify:toolchain &&")
    ) {
      violations.push(
        violation(
          "toolchain/aggregate-order",
          "package.json",
          "verify:foundation must reject an unsupported toolchain before every other gate",
        ),
      );
    }
    for (const [scriptName, expected] of [
      ["preinstall", "node tools/toolchain/verify-toolchain.mjs"],
      ["verify:toolchain", "node tools/toolchain/verify-toolchain.mjs"],
    ] as const) {
      requireValue(
        valueAt(rootManifest, "scripts", scriptName),
        expected,
        "toolchain/runtime-gate",
        "package.json",
        `scripts.${scriptName}`,
        violations,
      );
    }
    requireValue(
      valueAt(rootManifest, "scripts", "verify:diff"),
      "git diff --check",
      "toolchain/diff-check",
      "package.json",
      "scripts.verify:diff",
      violations,
    );
    validateExactDependencies(rootManifest, "package.json", violations);
  }

  const workspaceText = await readRequiredText(repositoryRoot, "pnpm-workspace.yaml", violations);
  if (workspaceText !== undefined) {
    const workspaceValue: unknown = parse(workspaceText);
    const workspaceDirectory = asJsonObject(workspaceValue);
    const expectedSettings: Readonly<Record<string, unknown>> = {
      engineStrict: true,
      packageManagerStrict: true,
      packageManagerStrictVersion: true,
      minimumReleaseAge: 1440,
      minimumReleaseAgeStrict: true,
      minimumReleaseAgeIgnoreMissingTime: false,
      trustPolicy: "no-downgrade",
      trustLockfile: false,
      blockExoticSubdeps: true,
      strictDepBuilds: true,
    };
    for (const [field, expected] of Object.entries(expectedSettings)) {
      requireValue(
        workspaceDirectory?.[field],
        expected,
        "supply-chain/pnpm-setting",
        "pnpm-workspace.yaml",
        field,
        violations,
      );
    }
    if (workspaceDirectory?.["dangerouslyAllowAllBuilds"] !== undefined) {
      violations.push(
        violation(
          "supply-chain/dangerous-builds",
          "pnpm-workspace.yaml",
          "dangerouslyAllowAllBuilds is forbidden",
        ),
      );
    }
    const overrides = asJsonObject(workspaceDirectory?.["overrides"]);
    const expectedOverrides: Readonly<Record<string, string>> = {
      "deepmerge-ts": "8.0.2",
      "fast-uri@3.1.5": "3.1.6",
      "fast-uri@4.1.2": "4.1.3",
      "find-my-way": "9.7.0",
      "js-yaml": "4.3.2",
      mysql2: "3.24.2",
      nanoid: "3.3.18",
      qs: "6.16.0",
    };
    if (
      overrides === undefined ||
      Object.keys(expectedOverrides).some(
        (packageName) => overrides[packageName] !== expectedOverrides[packageName],
      ) ||
      Object.keys(overrides).some((packageName) => !(packageName in expectedOverrides))
    ) {
      violations.push(
        violation(
          "supply-chain/overrides",
          "pnpm-workspace.yaml",
          "Dependency overrides must match the exact reviewed security resolution map",
        ),
      );
    }
    const allowBuilds = asJsonObject(workspaceDirectory?.["allowBuilds"]);
    const expectedAllowBuilds: Readonly<Record<string, boolean>> = {
      "@prisma/engines": true,
      prisma: true,
      "cpu-features": false,
      protobufjs: false,
      ssh2: false,
    };
    if (
      allowBuilds === undefined ||
      Object.keys(expectedAllowBuilds).some(
        (packageName) => allowBuilds[packageName] !== expectedAllowBuilds[packageName],
      ) ||
      Object.keys(allowBuilds).some((packageName) => !(packageName in expectedAllowBuilds))
    ) {
      violations.push(
        violation(
          "supply-chain/allow-builds",
          "pnpm-workspace.yaml",
          "Dependency lifecycle policy must match the exact reviewed allow/deny map",
        ),
      );
    }
  }

  await readRequiredText(repositoryRoot, "pnpm-lock.yaml", violations);
  await readRequiredText(repositoryRoot, "tools/toolchain/verify-toolchain.mjs", violations);
  const workflow = await readRequiredText(
    repositoryRoot,
    ".github/workflows/verify-foundation.yml",
    violations,
  );
  if (workflow !== undefined) {
    validateActionPins(workflow, violations);
    for (const command of [
      "corepack pnpm verify:toolchain",
      "corepack pnpm install --frozen-lockfile",
      "corepack pnpm verify:foundation",
    ]) {
      if (!workflow.includes(command)) {
        violations.push(
          violation(
            "ci/aggregate-command",
            ".github/workflows/verify-foundation.yml",
            `CI must run ${command}`,
          ),
        );
      }
    }
    const toolchainPosition = workflow.indexOf("corepack pnpm verify:toolchain");
    const installPosition = workflow.indexOf("corepack pnpm install --frozen-lockfile");
    if (toolchainPosition < 0 || installPosition < 0 || toolchainPosition > installPosition) {
      violations.push(
        violation(
          "ci/toolchain-order",
          ".github/workflows/verify-foundation.yml",
          "CI must reject an unsupported toolchain before dependency installation",
        ),
      );
    }
    if (!/^permissions:\r?\n\s+contents: read$/mu.test(workflow)) {
      violations.push(
        violation(
          "ci/permissions",
          ".github/workflows/verify-foundation.yml",
          "CI permissions must be read-only",
        ),
      );
    }
    if (/pull_request_target|\$\{\{\s*secrets\./u.test(workflow)) {
      violations.push(
        violation(
          "ci/untrusted-privilege",
          ".github/workflows/verify-foundation.yml",
          "Foundation verification must not use privileged fork triggers or secrets",
        ),
      );
    }
  }

  const gitignore = await readRequiredText(repositoryRoot, ".gitignore", violations);
  if (
    gitignore !== undefined &&
    ![
      "node_modules/",
      "dist/",
      "coverage/",
      ".env.*",
      "memory-bank/.local/",
      "provider-capture-*",
    ].every((entry) => gitignore.includes(entry))
  ) {
    violations.push(
      violation(
        "security/gitignore",
        ".gitignore",
        "Git ignore policy must cover local build, secret, and protected-evidence artifacts",
      ),
    );
  }

  for (const workspaceDirectory of expectedWorkspaces) {
    const manifestPath = `${workspaceDirectory.directory}/package.json`;
    const manifest = await readRequiredJson(repositoryRoot, manifestPath, violations);
    if (manifest !== undefined) {
      validateExactDependencies(manifest, manifestPath, violations);
    }
  }

  const adr1 = await readRequiredText(
    repositoryRoot,
    "docs/adr/0001-modular-monolith-foundation.md",
    violations,
  );
  const adr2 = await readRequiredText(
    repositoryRoot,
    "docs/adr/0002-openapi-client-generation.md",
    violations,
  );
  if (adr1 !== undefined && !adr1.includes("Node.js 24.18.0")) {
    violations.push(
      violation(
        "decision/adr-0001",
        "docs/adr/0001-modular-monolith-foundation.md",
        "ADR 0001 must record the exact Node pin",
      ),
    );
  }
  if (adr2 !== undefined && (!adr2.includes("OpenAPI 3.1") || !adr2.includes("spec-first"))) {
    violations.push(
      violation(
        "decision/adr-0002",
        "docs/adr/0002-openapi-client-generation.md",
        "ADR 0002 must record the OpenAPI 3.1 spec-first decision",
      ),
    );
  }

  return violations;
}

async function listSourceFiles(
  repositoryRoot: string,
  relativeDirectory: string,
): Promise<readonly string[]> {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = normalizePath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      if (!["dist", "dist-types", "generated", "node_modules"].includes(entry.name)) {
        files.push(...(await listSourceFiles(repositoryRoot, relativePath)));
      }
    } else if (
      /\.(?:ts|tsx)$/u.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

export async function validateWorkspacePolicy(
  repositoryRoot: string,
): Promise<readonly PolicyViolation[]> {
  const violations: PolicyViolation[] = [];
  const baseConfig = await readRequiredJson(repositoryRoot, "tsconfig.base.json", violations);
  if (baseConfig !== undefined) {
    const compilerOptions = asJsonObject(baseConfig["compilerOptions"]);
    for (const [field, expected] of Object.entries({
      target: "ES2024",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      composite: true,
      verbatimModuleSyntax: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
    })) {
      requireValue(
        compilerOptions?.[field],
        expected,
        "typescript/strict-config",
        "tsconfig.base.json",
        `compilerOptions.${field}`,
        violations,
      );
    }
  }

  const rootConfig = await readRequiredJson(repositoryRoot, "tsconfig.json", violations);
  const referencesValue = rootConfig?.["references"];
  const rootReferences = Array.isArray(referencesValue)
    ? referencesValue
        .map((reference) => (isJsonObject(reference) ? reference["path"] : undefined))
        .filter((reference): reference is string => typeof reference === "string")
    : [];

  for (const workspaceDirectory of expectedWorkspaces) {
    const manifestPath = `${workspaceDirectory.directory}/package.json`;
    const tsconfigPath = `${workspaceDirectory.directory}/tsconfig.json`;
    const manifest = await readRequiredJson(repositoryRoot, manifestPath, violations);
    const tsconfig = await readRequiredJson(repositoryRoot, tsconfigPath, violations);
    await readRequiredText(
      repositoryRoot,
      `${workspaceDirectory.directory}/${workspaceDirectory.entryPoint}`,
      violations,
    );

    if (manifest !== undefined) {
      requireValue(
        manifest["private"],
        true,
        "workspace/private",
        manifestPath,
        "private",
        violations,
      );
      requireValue(manifest["type"], "module", "workspace/esm", manifestPath, "type", violations);
      if (workspaceDirectory.publicPackage && !isJsonObject(manifest["exports"])) {
        violations.push(
          violation(
            "workspace/public-exports",
            manifestPath,
            "Package must expose an explicit exports map",
          ),
        );
      }
      for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
        const dependencyObject = asJsonObject(manifest[field]);
        const dependencies = Object.fromEntries(
          Object.entries(dependencyObject ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
        violations.push(
          ...validateManifestDependencies({
            workspaceDirectory: workspaceDirectory.directory,
            dependencies,
          }),
        );
      }
    }

    if (tsconfig !== undefined) {
      const compilerOptions = asJsonObject(tsconfig["compilerOptions"]);
      if (workspaceDirectory.resolution === "bundler") {
        requireValue(
          compilerOptions?.["moduleResolution"],
          "Bundler",
          "typescript/web-bundler-resolution",
          tsconfigPath,
          "compilerOptions.moduleResolution",
          violations,
        );
      } else {
        requireValue(
          tsconfig["extends"],
          "../../tsconfig.base.json",
          "typescript/node-next-config",
          tsconfigPath,
          "extends",
          violations,
        );
        if (!rootReferences.includes(workspaceDirectory.directory)) {
          violations.push(
            violation(
              "typescript/project-reference",
              "tsconfig.json",
              `Root project references must include ${workspaceDirectory.directory}`,
            ),
          );
        }
      }
    }

    for (const sourceFile of await listSourceFiles(
      repositoryRoot,
      `${workspaceDirectory.directory}/src`,
    )) {
      const source = await readFile(path.join(repositoryRoot, sourceFile), "utf8");
      violations.push(...analyzeArchitectureSource({ filePath: sourceFile, source }));
    }
  }

  for (const filePath of [
    "eslint.config.mjs",
    "dependency-cruiser.config.mjs",
    "prettier.config.mjs",
    "vitest.workspace.ts",
    "playwright.config.ts",
    "apps/web/vite.config.ts",
    "packages/api-client/vite.config.ts",
    "apps/web/index.html",
  ]) {
    await readRequiredText(repositoryRoot, filePath, violations);
  }

  return violations;
}
