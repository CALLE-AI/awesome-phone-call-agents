import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@hey-api/openapi-ts";
import { parse } from "yaml";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = join(repositoryRoot, "docs/api/openapi.yaml");
const committedOutput = join(repositoryRoot, "packages/api-client/src/generated");
const observationAcceptedDescription =
  "A newly established request does not imply provider-call or evidence-extraction completion. A matching replay reports the database-established current stage and terminal outcome, while the operation remains queryable.";

const plugins = [
  { name: "@hey-api/client-fetch" as const, bundle: true, throwOnError: false },
  "@hey-api/typescript" as const,
  "@hey-api/sdk" as const,
];

async function generateAt(output: string): Promise<void> {
  await createClient({ input: sourcePath, output, plugins });
  await rewriteNodeEsmImports(output);
  await writeFile(join(output, "client.ts"), 'export * from "./client/index.js";\n', "utf8");
  await writeFile(join(output, "schema.ts"), 'export * from "./types.gen.js";\n', "utf8");
}

async function filesUnder(root: string): Promise<readonly string[]> {
  const results: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else results.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return results.sort();
}

async function outputsMatch(expected: string, actual: string): Promise<boolean> {
  const expectedFiles = await filesUnder(expected);
  const actualFiles = await filesUnder(actual);
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) return false;
  for (const file of expectedFiles) {
    if (
      (await readFile(join(expected, file), "utf8")) !==
      (await readFile(join(actual, file), "utf8"))
    ) {
      return false;
    }
  }
  return true;
}

async function rewriteNodeEsmImports(output: string): Promise<void> {
  for (const file of (await filesUnder(output)).filter((candidate) => candidate.endsWith(".ts"))) {
    const path = join(output, file);
    const source = await readFile(path, "utf8");
    const rewritten = source.replace(
      /(\bfrom\s+["'])(\.\.?\/[^"']+)(["'])/gu,
      (_match: string, prefix: string, specifier: string, suffix: string) =>
        `${prefix}${specifier.endsWith(".js") ? specifier : `${specifier}.js`}${suffix}`,
    );
    if (rewritten !== source) await writeFile(path, rewritten, "utf8");
  }
}

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, ...path: readonly string[]): JsonObject | undefined {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = (current as JsonObject)[key];
  }
  return typeof current === "object" && current !== null ? (current as JsonObject) : undefined;
}

function hasExactArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((item, index) => value[index] === item)
  );
}

function hasResponseContract(
  operation: JsonObject,
  statusCode: "200" | "404" | "503",
  exampleName: "ready" | "notFound" | "degraded",
  schemaName: "SystemHealthResponse" | "ErrorResponse",
): boolean {
  const response = objectAt(operation, "responses", statusCode);
  const mediaType = objectAt(response, "content", "application/json");
  const example = objectAt(mediaType, "examples", exampleName, "value");
  const headers = objectAt(response, "headers");
  const expectedExample =
    exampleName === "ready"
      ? { status: "ready" }
      : exampleName === "degraded"
        ? { status: "degraded" }
        : {
            error: {
              code: "not_found",
              message: "Resource not found",
              correlationId: "32af9cc5-3c5b-4219-bff1-68341bd3cb29",
            },
          };
  const expectedHeaders: Readonly<Record<string, string>> = {
    "Cache-Control": "#/components/headers/CacheControl",
    Pragma: "#/components/headers/Pragma",
    Expires: "#/components/headers/Expires",
    "X-Content-Type-Options": "#/components/headers/ContentTypeOptions",
  };
  return (
    typeof response?.["description"] === "string" &&
    objectAt(mediaType, "schema")?.["$ref"] === `#/components/schemas/${schemaName}` &&
    JSON.stringify(example) === JSON.stringify(expectedExample) &&
    headers !== undefined &&
    Object.entries(expectedHeaders).every(
      ([name, reference]) => objectAt(headers, name)?.["$ref"] === reference,
    )
  );
}

function hasHeaderComponent(root: JsonObject, name: string, value: string): boolean {
  const schema = objectAt(root, "components", "headers", name, "schema");
  return schema?.["type"] === "string" && schema["const"] === value;
}

function references(value: unknown, reference: string): boolean {
  return objectAt(value)?.["$ref"] === reference;
}

function hasObservationSecurity(operation: JsonObject | undefined): boolean {
  const security = operation?.["security"];
  return (
    Array.isArray(security) &&
    security.length === 1 &&
    objectAt(security[0]) !== undefined &&
    hasExactArray(objectAt(security[0])?.["ObservationAuthorization"], [])
  );
}

function hasSafeResponseHeaders(response: JsonObject | undefined): boolean {
  const headers = objectAt(response, "headers");
  return (
    headers !== undefined &&
    references(headers["Cache-Control"], "#/components/headers/CacheControl") &&
    references(headers["Pragma"], "#/components/headers/Pragma") &&
    references(headers["Expires"], "#/components/headers/Expires") &&
    references(headers["X-Content-Type-Options"], "#/components/headers/ContentTypeOptions")
  );
}

const observationQualities = new Set(["complete", "partial", "unknown", "invalid"]);
const readingDispositions = new Set([
  "grounded",
  "missing",
  "ambiguous",
  "contradictory",
  "reviewed_not_applicable",
  "invalid",
]);

function hasLegalObservationExample(example: JsonObject | undefined): boolean {
  const evidence = objectAt(example, "evidence");
  const observation = objectAt(example, "observation");
  const readings = observation?.["readings"];
  const quality = observation?.["quality"];
  if (
    evidence === undefined ||
    observation === undefined ||
    !observationQualities.has(quality as string) ||
    !Array.isArray(readings) ||
    readings.length === 0
  ) {
    return false;
  }
  const zoneIds = new Set<string>();
  const ordinals = new Set<number>();
  const dispositions: string[] = [];
  for (const [index, value] of readings.entries()) {
    const reading = objectAt(value);
    if (reading === undefined) return false;
    const zoneId = reading?.["zoneId"];
    const ordinal = reading?.["ordinal"];
    const disposition = reading?.["disposition"];
    const evidenceAnchors = reading?.["evidenceAnchorIds"];
    if (
      typeof zoneId !== "string" ||
      zoneIds.has(zoneId) ||
      ordinal !== index ||
      ordinals.has(ordinal) ||
      typeof disposition !== "string" ||
      !readingDispositions.has(disposition) ||
      !Array.isArray(evidenceAnchors) ||
      reading?.["evidenceId"] !== evidence["evidenceId"] ||
      reading["evidenceId"] !== observation["evidenceId"] ||
      reading["providerRunId"] !== evidence["providerRunId"] ||
      reading["adapterVersionId"] !== observation["adapterVersionId"] ||
      reading["extractorVersionId"] !== observation["extractorVersionId"] ||
      typeof reading["evidenceRevisionId"] !== "string" ||
      typeof reading["sourceCapturedAt"] !== "string" ||
      typeof reading["derivedAt"] !== "string"
    ) {
      return false;
    }
    const derivedFields = [
      reading["value"],
      reading["spokenUnit"],
      reading["normalizedUnit"],
      reading["confidenceToken"],
      reading["confidenceSemanticsVersion"],
    ];
    if (
      disposition === "grounded"
        ? derivedFields.some((field) => typeof field !== "string" || field.length === 0) ||
          evidenceAnchors.length === 0
        : derivedFields.some((field) => field !== null)
    ) {
      return false;
    }
    zoneIds.add(zoneId);
    ordinals.add(ordinal);
    dispositions.push(disposition);
  }
  const invalid = dispositions.includes("invalid");
  const allSatisfied = dispositions.every(
    (disposition) => disposition === "grounded" || disposition === "reviewed_not_applicable",
  );
  const complete = !invalid && allSatisfied && evidence["sourceCompleteness"] === "complete";
  const grounded = dispositions.includes("grounded");
  const expectedQuality = invalid
    ? "invalid"
    : complete
      ? "complete"
      : grounded
        ? "partial"
        : "unknown";
  return quality === expectedQuality;
}

function hasExpectedExampleZones(example: JsonObject | undefined): boolean {
  const readings = objectAt(example, "observation")?.["readings"];
  return (
    Array.isArray(readings) &&
    hasExactArray(
      readings.map((reading) => objectAt(reading)?.["zoneId"]),
      ["zone-01", "zone-02"],
    )
  );
}

function hasUnexpectedErrorResponse(root: JsonObject): boolean {
  const response = objectAt(root, "components", "responses", "UnexpectedError");
  const media = objectAt(response, "content", "application/json");
  const example = objectAt(media, "examples", "unexpected", "value", "error");
  return (
    hasSafeResponseHeaders(response) &&
    references(media?.["schema"], "#/components/schemas/ErrorResponse") &&
    example?.["code"] === "unexpected_error" &&
    example["message"] === "Unexpected error" &&
    typeof example["correlationId"] === "string"
  );
}

function hasObservationContracts(root: JsonObject): boolean {
  const requestOperation = objectAt(
    root,
    "paths",
    "/api/v1/endpoints/{endpointId}/observations",
    "post",
  );
  const statusOperation = objectAt(root, "paths", "/api/v1/observations/{operationId}", "get");
  const acceptedResponse = objectAt(requestOperation, "responses", "202");
  const conflictResponse = objectAt(requestOperation, "responses", "409");
  const statusResponse = objectAt(statusOperation, "responses", "200");
  const acceptedMedia = objectAt(acceptedResponse, "content", "application/json");
  const statusMedia = objectAt(statusResponse, "content", "application/json");
  const statusExamples = objectAt(statusMedia, "examples");
  const operationSchema = objectAt(root, "components", "schemas", "ObservationOperationResponse");
  const operationProperties = objectAt(operationSchema, "properties");
  const observationProperty = objectAt(operationProperties, "observation");
  const evidenceProperty = objectAt(operationProperties, "evidence");
  const acceptedSchema = objectAt(root, "components", "schemas", "ObservationAcceptedResponse");
  const acceptedProperties = objectAt(acceptedSchema, "properties");
  const versionedReadings = objectAt(
    root,
    "components",
    "schemas",
    "VersionedObservation",
    "properties",
    "readings",
  );
  const readingSchema = objectAt(root, "components", "schemas", "ObservationReading");
  const readingProperties = objectAt(readingSchema, "properties");
  const errorCodes = objectAt(
    root,
    "components",
    "schemas",
    "ErrorResponse",
    "properties",
    "error",
    "properties",
    "code",
  );
  const completeExample = objectAt(root, "components", "examples", "CompleteObservation", "value");
  const incompleteExample = objectAt(
    root,
    "components",
    "examples",
    "IncompleteObservation",
    "value",
  );
  const blockedExample = objectAt(root, "components", "examples", "BlockedObservation", "value");
  const unknownExample = objectAt(root, "components", "examples", "UnknownObservation", "value");
  const invalidExample = objectAt(root, "components", "examples", "InvalidObservation", "value");
  const noAnswerExample = objectAt(root, "components", "examples", "NoAnswerObservation", "value");
  const busyExample = objectAt(root, "components", "examples", "BusyObservation", "value");
  const failureExample = objectAt(
    root,
    "components",
    "examples",
    "ProviderFailureObservation",
    "value",
  );
  const evidenceUnavailableExample = objectAt(
    root,
    "components",
    "examples",
    "EvidenceUnavailableObservation",
    "value",
  );
  return (
    requestOperation?.["operationId"] === "requestObservation" &&
    statusOperation?.["operationId"] === "getObservationOperation" &&
    hasObservationSecurity(requestOperation) &&
    hasObservationSecurity(statusOperation) &&
    references(
      objectAt(requestOperation, "requestBody", "content", "application/json", "schema"),
      "#/components/schemas/ObservationRequest",
    ) &&
    hasSafeResponseHeaders(acceptedResponse) &&
    acceptedResponse?.["description"] === observationAcceptedDescription &&
    references(
      acceptedResponse?.["headers"] === undefined
        ? undefined
        : objectAt(acceptedResponse, "headers")?.["Location"],
      "#/components/headers/Location",
    ) &&
    references(
      objectAt(acceptedResponse, "headers")?.["Retry-After"],
      "#/components/headers/RetryAfter",
    ) &&
    references(acceptedMedia?.["schema"], "#/components/schemas/ObservationAcceptedResponse") &&
    objectAt(acceptedMedia, "examples", "accepted", "value")?.["operationId"] ===
      "operation_opaque" &&
    references(
      objectAt(requestOperation, "responses")?.["400"],
      "#/components/responses/ValidationError",
    ) &&
    references(
      objectAt(requestOperation, "responses")?.["404"],
      "#/components/responses/ConcealedNotFound",
    ) &&
    conflictResponse !== undefined &&
    hasSafeResponseHeaders(conflictResponse) &&
    references(
      objectAt(requestOperation, "responses")?.["500"],
      "#/components/responses/UnexpectedError",
    ) &&
    references(
      objectAt(requestOperation, "responses")?.["503"],
      "#/components/responses/DependencyUnavailable",
    ) &&
    hasSafeResponseHeaders(statusResponse) &&
    references(statusMedia?.["schema"], "#/components/schemas/ObservationOperationResponse") &&
    statusExamples !== undefined &&
    [
      "scheduled",
      "calling",
      "extracting",
      "complete",
      "incomplete",
      "unknown",
      "invalid",
      "blocked",
      "noAnswer",
      "busy",
      "providerFailure",
      "evidenceUnavailable",
    ].every((name) => objectAt(statusExamples[name])?.["$ref"] !== undefined) &&
    references(
      objectAt(statusOperation, "responses")?.["400"],
      "#/components/responses/ValidationError",
    ) &&
    references(
      objectAt(statusOperation, "responses")?.["404"],
      "#/components/responses/ConcealedNotFound",
    ) &&
    references(
      objectAt(statusOperation, "responses")?.["503"],
      "#/components/responses/DependencyUnavailable",
    ) &&
    references(
      objectAt(statusOperation, "responses")?.["500"],
      "#/components/responses/UnexpectedError",
    ) &&
    hasUnexpectedErrorResponse(root) &&
    acceptedSchema?.["additionalProperties"] === false &&
    hasExactArray(acceptedSchema?.["required"], [
      "contractVersion",
      "operationId",
      "statusUrl",
      "stage",
      "terminalOutcome",
      "acceptedAt",
    ]) &&
    hasExactArray(
      acceptedProperties?.["stage"] === undefined
        ? undefined
        : objectAt(acceptedProperties, "stage")?.["enum"],
      ["scheduled", "calling", "extracting", "terminal"],
    ) &&
    hasExactArray(objectAt(acceptedProperties, "terminalOutcome")?.["type"], ["string", "null"]) &&
    versionedReadings?.["minItems"] === 1 &&
    operationSchema?.["additionalProperties"] === false &&
    hasExactArray(operationSchema?.["required"], [
      "contractVersion",
      "operationId",
      "resourceVersion",
      "stage",
      "terminal",
      "lastTransitionAt",
      "latestRevisionAt",
      "attempt",
      "terminalOutcome",
      "evidence",
      "observation",
      "recommendedAction",
    ]) &&
    references(operationProperties?.["attempt"], "#/components/schemas/ObservationAttempt") &&
    Array.isArray(evidenceProperty?.["oneOf"]) &&
    hasExactArray(observationProperty?.["type"], ["object", "null"]) &&
    readingSchema?.["additionalProperties"] === false &&
    readingProperties?.["evidenceId"] !== undefined &&
    readingProperties["providerRunId"] !== undefined &&
    readingProperties["adapterVersionId"] !== undefined &&
    readingProperties["extractorVersionId"] !== undefined &&
    objectAt(root, "components", "securitySchemes", "ObservationAuthorization")?.["type"] ===
      "apiKey" &&
    hasExactArray(errorCodes?.["enum"], [
      "validation_error",
      "not_found",
      "conflict",
      "access_denied",
      "dependency_unavailable",
      "unexpected_error",
    ]) &&
    completeExample?.["terminalOutcome"] === "observation_recorded" &&
    hasLegalObservationExample(completeExample) &&
    hasLegalObservationExample(incompleteExample) &&
    hasLegalObservationExample(unknownExample) &&
    hasLegalObservationExample(invalidExample) &&
    hasExpectedExampleZones(incompleteExample) &&
    hasExpectedExampleZones(unknownExample) &&
    hasExpectedExampleZones(invalidExample) &&
    blockedExample?.["terminalOutcome"] === "blocked" &&
    blockedExample["observation"] === null &&
    noAnswerExample?.["terminalOutcome"] === "no_answer" &&
    noAnswerExample["observation"] === null &&
    busyExample?.["terminalOutcome"] === "busy" &&
    busyExample["observation"] === null &&
    failureExample?.["terminalOutcome"] === "provider_failed" &&
    failureExample["observation"] === null &&
    evidenceUnavailableExample?.["terminalOutcome"] === "evidence_unavailable" &&
    evidenceUnavailableExample["observation"] === null &&
    objectAt(failureExample, "attempt")?.["provenance"] === "SIMULATED"
  );
}

function hasFleetContracts(root: JsonObject): boolean {
  const operation = objectAt(root, "paths", "/api/v1/fleet", "get");
  const security = operation?.["security"];
  const response = objectAt(operation, "responses", "200");
  const media = objectAt(response, "content", "application/json");
  const responseSchema = objectAt(root, "components", "schemas", "FleetHealthResponse");
  const responseProperties = objectAt(responseSchema, "properties");
  const endpointArray = objectAt(responseProperties, "endpoints");
  const state = objectAt(root, "components", "schemas", "FleetOperationalState");
  const incident = objectAt(root, "components", "schemas", "FleetIncident");
  const incidentOneOf = incident?.["oneOf"];
  const incidentVariants = [
    ["FleetIncidentNone", "none"],
    ["FleetIncidentOpen", "open"],
    ["FleetIncidentUnavailable", "unavailable"],
  ] as const;
  const heartbeat = objectAt(root, "components", "schemas", "FleetSchedulerHeartbeat");
  return (
    operation?.["operationId"] === "getFleetHealth" &&
    Array.isArray(security) &&
    security.length === 1 &&
    hasExactArray(objectAt(security[0])?.["FleetAuthorization"], []) &&
    objectAt(root, "components", "securitySchemes", "FleetAuthorization")?.["type"] === "apiKey" &&
    hasSafeResponseHeaders(response) &&
    references(media?.["schema"], "#/components/schemas/FleetHealthResponse") &&
    objectAt(media, "examples", "fleet", "value")?.["contractVersion"] === "1" &&
    references(
      objectAt(operation, "responses")?.["404"],
      "#/components/responses/ConcealedNotFound",
    ) &&
    references(
      objectAt(operation, "responses")?.["500"],
      "#/components/responses/UnexpectedError",
    ) &&
    references(
      objectAt(operation, "responses")?.["503"],
      "#/components/responses/DependencyUnavailable",
    ) &&
    responseSchema?.["additionalProperties"] === false &&
    hasExactArray(responseSchema?.["required"], [
      "contractVersion",
      "generatedAt",
      "schedulerHeartbeat",
      "endpoints",
    ]) &&
    endpointArray?.["type"] === "array" &&
    endpointArray["maxItems"] === 500 &&
    references(endpointArray["items"], "#/components/schemas/FleetEndpoint") &&
    hasExactArray(state?.["enum"], [
      "unreachable",
      "observation_incomplete",
      "stale",
      "not_observed",
      "normal_observed",
    ]) &&
    Array.isArray(incidentOneOf) &&
    incidentOneOf.length === 3 &&
    incidentVariants.every(
      ([schemaName, status], index) =>
        references(incidentOneOf[index], `#/components/schemas/${schemaName}`) &&
        objectAt(root, "components", "schemas", schemaName, "properties", "status")?.["const"] ===
          status,
    ) &&
    objectAt(heartbeat, "properties", "evidenceKind")?.["const"] ===
      "foundation_health_job_completion"
  );
}

export function validateOpenApiDocument(document: unknown): boolean {
  const root = objectAt(document);
  const info = objectAt(root, "info");
  const operation = objectAt(root, "paths", "/api/v1/system/health", "get");
  const healthSchema = objectAt(root, "components", "schemas", "SystemHealthResponse");
  const healthStatus = objectAt(healthSchema, "properties", "status");
  const errorSchema = objectAt(root, "components", "schemas", "ErrorResponse");
  const errorDetail = objectAt(errorSchema, "properties", "error");
  const errorProperties = objectAt(errorDetail, "properties");
  return (
    root?.["openapi"] === "3.1.0" &&
    typeof info?.["title"] === "string" &&
    typeof info?.["version"] === "string" &&
    operation?.["operationId"] === "getSystemHealth" &&
    Array.isArray(operation["security"]) &&
    operation["security"].length === 0 &&
    hasResponseContract(operation, "200", "ready", "SystemHealthResponse") &&
    hasResponseContract(operation, "404", "notFound", "ErrorResponse") &&
    hasResponseContract(operation, "503", "degraded", "SystemHealthResponse") &&
    hasHeaderComponent(root, "CacheControl", "no-store, max-age=0") &&
    hasHeaderComponent(root, "Pragma", "no-cache") &&
    hasHeaderComponent(root, "Expires", "0") &&
    hasHeaderComponent(root, "ContentTypeOptions", "nosniff") &&
    hasObservationContracts(root) &&
    hasFleetContracts(root) &&
    healthSchema?.["type"] === "object" &&
    healthSchema["additionalProperties"] === false &&
    hasExactArray(healthSchema["required"], ["status"]) &&
    healthStatus?.["type"] === "string" &&
    hasExactArray(healthStatus["enum"], ["ready", "degraded"]) &&
    errorSchema?.["type"] === "object" &&
    errorSchema["additionalProperties"] === false &&
    hasExactArray(errorSchema["required"], ["error"]) &&
    errorDetail?.["type"] === "object" &&
    errorDetail["additionalProperties"] === false &&
    hasExactArray(errorDetail["required"], ["code", "message", "correlationId"]) &&
    objectAt(errorProperties, "code")?.["type"] === "string" &&
    hasExactArray(objectAt(errorProperties, "code")?.["enum"], [
      "validation_error",
      "not_found",
      "conflict",
      "access_denied",
      "dependency_unavailable",
      "unexpected_error",
    ]) &&
    objectAt(errorProperties, "message")?.["type"] === "string" &&
    objectAt(errorProperties, "message")?.["maxLength"] === 128 &&
    objectAt(errorProperties, "correlationId")?.["type"] === "string" &&
    objectAt(errorProperties, "correlationId")?.["format"] === "uuid"
  );
}

export async function generateCommittedClient(): Promise<void> {
  await generateAt(committedOutput);
}

export async function checkGeneratedClient(comparisonOutput = committedOutput): Promise<{
  readonly valid: boolean;
  readonly drift: boolean;
}> {
  const valid = validateOpenApiDocument(parse(await readFile(sourcePath, "utf8")));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "muster-openapi-"));
  const temporaryOutput = join(temporaryRoot, basename(committedOutput));
  try {
    await generateAt(temporaryOutput);
    return { valid, drift: !(await outputsMatch(temporaryOutput, comparisonOutput)) };
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}
