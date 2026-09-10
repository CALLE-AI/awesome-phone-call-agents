import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface OpenApiCheckModule {
  readonly checkGeneratedClient: () => Promise<{
    readonly valid: boolean;
    readonly drift: boolean;
  }>;
  readonly validateOpenApiDocument: (document: unknown) => boolean;
}

function objectAt(value: unknown, ...path: readonly string[]): Record<string, unknown> {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      throw new Error(`Expected OpenAPI object at ${path.join(".")}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "object" || current === null) {
    throw new Error(`Expected OpenAPI object at ${path.join(".")}`);
  }
  return current as Record<string, unknown>;
}

describe("OpenAPI generated-client contract", () => {
  it("validates OpenAPI 3.1 and regenerates the committed Fetch client with zero diff", async () => {
    const moduleUrl = new URL("./check-generated-client.ts", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<OpenApiCheckModule>;
    if (loaded.checkGeneratedClient === undefined) {
      throw new Error("checkGeneratedClient is not implemented");
    }

    await expect(loaded.checkGeneratedClient()).resolves.toEqual({ valid: true, drift: false });
  });

  it("rejects malformed health operations, response schemas, examples, headers, and security posture", async () => {
    const moduleUrl = new URL("./check-generated-client.ts", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<OpenApiCheckModule>;
    if (loaded.validateOpenApiDocument === undefined) {
      throw new Error("validateOpenApiDocument is not implemented");
    }
    const source = parse(
      await readFile(new URL("../../docs/api/openapi.yaml", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(loaded.validateOpenApiDocument(source)).toBe(true);

    const mutations: readonly ((document: Record<string, unknown>) => void)[] = [
      (document) =>
        delete objectAt(document, "paths", "/api/v1/system/health", "get", "responses")["503"],
      (document) =>
        delete objectAt(
          document,
          "components",
          "schemas",
          "SystemHealthResponse",
          "properties",
          "status",
        )["enum"],
      (document) =>
        delete objectAt(
          document,
          "paths",
          "/api/v1/system/health",
          "get",
          "responses",
          "200",
          "headers",
        )["Cache-Control"],
      (document) =>
        delete objectAt(
          document,
          "paths",
          "/api/v1/system/health",
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "examples",
        )["ready"],
      (document) => delete objectAt(document, "paths", "/api/v1/system/health", "get")["security"],
      (document) =>
        delete objectAt(document, "components", "headers", "CacheControl", "schema")["const"],
      (document) => {
        objectAt(
          document,
          "components",
          "schemas",
          "ErrorResponse",
          "properties",
          "error",
          "properties",
          "message",
        )["type"] = "number";
      },
      (document) =>
        delete objectAt(
          document,
          "components",
          "schemas",
          "ErrorResponse",
          "properties",
          "error",
          "properties",
          "correlationId",
        )["format"],
    ];
    for (const mutate of mutations) {
      const document = structuredClone(source);
      mutate(document);
      expect(loaded.validateOpenApiDocument(document)).toBe(false);
    }
  });

  it("requires the complete authorized observation lifecycle and source-derived schema boundary", async () => {
    const moduleUrl = new URL("./check-generated-client.ts", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<OpenApiCheckModule>;
    if (loaded.validateOpenApiDocument === undefined) {
      throw new Error("validateOpenApiDocument is not implemented");
    }
    const source = parse(
      await readFile(new URL("../../docs/api/openapi.yaml", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    expect(loaded.validateOpenApiDocument(source)).toBe(true);
    expect(
      objectAt(source, "paths", "/api/v1/endpoints/{endpointId}/observations", "post")[
        "operationId"
      ],
    ).toBe("requestObservation");
    expect(
      objectAt(source, "paths", "/api/v1/endpoints/{endpointId}/observations", "post")[
        "description"
      ],
    ).toBe(
      "Establishes or replays one organization-scoped operation. A newly established request does not imply provider-call or evidence-extraction completion. A matching replay reports the database-established current stage and terminal outcome. SIMULATED provenance is explicit and does not establish provider or hardware compatibility.",
    );
    expect(
      objectAt(
        source,
        "paths",
        "/api/v1/endpoints/{endpointId}/observations",
        "post",
        "responses",
        "202",
      )["description"],
    ).toBe(
      "A newly established request does not imply provider-call or evidence-extraction completion. A matching replay reports the database-established current stage and terminal outcome, while the operation remains queryable.",
    );
    expect(
      objectAt(source, "paths", "/api/v1/observations/{operationId}", "get")["operationId"],
    ).toBe("getObservationOperation");
    expect(
      objectAt(
        source,
        "components",
        "schemas",
        "ObservationOperationResponse",
        "properties",
        "observation",
      )["type"],
    ).toEqual(["object", "null"]);
    expect(
      objectAt(
        source,
        "components",
        "schemas",
        "ObservationOperationResponse",
        "properties",
        "attempt",
      )["$ref"],
    ).toBe("#/components/schemas/ObservationAttempt");
    expect(
      objectAt(
        source,
        "components",
        "schemas",
        "ObservationOperationResponse",
        "properties",
        "evidence",
      )["oneOf"],
    ).toBeDefined();
    expect(
      objectAt(
        source,
        "components",
        "schemas",
        "ObservationAcceptedResponse",
        "properties",
        "stage",
      )["enum"],
    ).toEqual(["scheduled", "calling", "extracting", "terminal"]);
    expect(
      objectAt(
        source,
        "components",
        "schemas",
        "ObservationAcceptedResponse",
        "properties",
        "terminalOutcome",
      )["type"],
    ).toEqual(["string", "null"]);
    expect(
      objectAt(source, "components", "schemas", "VersionedObservation", "properties", "readings")[
        "minItems"
      ],
    ).toBe(1);
    for (const [path, method] of [
      ["/api/v1/endpoints/{endpointId}/observations", "post"],
      ["/api/v1/observations/{operationId}", "get"],
    ] as const) {
      expect(objectAt(source, "paths", path, method, "responses", "500")["$ref"]).toBe(
        "#/components/responses/UnexpectedError",
      );
    }
    for (const name of [
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
    ]) {
      expect(
        objectAt(
          source,
          "paths",
          "/api/v1/observations/{operationId}",
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "examples",
          name,
        )["$ref"],
      ).toBe(`#/components/examples/${name[0]?.toUpperCase()}${name.slice(1)}Observation`);
    }

    const mutations: readonly ((document: Record<string, unknown>) => void)[] = [
      (document) =>
        delete objectAt(
          document,
          "paths",
          "/api/v1/endpoints/{endpointId}/observations",
          "post",
          "responses",
        )["409"],
      (document) =>
        delete objectAt(
          document,
          "paths",
          "/api/v1/observations/{operationId}",
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "examples",
        )["providerFailure"],
      (document) => {
        objectAt(
          document,
          "components",
          "schemas",
          "ObservationOperationResponse",
          "properties",
          "observation",
        )["type"] = "object";
      },
      (document) =>
        delete objectAt(document, "components", "schemas", "ObservationReading", "properties")[
          "evidenceId"
        ],
      (document) =>
        delete objectAt(document, "paths", "/api/v1/endpoints/{endpointId}/observations", "post")[
          "security"
        ],
      (document) => {
        objectAt(
          document,
          "components",
          "examples",
          "IncompleteObservation",
          "value",
          "observation",
        )["readings"] = [];
      },
      (document) => {
        objectAt(
          document,
          "components",
          "examples",
          "IncompleteObservation",
          "value",
          "observation",
        )["quality"] = "complete";
      },
      (document) => {
        objectAt(
          document,
          "components",
          "examples",
          "UnknownObservation",
          "value",
          "observation",
          "readings",
          "0",
        )["disposition"] = "grounded";
      },
      (document) =>
        delete objectAt(
          document,
          "paths",
          "/api/v1/observations/{operationId}",
          "get",
          "responses",
        )["500"],
      (document) => {
        objectAt(
          document,
          "paths",
          "/api/v1/endpoints/{endpointId}/observations",
          "post",
          "responses",
          "202",
        )["description"] =
          "The operation was established or replayed and remains queryable without reporting replay state.";
      },
    ];
    for (const mutate of mutations) {
      const document = structuredClone(source);
      mutate(document);
      expect(loaded.validateOpenApiDocument(document)).toBe(false);
    }
  });

  it("requires the bounded authorized fleet contract, examples, errors, and generated operation", async () => {
    const moduleUrl = new URL("./check-generated-client.ts", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<OpenApiCheckModule>;
    if (loaded.validateOpenApiDocument === undefined)
      throw new Error("validateOpenApiDocument is not implemented");
    const source = parse(
      await readFile(new URL("../../docs/api/openapi.yaml", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(loaded.validateOpenApiDocument(source)).toBe(true);
    expect(objectAt(source, "paths", "/api/v1/fleet", "get")["operationId"]).toBe("getFleetHealth");
    expect(
      objectAt(source, "components", "schemas", "FleetHealthResponse", "properties", "endpoints")[
        "maxItems"
      ],
    ).toBe(500);
    expect(objectAt(source, "components", "schemas", "FleetIncident")["oneOf"]).toHaveLength(3);
    for (const [schema, status] of [
      ["FleetIncidentNone", "none"],
      ["FleetIncidentOpen", "open"],
      ["FleetIncidentUnavailable", "unavailable"],
    ] as const) {
      expect(
        objectAt(source, "components", "schemas", schema, "properties", "status")["const"],
      ).toBe(status);
    }
    for (const status of ["200", "404", "500", "503"] as const) {
      expect(objectAt(source, "paths", "/api/v1/fleet", "get", "responses")[status]).toBeDefined();
    }
    const mutations: readonly ((document: Record<string, unknown>) => void)[] = [
      (document) => delete objectAt(document, "paths", "/api/v1/fleet", "get")["security"],
      (document) => delete objectAt(document, "paths", "/api/v1/fleet", "get", "responses")["503"],
      (document) =>
        delete objectAt(
          document,
          "components",
          "schemas",
          "FleetHealthResponse",
          "properties",
          "endpoints",
        )["maxItems"],
      (document) => {
        objectAt(document, "components", "schemas", "FleetOperationalState")["enum"] = [
          "normal_observed",
        ];
      },
      (document) => {
        objectAt(document, "components", "schemas", "FleetIncident")["oneOf"] = [
          { $ref: "#/components/schemas/FleetIncidentNone" },
        ];
      },
      (document) =>
        delete objectAt(
          document,
          "components",
          "schemas",
          "FleetIncidentOpen",
          "properties",
          "status",
        )["const"],
      (document) =>
        delete objectAt(
          document,
          "paths",
          "/api/v1/fleet",
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "examples",
        )["fleet"],
    ];
    for (const mutate of mutations) {
      const document = structuredClone(source);
      mutate(document);
      expect(loaded.validateOpenApiDocument(document)).toBe(false);
    }
  });
});
