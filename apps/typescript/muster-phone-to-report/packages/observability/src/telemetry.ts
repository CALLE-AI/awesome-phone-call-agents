import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  trace,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from "@opentelemetry/sdk-trace-base";

import type { ObservabilityConfig } from "./observability-config.js";

export interface W3CTraceContext {
  readonly traceparent: string;
  readonly tracestate?: string;
}

const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/u;
const TRACESTATE = /^[\x20-\x7e]{1,512}$/u;
const w3cPropagator = new W3CTraceContextPropagator();
const carrierGetter: TextMapGetter<Record<string, string | undefined>> = {
  get: (carrier, key) => carrier[key],
  keys: (carrier) => Object.keys(carrier),
};
const carrierSetter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

export function sanitizeW3CTraceContext(
  carrier: Record<string, string | undefined>,
): W3CTraceContext | undefined {
  const traceparent = carrier["traceparent"]?.trim().toLowerCase();
  if (traceparent === undefined || !TRACEPARENT.test(traceparent)) {
    return undefined;
  }
  const tracestate = carrier["tracestate"]?.trim();
  return Object.freeze({
    traceparent,
    ...(tracestate === undefined || !TRACESTATE.test(tracestate) ? {} : { tracestate }),
  });
}

export function injectActiveW3CTraceContext(): W3CTraceContext | undefined {
  const carrier: Record<string, string> = {};
  w3cPropagator.inject(context.active(), carrier, carrierSetter);
  return sanitizeW3CTraceContext(carrier);
}

export interface ConsumerSpanOptions<T> {
  readonly carrier: Record<string, string | undefined>;
  readonly spanName: string;
  readonly operation: () => Promise<T>;
}

export interface ProducerSpanOptions<T> {
  readonly spanName: string;
  readonly operation: () => Promise<T>;
}

export async function runWithProducerSpan<T>(options: ProducerSpanOptions<T>): Promise<T> {
  const tracer = trace.getTracer("@muster/observability");
  return await tracer.startActiveSpan(
    options.spanName,
    { kind: SpanKind.PRODUCER },
    async (span) => {
      try {
        return await options.operation();
      } catch (error: unknown) {
        span.recordException(new Error("producer_operation_failed"));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export async function runWithConsumerSpan<T>(options: ConsumerSpanOptions<T>): Promise<T> {
  const safeCarrier = sanitizeW3CTraceContext(options.carrier);
  const parentContext =
    safeCarrier === undefined
      ? ROOT_CONTEXT
      : w3cPropagator.extract(ROOT_CONTEXT, safeCarrier, carrierGetter);
  const tracer = trace.getTracer("@muster/observability");
  return await tracer.startActiveSpan(
    options.spanName,
    { kind: SpanKind.CONSUMER },
    parentContext,
    async (span) => {
      try {
        return await options.operation();
      } catch (error: unknown) {
        span.recordException(new Error("consumer_operation_failed"));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

function sampler(config: ObservabilityConfig): Sampler {
  switch (config.tracing.sampler) {
    case "always_off":
      return new AlwaysOffSampler();
    case "always_on":
      return new AlwaysOnSampler();
    case "parent_based_ratio":
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(config.tracing.ratio ?? 0),
      });
  }
}

export interface TelemetryLifecycle {
  start(): void;
  shutdown(): Promise<void>;
}

export function createTelemetryLifecycle(config: ObservabilityConfig): TelemetryLifecycle {
  const traceExporter =
    config.tracing.exporter === "otlp"
      ? new OTLPTraceExporter({
          url:
            config.tracing.endpoint ??
            (() => {
              throw new Error("Invalid observability configuration: OTEL_TRACES_EXPORTER");
            })(),
          timeoutMillis: config.tracing.timeoutMs,
        })
      : undefined;
  const metricReader =
    config.metrics.enabled && config.metrics.exporter === "otlp"
      ? new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url:
              config.metrics.endpoint ??
              (() => {
                throw new Error("Invalid observability configuration: OTEL_METRICS_EXPORTER");
              })(),
            timeoutMillis: config.metrics.timeoutMs,
          }),
          exportIntervalMillis: 10_000,
        })
      : undefined;
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": config.serviceName,
      "service.version": config.serviceVersion,
      "deployment.environment.name": config.deploymentEnvironment,
      "muster.runtime": config.runtime,
    }),
    sampler: sampler(config),
    textMapPropagator: new W3CTraceContextPropagator(),
    ...(traceExporter === undefined ? {} : { traceExporter }),
    ...(metricReader === undefined ? {} : { metricReader }),
    instrumentations: [],
  });
  let started = false;
  return {
    start: () => {
      if (started) return;
      sdk.start();
      started = true;
    },
    shutdown: async () => {
      if (!started) return;
      started = false;
      await sdk.shutdown();
    },
  };
}
