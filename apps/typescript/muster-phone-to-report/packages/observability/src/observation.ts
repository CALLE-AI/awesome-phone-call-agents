import {
  context,
  metrics as telemetryMetrics,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Counter,
  type Histogram,
  type Meter,
} from "@opentelemetry/api";

export const OBSERVATION_HTTP_ROUTES = Object.freeze([
  "/api/v1/endpoints/{endpointId}/observations",
  "/api/v1/observations/{operationId}",
] as const);
export const OBSERVATION_HTTP_OUTCOMES = Object.freeze([
  "accepted",
  "replayed",
  "validation_failed",
  "concealed",
  "conflict",
  "blocked",
  "found",
  "unexpected_error",
  "dependency_unavailable",
] as const);

export type ObservationHttpRoute = (typeof OBSERVATION_HTTP_ROUTES)[number];
export type ObservationHttpMetricOutcome = (typeof OBSERVATION_HTTP_OUTCOMES)[number];

export interface ObservationHttpMetricInput {
  readonly method: "POST" | "GET";
  readonly route: ObservationHttpRoute;
  readonly statusCode: 200 | 202 | 400 | 404 | 409 | 500 | 503;
  readonly outcome: ObservationHttpMetricOutcome;
  readonly durationSeconds: number;
}

export interface ObservationHttpMetrics {
  recordRequest(input: ObservationHttpMetricInput): void;
}

interface ObservationMetricRecord {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
}

function invalidMetric(): never {
  throw new Error("Invalid bounded observation HTTP metric");
}

function validateMetric(input: ObservationHttpMetricInput): void {
  if (
    !OBSERVATION_HTTP_ROUTES.includes(input.route) ||
    !OBSERVATION_HTTP_OUTCOMES.includes(input.outcome) ||
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds < 0
  ) {
    invalidMetric();
  }
  if (
    (input.method === "POST" && input.route !== OBSERVATION_HTTP_ROUTES[0]) ||
    (input.method === "GET" && input.route !== OBSERVATION_HTTP_ROUTES[1])
  ) {
    invalidMetric();
  }
  const validCombination =
    (input.outcome === "accepted" && input.statusCode === 202 && input.method === "POST") ||
    (input.outcome === "replayed" && input.statusCode === 202 && input.method === "POST") ||
    (input.outcome === "validation_failed" && input.statusCode === 400) ||
    (input.outcome === "concealed" && input.statusCode === 404) ||
    (input.outcome === "conflict" && input.statusCode === 409 && input.method === "POST") ||
    (input.outcome === "blocked" && input.statusCode === 409 && input.method === "POST") ||
    (input.outcome === "found" && input.statusCode === 200 && input.method === "GET") ||
    (input.outcome === "unexpected_error" && input.statusCode === 500) ||
    (input.outcome === "dependency_unavailable" && input.statusCode === 503);
  if (!validCombination) invalidMetric();
}

function attributes(input: ObservationHttpMetricInput): Readonly<Record<string, string>> {
  return {
    method: input.method,
    route: input.route,
    statusClass: `${String(Math.floor(input.statusCode / 100))}xx`,
    outcome: input.outcome,
  };
}

export function createInMemoryObservationHttpMetrics(): {
  readonly metrics: ObservationHttpMetrics;
  readonly snapshot: () => readonly ObservationMetricRecord[];
} {
  const records: ObservationMetricRecord[] = [];
  return {
    metrics: {
      recordRequest(input) {
        validateMetric(input);
        const boundedAttributes = attributes(input);
        records.push(
          { name: "muster.observation.http.requests", attributes: boundedAttributes },
          { name: "muster.observation.http.duration", attributes: boundedAttributes },
        );
      },
    },
    snapshot: () => structuredClone(records),
  };
}

function createOpenTelemetryObservationHttpMetrics(meter: Meter): ObservationHttpMetrics {
  const requests: Counter = meter.createCounter("muster.observation.http.requests", {
    unit: "{request}",
  });
  const duration: Histogram = meter.createHistogram("muster.observation.http.duration", {
    unit: "s",
  });
  return {
    recordRequest(input) {
      validateMetric(input);
      const boundedAttributes = attributes(input);
      requests.add(1, boundedAttributes);
      duration.record(input.durationSeconds, boundedAttributes);
    },
  };
}

export function createGlobalObservationHttpMetrics(
  instrumentationScope = "@muster/observability",
): ObservationHttpMetrics {
  return createOpenTelemetryObservationHttpMetrics(telemetryMetrics.getMeter(instrumentationScope));
}

const TRACE_HEADER_NAMES = ["traceparent", "tracestate"] as const;

export async function runObservationHttpSpan<T>(input: {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly method: "POST" | "GET";
  readonly route: ObservationHttpRoute;
  readonly operation: () => Promise<T>;
}): Promise<T> {
  const carrier: Record<string, string> = {};
  for (const name of TRACE_HEADER_NAMES) {
    const value = input.headers[name];
    if (typeof value === "string") carrier[name] = value;
  }
  const extracted = propagation.extract(ROOT_CONTEXT, carrier);
  return await context.with(
    extracted,
    async () =>
      await trace.getTracer("@muster/api").startActiveSpan(
        `${input.method} ${input.route}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.request.method": input.method,
            "http.route": input.route,
          },
        },
        async (span) => {
          try {
            return await input.operation();
          } catch (error: unknown) {
            span.recordException(new Error("observation_http_request_failed"));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      ),
  );
}
