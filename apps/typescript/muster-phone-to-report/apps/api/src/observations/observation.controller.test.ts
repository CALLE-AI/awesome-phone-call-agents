import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationError, type RequestObservationInput } from "@muster/application";
import type { ObservationAcceptedResponse, ObservationOperationResponse } from "@muster/contracts";
import { getPostgresTestConnectionUrls } from "@muster/testing";

type OrganizationScope = RequestObservationInput["organizationId"];

interface OperationShape {
  readonly id: string;
  readonly acceptedAt: string;
  readonly stage: "scheduled" | "calling" | "extracting" | "terminal";
  readonly terminalOutcome:
    | "observation_recorded"
    | "blocked"
    | "no_answer"
    | "busy"
    | "provider_failed"
    | "evidence_unavailable"
    | null;
}

function organization(value: string): OrganizationScope {
  return Object.freeze({
    value,
    equals: (other: OrganizationScope) => other.value === value,
    toString: () => value,
  });
}

interface ObservationHttpDependencies {
  readonly requestAuthorizer: (input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly resource:
      | Readonly<{ kind: "endpoint"; endpointId: string }>
      | Readonly<{ kind: "observation"; operationId: string }>;
  }) => Promise<Readonly<{ organizationId: OrganizationScope }> | undefined>;
  readonly requestObservation: {
    execute(input: {
      readonly organizationId: OrganizationScope;
      readonly endpointId: string;
      readonly pollWindowId: string;
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly trigger: "manual";
    }): Promise<{
      readonly outcome: "established" | "replayed";
      readonly operation: OperationShape;
      readonly schedulingOutcome: "scheduled" | "duplicate" | "deferred" | "blocked";
    }>;
  };
  readonly getObservationOperation: {
    execute(input: {
      readonly organizationId: OrganizationScope;
      readonly operationId: string;
    }): Promise<ObservationOperationResponse | undefined>;
  };
  readonly logger?: {
    debug(event: unknown): void;
    info(event: unknown): void;
    warn(event: unknown): void;
    error(event: unknown): void;
    child(): ObservationHttpDependencies["logger"];
  };
  readonly telemetry?: {
    run<T>(input: { readonly operation: () => Promise<T> }): Promise<T>;
    activeTraceContext(): undefined;
    recordRequest(input: unknown): void;
  };
}

interface ObservationHttpRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

interface ObservationHttpModule {
  readonly startSystemHealthHttpRuntime: (options: {
    readonly connectionString: string;
    readonly jobsSchema: string;
    readonly runtimeProfile: "test";
    readonly healthExposure: "disabled";
    readonly startJobs: false;
    readonly observation?: ObservationHttpDependencies;
  }) => Promise<ObservationHttpRuntime>;
}

const organizationId = organization("org_observation_http");
const otherOrganizationId = organization("org_observation_http_other");
const acceptedAt = "2026-08-06T16:00:00.000Z";
const operationId = "operation_http_accepted";

function establishedAttempt(): OperationShape {
  return Object.freeze({
    id: operationId,
    acceptedAt,
    stage: "scheduled",
    terminalOutcome: null,
  });
}

function projection(
  changes: Partial<ObservationOperationResponse> = {},
): ObservationOperationResponse {
  return {
    contractVersion: "1",
    operationId,
    resourceVersion: 1,
    stage: "scheduled",
    terminal: false,
    lastTransitionAt: acceptedAt,
    latestRevisionAt: null,
    attempt: {
      trigger: "manual",
      provenance: "SIMULATED",
      acceptedAt,
      retryable: null,
    },
    terminalOutcome: null,
    evidence: null,
    observation: null,
    recommendedAction: "poll",
    ...changes,
  };
}

function authorized(): ObservationHttpDependencies["requestAuthorizer"] {
  return async () => ({ organizationId });
}

const authorizationFailures: readonly (readonly [
  string,
  ObservationHttpDependencies["requestAuthorizer"],
])[] = [
  ["denied", async () => undefined],
  ["failed", async () => await Promise.reject(new Error("protected authorization detail"))],
];

function dependencies(
  overrides: Partial<ObservationHttpDependencies> = {},
): ObservationHttpDependencies {
  return {
    requestAuthorizer: authorized(),
    requestObservation: {
      execute: async () => ({
        outcome: "established",
        operation: establishedAttempt(),
        schedulingOutcome: "scheduled",
      }),
    },
    getObservationOperation: {
      execute: async ({ organizationId: scopedOrganization, operationId: requestedId }) =>
        scopedOrganization.equals(organizationId) && requestedId === operationId
          ? projection()
          : undefined,
    },
    ...overrides,
  };
}

async function loadHttpModule(): Promise<ObservationHttpModule> {
  const moduleUrl = new URL("../composition/start-system-health-http-runtime.ts", import.meta.url)
    .href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<ObservationHttpModule>;
  if (loaded.startSystemHealthHttpRuntime === undefined) {
    throw new Error("startSystemHealthHttpRuntime is not implemented");
  }
  return { startSystemHealthHttpRuntime: loaded.startSystemHealthHttpRuntime };
}

const runtimes: ObservationHttpRuntime[] = [];

async function startRuntime(
  observation?: ObservationHttpDependencies,
): Promise<ObservationHttpRuntime> {
  const http = await loadHttpModule();
  const runtime = await http.startSystemHealthHttpRuntime({
    connectionString: getPostgresTestConnectionUrls().repository,
    jobsSchema: `observation_http_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    runtimeProfile: "test",
    healthExposure: "disabled",
    startJobs: false,
    ...(observation === undefined ? {} : { observation }),
  });
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) await runtime.close();
});

function expectSafeHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("www-authenticate")).toBeNull();
}

async function postObservation(
  baseUrl: string,
  input: {
    readonly endpointId?: string;
    readonly idempotencyKey?: string;
    readonly body?: unknown;
  } = {},
): Promise<Response> {
  return await fetch(
    `${baseUrl}/api/v1/endpoints/${input.endpointId ?? "endpoint_http"}/observations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.idempotencyKey === undefined
          ? { "idempotency-key": "idempotency_http" }
          : input.idempotencyKey.length === 0
            ? {}
            : { "idempotency-key": input.idempotencyKey }),
      },
      body: JSON.stringify(input.body ?? { pollWindowId: "poll_window_http" }),
    },
  );
}

describe.sequential("authorized observation REST lifecycle", () => {
  it("keeps both observation routes unregistered without complete explicit dependencies", async () => {
    const complete = dependencies();
    const incompleteBindings: readonly (ObservationHttpDependencies | undefined)[] = [
      undefined,
      { ...complete, requestAuthorizer: undefined } as unknown as ObservationHttpDependencies,
      { ...complete, requestObservation: undefined } as unknown as ObservationHttpDependencies,
      {
        ...complete,
        getObservationOperation: undefined,
      } as unknown as ObservationHttpDependencies,
    ];
    for (const observation of incompleteBindings) {
      const runtime = await startRuntime(observation);
      const [post, get] = await Promise.all([
        postObservation(runtime.baseUrl),
        fetch(`${runtime.baseUrl}/api/v1/observations/${operationId}`),
      ]);

      expect(post.status).toBe(404);
      expect(get.status).toBe(404);
      expectSafeHeaders(post);
      expectSafeHeaders(get);
    }
  });

  it("returns 202 with the repository-established identity and stable replay Location", async () => {
    const execute = vi
      .fn<ObservationHttpDependencies["requestObservation"]["execute"]>()
      .mockResolvedValueOnce({
        outcome: "established",
        operation: establishedAttempt(),
        schedulingOutcome: "scheduled",
      })
      .mockResolvedValueOnce({
        outcome: "replayed",
        operation: establishedAttempt(),
        schedulingOutcome: "duplicate",
      });
    const runtime = await startRuntime(dependencies({ requestObservation: { execute } }));

    const first = await postObservation(runtime.baseUrl);
    const replay = await postObservation(runtime.baseUrl);
    const expectedBody: ObservationAcceptedResponse = {
      contractVersion: "1",
      operationId,
      statusUrl: `/api/v1/observations/${operationId}`,
      stage: "scheduled",
      terminalOutcome: null,
      acceptedAt,
    };

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(first.headers.get("location")).toBe(expectedBody.statusUrl);
    expect(replay.headers.get("location")).toBe(expectedBody.statusUrl);
    expect(first.headers.get("retry-after")).toBe("2");
    expect(replay.headers.get("retry-after")).toBe("2");
    expect(await first.json()).toEqual(expectedBody);
    expect(await replay.json()).toEqual(expectedBody);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      "idempotency_http",
      "idempotency_http",
    ]);
    expectSafeHeaders(first);
    expectSafeHeaders(replay);
  });

  it.each([
    ["calling", "calling", null],
    ["extracting", "extracting", null],
    ["terminal", "terminal", "observation_recorded"],
  ] as const)(
    "preserves the repository-established %s replay stage and terminal outcome",
    async (_label, stage, terminalOutcome) => {
      const runtime = await startRuntime(
        dependencies({
          requestObservation: {
            execute: async () => ({
              outcome: "replayed",
              operation: {
                ...establishedAttempt(),
                stage,
                terminalOutcome,
              },
              schedulingOutcome: "duplicate",
            }),
          },
        }),
      );

      const response = await postObservation(runtime.baseUrl);

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        contractVersion: "1",
        operationId,
        statusUrl: `/api/v1/observations/${operationId}`,
        stage,
        terminalOutcome,
        acceptedAt,
      });
      expect(response.headers.get("location")).toBe(`/api/v1/observations/${operationId}`);
      expectSafeHeaders(response);
    },
  );

  it("returns one bounded dependency-unavailable completion for an invalid application operation identifier", async () => {
    const logEvents: unknown[] = [];
    const metricEvents: unknown[] = [];
    const logger = {
      debug: () => undefined,
      info: (event: unknown) => logEvents.push(event),
      warn: () => undefined,
      error: () => undefined,
      child: () => logger,
    };
    const telemetry = {
      run: async <T>(input: { readonly operation: () => Promise<T> }): Promise<T> =>
        await input.operation(),
      activeTraceContext: () => undefined,
      recordRequest: (input: unknown) => metricEvents.push(input),
    };
    const runtime = await startRuntime(
      dependencies({
        logger,
        telemetry,
        requestObservation: {
          execute: async () => ({
            outcome: "established",
            operation: {
              ...establishedAttempt(),
              id: "invalid operation protected-provider-value",
            },
            schedulingOutcome: "scheduled",
          }),
        },
      }),
    );

    const response = await postObservation(runtime.baseUrl);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "dependency_unavailable",
        message: "Service unavailable",
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    });
    expect(response.headers.get("retry-after")).toBe("2");
    expect(logEvents).toHaveLength(1);
    expect(logEvents[0]).toMatchObject({
      event: "http.request.completed",
      method: "POST",
      route: "/api/v1/endpoints/{endpointId}/observations",
      statusCode: 503,
      outcome: "dependency_unavailable",
    });
    expect(metricEvents).toHaveLength(1);
    expect(metricEvents[0]).toMatchObject({
      method: "POST",
      route: "/api/v1/endpoints/{endpointId}/observations",
      statusCode: 503,
      outcome: "dependency_unavailable",
    });
    expect(JSON.stringify({ logEvents, metricEvents })).not.toMatch(
      /invalid operation|protected|provider/iu,
    );
    expectSafeHeaders(response);
  });

  it.each([
    ["missing idempotency", { idempotencyKey: "" }],
    ["invalid endpoint", { endpointId: "invalid endpoint" }],
    ["missing poll window", { body: {} }],
    ["unknown request field", { body: { pollWindowId: "poll_window_http", secret: "no" } }],
  ] as const)("returns the closed validation envelope for %s", async (_label, input) => {
    const execute = vi.fn<ObservationHttpDependencies["requestObservation"]["execute"]>();
    const runtime = await startRuntime(dependencies({ requestObservation: { execute } }));

    const response = await postObservation(runtime.baseUrl, input);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_error",
        message: "Request validation failed",
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expectSafeHeaders(response);
  });

  it.each(authorizationFailures)(
    "conceals %s authorization before application disclosure",
    async (_label, authorizer) => {
      const execute = vi.fn<ObservationHttpDependencies["requestObservation"]["execute"]>();
      const runtime = await startRuntime(
        dependencies({ requestAuthorizer: authorizer, requestObservation: { execute } }),
      );

      const response = await postObservation(runtime.baseUrl);
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(404);
      expect(serialized).toContain("not_found");
      expect(serialized).not.toMatch(/authorization|protected|org_observation/iu);
      expect(execute).not.toHaveBeenCalled();
      expectSafeHeaders(response);
    },
  );

  it("returns a sanitized 409 for a semantic idempotency mismatch", async () => {
    const runtime = await startRuntime(
      dependencies({
        requestObservation: {
          execute: async () => {
            throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
          },
        },
      }),
    );

    const response = await postObservation(runtime.baseUrl);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(409);
    expect(serialized).toContain('"code":"conflict"');
    expect(serialized).not.toMatch(/call_attempt|fingerprint|postgres|stack/iu);
    expect(response.headers.get("location")).toBeNull();
    expectSafeHeaders(response);
  });

  it("returns a queryable sanitized 409 block", async () => {
    const blocked: OperationShape = Object.freeze({
      ...establishedAttempt(),
      stage: "terminal",
      terminalOutcome: "blocked",
    });
    const runtime = await startRuntime(
      dependencies({
        requestObservation: {
          execute: async () => ({
            outcome: "established",
            operation: blocked,
            schedulingOutcome: "blocked",
          }),
        },
        getObservationOperation: {
          execute: async () =>
            projection({
              stage: "terminal",
              terminal: true,
              terminalOutcome: "blocked",
              attempt: {
                trigger: "manual",
                provenance: "SIMULATED",
                acceptedAt,
                retryable: false,
              },
              recommendedAction: "create_new_request_after_remediation",
            }),
        },
      }),
    );

    const response = await postObservation(runtime.baseUrl);
    const status = await fetch(`${runtime.baseUrl}/api/v1/observations/${operationId}`);

    expect(response.status).toBe(409);
    expect(response.headers.get("location")).toBe(`/api/v1/observations/${operationId}`);
    expect(JSON.stringify(await response.json())).toContain('"code":"conflict"');
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      operationId,
      stage: "terminal",
      terminalOutcome: "blocked",
      observation: null,
    });
    expectSafeHeaders(response);
    expectSafeHeaders(status);
  });

  it.each([
    ["scheduled", projection(), true],
    ["calling", projection({ resourceVersion: 2, stage: "calling" }), true],
    [
      "extracting",
      projection({
        resourceVersion: 3,
        stage: "extracting",
        latestRevisionAt: "2026-08-06T16:00:08.000Z",
        evidence: {
          evidenceId: "evidence_http",
          revision: 1,
          providerRunId: "provider_run_opaque",
          provenance: "SIMULATED",
          sourceCompleteness: "complete",
          retainedAt: "2026-08-06T16:00:08.000Z",
        },
      }),
      true,
    ],
    [
      "terminal observation",
      projection({
        resourceVersion: 4,
        stage: "terminal",
        terminal: true,
        terminalOutcome: "observation_recorded",
        latestRevisionAt: "2026-08-06T16:00:12.000Z",
        evidence: {
          evidenceId: "evidence_http",
          revision: 1,
          providerRunId: "provider_run_opaque",
          provenance: "SIMULATED",
          sourceCompleteness: "complete",
          retainedAt: "2026-08-06T16:00:08.000Z",
        },
        observation: {
          observationId: "observation_http",
          version: 1,
          predecessorObservationId: null,
          quality: "complete",
          provenance: "SIMULATED",
          adapterVersionId: "adapter_version_simulated_http",
          extractorVersionId: "extractor_version_http",
          reconciliationPolicyVersion: "reconcile.v1",
          evidenceId: "evidence_http",
          readings: [
            {
              zoneId: "zone-01",
              ordinal: 0,
              disposition: "grounded",
              value: "71",
              spokenUnit: "degrees fahrenheit",
              normalizedUnit: "degF",
              confidenceToken: "reviewed",
              confidenceSemanticsVersion: "confidence.v1",
              evidenceId: "evidence_http",
              evidenceRevisionId: "provider_revision_http",
              providerRunId: "provider_run_opaque",
              adapterVersionId: "adapter_version_simulated_http",
              extractorVersionId: "extractor_version_http",
              evidenceAnchorIds: ["anchor_opaque"],
              sourceCapturedAt: "2026-08-06T16:00:07.000Z",
              derivedAt: "2026-08-06T16:00:11.000Z",
            },
          ],
          createdAt: "2026-08-06T16:00:11.000Z",
        },
        recommendedAction: "none",
      }),
      false,
    ],
    [
      "terminal provider failure",
      projection({
        resourceVersion: 4,
        stage: "terminal",
        terminal: true,
        terminalOutcome: "provider_failed",
        attempt: {
          trigger: "manual",
          provenance: "SIMULATED",
          acceptedAt,
          retryable: true,
        },
        recommendedAction: "create_new_request_after_remediation",
      }),
      false,
    ],
  ] as const)(
    "returns the %s projection without joining source and derived fields",
    async (_label, statusProjection, retryExpected) => {
      const runtime = await startRuntime(
        dependencies({
          getObservationOperation: { execute: async () => statusProjection },
        }),
      );

      const response = await fetch(`${runtime.baseUrl}/api/v1/observations/${operationId}`);
      const body = (await response.json()) as ObservationOperationResponse;

      expect(response.status).toBe(200);
      expect(body).toEqual(statusProjection);
      expect(response.headers.get("retry-after")).toBe(retryExpected ? "2" : null);
      expect(body.attempt.provenance).toBe("SIMULATED");
      if (body.observation !== null) {
        expect(body.evidence).not.toBeNull();
        expect(body.observation.readings[0]?.evidenceId).toBe(body.evidence?.evidenceId);
      }
      if (body.terminalOutcome === "provider_failed") expect(body.observation).toBeNull();
      expectSafeHeaders(response);
    },
  );

  it("conceals unknown and cross-organization operation reads", async () => {
    const get = vi.fn<ObservationHttpDependencies["getObservationOperation"]["execute"]>();
    const runtime = await startRuntime(
      dependencies({
        requestAuthorizer: async () => ({ organizationId: otherOrganizationId }),
        getObservationOperation: { execute: get.mockResolvedValue(undefined) },
      }),
    );

    const response = await fetch(`${runtime.baseUrl}/api/v1/observations/${operationId}`);
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(404);
    expect(body).toContain("not_found");
    expect(body).not.toMatch(/org_observation|operation_http_accepted/iu);
    expect(get).toHaveBeenCalledWith({
      organizationId: otherOrganizationId,
      operationId,
    });
    expectSafeHeaders(response);
  });

  it.each(["POST", "GET"] as const)(
    "returns a sanitized 503 when the %s dependency is unavailable",
    async (method) => {
      const unavailable = async (): Promise<never> => {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      };
      const runtime = await startRuntime(
        dependencies(
          method === "POST"
            ? { requestObservation: { execute: unavailable } }
            : { getObservationOperation: { execute: unavailable } },
        ),
      );

      const response =
        method === "POST"
          ? await postObservation(runtime.baseUrl)
          : await fetch(`${runtime.baseUrl}/api/v1/observations/${operationId}`);
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(503);
      expect(body).toContain("dependency_unavailable");
      expect(body).not.toMatch(/observation_repository|postgres|stack|exception/iu);
      expect(response.headers.get("retry-after")).toBe("2");
      expectSafeHeaders(response);
    },
  );

  it.each(["POST", "GET"] as const)(
    "conceals raw %s failures and records one bounded unexpected-error completion",
    async (method) => {
      const logEvents: unknown[] = [];
      const metricEvents: unknown[] = [];
      const logger = {
        debug: () => undefined,
        info: (event: unknown) => logEvents.push(event),
        warn: () => undefined,
        error: () => undefined,
        child: () => logger,
      };
      const telemetry = {
        run: async <T>(input: { readonly operation: () => Promise<T> }): Promise<T> =>
          await input.operation(),
        activeTraceContext: () => undefined,
        recordRequest: (input: unknown) => metricEvents.push(input),
      };
      const rawFailure = async (): Promise<never> => {
        throw new Error("vendor transcript +1-555-0100 protected payload");
      };
      const rawFailureLeakPattern = /vendor|transcript|\+1-555-0100|protected|payload/iu;
      const runtime = await startRuntime(
        dependencies({
          logger,
          telemetry,
          ...(method === "POST"
            ? { requestObservation: { execute: rawFailure } }
            : { getObservationOperation: { execute: rawFailure } }),
        }),
      );

      const response =
        method === "POST"
          ? await postObservation(runtime.baseUrl)
          : await fetch(`${runtime.baseUrl}/api/v1/observations/${operationId}`);
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(500);
      expect(body).toContain('"code":"unexpected_error"');
      expect(body).not.toMatch(rawFailureLeakPattern);
      expect(body).not.toMatch(/stack/iu);
      expect(logEvents).toHaveLength(1);
      expect(logEvents[0]).toMatchObject({
        event: "http.request.completed",
        method,
        route:
          method === "POST"
            ? "/api/v1/endpoints/{endpointId}/observations"
            : "/api/v1/observations/{operationId}",
        statusCode: 500,
        outcome: "unexpected_error",
      });
      expect(metricEvents).toHaveLength(1);
      expect(metricEvents[0]).toMatchObject({
        method,
        statusCode: 500,
        outcome: "unexpected_error",
      });
      const serializedTelemetry = JSON.stringify({ logEvents, metricEvents });
      expect(serializedTelemetry).not.toMatch(rawFailureLeakPattern);
      expect(serializedTelemetry).not.toMatch(/endpoint_http|operation_http/iu);
      expectSafeHeaders(response);
    },
  );
});
