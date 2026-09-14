import { randomBytes } from "node:crypto";

import { metrics, type Meter } from "@opentelemetry/api";

import type { LoggerPort, SafeLogEvent } from "@muster/application";

import { createPinoLoggerRuntime, type PinoLoggerRuntime } from "./logger.js";
import type { SimulatorHostProcessTelemetry } from "./preload-state.js";
import {
  runWithConsumerSpan,
  runWithProducerSpan,
  sanitizeW3CTraceContext,
  type TelemetryLifecycle,
  type W3CTraceContext,
} from "./telemetry.js";

const liveOutcomes = new Set([
  "blocked",
  "gate_passed",
  "authorization_reserved",
  "dispatch_attempted",
  "evidence_persisted",
  "completed",
  "failed",
]);
const twilioOutcomes = new Set([
  "provider_signature_rejected",
  "authorization_rejected",
  "authorization_bound",
  "authorization_replayed",
  "voice_rendered",
  "canary_clear",
  "canary_failed",
]);
const httpRoutes = new Set([
  "/api/v1/live-simulator/capability",
  "/api/v1/live-simulator/operations",
  "/api/v1/live-simulator/operations/{operationId}",
  "DELETE /api/v1/live-demo-review/sessions/{sessionId}",
  "GET /api/v1/live-simulator/operations/{operationId}",
  "/twilio/voice",
  "/twilio/status",
  "/twilio/canary/{callbackHandle}",
]);
const traceparentIdentifiers = /^00-(?!0{32})([0-9a-f]{32})-((?!0{16})[0-9a-f]{16})-[0-9a-f]{2}$/u;
const safeLiveSmokeReasons = new Set([
  "evidence_timestamp_invalid",
  "application_persistence_failed",
  "provider_timeout",
  "provider_failed",
  "provider_authentication",
  "provider_rate_limited",
  "provider_insufficient_balance",
  "provider_recipient_blocked",
  "provider_invalid_recipient",
  "provider_unsupported_region",
  "provider_policy_violation",
  "provider_create_response_invalid",
  "provider_unavailable",
  "provider_no_answer",
  "provider_busy",
  "provider_evidence_invalid",
  "provider_evidence_invalid_terminal_shape",
  "provider_evidence_invalid_reading_shape",
  "provider_evidence_invalid_zone_identity",
  "provider_evidence_invalid_anchor_value",
  "provider_evidence_invalid_anchor_unit",
  "provider_evidence_invalid_anchor_status",
  "provider_evidence_invalid_auxiliary_status",
  "provider_evidence_unavailable",
]);
const safeProviderResponseContentTypes = new Set(["missing", "json", "text", "other"]);
const safeProviderResponseBodies = new Set(["absent", "present", "unavailable"]);
const safeProviderResponseLocations = new Set([
  "missing",
  "invalid",
  "cross_origin",
  "invalid_call_resource",
  "exact_call_resource",
]);

function traceIdentifiers(
  traceContext: W3CTraceContext | undefined,
): Readonly<{ traceId: string; spanId: string }> | undefined {
  if (traceContext === undefined) return undefined;
  const match = traceparentIdentifiers.exec(traceContext.traceparent);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : Object.freeze({ traceId: match[1], spanId: match[2] });
}

function newTraceContext(): W3CTraceContext {
  return Object.freeze({
    traceparent: `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
  });
}

function defaultLogger(
  runtimeProfile = process.env["RUNTIME_PROFILE"] ?? "development",
): PinoLoggerRuntime {
  const configuredLevel = process.env["LOG_LEVEL"];
  const level =
    configuredLevel === "debug" ||
    configuredLevel === "info" ||
    configuredLevel === "warn" ||
    configuredLevel === "error"
      ? configuredLevel
      : "info";
  return createPinoLoggerRuntime({
    level,
    bindings: {
      service: process.env["OTEL_SERVICE_NAME"] ?? "muster-simulator-host",
      version: process.env["OTEL_SERVICE_VERSION"] ?? "unknown",
      environment: runtimeProfile,
      runtime: "simulator-host",
    },
  });
}

export function createSimulatorHostProcessTelemetry(input: {
  readonly runtimeProfile: SimulatorHostProcessTelemetry["runtimeProfile"];
  readonly telemetry: TelemetryLifecycle;
  readonly loggerRuntime?: PinoLoggerRuntime;
}): SimulatorHostProcessTelemetry {
  const loggerRuntime = input.loggerRuntime ?? defaultLogger(input.runtimeProfile);
  let shutdownPromise: Promise<void> | undefined;
  return Object.freeze({
    runtimeProfile: input.runtimeProfile,
    start: (): void => input.telemetry.start(),
    reportProcessFailure: ({ phase }: Readonly<{ phase: "startup" | "shutdown" }>): void => {
      loggerRuntime.logger.error({
        event:
          phase === "startup" ? "simulator.host.startup_failed" : "simulator.host.shutdown_failed",
        outcome: "failed",
      });
    },
    shutdown: (): Promise<void> =>
      (shutdownPromise ??= (async () => {
        let failed = false;
        for (const close of [
          async () => await input.telemetry.shutdown(),
          async () => await loggerRuntime.close(),
        ]) {
          try {
            await close();
          } catch {
            failed = true;
          }
        }
        if (failed) throw new Error("Simulator host telemetry shutdown failed");
      })()),
  });
}

export interface SimulatorHostObservabilityOptions {
  readonly logger?: LoggerPort;
  readonly meter?: Meter;
  readonly now?: () => number;
  readonly spanRunners?: Readonly<{
    runConsumerSpan: typeof runWithConsumerSpan;
    runProducerSpan: typeof runWithProducerSpan;
  }>;
}

function ignoreTelemetryFailure(operation: () => void): void {
  try {
    operation();
  } catch {
    // Telemetry is best effort and cannot replace business behavior.
  }
}

async function runWithSafeSpan<T>(
  runSpan: (operation: () => Promise<T>) => Promise<T>,
  operation: () => Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> =>
    (operationPromise ??= Promise.resolve().then(async () => await operation()));
  try {
    await runSpan(runOnce);
  } catch {
    // The memoized operation below preserves its own success or failure exactly once.
  }
  return await runOnce();
}

export function createSimulatorHostObservability(options: SimulatorHostObservabilityOptions = {}) {
  const ownedLogger = options.logger === undefined ? defaultLogger() : undefined;
  const logger = options.logger ?? ownedLogger!.logger;
  const meter = options.meter ?? metrics.getMeter("@muster/simulator-host");
  const spanRunners = options.spanRunners ?? {
    runConsumerSpan: runWithConsumerSpan,
    runProducerSpan: runWithProducerSpan,
  };
  let operationCounter: ReturnType<Meter["createCounter"]> | undefined;
  let httpRequests: ReturnType<Meter["createCounter"]> | undefined;
  let httpDuration: ReturnType<Meter["createHistogram"]> | undefined;
  ignoreTelemetryFailure(() => {
    operationCounter = meter.createCounter("muster.simulator.live.operations", {
      unit: "{operation}",
    });
  });
  ignoreTelemetryFailure(() => {
    httpRequests = meter.createCounter("muster.http.server.requests", {
      unit: "{request}",
    });
  });
  ignoreTelemetryFailure(() => {
    httpDuration = meter.createHistogram("muster.http.server.duration", { unit: "s" });
  });
  let activeTrace: W3CTraceContext | undefined;
  let closed = false;
  ignoreTelemetryFailure(() =>
    logger.info({ event: "simulator.host.started", outcome: "started" }),
  );

  const lifecycle = async <T>(
    kind: "job" | "callback",
    identifiers: Readonly<{ traceId: string; spanId: string }> | undefined,
    operation: () => Promise<T>,
  ): Promise<T> => {
    ignoreTelemetryFailure(() =>
      logger.info({
        event: `simulator.${kind}.started`,
        outcome: "started",
        ...identifiers,
      } as SafeLogEvent),
    );
    try {
      const result = await operation();
      ignoreTelemetryFailure(() =>
        logger.info({
          event: `simulator.${kind}.completed`,
          outcome: "succeeded",
          ...identifiers,
        } as SafeLogEvent),
      );
      return result;
    } catch (error: unknown) {
      ignoreTelemetryFailure(() =>
        logger.error({
          event: `simulator.${kind}.failed`,
          outcome: "failed",
          ...identifiers,
        } as SafeLogEvent),
      );
      throw error;
    }
  };

  return Object.freeze({
    establishTraceContext(
      input?: Readonly<Record<string, string | undefined>> | W3CTraceContext,
    ): W3CTraceContext {
      activeTrace =
        sanitizeW3CTraceContext({
          traceparent: input?.traceparent,
          tracestate: input?.tracestate,
        }) ?? newTraceContext();
      return activeTrace;
    },
    record(
      event: Readonly<{
        event?: string;
        outcome: string;
        reason?: string;
        traceId?: string;
        spanId?: string;
        providerResponseStatusCode?: number;
        providerResponseContentType?: string;
        providerResponseBody?: string;
        providerResponseLocation?: string;
        providerRequestIdPresent?: boolean;
      }>,
    ): void {
      const allowed =
        (event.event === "simulator.live_smoke" && liveOutcomes.has(event.outcome)) ||
        (event.event === "simulator.twilio.request" && twilioOutcomes.has(event.outcome));
      if (!allowed || event.event === undefined) return;
      const eventName = event.event;
      ignoreTelemetryFailure(() =>
        operationCounter?.add(1, { event: eventName, outcome: event.outcome }),
      );
      const identifiers =
        event.traceId !== undefined &&
        event.spanId !== undefined &&
        /^[0-9a-f]{32}$/u.test(event.traceId) &&
        !/^0{32}$/u.test(event.traceId) &&
        /^[0-9a-f]{16}$/u.test(event.spanId) &&
        !/^0{16}$/u.test(event.spanId)
          ? { traceId: event.traceId, spanId: event.spanId }
          : {};
      const createResponseDiagnostics =
        event.reason === "provider_create_response_invalid" &&
        Number.isInteger(event.providerResponseStatusCode) &&
        event.providerResponseStatusCode !== undefined &&
        event.providerResponseStatusCode >= 100 &&
        event.providerResponseStatusCode <= 599 &&
        event.providerResponseContentType !== undefined &&
        safeProviderResponseContentTypes.has(event.providerResponseContentType) &&
        event.providerResponseBody !== undefined &&
        safeProviderResponseBodies.has(event.providerResponseBody) &&
        event.providerResponseLocation !== undefined &&
        safeProviderResponseLocations.has(event.providerResponseLocation) &&
        typeof event.providerRequestIdPresent === "boolean"
          ? {
              providerResponseStatusCode: event.providerResponseStatusCode,
              providerResponseContentType: event.providerResponseContentType as
                "missing" | "json" | "text" | "other",
              providerResponseBody: event.providerResponseBody as
                "absent" | "present" | "unavailable",
              providerResponseLocation: event.providerResponseLocation as
                | "missing"
                | "invalid"
                | "cross_origin"
                | "invalid_call_resource"
                | "exact_call_resource",
              providerRequestIdPresent: event.providerRequestIdPresent,
            }
          : {};
      const safeEvent = {
        event: event.event,
        outcome: event.outcome,
        ...identifiers,
        ...(event.reason !== undefined && safeLiveSmokeReasons.has(event.reason)
          ? { reason: event.reason }
          : {}),
        ...createResponseDiagnostics,
      } as SafeLogEvent;
      if (
        event.outcome === "failed" ||
        event.outcome === "canary_failed" ||
        event.outcome.endsWith("rejected")
      ) {
        ignoreTelemetryFailure(() => logger.warn(safeEvent));
      } else {
        ignoreTelemetryFailure(() => logger.info(safeEvent));
      }
    },
    recordHttpRequest(input: {
      readonly method: "GET" | "POST" | "DELETE" | "OPTIONS" | "OTHER";
      readonly route:
        | "/api/v1/live-simulator/capability"
        | "/api/v1/live-simulator/operations"
        | "/api/v1/live-simulator/operations/{operationId}"
        | "GET /api/v1/live-simulator/operations/{operationId}"
        | "DELETE /api/v1/live-demo-review/sessions/{sessionId}"
        | "/twilio/voice"
        | "/twilio/status"
        | "/twilio/canary/{callbackHandle}";
      readonly statusCode: number;
      readonly durationSeconds: number;
    }): void {
      if (
        !(["GET", "POST", "DELETE", "OPTIONS", "OTHER"] as const).includes(input.method) ||
        !httpRoutes.has(input.route) ||
        !Number.isInteger(input.statusCode) ||
        input.statusCode < 100 ||
        input.statusCode > 599 ||
        !Number.isFinite(input.durationSeconds) ||
        input.durationSeconds < 0
      ) {
        throw new Error("Invalid bounded simulator HTTP metric");
      }
      const attributes = {
        method: input.method,
        route: input.route,
        status_code: input.statusCode,
      };
      ignoreTelemetryFailure(() => httpRequests?.add(1, attributes));
      ignoreTelemetryFailure(() => httpDuration?.record(input.durationSeconds, attributes));
    },
    async runJobSpan<T>(operation: () => Promise<T>): Promise<T> {
      return await runWithSafeSpan(
        async (runOnce) =>
          await spanRunners.runConsumerSpan({
            carrier: { ...(activeTrace ?? newTraceContext()) },
            spanName: "simulator.live.job",
            operation: runOnce,
          }),
        async () => await lifecycle("job", traceIdentifiers(activeTrace), operation),
      );
    },
    async runProviderSpan<T>(operation: () => Promise<T>): Promise<T> {
      return await runWithSafeSpan(
        async (runOnce) =>
          await spanRunners.runProducerSpan({
            spanName: "simulator.live.provider",
            operation: runOnce,
          }),
        operation,
      );
    },
    async runCallbackSpan<T>(
      traceContext: W3CTraceContext,
      operation: () => Promise<T>,
    ): Promise<T> {
      return await runWithSafeSpan(
        async (runOnce) =>
          await spanRunners.runConsumerSpan({
            carrier: { ...traceContext },
            spanName: "simulator.twilio.callback",
            operation: runOnce,
          }),
        async () => await lifecycle("callback", traceIdentifiers(traceContext), operation),
      );
    },
    async runRestSpan<T>(
      input: Readonly<{
        method: "GET" | "POST" | "DELETE" | "OPTIONS" | "OTHER";
        route:
          | "/api/v1/live-simulator/capability"
          | "/api/v1/live-simulator/operations"
          | "/api/v1/live-simulator/operations/{operationId}"
          | "GET /api/v1/live-simulator/operations/{operationId}"
          | "DELETE /api/v1/live-demo-review/sessions/{sessionId}";
        traceContext: W3CTraceContext;
      }>,
      operation: () => Promise<T>,
    ): Promise<T> {
      return await runWithSafeSpan(
        async (runOnce) =>
          await spanRunners.runConsumerSpan({
            carrier: { ...input.traceContext },
            spanName: `${input.method} ${input.route}`,
            operation: runOnce,
          }),
        operation,
      );
    },
    close: async (): Promise<void> => {
      if (closed) return;
      ignoreTelemetryFailure(() =>
        logger.info({ event: "simulator.host.stopped", outcome: "stopped" }),
      );
      await ownedLogger?.close();
      closed = true;
    },
  });
}
