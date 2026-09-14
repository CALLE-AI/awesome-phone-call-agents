import { describe, expect, it } from "vitest";

interface ObservationMetricsModule {
  readonly createInMemoryObservationHttpMetrics: () => {
    readonly metrics: {
      recordRequest(input: {
        readonly method: "POST" | "GET";
        readonly route:
          "/api/v1/endpoints/{endpointId}/observations" | "/api/v1/observations/{operationId}";
        readonly statusCode: 200 | 202 | 400 | 404 | 409 | 500 | 503;
        readonly outcome:
          | "accepted"
          | "replayed"
          | "validation_failed"
          | "concealed"
          | "conflict"
          | "blocked"
          | "found"
          | "unexpected_error"
          | "dependency_unavailable";
        readonly durationSeconds: number;
      }): void;
    };
    readonly snapshot: () => readonly {
      readonly name: string;
      readonly attributes: Readonly<Record<string, string>>;
    }[];
  };
  readonly runObservationHttpSpan: <T>(input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly method: "POST" | "GET";
    readonly route:
      "/api/v1/endpoints/{endpointId}/observations" | "/api/v1/observations/{operationId}";
    readonly operation: () => Promise<T>;
  }) => Promise<T>;
}

async function loadObservationMetrics(): Promise<ObservationMetricsModule> {
  const moduleUrl = new URL("./observation.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as ObservationMetricsModule;
}

describe("observation HTTP observability", () => {
  it("records only closed route, status-class, and outcome attributes", async () => {
    const { createInMemoryObservationHttpMetrics } = await loadObservationMetrics();
    const sink = createInMemoryObservationHttpMetrics();

    sink.metrics.recordRequest({
      method: "POST",
      route: "/api/v1/endpoints/{endpointId}/observations",
      statusCode: 202,
      outcome: "accepted",
      durationSeconds: 0.025,
    });
    sink.metrics.recordRequest({
      method: "GET",
      route: "/api/v1/observations/{operationId}",
      statusCode: 200,
      outcome: "found",
      durationSeconds: 0.01,
    });

    expect(sink.snapshot()).toEqual([
      {
        name: "muster.observation.http.requests",
        attributes: {
          method: "POST",
          route: "/api/v1/endpoints/{endpointId}/observations",
          statusClass: "2xx",
          outcome: "accepted",
        },
      },
      {
        name: "muster.observation.http.duration",
        attributes: {
          method: "POST",
          route: "/api/v1/endpoints/{endpointId}/observations",
          statusClass: "2xx",
          outcome: "accepted",
        },
      },
      {
        name: "muster.observation.http.requests",
        attributes: {
          method: "GET",
          route: "/api/v1/observations/{operationId}",
          statusClass: "2xx",
          outcome: "found",
        },
      },
      {
        name: "muster.observation.http.duration",
        attributes: {
          method: "GET",
          route: "/api/v1/observations/{operationId}",
          statusClass: "2xx",
          outcome: "found",
        },
      },
    ]);
    expect(JSON.stringify(sink.snapshot())).not.toMatch(/endpoint_http|operation_http|org_/iu);
  });

  it("rejects unbounded or inconsistent metric dimensions", async () => {
    const { createInMemoryObservationHttpMetrics } = await loadObservationMetrics();
    const sink = createInMemoryObservationHttpMetrics();
    const invalidInputs = [
      {
        method: "GET",
        route: "/api/v1/observations/operation_sensitive",
        statusCode: 200,
        outcome: "found",
        durationSeconds: 0.1,
      },
      {
        method: "POST",
        route: "/api/v1/endpoints/{endpointId}/observations",
        statusCode: 202,
        outcome: "endpoint_sensitive",
        durationSeconds: 0.1,
      },
      {
        method: "GET",
        route: "/api/v1/observations/{operationId}",
        statusCode: 200,
        outcome: "found",
        durationSeconds: Number.POSITIVE_INFINITY,
      },
    ];

    for (const input of invalidInputs) {
      expect(() =>
        sink.metrics.recordRequest(input as Parameters<typeof sink.metrics.recordRequest>[0]),
      ).toThrow("Invalid bounded observation HTTP metric");
    }
  });

  it("records the closed unexpected-error outcome for either observation route", async () => {
    const { createInMemoryObservationHttpMetrics } = await loadObservationMetrics();
    const sink = createInMemoryObservationHttpMetrics();

    for (const [method, route] of [
      ["POST", "/api/v1/endpoints/{endpointId}/observations"],
      ["GET", "/api/v1/observations/{operationId}"],
    ] as const) {
      sink.metrics.recordRequest({
        method,
        route,
        statusCode: 500,
        outcome: "unexpected_error",
        durationSeconds: 0.01,
      });
    }

    expect(sink.snapshot()).toHaveLength(4);
    expect(sink.snapshot().map(({ attributes }) => attributes)).toEqual([
      {
        method: "POST",
        route: "/api/v1/endpoints/{endpointId}/observations",
        statusClass: "5xx",
        outcome: "unexpected_error",
      },
      {
        method: "POST",
        route: "/api/v1/endpoints/{endpointId}/observations",
        statusClass: "5xx",
        outcome: "unexpected_error",
      },
      {
        method: "GET",
        route: "/api/v1/observations/{operationId}",
        statusClass: "5xx",
        outcome: "unexpected_error",
      },
      {
        method: "GET",
        route: "/api/v1/observations/{operationId}",
        statusClass: "5xx",
        outcome: "unexpected_error",
      },
    ]);
  });

  it("runs invalid trace carriers in a safe bounded server span without changing business work", async () => {
    const { runObservationHttpSpan } = await loadObservationMetrics();

    await expect(
      runObservationHttpSpan({
        headers: {
          traceparent: "malformed-protected-carrier",
          baggage: "protected=value",
        },
        method: "POST",
        route: "/api/v1/endpoints/{endpointId}/observations",
        operation: async () => "accepted",
      }),
    ).resolves.toBe("accepted");
  });
});
