import { createHash } from "node:crypto";

import * as ts from "typescript";

export interface ProviderFreeSourceModule {
  readonly id: string;
  readonly source: string;
  readonly allowedSourceSha256?: string;
  readonly allowedStaticImports: readonly string[];
  readonly allowedDynamicImports: readonly string[];
  readonly allowedLocalCapabilityImports?: readonly string[];
  readonly allowedLocalCapabilityOccurrences?: Readonly<
    Partial<Record<"filesystem_capability" | "child_process_capability", number>>
  >;
  readonly allowedEnvironmentVariableReads?: readonly string[];
  readonly allowedWholeEnvironmentAccesses?: readonly string[];
  readonly allowedEnvironmentObjectAliasOccurrences?: Readonly<Record<string, number>>;
  readonly allowedEnvironmentGuardSourceSha256?: string;
  readonly enforceExactBuiltinModuleBoundary?: boolean;
}

export type ProviderFreeIsolationViolationCode =
  | "source_integrity"
  | "side_effect_import"
  | "forbidden_import"
  | "unexpected_import"
  | "non_literal_dynamic_import"
  | "builtin_module_acquisition"
  | "environment_capability"
  | "filesystem_capability"
  | "network_capability"
  | "fetch_capability"
  | "child_process_capability"
  | "provider_or_database_capability"
  | "listener_capability"
  | "external_mutation_capability"
  | "retry_or_redial_capability";

export interface ProviderFreeIsolationViolation {
  readonly moduleId: string;
  readonly code: ProviderFreeIsolationViolationCode;
}

const forbiddenImport =
  /^(?:node:)?(?:fs(?:\/promises)?|net|http|https|http2|tls|dns(?:\/promises)?|dgram|child_process|worker_threads)$|^(?:pg|dotenv|twilio(?:\/|$)|@twilio\/|@call-e\/|@muster\/(?:observability|infrastructure-))/u;
const allowlistableLocalCapabilityImport =
  /^(?:node:(?:fs(?:\/promises)?|child_process)|@muster\/infrastructure-postgres)$/u;

const capabilityPatterns: readonly Readonly<{
  code: ProviderFreeIsolationViolationCode;
  pattern: RegExp;
}>[] = Object.freeze([
  {
    code: "builtin_module_acquisition",
    pattern:
      /\bprocess\s*\.\s*getBuiltinModule\s*\(|\b(?:require|createRequire|require[A-Z][A-Za-z0-9_$]*)\b/u,
  },
  {
    code: "environment_capability",
    pattern:
      /\b(?:Object|Reflect)\s*\.\s*getOwnPropertyDescriptor\s*\(\s*process\s*\.\s*env\b|\bObject\s*\.\s*hasOwn\s*\(\s*process\s*\.\s*env\b/u,
  },
  {
    code: "filesystem_capability",
    pattern:
      /(?:^|[^.\w])(?:readFile|writeFile|appendFile|open|createReadStream|createWriteStream|watch)\s*\(/u,
  },
  {
    code: "network_capability",
    pattern: /(?:^|[^\w])(?:connect|request)\s*\(|\.\s*(?:connect|request)\s*\(/u,
  },
  {
    code: "fetch_capability",
    pattern: /\b(?:fetch|WebSocket)\b/u,
  },
  {
    code: "child_process_capability",
    pattern: /(?:^|[^.\w])(?:spawn|exec|execFile|fork)\s*\(/u,
  },
  {
    code: "provider_or_database_capability",
    pattern: /\bnew\s+(?:Pool|Client|CalleClient|Twilio|PrismaClient)\b/u,
  },
  {
    code: "listener_capability",
    pattern: /(?:^|[^\w])listen\s*\(|\.\s*listen\s*\(/u,
  },
  {
    code: "external_mutation_capability",
    pattern:
      /(?:^|[^\w])(?:authorize|mintAuthorization|createTask|createCall|dial)\s*\(|\.\s*(?:authorize|mintAuthorization|createTask|createCall|dial)\s*\(/u,
  },
  {
    code: "retry_or_redial_capability",
    pattern: /(?:^|[^\w])(?:retry|redial)\s*\(|\.\s*(?:retry|redial)\s*\(/u,
  },
]);

function stringsFromMatches(source: string, pattern: RegExp): string[] {
  return Array.from(source.matchAll(pattern), (match) => match[1]!).sort();
}

function lexicalCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, " ");
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function occurrenceCount(source: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return Array.from(source.matchAll(new RegExp(pattern.source, flags))).length;
}

function sha256(value: string): string {
  return createHash("sha256").update(value.replace(/\r\n?/gu, "\n"), "utf8").digest("hex");
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticText(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text;
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticText(current.left);
    const right = staticText(current.right);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  return undefined;
}

function propertyName(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) return staticText(current.argumentExpression);
  return undefined;
}

function isProcessExpression(expression: ts.Expression, aliases: ReadonlySet<string>): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return aliases.has(current.text);
  if (
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) &&
    propertyName(current) === "process"
  ) {
    const owner = unwrapExpression(current.expression);
    return ts.isIdentifier(owner) && owner.text === "globalThis";
  }
  return false;
}

function namedCall(expression: ts.LeftHandSideExpression, owner: string, name: string): boolean {
  const current = unwrapExpression(expression);
  const currentOwner =
    ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
      ? unwrapExpression(current.expression)
      : undefined;
  return (
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) &&
    currentOwner !== undefined &&
    ts.isIdentifier(currentOwner) &&
    currentOwner.text === owner &&
    propertyName(current) === name
  );
}

function isEnvironmentDescriptorCall(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isCallExpression(current) &&
    (namedCall(current.expression, "Object", "getOwnPropertyDescriptor") ||
      namedCall(current.expression, "Reflect", "getOwnPropertyDescriptor")) &&
    current.arguments[0] !== undefined &&
    staticText(current.arguments[1]) === "env"
  );
}

function isEnvironmentObjectExpression(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  if (
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) &&
    propertyName(current) === "env"
  ) {
    return true;
  }
  if (
    ts.isCallExpression(current) &&
    namedCall(current.expression, "Reflect", "get") &&
    current.arguments[0] !== undefined &&
    staticText(current.arguments[1]) === "env"
  ) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(current) &&
    current.name.text === "value" &&
    isEnvironmentDescriptorCall(current.expression)
  );
}

function isCanonicalProcessEnvironment(expression: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.questionDotToken === undefined &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "process" &&
    expression.name.text === "env"
  );
}

function canonicalEnvironmentReadName(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  environment: ts.Expression,
): string | undefined {
  if (access.expression !== environment || access.questionDotToken !== undefined) return undefined;
  if (ts.isPropertyAccessExpression(access)) return access.name.text;
  return ts.isStringLiteral(access.argumentExpression) ? access.argumentExpression.text : undefined;
}

function transparentTop(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    current.parent !== undefined &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

function isReadonlyAccess(expression: ts.Expression): boolean {
  const current = transparentTop(expression);
  const parent = current.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === current &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return false;
  }
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return false;
  }
  return !ts.isDeleteExpression(parent);
}

function hasForbiddenBuiltinModuleAcquisition(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    "provider-free-builtin-source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) return true;
  let forbidden = false;
  const forbiddenProperties = new Set(["getBuiltinModule", "createRequire", "require", "_load"]);
  const forbiddenReflectionProperties = new Set([
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
  ]);
  const forbiddenDynamicCodeProperties = new Set(["constructor", "eval", "Function"]);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "Reflect") forbidden = true;
    if (
      ts.isIdentifier(node) &&
      (forbiddenProperties.has(node.text) ||
        forbiddenDynamicCodeProperties.has(node.text) ||
        /^(?:require|createRequire|require[A-Z][A-Za-z0-9_$]*)$/u.test(node.text))
    ) {
      forbidden = true;
    }
    if (
      ts.isBindingElement(node) &&
      (forbiddenProperties.has(bindingElementName(node) ?? "") ||
        forbiddenDynamicCodeProperties.has(bindingElementName(node) ?? ""))
    ) {
      forbidden = true;
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      (forbiddenProperties.has(propertyName(node) ?? "") ||
        forbiddenReflectionProperties.has(propertyName(node) ?? "") ||
        forbiddenDynamicCodeProperties.has(propertyName(node) ?? "") ||
        propertyName(node) === "Reflect")
    ) {
      forbidden = true;
    }
    if (ts.isCallExpression(node)) {
      if (
        (namedCall(node.expression, "Reflect", "get") ||
          namedCall(node.expression, "Object", "getOwnPropertyDescriptor") ||
          namedCall(node.expression, "Reflect", "getOwnPropertyDescriptor")) &&
        forbiddenProperties.has(staticText(node.arguments[1]) ?? "")
      ) {
        forbidden = true;
      }
      const callee = unwrapExpression(node.expression);
      if (ts.isIdentifier(callee) && (callee.text === "eval" || callee.text === "Function")) {
        forbidden = true;
      }
    }
    if (ts.isNewExpression(node)) {
      const constructor = unwrapExpression(node.expression);
      if (ts.isIdentifier(constructor) && constructor.text === "Function") forbidden = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return forbidden;
}

function bindingElementName(element: ts.BindingElement): string | undefined {
  if (element.propertyName === undefined) {
    return ts.isIdentifier(element.name) ? element.name.text : undefined;
  }
  if (ts.isComputedPropertyName(element.propertyName)) {
    return staticText(element.propertyName.expression);
  }
  return element.propertyName.text;
}

function isNonValueProcessIdentifier(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isPropertySignature(parent) && parent.name === identifier) ||
    (ts.isPropertyDeclaration(parent) && parent.name === identifier) ||
    (ts.isMethodSignature(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === identifier) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === identifier)
  ) {
    return true;
  }
  return (
    (ts.isImportClause(parent) && parent.name === identifier) ||
    (ts.isNamespaceImport(parent) && parent.name === identifier) ||
    (ts.isImportSpecifier(parent) &&
      (parent.name === identifier || parent.propertyName === identifier))
  );
}

function isAllowedTrackedProcessUse(
  expression: ts.Identifier | ts.PropertyAccessExpression | ts.ElementAccessExpression,
): boolean {
  if (ts.isIdentifier(expression) && isNonValueProcessIdentifier(expression)) return true;
  const current = transparentTop(expression);
  const parent = current.parent;
  return (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === current &&
    propertyName(parent) !== undefined
  );
}

function containingFunction(node: ts.Node): ts.Node | undefined {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
  }
  return undefined;
}

function isInsideFinallyBlock(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isBlock(current) &&
      ts.isTryStatement(current.parent) &&
      current.parent.finallyBlock === current
    ) {
      return true;
    }
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return false;
    }
  }
  return false;
}

function functionBody(node: ts.Node): ts.Block | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  ) {
    const body = node.body;
    return body !== undefined && ts.isBlock(body) ? body : undefined;
  }
  return undefined;
}

function hasExactEnvironmentVariableReads(
  source: string,
  allowedEnvironmentVariableReads: readonly string[],
  allowedWholeEnvironmentAccesses: readonly string[],
  allowedEnvironmentObjectAliasOccurrences: Readonly<Record<string, number>>,
  allowedEnvironmentGuardSourceSha256: string | undefined,
): boolean {
  if (
    allowedEnvironmentGuardSourceSha256 !== undefined &&
    (!/^[0-9a-f]{64}$/u.test(allowedEnvironmentGuardSourceSha256) ||
      sha256(source) !== allowedEnvironmentGuardSourceSha256)
  ) {
    return false;
  }
  const sourceFile = ts.createSourceFile(
    "provider-free-source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) return false;
  const hasTrustedEnvironmentGuard = allowedEnvironmentGuardSourceSha256 !== undefined;
  const processAliases = new Set(["process"]);
  const environmentAliases = new Set<string>();
  let invalid = false;

  const walk = (node: ts.Node, visit: (candidate: ts.Node) => void): void => {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  };

  walk(sourceFile, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "node:process"
    ) {
      if (node.importClause?.name !== undefined) processAliases.add(node.importClause.name.text);
      const bindings = node.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        processAliases.add(bindings.name.text);
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === "env") {
            environmentAliases.add(element.name.text);
          }
        }
      }
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    walk(sourceFile, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        isProcessExpression(node.initializer, processAliases) &&
        !processAliases.has(node.name.text)
      ) {
        processAliases.add(node.name.text);
        changed = true;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(unwrapExpression(node.left)) &&
        isProcessExpression(node.right, processAliases)
      ) {
        const name = (unwrapExpression(node.left) as ts.Identifier).text;
        if (!processAliases.has(name)) {
          processAliases.add(name);
          changed = true;
        }
      }
    });
  }

  changed = true;
  while (changed) {
    changed = false;
    walk(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        if (!ts.isIdentifier(node.name)) {
          if (
            isProcessExpression(node.initializer, processAliases) ||
            isEnvironmentObjectExpression(node.initializer) ||
            (ts.isIdentifier(unwrapExpression(node.initializer)) &&
              environmentAliases.has((unwrapExpression(node.initializer) as ts.Identifier).text))
          ) {
            invalid = true;
          }
          return;
        }
        const initializer = unwrapExpression(node.initializer);
        if (
          isEnvironmentObjectExpression(initializer) ||
          (ts.isIdentifier(initializer) && environmentAliases.has(initializer.text))
        ) {
          if (!environmentAliases.has(node.name.text)) {
            environmentAliases.add(node.name.text);
            changed = true;
          }
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = unwrapExpression(node.left);
        const right = unwrapExpression(node.right);
        if (!ts.isIdentifier(left)) {
          if (
            (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) &&
            (isProcessExpression(right, processAliases) ||
              isEnvironmentObjectExpression(right) ||
              (ts.isIdentifier(right) && environmentAliases.has(right.text)))
          ) {
            invalid = true;
          }
          return;
        }
        if (
          isEnvironmentObjectExpression(right) ||
          (ts.isIdentifier(right) && environmentAliases.has(right.text))
        ) {
          if (!environmentAliases.has(left.text)) {
            environmentAliases.add(left.text);
            changed = true;
          }
        }
      }
    });
  }

  const actualReads: string[] = [];
  const actualWholeAccesses: string[] = [];
  const wholeAccessFunctions: ts.Node[] = [];
  let captureStatement: ts.VariableStatement | undefined;
  let installStatement: ts.ExpressionStatement | undefined;
  let restoreStatement: ts.ExpressionStatement | undefined;
  const collectNamedRead = (access: ts.Expression, name: string | undefined): void => {
    if (name === undefined || !isReadonlyAccess(access)) {
      invalid = true;
      return;
    }
    actualReads.push(name);
  };

  walk(sourceFile, (node) => {
    if (
      !hasTrustedEnvironmentGuard &&
      ts.isBindingElement(node) &&
      bindingElementName(node) === "env"
    ) {
      invalid = true;
    }

    if (
      !hasTrustedEnvironmentGuard &&
      (ts.isIdentifier(node) ||
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      isProcessExpression(node, processAliases) &&
      !isAllowedTrackedProcessUse(node)
    ) {
      invalid = true;
    }

    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      environmentAliases.has((unwrapExpression(node.expression) as ts.Identifier).text)
    ) {
      invalid = true;
    }

    if (ts.isCallExpression(node)) {
      const first =
        node.arguments[0] === undefined ? undefined : unwrapExpression(node.arguments[0]);
      const processTarget = first !== undefined && isProcessExpression(first, processAliases);
      const environmentTarget =
        first !== undefined && ts.isIdentifier(first) && environmentAliases.has(first.text);
      const reflectiveGet = namedCall(node.expression, "Reflect", "get");
      const reflectiveDescriptor =
        namedCall(node.expression, "Object", "getOwnPropertyDescriptor") ||
        namedCall(node.expression, "Reflect", "getOwnPropertyDescriptor");
      if ((reflectiveGet || reflectiveDescriptor) && (processTarget || environmentTarget)) {
        const name = staticText(node.arguments[1]);
        if (processTarget && name !== "env") {
          if (name === undefined) invalid = true;
        } else if (environmentTarget) {
          invalid = true;
        } else if (reflectiveDescriptor) {
          const parent = transparentTop(node).parent;
          if (!ts.isPropertyAccessExpression(parent) || parent.name.text !== "value") {
            invalid = true;
          }
        }
      }
    }

    if (
      ts.isElementAccessExpression(node) &&
      isProcessExpression(node.expression, processAliases) &&
      staticText(node.argumentExpression) === undefined
    ) {
      invalid = true;
    }

    if (
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node) &&
      !ts.isCallExpression(node)
    ) {
      return;
    }
    if (!isEnvironmentObjectExpression(node)) return;
    if (!isCanonicalProcessEnvironment(node) || transparentTop(node) !== node) {
      invalid = true;
      return;
    }
    const current = node;
    const parent = current.parent;
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === current
    ) {
      collectNamedRead(parent, canonicalEnvironmentReadName(parent, current));
      return;
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === current &&
      ts.isIdentifier(parent.name) &&
      ts.isVariableDeclarationList(parent.parent) &&
      (parent.parent.flags & ts.NodeFlags.Const) !== 0 &&
      parent.parent.declarations.length === 1
    ) {
      actualWholeAccesses.push(`capture:${parent.name.text}`);
      const statement = parent.parent.parent;
      if (!ts.isVariableStatement(statement) || captureStatement !== undefined) invalid = true;
      else captureStatement = statement;
      const owner = containingFunction(parent);
      if (owner === undefined) invalid = true;
      else wholeAccessFunctions.push(owner);
      return;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.left === current &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isExpressionStatement(parent.parent)
    ) {
      const value = unwrapExpression(parent.right);
      const constructor = ts.isNewExpression(value)
        ? unwrapExpression(value.expression)
        : undefined;
      if (
        ts.isNewExpression(value) &&
        constructor !== undefined &&
        ts.isIdentifier(constructor) &&
        constructor.text === "Proxy" &&
        value.arguments?.[0] !== undefined &&
        ts.isIdentifier(unwrapExpression(value.arguments[0])) &&
        environmentAliases.has((unwrapExpression(value.arguments[0]) as ts.Identifier).text)
      ) {
        const alias = (unwrapExpression(value.arguments[0]) as ts.Identifier).text;
        actualWholeAccesses.push(`install-proxy:${alias}`);
        if (installStatement !== undefined) invalid = true;
        else installStatement = parent.parent;
        const owner = containingFunction(parent);
        if (owner === undefined) invalid = true;
        else wholeAccessFunctions.push(owner);
        return;
      }
      if (ts.isIdentifier(value) && environmentAliases.has(value.text)) {
        actualWholeAccesses.push(`restore:${value.text}`);
        if (restoreStatement !== undefined) invalid = true;
        else restoreStatement = parent.parent;
        const owner = containingFunction(parent);
        if (owner === undefined || !isInsideFinallyBlock(parent)) invalid = true;
        else wholeAccessFunctions.push(owner);
        return;
      }
    }
    invalid = true;
  });

  const identifierOccurrences = new Map<string, number>();
  walk(sourceFile, (node) => {
    if (ts.isIdentifier(node)) {
      identifierOccurrences.set(node.text, (identifierOccurrences.get(node.text) ?? 0) + 1);
    }
  });
  for (const [alias, expectedOccurrences] of Object.entries(
    allowedEnvironmentObjectAliasOccurrences,
  )) {
    if (
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(alias) ||
      !Number.isSafeInteger(expectedOccurrences) ||
      expectedOccurrences < 0 ||
      !environmentAliases.has(alias) ||
      identifierOccurrences.get(alias) !== expectedOccurrences
    ) {
      invalid = true;
    }
  }
  for (const alias of environmentAliases) {
    if (!Object.hasOwn(allowedEnvironmentObjectAliasOccurrences, alias)) invalid = true;
  }
  for (const signature of allowedWholeEnvironmentAccesses) {
    const configured = /^(?:capture|install-proxy|restore):([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(
      signature,
    );
    if (
      configured === null ||
      !Object.hasOwn(allowedEnvironmentObjectAliasOccurrences, configured[1]!)
    ) {
      invalid = true;
    }
  }
  if (allowedWholeEnvironmentAccesses.length > 0) {
    const aliases = Object.keys(allowedEnvironmentObjectAliasOccurrences);
    const alias = aliases.length === 1 ? aliases[0] : undefined;
    const owner = wholeAccessFunctions[0];
    const body = owner === undefined ? undefined : functionBody(owner);
    const finallyBlock = restoreStatement?.parent;
    const guardedTry =
      finallyBlock !== undefined &&
      ts.isBlock(finallyBlock) &&
      ts.isTryStatement(finallyBlock.parent) &&
      finallyBlock.parent.finallyBlock === finallyBlock
        ? finallyBlock.parent
        : undefined;
    if (
      alias === undefined ||
      allowedEnvironmentGuardSourceSha256 === undefined ||
      !equalStrings(allowedWholeEnvironmentAccesses, [
        `capture:${alias}`,
        `install-proxy:${alias}`,
        `restore:${alias}`,
      ]) ||
      body === undefined ||
      captureStatement?.parent !== body ||
      installStatement?.parent !== body ||
      guardedTry?.parent !== body ||
      restoreStatement?.parent !== guardedTry.finallyBlock ||
      !(captureStatement.pos < installStatement.pos && installStatement.pos < guardedTry.pos)
    ) {
      invalid = true;
    } else {
      const guardedDynamicImports: string[] = [];
      walk(guardedTry.tryBlock, (node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] !== undefined &&
          ts.isStringLiteral(node.arguments[0]) &&
          containingFunction(node) === owner
        ) {
          guardedDynamicImports.push(node.arguments[0].text);
        }
      });
      if (
        !equalStrings(guardedDynamicImports.sort(), [
          "./live-smoke-prepare-verification-orchestration.js",
        ])
      ) {
        invalid = true;
      }
    }
  } else if (
    allowedEnvironmentGuardSourceSha256 !== undefined ||
    captureStatement !== undefined ||
    installStatement !== undefined ||
    restoreStatement !== undefined
  ) {
    invalid = true;
  }

  return (
    !invalid &&
    wholeAccessFunctions.every((owner) => owner === wholeAccessFunctions[0]) &&
    equalStrings(actualWholeAccesses, allowedWholeEnvironmentAccesses) &&
    equalStrings(actualReads.sort(), [...allowedEnvironmentVariableReads].sort())
  );
}

export function inspectProviderFreeSourceIsolation(input: {
  readonly modules: readonly ProviderFreeSourceModule[];
}): Readonly<{
  outcome: "PASS" | "BLOCKED";
  violations: readonly ProviderFreeIsolationViolation[];
}> {
  const violations: ProviderFreeIsolationViolation[] = [];

  for (const module of input.modules) {
    if (
      module.allowedSourceSha256 !== undefined &&
      (!/^[0-9a-f]{64}$/u.test(module.allowedSourceSha256) ||
        sha256(module.source) !== module.allowedSourceSha256)
    ) {
      violations.push({ moduleId: module.id, code: "source_integrity" });
    }
    const sideEffectImports = stringsFromMatches(
      module.source,
      /^\s*import\s*["']([^"']+)["']\s*;?/gmu,
    );
    const fromImports = stringsFromMatches(
      module.source,
      /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/gu,
    );
    const staticImports = [...sideEffectImports, ...fromImports].sort();
    const dynamicImports = stringsFromMatches(
      module.source,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    );

    violations.push(
      ...sideEffectImports.map(() => ({
        moduleId: module.id,
        code: "side_effect_import" as const,
      })),
    );
    const allowedLocalCapabilityImports = [...(module.allowedLocalCapabilityImports ?? [])].sort();
    const actualForbiddenImports = [...staticImports, ...dynamicImports]
      .filter((specifier) => forbiddenImport.test(specifier))
      .sort();
    if (
      allowedLocalCapabilityImports.some(
        (specifier) => !allowlistableLocalCapabilityImport.test(specifier),
      ) ||
      !equalStrings(actualForbiddenImports, allowedLocalCapabilityImports)
    ) {
      violations.push({ moduleId: module.id, code: "forbidden_import" });
    }
    if (!equalStrings(staticImports, [...module.allowedStaticImports].sort())) {
      violations.push({ moduleId: module.id, code: "unexpected_import" });
    }
    if (!equalStrings(dynamicImports, [...module.allowedDynamicImports].sort())) {
      violations.push({ moduleId: module.id, code: "unexpected_import" });
    }
    const dynamicImportCount = module.source.match(/\bimport\s*\(/gu)?.length ?? 0;
    if (dynamicImportCount !== dynamicImports.length) {
      violations.push({ moduleId: module.id, code: "non_literal_dynamic_import" });
    }

    const code = lexicalCode(module.source);
    if (
      module.enforceExactBuiltinModuleBoundary === true &&
      hasForbiddenBuiltinModuleAcquisition(module.source)
    ) {
      violations.push({ moduleId: module.id, code: "builtin_module_acquisition" });
    }
    if (
      !hasExactEnvironmentVariableReads(
        module.source,
        module.allowedEnvironmentVariableReads ?? [],
        module.allowedWholeEnvironmentAccesses ?? [],
        module.allowedEnvironmentObjectAliasOccurrences ?? {},
        module.allowedEnvironmentGuardSourceSha256,
      )
    ) {
      violations.push({ moduleId: module.id, code: "environment_capability" });
    }
    for (const capability of capabilityPatterns) {
      const actualOccurrences = occurrenceCount(code, capability.pattern);
      const allowedOccurrences =
        (capability.code === "filesystem_capability" ||
        capability.code === "child_process_capability"
          ? module.allowedLocalCapabilityOccurrences?.[capability.code]
          : undefined) ?? 0;
      if (actualOccurrences !== allowedOccurrences) {
        violations.push({ moduleId: module.id, code: capability.code });
      }
    }
  }

  return Object.freeze({
    outcome: violations.length === 0 ? "PASS" : "BLOCKED",
    violations: Object.freeze(violations.map((violation) => Object.freeze(violation))),
  });
}
