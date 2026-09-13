import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import type { PolicyViolation } from "./architecture-policy.js";

interface SourcePolicyInput {
  readonly filePath: string;
  readonly source: string;
}

const rawQueryApis = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
const prismaSqlHelpers = new Set(["sql", "raw", "join", "empty"]);

const inlineSqlPattern =
  /\b(?:SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+[A-Za-z_][\w.]*\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)|WITH\s+[A-Za-z_]\w*\s+AS\s*\()/iu;

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isProductionSource(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    /^(?:apps|packages)\//u.test(normalized) &&
    !/\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/u.test(normalized) &&
    !/(?:^|\/)(?:__tests__|generated|dist|dist-demo|dist-types)(?:\/|$)/u.test(normalized)
  );
}

function propertyName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  const argument = node.argumentExpression;
  return argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : undefined;
}

function namedNodeText(node: ts.Node | undefined): string | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    return namedNodeText(node.expression);
  }
  return undefined;
}

function violation(code: string, filePath: string, message: string): PolicyViolation {
  return { code, filePath, message };
}

export function analyzeProductionSource(input: SourcePolicyInput): readonly PolicyViolation[] {
  const filePath = normalizePath(input.filePath);
  if (!isProductionSource(filePath)) {
    return [];
  }

  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const violations: PolicyViolation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = propertyName(node);
      const isPrismaHelper =
        name !== undefined &&
        prismaSqlHelpers.has(name) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Prisma";
      if ((name !== undefined && rawQueryApis.has(name)) || isPrismaHelper) {
        violations.push(
          violation(
            "source/raw-query-api",
            filePath,
            `Production source may not reference Prisma raw-query API ${String(name)}`,
          ),
        );
      }
    }

    if (ts.isBindingElement(node)) {
      const name = namedNodeText(node.propertyName) ?? namedNodeText(node.name);
      if (name !== undefined && rawQueryApis.has(name)) {
        violations.push(
          violation(
            "source/raw-query-api",
            filePath,
            `Production source may not bind Prisma raw-query API ${name}`,
          ),
        );
      }
    }

    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = namedNodeText(node.name);
      if (name !== undefined && rawQueryApis.has(name)) {
        violations.push(
          violation(
            "source/raw-query-api",
            filePath,
            `Production source may not alias Prisma raw-query API ${name}`,
          ),
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        const name = propertyName(expression);
        const isPrismaHelper =
          name !== undefined &&
          prismaSqlHelpers.has(name) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === "Prisma";
        if ((name !== undefined && rawQueryApis.has(name)) || isPrismaHelper) {
          violations.push(
            violation(
              "source/raw-query-api",
              filePath,
              `Production source may not call Prisma raw-query API ${String(name)}`,
            ),
          );
        }
        if (
          name !== undefined &&
          ["log", "info", "warn", "error", "debug", "trace"].includes(name) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === "console"
        ) {
          violations.push(
            violation(
              "source/no-console",
              filePath,
              `Production source may not call console.${name}`,
            ),
          );
        }
      }
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag;
      if (
        (ts.isPropertyAccessExpression(tag) || ts.isElementAccessExpression(tag)) &&
        (rawQueryApis.has(propertyName(tag) ?? "") ||
          (prismaSqlHelpers.has(propertyName(tag) ?? "") &&
            ts.isIdentifier(tag.expression) &&
            tag.expression.text === "Prisma"))
      ) {
        violations.push(
          violation(
            "source/raw-query-api",
            filePath,
            "Production source may not use a raw-query tag",
          ),
        );
      }
    }

    if (
      (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      inlineSqlPattern.test(node.text)
    ) {
      violations.push(
        violation("source/inline-sql", filePath, "Production source may not contain inline SQL"),
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

async function listProductionFiles(
  repositoryRoot: string,
  relativeDirectory: string,
): Promise<readonly string[]> {
  const entries = await readdir(path.join(repositoryRoot, relativeDirectory), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = normalizePath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      if (!["dist", "dist-types", "generated", "node_modules"].includes(entry.name)) {
        files.push(...(await listProductionFiles(repositoryRoot, relativePath)));
      }
    } else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

export async function scanProductionSource(
  repositoryRoot: string,
): Promise<readonly PolicyViolation[]> {
  const violations: PolicyViolation[] = [];
  for (const directory of ["apps", "packages"] as const) {
    for (const filePath of await listProductionFiles(repositoryRoot, directory)) {
      const source = await readFile(path.join(repositoryRoot, filePath), "utf8");
      violations.push(...analyzeProductionSource({ filePath, source }));
    }
  }
  return violations;
}
