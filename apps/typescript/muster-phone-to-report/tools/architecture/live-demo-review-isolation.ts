import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import * as ts from "typescript";

const reviewBindingEntry =
  "apps/simulator-host/src/composition/live-demo-review-runtime-binding.ts" as const;
const reviewRuntimeSource =
  "apps/simulator-host/src/composition/start-live-demo-review-runtime.ts" as const;
const guardedRuntimeSource =
  "apps/simulator-host/src/composition/guarded-live-smoke-runtime.ts" as const;
const reviewBoundarySource =
  "apps/simulator-host/src/composition/live-demo-review-boundary.ts" as const;
const exactReviewRoutes = Object.freeze([
  "GET /api/v1/live-simulator/operations/{operationId}",
  "DELETE /api/v1/live-demo-review/sessions/{sessionId}",
] as const);
const cleanupTriggers = Object.freeze(["finish", "ttl", "interrupt", "restart"] as const);

const providerImport =
  /(?:@muster\/infrastructure-(?:calle|twilio-simulator)|@call-e\/|(?:^|\/)twilio(?:\/|$))/iu;
const credentialOrTunnelImport = /(?:credential|secret|tunnel|ngrok|runtime-config)/iu;
const dispatchOrCallbackImport = /(?:guarded-live-smoke|callback|dispatch|permit)/iu;

export const LIVE_DEMO_REVIEW_PRODUCTION_MARKERS = Object.freeze([
  "Demo Review",
  "live-demo-review-runtime-binding",
  "start-live-demo-review-runtime",
  "/api/v1/live-demo-review/",
  "Finish demo and delete result",
] as const);

const forbiddenRuntimeProperties = Object.freeze([
  "loadModule",
  "environment",
  "createCalleClient",
  "createTwilioClient",
  "loadProviderCredentials",
  "openTunnel",
  "acceptProviderCallback",
  "dispatchCall",
  "mintAuthorization",
] as const);

const lifecycleFactAllowlist = new Set([
  "lifecycleState",
  "cleanupOutcome",
  "operationId",
  "scenarioId",
  "scenarioRevision",
  "reviewReadyAt",
  "reviewExpiresAt",
  "opaqueRecoveryId",
  "resourceVersion",
]);
const browserStorageAllowlist = new Set(["operationId", "scenarioId", "scenarioRevision"]);
const protectedFieldNames = new Set([
  "authorizationHeader",
  "callbackPayload",
  "credential",
  "custodyPath",
  "permit",
  "phoneNumber",
  "providerIdentity",
  "providerPayload",
  "rawCustodyPath",
  "targetAddress",
  "targetPayload",
  "transcript",
  "transcriptBody",
]);

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function staticText(node: ts.Expression | ts.PropertyName | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return staticText(node.expression);
  }
  if (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticText(node.left);
    const right = staticText(node.right);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function literalText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined &&
    (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function callPropertyName(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) return staticText(expression.argumentExpression);
  return undefined;
}

function propertyPath(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = propertyPath(expression.expression);
    return owner === undefined ? undefined : `${owner}.${expression.name.text}`;
  }
  if (ts.isElementAccessExpression(expression)) {
    const owner = propertyPath(expression.expression);
    const property = staticText(expression.argumentExpression);
    return owner === undefined || property === undefined ? undefined : `${owner}.${property}`;
  }
  return undefined;
}

function moduleSpecifierFromNode(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier === undefined || !ts.isStringLiteralLike(node.moduleSpecifier)
      ? undefined
      : node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression !== undefined
  ) {
    return staticText(node.moduleReference.expression);
  }
  if (ts.isCallExpression(node)) {
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
    const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (isRequire || isDynamicImport) return literalText(node.arguments[0]);
  }
  return undefined;
}

function inspectSourceAst(
  filePath: string,
  source: string,
): {
  readonly specifiers: readonly string[];
  readonly violations: readonly string[];
} {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifierFromNode(node);
    if (specifier !== undefined) {
      specifiers.push(specifier);
      if (providerImport.test(specifier)) {
        violations.push(`${filePath}: provider capability import ${specifier}`);
      }
      if (credentialOrTunnelImport.test(specifier)) {
        violations.push(`${filePath}: credential or tunnel capability import ${specifier}`);
      }
      if (dispatchOrCallbackImport.test(specifier)) {
        violations.push(`${filePath}: dispatch or callback composition import ${specifier}`);
      }
    }
    if (ts.isCallExpression(node)) {
      const name = callPropertyName(node.expression);
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const reflectiveCall =
        name === "eval" ||
        name === "Function" ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "Reflect" &&
          ["get", "ownKeys"].includes(node.expression.name.text));
      if (reflectiveCall || (dynamicImport && literalText(node.arguments[0]) === undefined)) {
        violations.push(`${filePath}: reflective capability acquisition`);
      }
      if (["get", "delete", "post", "put", "patch"].includes(name ?? "")) {
        const route = staticText(node.arguments[0]);
        if (route?.startsWith("/") === true) {
          violations.push(
            `${filePath}: review runtime route surface includes inline ${name} handler ${route}`,
          );
        }
      }
    }
    if (ts.isNewExpression(node) && callPropertyName(node.expression) === "Function") {
      violations.push(`${filePath}: reflective capability acquisition`);
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      /(?:^|\.)process\.env$/u.test(propertyPath(node) ?? "")
    ) {
      violations.push(`${filePath}: reflective capability acquisition`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze({
    specifiers: Object.freeze(specifiers),
    violations: Object.freeze([...new Set(violations)]),
  });
}

async function workspaceSourceForSpecifier(
  repositoryRoot: string,
  importer: string,
  specifier: string,
): Promise<string | undefined> {
  if (specifier.startsWith("@muster/")) {
    for (const directory of ["apps", "packages"] as const) {
      const entries = await readdir(path.join(repositoryRoot, directory), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const packageRoot = path.join(repositoryRoot, directory, entry.name);
        try {
          const manifest = JSON.parse(
            await readFile(path.join(packageRoot, "package.json"), "utf8"),
          ) as { readonly name?: string };
          if (manifest.name !== specifier) continue;
          return normalizePath(
            path.relative(repositoryRoot, path.join(packageRoot, "src/index.ts")),
          );
        } catch {
          // Directories without a readable workspaceDirectory manifest are not package imports.
        }
      }
    }
    return undefined;
  }
  if (!specifier.startsWith(".")) return undefined;
  const unresolved = path.resolve(repositoryRoot, path.dirname(importer), specifier);
  const candidates = specifier.endsWith(".js")
    ? [`${unresolved.slice(0, -3)}.ts`, `${unresolved.slice(0, -3)}.tsx`]
    : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return normalizePath(path.relative(repositoryRoot, candidate));
    } catch {
      // Missing or non-source relative imports are outside this TypeScript graph.
    }
  }
  return undefined;
}

function extractClosedRoutes(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    reviewBoundarySource,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let routes: readonly string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "LIVE_DEMO_REVIEW_ROUTE_TABLE" &&
      node.initializer !== undefined
    ) {
      const initializer =
        ts.isCallExpression(node.initializer) && node.initializer.arguments[0] !== undefined
          ? node.initializer.arguments[0]
          : node.initializer;
      const array = ts.isAsExpression(initializer) ? initializer.expression : initializer;
      if (ts.isArrayLiteralExpression(array)) {
        routes = array.elements.flatMap((element) => {
          const candidate = ts.isCallExpression(element)
            ? element.arguments[0]
            : ts.isObjectLiteralExpression(element)
              ? element
              : undefined;
          if (candidate === undefined || !ts.isObjectLiteralExpression(candidate)) return [];
          const route = candidate.properties.find(
            (property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) && staticText(property.name) === "route",
          );
          const value = route === undefined ? undefined : staticText(route.initializer);
          return value === undefined ? [] : [value];
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(routes);
}

function inspectReviewBoundary(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    reviewBoundarySource,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const routeEntries: Array<Readonly<{ kind?: string; method?: string; route?: string }>> = [];
  const classifierPathOperands: string[] = [];
  let cleanupFactories = 0;
  let cleanupOwnerDefinitions = 0;
  let cleanupOwnerAssignments = 0;
  let classifierDefinitions = 0;
  let methodNormalizerDefinitions = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "LIVE_DEMO_REVIEW_ROUTE_TABLE" &&
      node.initializer !== undefined
    ) {
      const frozen = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]
        : node.initializer;
      const array = frozen !== undefined && ts.isAsExpression(frozen) ? frozen.expression : frozen;
      if (array !== undefined && ts.isArrayLiteralExpression(array)) {
        for (const element of array.elements) {
          const candidate = ts.isCallExpression(element) ? element.arguments[0] : element;
          if (candidate === undefined || !ts.isObjectLiteralExpression(candidate)) continue;
          const fields = Object.fromEntries(
            candidate.properties.flatMap((property) => {
              if (!ts.isPropertyAssignment(property)) return [];
              const name = staticText(property.name);
              const value = staticText(property.initializer);
              return name === undefined || value === undefined ? [] : [[name, value]];
            }),
          );
          routeEntries.push(fields);
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "classifyLiveDemoReviewRequest") {
      classifierDefinitions += 1;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "normalizeMethod") {
      methodNormalizerDefinitions += 1;
      const normalized = node.body === undefined ? "" : normalizedSource(node.body, sourceFile);
      if (
        normalized !==
        '{returnmethod==="GET"||method==="DELETE"||method==="OPTIONS"?method:"OTHER";}'
      ) {
        violations.push("review boundary method normalization is not the exact closed method set");
      }
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createLiveDemoReviewProtectedCleanupBinding"
    ) {
      cleanupFactories += 1;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "cleanupOwner"
    ) {
      cleanupOwnerDefinitions += 1;
      if ((node.parent.flags & ts.NodeFlags.Const) === 0) {
        violations.push("review boundary cleanup owner is not immutable");
      }
    }
    if (ts.isBinaryExpression(node) && assignmentTarget(node) === "cleanupOwner") {
      cleanupOwnerAssignments += 1;
    }
    if (ts.isBinaryExpression(node)) {
      const left = propertyPath(node.left);
      const right = propertyPath(node.right);
      if (left === "input.path" || right === "input.path") {
        if (node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
          violations.push("review boundary route comparison is not exact equality");
        }
        classifierPathOperands.push(left === "input.path" ? (right ?? "") : (left ?? ""));
      }
    }
    if (ts.isStringLiteralLike(node) && node.text.includes("/api/v1/")) {
      if (!exactReviewRoutes.includes(node.text as (typeof exactReviewRoutes)[number])) {
        violations.push("review boundary contains a hidden or altered route literal");
      }
    }
    if (
      ts.isIdentifier(node) &&
      /(?:ensureControl|provider|twilio|calle|credential|tunnel|ngrok|callback|dispatch|permit|authorization|environment)/iu.test(
        node.text,
      )
    ) {
      violations.push(`review boundary contains forbidden capability ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const expectedEntries = [
    { kind: "operation", method: "GET", route: exactReviewRoutes[0] },
    { kind: "cleanup", method: "DELETE", route: exactReviewRoutes[1] },
  ];
  if (JSON.stringify(routeEntries) !== JSON.stringify(expectedEntries)) {
    violations.push("review boundary route table is not the exact closed definition");
  }
  if (
    classifierDefinitions !== 1 ||
    methodNormalizerDefinitions !== 1 ||
    classifierPathOperands.length !== 2 ||
    !classifierPathOperands.includes("input.exactOperationPath") ||
    !classifierPathOperands.includes("input.exactCleanupPath")
  ) {
    violations.push("review boundary classifier is not the exact closed dispatcher");
  }
  if (cleanupFactories !== 1 || cleanupOwnerDefinitions !== 1 || cleanupOwnerAssignments !== 0) {
    violations.push("review boundary cleanup binding is not the single immutable definition");
  }
  return Object.freeze([...new Set(violations)]);
}

function inspectNativeReviewRouting(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    reviewRuntimeSource,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const serverFactories: ts.CallExpression[] = [];
  const pathComparisons: ts.BinaryExpression[] = [];
  let classifierCalls = 0;
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callPropertyName(node.expression);
      if (name === "createServer") serverFactories.push(node);
      if (name === "classifyLiveDemoReviewRequest") classifierCalls += 1;
      if (
        ["addListener", "on", "once", "prependListener"].includes(name ?? "") &&
        staticText(node.arguments[0]) === "request"
      ) {
        violations.push("review runtime native request routing has a hidden listener");
      }
    }
    if (ts.isBinaryExpression(node)) {
      const comparesValues = [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind);
      const leftPath = propertyPath(node.left);
      const rightPath = propertyPath(node.right);
      const leftText = staticText(node.left);
      const rightText = staticText(node.right);
      const leftIsRequestRoute = leftPath === "request.url" || leftPath === "parsedTarget.pathname";
      const rightIsRequestRoute =
        rightPath === "request.url" || rightPath === "parsedTarget.pathname";
      if (comparesValues && (leftPath === "path" || rightPath === "path")) {
        pathComparisons.push(node);
      }
      if (
        comparesValues &&
        ((leftIsRequestRoute && rightText?.startsWith("/") === true) ||
          (rightIsRequestRoute && leftText?.startsWith("/") === true))
      ) {
        violations.push("review runtime native request routing contains a literal route branch");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (serverFactories.length !== 1) {
    violations.push(
      "review runtime native request routing must have exactly one server dispatcher",
    );
  } else {
    const handler = serverFactories[0]?.arguments[0];
    if (
      handler === undefined ||
      (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))
    ) {
      violations.push("review runtime native request routing dispatcher is not inspectable");
    } else {
      const dispatcher = handler.getText(sourceFile).replace(/\s+/gu, "");
      for (const requiredBranch of [
        "classifyLiveDemoReviewRequest({method:request.method,path,exactOperationPath,exactCleanupPath,})",
        'classification.outcome==="not_found"',
        'classification.outcome==="options"',
        'classification.outcome==="method_not_allowed"',
        'classification.outcome==="operation"',
      ]) {
        if (!dispatcher.includes(requiredBranch)) {
          violations.push(
            `review runtime native request routing is not the closed tuple dispatcher: ${requiredBranch}`,
          );
        }
      }
      const handlerSource = handler.getText(sourceFile);
      const handlerFile = ts.createSourceFile(
        "live-demo-review-native-handler.ts",
        handlerSource,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      let pathIdentifiers = 0;
      let requestUrlReads = 0;
      let parsedPathnameReads = 0;
      const inspectRouteDataFlow = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === "path") pathIdentifiers += 1;
        if (ts.isPropertyAccessExpression(node)) {
          const property = propertyPath(node);
          if (property === "request.url") requestUrlReads += 1;
          if (property === "parsedTarget.pathname") parsedPathnameReads += 1;
        }
        ts.forEachChild(node, inspectRouteDataFlow);
      };
      inspectRouteDataFlow(handlerFile);
      if (pathIdentifiers !== 2 || requestUrlReads !== 1 || parsedPathnameReads !== 1) {
        violations.push(
          "review runtime native request route data must flow only into the closed classifier",
        );
      }
    }
  }
  if (pathComparisons.length !== 0 || classifierCalls !== 1) {
    violations.push(
      "review runtime native request routing must delegate path and method classification exactly once",
    );
  }
  return Object.freeze([...new Set(violations)]);
}

function assignmentTarget(node: ts.BinaryExpression): string | undefined {
  const kind = node.operatorToken.kind;
  if (kind < ts.SyntaxKind.FirstAssignment || kind > ts.SyntaxKind.LastAssignment) {
    return undefined;
  }
  return ts.isIdentifier(node.left) ? node.left.text : undefined;
}

function normalizedSource(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/gu, "");
}

function verifyBindingCallsite(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    guardedRuntimeSource,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const boundCalls: ts.CallExpression[] = [];
  let directRuntimeCall = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callPropertyName(node.expression);
      if (name === "startLiveDemoReviewRuntime") directRuntimeCall = true;
      if (name === "startBoundLiveDemoReviewRuntime") boundCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (directRuntimeCall || boundCalls.length !== 1) return false;
  const argument = boundCalls[0]?.arguments[0];
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return false;
  const properties = argument.properties.map((property) =>
    ts.isShorthandPropertyAssignment(property) ? property.name.text : staticText(property.name),
  );
  return properties.filter((property) => property === "protectedCleanup").length === 1;
}

export async function inspectLiveDemoReviewIsolation(input: {
  readonly repositoryRoot: string;
  readonly sourceMutations?: Readonly<Record<string, string>>;
  readonly sourceOverrides?: Readonly<Record<string, string>>;
}): Promise<{
  readonly importGraph: readonly string[];
  readonly routes: readonly string[];
  readonly cleanupTriggers: readonly string[];
  readonly bindingCallsiteVerified: boolean;
  readonly violations: readonly string[];
}> {
  const pending: string[] = [reviewBindingEntry];
  const visited = new Set<string>();
  const violations: string[] = [];
  const graphSources = new Map<string, string>();
  while (pending.length > 0) {
    const filePath = pending.shift();
    if (filePath === undefined || visited.has(filePath)) continue;
    visited.add(filePath);
    const source = `${
      input.sourceOverrides?.[filePath] ??
      (await readFile(path.join(input.repositoryRoot, filePath), "utf8"))
    }\n${input.sourceMutations?.[filePath] ?? ""}`;
    graphSources.set(filePath, source);
    const inspected = inspectSourceAst(filePath, source);
    violations.push(...inspected.violations);
    for (const specifier of inspected.specifiers) {
      const resolved = await workspaceSourceForSpecifier(input.repositoryRoot, filePath, specifier);
      if (resolved !== undefined && !visited.has(resolved)) pending.push(resolved);
    }
  }
  const boundarySource = graphSources.get(reviewBoundarySource) ?? "";
  const routes = extractClosedRoutes(boundarySource);
  if (routes.join("\n") !== exactReviewRoutes.join("\n")) {
    violations.push("review runtime route surface is not the closed exact route tuple");
  }
  violations.push(...inspectReviewBoundary(boundarySource));
  const runtimeSource = graphSources.get(reviewRuntimeSource) ?? "";
  violations.push(...inspectNativeReviewRouting(runtimeSource));
  const combinedSource = [...graphSources.values()].join("\n");
  const observedCleanupTriggers = cleanupTriggers.filter((trigger) =>
    combinedSource.includes(`"${trigger}"`),
  );
  if (observedCleanupTriggers.length !== cleanupTriggers.length) {
    violations.push("review cleanup trigger surface is incomplete");
  }
  const guardedSource = `${
    input.sourceOverrides?.[guardedRuntimeSource] ??
    (await readFile(path.join(input.repositoryRoot, guardedRuntimeSource), "utf8"))
  }\n${input.sourceMutations?.[guardedRuntimeSource] ?? ""}`;
  const bindingCallsiteVerified = verifyBindingCallsite(guardedSource);
  if (!bindingCallsiteVerified) {
    violations.push("guarded runtime does not use the closed Demo Review binding callsite");
  }
  return Object.freeze({
    importGraph: Object.freeze([...visited].sort()),
    routes: Object.freeze(routes),
    cleanupTriggers: Object.freeze(observedCleanupTriggers),
    bindingCallsiteVerified,
    violations: Object.freeze([...new Set(violations)].sort()),
  });
}

export function createLiveDemoReviewRuntimeAcquisitionTrap<T extends object>(
  input: T,
): {
  readonly input: T;
  readonly acquisitions: readonly string[];
} {
  const acquisitions: string[] = [];
  const forbidden = new Set<string>(forbiddenRuntimeProperties);
  const trapped = new Proxy(input, {
    get(target, property, receiver) {
      if (typeof property === "string" && forbidden.has(property)) {
        acquisitions.push(property);
        throw new Error(`Demo Review attempted forbidden capability acquisition: ${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return Object.freeze({ input: trapped, acquisitions });
}

function listReviewArtifactCandidates(repositoryRoot: string): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repositoryRoot, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(
          Object.freeze(
            stdout
              .split("\0")
              .filter((filePath) => {
                if (!/\.(?:json|md|snap|tsx?|txt|ya?ml)$/iu.test(filePath)) return false;
                return (
                  filePath.startsWith("docs/") ||
                  filePath.startsWith("memory-bank/") ||
                  /(?:^|\/)(?:__snapshots__|fixtures?|snapshots?)(?:\/|$)/iu.test(filePath) ||
                  /\.snap$/iu.test(filePath)
                );
              })
              .sort(),
          ),
        );
      },
    );
  });
}

function privacyViolations(surface: string, content: string): readonly string[] {
  const violations: string[] = [];
  if (/\b(?:AC|CA|PN|SK)[0-9a-f]{32}\b/iu.test(content)) {
    violations.push(`${surface}: provider identity or credential-shaped value`);
  }
  if (
    /\+[1-9][0-9\s().-]{7,20}[0-9]\b/u.test(content) ||
    /\([2-9][0-9]{2}\)\s*[0-9]{3}[-\s][0-9]{4}\b/u.test(content)
  ) {
    violations.push(`${surface}: phone value`);
  }
  if (
    /https?:\/\/[^\s"')]+[?&](?:permit|credential|authorization|phone|target|provider|transcript|custody)=/iu.test(
      content,
    )
  ) {
    violations.push(`${surface}: protected URL value`);
  }
  const protectedAssignment = new RegExp(
    `["']?(?:${[...protectedFieldNames].join("|")})["']?\\s*[:=]\\s*["'][^"']+["']`,
    "iu",
  );
  if (protectedAssignment.test(content)) {
    violations.push(`${surface}: protected field value`);
  }
  const protectedSerializedField = new RegExp(
    `["'](?:${[...protectedFieldNames].join("|")})["']\\s*:`,
    "iu",
  );
  if (protectedSerializedField.test(content)) {
    violations.push(`${surface}: protected serialized field`);
  }
  return Object.freeze(violations);
}

function inspectCapturedValue(surface: string, value: unknown, violations: string[]): void {
  if (typeof value === "string") {
    violations.push(...privacyViolations(surface, value));
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectCapturedValue(`${surface}[${String(index)}]`, item, violations),
    );
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (protectedFieldNames.has(key)) violations.push(`${surface}: protected field ${key}`);
    inspectCapturedValue(surface, item, violations);
  }
}

export async function inspectLiveDemoReviewPrivacy(input: {
  readonly repositoryRoot: string;
  readonly capturedLifecycleFacts?: readonly Readonly<Record<string, unknown>>[];
  readonly capturedSurfaces?: Readonly<Record<string, unknown>>;
  readonly trackedArtifactMutations?: Readonly<Record<string, string>>;
}): Promise<{
  readonly violations: readonly string[];
  readonly inspectedFiles: readonly string[];
}> {
  const violations: string[] = [];
  for (const [index, facts] of (input.capturedLifecycleFacts ?? []).entries()) {
    for (const key of Object.keys(facts)) {
      if (!lifecycleFactAllowlist.has(key)) {
        violations.push(
          `captured lifecycle facts ${String(index)}: non-allowlisted lifecycle fact ${key}`,
        );
      }
    }
    violations.push(
      ...privacyViolations(`captured lifecycle facts ${String(index)}`, JSON.stringify(facts)),
    );
  }
  for (const [surface, value] of Object.entries(input.capturedSurfaces ?? {})) {
    if (
      surface === "storage" &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      for (const key of Object.keys(value)) {
        if (!browserStorageAllowlist.has(key)) {
          violations.push(`${surface}: non-allowlisted browser storage field ${key}`);
        }
      }
    }
    inspectCapturedValue(surface, value, violations);
  }
  const candidateFiles = await listReviewArtifactCandidates(input.repositoryRoot);
  for (const filePath of candidateFiles) {
    const content = await readFile(path.join(input.repositoryRoot, filePath), "utf8");
    violations.push(...privacyViolations(filePath, content));
  }
  for (const [filePath, content] of Object.entries(input.trackedArtifactMutations ?? {})) {
    violations.push(...privacyViolations(filePath, content));
  }
  return Object.freeze({
    violations: Object.freeze([...new Set(violations)].sort()),
    inspectedFiles: Object.freeze(candidateFiles),
  });
}

export function inspectLiveDemoReviewArtifactContents(
  artifacts: Readonly<Record<string, string>>,
): { readonly violations: readonly string[] } {
  const violations: string[] = [];
  for (const [filePath, content] of Object.entries(artifacts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const marker of LIVE_DEMO_REVIEW_PRODUCTION_MARKERS) {
      if (content.includes(marker)) violations.push(`${filePath}: ${marker}`);
    }
  }
  return Object.freeze({ violations: Object.freeze(violations) });
}
