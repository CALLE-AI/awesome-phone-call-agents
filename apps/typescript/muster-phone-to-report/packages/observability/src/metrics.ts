import {
  metrics as telemetryMetrics,
  type Counter,
  type Gauge,
  type Histogram,
  type Meter,
} from "@opentelemetry/api";

export type FoundationJobOutcome = "succeeded" | "failed" | "retried";
export type FoundationDependency = "database" | "jobs";
export type FoundationReadinessOutcome = "ready" | "degraded" | "unknown";

export interface FoundationJobMetricInput {
  readonly jobType: "foundation-health.v1";
  readonly outcome: FoundationJobOutcome;
  readonly durationSeconds: number;
}

export interface FoundationJobQueueDelayInput {
  readonly jobType: "foundation-health.v1";
  readonly durationSeconds: number;
}

export interface FoundationReadinessInput {
  readonly dependency: FoundationDependency;
  readonly outcome: FoundationReadinessOutcome;
}

export interface FoundationHttpRequestInput {
  readonly method: "GET";
  readonly route: "/api/v1/system/health";
  readonly statusCode: 200 | 503;
  readonly durationSeconds: number;
}

export interface FoundationMetrics {
  recordHttpRequest(input: FoundationHttpRequestInput): void;
  recordJobExecution(input: FoundationJobMetricInput): void;
  recordJobQueueDelay(input: FoundationJobQueueDelayInput): void;
  recordReadiness(input: FoundationReadinessInput): void;
}

interface MetricRecord {
  readonly name: string;
  readonly unit: string;
  readonly value: number;
  readonly attributes: Readonly<Record<string, string>>;
}

function validateJobType(jobType: unknown): asserts jobType is "foundation-health.v1" {
  if (jobType !== "foundation-health.v1") throw new Error("Invalid bounded foundation metric");
}

function validateDuration(durationSeconds: unknown): asserts durationSeconds is number {
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    throw new Error("Invalid bounded foundation metric");
  }
}

function validateExecution(input: FoundationJobMetricInput): void {
  validateJobType(input.jobType);
  if (!(["succeeded", "failed", "retried"] as const).includes(input.outcome)) {
    throw new Error("Invalid bounded foundation metric");
  }
  validateDuration(input.durationSeconds);
}

function validateQueueDelay(input: FoundationJobQueueDelayInput): void {
  validateJobType(input.jobType);
  validateDuration(input.durationSeconds);
}

function validateReadiness(input: FoundationReadinessInput): void {
  if (
    !(["database", "jobs"] as const).includes(input.dependency) ||
    !(["ready", "degraded", "unknown"] as const).includes(input.outcome)
  ) {
    throw new Error("Invalid bounded readiness metric");
  }
}

function validateHttpRequest(input: FoundationHttpRequestInput): void {
  if (
    input.method !== "GET" ||
    input.route !== "/api/v1/system/health" ||
    (input.statusCode !== 200 && input.statusCode !== 503)
  ) {
    throw new Error("Invalid bounded HTTP metric");
  }
  validateDuration(input.durationSeconds);
}

export function createInMemoryFoundationMetrics(): {
  readonly metrics: FoundationMetrics;
  readonly snapshot: () => readonly MetricRecord[];
} {
  const records: MetricRecord[] = [];
  return {
    metrics: {
      recordHttpRequest(input) {
        validateHttpRequest(input);
        const attributes = {
          method: input.method,
          route: input.route,
          statusClass: input.statusCode === 200 ? "2xx" : "5xx",
        };
        records.push(
          { name: "muster.http.server.requests", unit: "{request}", value: 1, attributes },
          {
            name: "muster.http.server.duration",
            unit: "s",
            value: input.durationSeconds,
            attributes,
          },
        );
      },
      recordJobExecution(input) {
        validateExecution(input);
        const attributes = { jobType: input.jobType, outcome: input.outcome };
        records.push(
          { name: "muster.job.executions", unit: "{job}", value: 1, attributes },
          {
            name: "muster.job.duration",
            unit: "s",
            value: input.durationSeconds,
            attributes,
          },
        );
      },
      recordJobQueueDelay(input) {
        validateQueueDelay(input);
        records.push({
          name: "muster.job.queue.delay",
          unit: "s",
          value: input.durationSeconds,
          attributes: { jobType: input.jobType },
        });
      },
      recordReadiness(input) {
        validateReadiness(input);
        records.push({
          name: "muster.readiness",
          unit: "1",
          value: input.outcome === "ready" ? 1 : 0,
          attributes: { dependency: input.dependency },
        });
      },
    },
    snapshot: () => structuredClone(records),
  };
}

function createOpenTelemetryFoundationMetrics(meter: Meter): FoundationMetrics {
  const httpRequests: Counter = meter.createCounter("muster.http.server.requests", {
    unit: "{request}",
  });
  const httpDuration: Histogram = meter.createHistogram("muster.http.server.duration", {
    unit: "s",
  });
  const executions: Counter = meter.createCounter("muster.job.executions", { unit: "{job}" });
  const duration: Histogram = meter.createHistogram("muster.job.duration", { unit: "s" });
  const queueDelay: Histogram = meter.createHistogram("muster.job.queue.delay", { unit: "s" });
  const readiness: Gauge = meter.createGauge("muster.readiness", { unit: "1" });
  return {
    recordHttpRequest(input) {
      validateHttpRequest(input);
      const attributes = {
        method: input.method,
        route: input.route,
        statusClass: input.statusCode === 200 ? "2xx" : "5xx",
      };
      httpRequests.add(1, attributes);
      httpDuration.record(input.durationSeconds, attributes);
    },
    recordJobExecution(input) {
      validateExecution(input);
      const attributes = { jobType: input.jobType, outcome: input.outcome };
      executions.add(1, attributes);
      duration.record(input.durationSeconds, attributes);
    },
    recordJobQueueDelay(input) {
      validateQueueDelay(input);
      queueDelay.record(input.durationSeconds, { jobType: input.jobType });
    },
    recordReadiness(input) {
      validateReadiness(input);
      readiness.record(input.outcome === "ready" ? 1 : 0, { dependency: input.dependency });
    },
  };
}

export function createGlobalFoundationMetrics(
  instrumentationScope = "@muster/observability",
): FoundationMetrics {
  return createOpenTelemetryFoundationMetrics(telemetryMetrics.getMeter(instrumentationScope));
}
