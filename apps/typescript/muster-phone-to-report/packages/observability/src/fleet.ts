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

export const FLEET_HTTP_ROUTE = "/api/v1/fleet" as const;
export const FLEET_HTTP_OUTCOMES = Object.freeze([
  "found",
  "concealed",
  "dependency_unavailable",
  "unexpected_error",
] as const);

export type FleetHttpOutcome = (typeof FLEET_HTTP_OUTCOMES)[number];

export interface FleetHttpMetricInput {
  readonly method: "GET";
  readonly route: typeof FLEET_HTTP_ROUTE;
  readonly statusCode: 200 | 404 | 500 | 503;
  readonly outcome: FleetHttpOutcome;
  readonly durationSeconds: number;
}

export interface FleetHttpMetrics {
  recordRequest(input: FleetHttpMetricInput): void;
}

interface FleetMetricRecord {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
}

function validateMetric(input: FleetHttpMetricInput): void {
  const validCombination =
    input.method === "GET" &&
    input.route === FLEET_HTTP_ROUTE &&
    Number.isFinite(input.durationSeconds) &&
    input.durationSeconds >= 0 &&
    ((input.statusCode === 200 && input.outcome === "found") ||
      (input.statusCode === 404 && input.outcome === "concealed") ||
      (input.statusCode === 503 && input.outcome === "dependency_unavailable") ||
      (input.statusCode === 500 && input.outcome === "unexpected_error"));
  if (!validCombination) throw new Error("Invalid bounded fleet HTTP metric");
}

function attributes(input: FleetHttpMetricInput): Readonly<Record<string, string>> {
  return Object.freeze({
    method: input.method,
    route: input.route,
    statusClass: `${String(Math.floor(input.statusCode / 100))}xx`,
    outcome: input.outcome,
  });
}

export function createInMemoryFleetHttpMetrics(): {
  readonly metrics: FleetHttpMetrics;
  readonly snapshot: () => readonly FleetMetricRecord[];
} {
  const records: FleetMetricRecord[] = [];
  return Object.freeze({
    metrics: Object.freeze({
      recordRequest(input: FleetHttpMetricInput): void {
        validateMetric(input);
        const bounded = attributes(input);
        records.push(
          { name: "muster.fleet.http.requests", attributes: bounded },
          { name: "muster.fleet.http.duration", attributes: bounded },
        );
      },
    }),
    snapshot: () => structuredClone(records),
  });
}

function createOpenTelemetryFleetHttpMetrics(meter: Meter): FleetHttpMetrics {
  const requests: Counter = meter.createCounter("muster.fleet.http.requests", {
    unit: "{request}",
  });
  const duration: Histogram = meter.createHistogram("muster.fleet.http.duration", { unit: "s" });
  return Object.freeze({
    recordRequest(input: FleetHttpMetricInput): void {
      validateMetric(input);
      const bounded = attributes(input);
      requests.add(1, bounded);
      duration.record(input.durationSeconds, bounded);
    },
  });
}

export function createGlobalFleetHttpMetrics(
  instrumentationScope = "@muster/observability",
): FleetHttpMetrics {
  return createOpenTelemetryFleetHttpMetrics(telemetryMetrics.getMeter(instrumentationScope));
}

export async function runFleetHttpSpan<T>(input: {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly method: "GET";
  readonly route: typeof FLEET_HTTP_ROUTE;
  readonly operation: () => Promise<T>;
}): Promise<T> {
  const carrier: Record<string, string> = {};
  for (const name of ["traceparent", "tracestate"] as const) {
    const value = input.headers[name];
    if (typeof value === "string") carrier[name] = value;
  }
  const extracted = propagation.extract(ROOT_CONTEXT, carrier);
  return await context.with(
    extracted,
    async () =>
      await trace.getTracer("@muster/api").startActiveSpan(
        "GET /api/v1/fleet",
        {
          kind: SpanKind.SERVER,
          attributes: { "http.request.method": "GET", "http.route": FLEET_HTTP_ROUTE },
        },
        async (span) => {
          try {
            return await input.operation();
          } catch (error: unknown) {
            span.recordException(new Error("fleet_http_request_failed"));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      ),
  );
}
