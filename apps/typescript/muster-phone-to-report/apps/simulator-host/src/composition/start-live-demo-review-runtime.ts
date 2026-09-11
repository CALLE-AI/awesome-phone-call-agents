import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { W3CTraceContext } from "@muster/contracts";

import {
  isLiveDemoReviewExpired,
  restoreLiveDemoReviewLease,
  type LiveDemoReviewCleanupResult,
  type LiveDemoReviewIdentity,
  type LiveDemoReviewLease,
} from "../live-runs/live-demo-review-session.js";
import {
  classifyLiveDemoReviewRequest,
  LIVE_DEMO_REVIEW_ROUTE_TABLE,
  type LiveDemoReviewMethod as ReviewMethod,
  type LiveDemoReviewRoute as ReviewRoute,
} from "./live-demo-review-boundary.js";

export const LIVE_DEMO_REVIEW_ROUTES = Object.freeze([
  LIVE_DEMO_REVIEW_ROUTE_TABLE[0].route,
  LIVE_DEMO_REVIEW_ROUTE_TABLE[1].route,
] as const);
const [operationRoute, cleanupRoute] = LIVE_DEMO_REVIEW_ROUTES;
const opaqueIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

export interface LiveDemoReviewProjection extends LiveDemoReviewIdentity {
  readonly resourceVersion: number;
  readonly stage: "scheduled" | "calling" | "extracting" | "terminal";
  readonly terminal: boolean;
  readonly terminalOutcome:
    | "observation_recorded"
    | "recovery_candidate"
    | "evidence_incomplete"
    | "blocked"
    | "no_answer"
    | "busy"
    | "provider_failed"
    | "evidence_unavailable"
    | null;
  readonly provenance: "SIMULATED";
  readonly transcript: readonly Readonly<{
    speaker: "agent" | "device" | "system";
    text: string;
  }>[];
  readonly evidence?: Readonly<{
    quality: "complete" | "partial" | "unknown";
  }> | null;
  readonly readings: readonly Readonly<{
    zoneId: string;
    label: string;
    value: string | null;
    unit: string | null;
    status: "OK" | "ALARM" | "LOW" | "UNKNOWN";
    disposition: "grounded" | "missing" | "ambiguous" | "contradictory" | "invalid";
  }>[];
  readonly reconciliation: readonly Readonly<{
    zoneId: string;
    disposition: "matched" | "missing" | "ambiguous" | "contradictory" | "invalid";
  }>[];
  readonly auxiliaryStatus: Readonly<{
    sound: "normal" | "alarm" | "unknown";
    power: "mains_available" | "mains_failed" | "unknown";
    battery: "normal" | "low" | "unknown";
    output: "off" | "on" | "unknown";
  }> | null;
  readonly predecessorOperationId: string | null;
}

export interface LiveDemoReviewRuntime {
  readonly baseUrl: string;
  readonly routes: readonly [typeof operationRoute, typeof cleanupRoute];
  close(): Promise<void>;
}

function requestHeaders(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  const traceparent = request.headers["traceparent"];
  const tracestate = request.headers["tracestate"];
  return Object.freeze({
    traceparent: typeof traceparent === "string" ? traceparent : undefined,
    tracestate: typeof tracestate === "string" ? tracestate : undefined,
  });
}

function fallbackTraceContext(): W3CTraceContext {
  return Object.freeze({
    traceparent: `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
  });
}

function isExactLoopbackOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname === "[::1]" ? "::1" : parsed.hostname;
    return (
      parsed.protocol === "http:" &&
      ["127.0.0.1", "::1"].includes(hostname) &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.pathname === "/" &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0 &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function send(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  allowedOrigin?: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-muster-runtime-mode", "review-only");
  if (allowedOrigin !== undefined) {
    response.setHeader("access-control-allow-origin", allowedOrigin);
    response.setHeader("vary", "Origin");
  }
  for (const [name, value] of Object.entries(additionalHeaders)) {
    response.setHeader(name, value);
  }
  response.end(JSON.stringify(body));
}

export function restoreLiveDemoReviewProjection(
  source: unknown,
  identity: LiveDemoReviewIdentity,
): LiveDemoReviewProjection | undefined {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return undefined;
  // Boundary narrowing is followed by exhaustive field and collection validation below.
  const value = source as Partial<LiveDemoReviewProjection>;
  const stages = new Set(["scheduled", "calling", "extracting", "terminal"]);
  const terminalOutcomes = new Set([
    "observation_recorded",
    "recovery_candidate",
    "evidence_incomplete",
    "blocked",
    "no_answer",
    "busy",
    "provider_failed",
    "evidence_unavailable",
  ]);
  if (
    value.operationId !== identity.operationId ||
    value.scenarioId !== identity.scenarioId ||
    value.scenarioRevision !== identity.scenarioRevision ||
    typeof value.resourceVersion !== "number" ||
    !Number.isSafeInteger(value.resourceVersion) ||
    value.resourceVersion < 0 ||
    typeof value.stage !== "string" ||
    !stages.has(value.stage) ||
    typeof value.terminal !== "boolean" ||
    (value.terminalOutcome !== null &&
      (typeof value.terminalOutcome !== "string" ||
        !terminalOutcomes.has(value.terminalOutcome))) ||
    value.provenance !== "SIMULATED" ||
    !Array.isArray(value.transcript) ||
    value.transcript.length > 128 ||
    !Array.isArray(value.readings) ||
    value.readings.length > 4 ||
    !Array.isArray(value.reconciliation) ||
    value.reconciliation.length > 4 ||
    value.auxiliaryStatus === undefined ||
    (value.predecessorOperationId !== null &&
      (value.predecessorOperationId === undefined ||
        !opaqueIdentifier.test(value.predecessorOperationId)))
  ) {
    return undefined;
  }
  const exactValue = value as LiveDemoReviewProjection;
  const transcript = exactValue.transcript.map((entry) => {
    if (!["agent", "device", "system"].includes(entry.speaker) || !boundedText(entry.text, 4_096)) {
      throw new Error("invalid projection");
    }
    return Object.freeze({ speaker: entry.speaker, text: entry.text });
  });
  const dispositions = new Set(["grounded", "missing", "ambiguous", "contradictory", "invalid"]);
  const statuses = new Set(["OK", "ALARM", "LOW", "UNKNOWN"]);
  const readings = exactValue.readings.map((reading) => {
    if (
      !opaqueIdentifier.test(reading.zoneId) ||
      !boundedText(reading.label, 256) ||
      (reading.value !== null && !boundedText(reading.value, 128)) ||
      (reading.unit !== null && !boundedText(reading.unit, 64)) ||
      !statuses.has(reading.status) ||
      !dispositions.has(reading.disposition)
    ) {
      throw new Error("invalid projection");
    }
    return Object.freeze({
      zoneId: reading.zoneId,
      label: reading.label,
      value: reading.value,
      unit: reading.unit,
      status: reading.status,
      disposition: reading.disposition,
    });
  });
  const reconciliation = exactValue.reconciliation.map((entry) => {
    if (
      !opaqueIdentifier.test(entry.zoneId) ||
      !["matched", "missing", "ambiguous", "contradictory", "invalid"].includes(entry.disposition)
    ) {
      throw new Error("invalid projection");
    }
    return Object.freeze({ zoneId: entry.zoneId, disposition: entry.disposition });
  });
  const evidence =
    exactValue.evidence === undefined || exactValue.evidence === null
      ? exactValue.evidence
      : ["complete", "partial", "unknown"].includes(exactValue.evidence.quality)
        ? Object.freeze({ quality: exactValue.evidence.quality })
        : undefined;
  if (exactValue.evidence !== undefined && exactValue.evidence !== null && evidence === undefined) {
    return undefined;
  }
  const auxiliary = exactValue.auxiliaryStatus;
  if (
    auxiliary !== null &&
    (!(["normal", "alarm", "unknown"] as const).includes(auxiliary.sound) ||
      !(["mains_available", "mains_failed", "unknown"] as const).includes(auxiliary.power) ||
      !(["normal", "low", "unknown"] as const).includes(auxiliary.battery) ||
      !(["off", "on", "unknown"] as const).includes(auxiliary.output))
  ) {
    return undefined;
  }
  if (
    !exactValue.terminal ||
    exactValue.stage !== "terminal" ||
    exactValue.terminalOutcome === null
  ) {
    return undefined;
  }
  if (exactValue.terminalOutcome === "observation_recorded") {
    const readingZones = new Set(readings.map(({ zoneId }) => zoneId));
    const reconciliationZones = new Set(reconciliation.map(({ zoneId }) => zoneId));
    if (
      evidence?.quality !== "complete" ||
      transcript.length === 0 ||
      readings.length !== 4 ||
      reconciliation.length !== 4 ||
      readingZones.size !== 4 ||
      reconciliationZones.size !== 4 ||
      readings.some(({ disposition }) => disposition !== "grounded") ||
      reconciliation.some(
        ({ zoneId, disposition }) => disposition !== "matched" || !readingZones.has(zoneId),
      ) ||
      auxiliary === null ||
      auxiliary.sound === "unknown" ||
      auxiliary.power === "unknown" ||
      auxiliary.battery === "unknown" ||
      auxiliary.output === "unknown"
    ) {
      return undefined;
    }
  }
  return Object.freeze({
    operationId: identity.operationId,
    scenarioId: identity.scenarioId,
    scenarioRevision: identity.scenarioRevision,
    resourceVersion: exactValue.resourceVersion,
    stage: exactValue.stage,
    terminal: exactValue.terminal,
    terminalOutcome: exactValue.terminalOutcome,
    provenance: "SIMULATED" as const,
    transcript: Object.freeze(transcript),
    ...(evidence === undefined ? {} : { evidence }),
    readings: Object.freeze(readings),
    reconciliation: Object.freeze(reconciliation),
    auxiliaryStatus: auxiliary === null ? null : Object.freeze({ ...auxiliary }),
    predecessorOperationId: exactValue.predecessorOperationId,
  });
}

export async function startLiveDemoReviewRuntime(input: {
  readonly host: string;
  readonly port: number;
  readonly allowedBrowserOrigin: string;
  readonly sessionId: string;
  readonly lease: LiveDemoReviewLease;
  readonly now: () => Date;
  readonly readExactProjection: (
    identity: LiveDemoReviewIdentity,
  ) => Promise<LiveDemoReviewProjection | undefined>;
  readonly cleanup: (
    trigger: "finish" | "ttl" | "interrupt" | "restart",
  ) => Promise<LiveDemoReviewCleanupResult>;
  readonly establishTraceContext?: (
    headers: Readonly<Record<string, string | undefined>>,
  ) => W3CTraceContext;
  readonly runRequestSpan?: <T>(
    input: Readonly<{
      method: ReviewMethod;
      route: ReviewRoute;
      traceContext: W3CTraceContext;
    }>,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly recordHttpRequest?: (
    input: Readonly<{
      method: ReviewMethod;
      route: ReviewRoute;
      statusCode: number;
      durationSeconds: number;
    }>,
  ) => void;
  readonly revokeProjection?: () => void;
  readonly closeObservability?: () => Promise<void>;
  readonly runCleanupSpan?: <T>(
    input: Readonly<{ trigger: "finish" | "ttl" | "interrupt" | "restart" }>,
    operation: () => Promise<T>,
  ) => Promise<T>;
}): Promise<LiveDemoReviewRuntime> {
  if (
    !["127.0.0.1", "::1"].includes(input.host) ||
    !Number.isSafeInteger(input.port) ||
    input.port < 0 ||
    input.port > 65_535 ||
    !isExactLoopbackOrigin(input.allowedBrowserOrigin) ||
    !opaqueIdentifier.test(input.sessionId)
  ) {
    throw new Error("Live demo review runtime configuration is invalid");
  }
  const lease = restoreLiveDemoReviewLease(input.lease);
  const exactOperationPath = `/api/v1/live-simulator/operations/${encodeURIComponent(lease.identity.operationId)}`;
  const exactCleanupPath = `/api/v1/live-demo-review/sessions/${encodeURIComponent(input.sessionId)}`;
  let projectionAvailable = true;
  let ttlCleanup: Promise<LiveDemoReviewCleanupResult> | undefined;
  let closePromise: Promise<void> | undefined;
  const runCleanup = async (
    trigger: "finish" | "ttl" | "interrupt" | "restart",
  ): Promise<LiveDemoReviewCleanupResult> => {
    const operation = async (): Promise<LiveDemoReviewCleanupResult> =>
      await input.cleanup(trigger);
    return input.runCleanupSpan === undefined
      ? await operation()
      : await input.runCleanupSpan({ trigger }, operation);
  };
  const cleanupAtExpiry = (): Promise<LiveDemoReviewCleanupResult> => {
    ttlCleanup ??= runCleanup("ttl");
    return ttlCleanup;
  };
  const delay = Math.max(0, Date.parse(lease.reviewExpiresAt) - input.now().getTime());
  let closeAfterDeletion = async (): Promise<void> => undefined;
  const timer = setTimeout(() => {
    void cleanupAtExpiry()
      .then(async (result) => {
        if (result.outcome === "deleted") await closeAfterDeletion();
      })
      .catch(() => undefined);
  }, delay);
  timer.unref();

  const server = createServer(async (request, response) => {
    const startedAt = performance.now();
    let method: ReviewMethod = "OTHER";
    let route: ReviewRoute | undefined;
    let statusCode = 500;
    const allowedOrigin =
      request.headers.origin === input.allowedBrowserOrigin
        ? input.allowedBrowserOrigin
        : undefined;
    try {
      const target = request.url ?? "/";
      if (!target.startsWith("/") || target.startsWith("//")) throw new Error("invalid target");
      const parsedTarget = new URL(target, "http://localhost");
      if (
        parsedTarget.origin !== "http://localhost" ||
        parsedTarget.search.length > 0 ||
        parsedTarget.hash.length > 0 ||
        parsedTarget.username.length > 0 ||
        parsedTarget.password.length > 0
      ) {
        statusCode = 404;
        send(response, statusCode, {
          error: { code: "not_found", message: "Resource not found." },
        });
        return;
      }
      const path = parsedTarget.pathname;
      const classification = classifyLiveDemoReviewRequest({
        method: request.method,
        path,
        exactOperationPath,
        exactCleanupPath,
      });
      method = classification.method;
      if (classification.outcome === "not_found") {
        statusCode = 404;
        send(response, statusCode, {
          error: { code: "not_found", message: "Resource not found." },
        });
        return;
      }
      route = classification.route;
      let traceContext: W3CTraceContext;
      try {
        traceContext =
          input.establishTraceContext?.(requestHeaders(request)) ?? fallbackTraceContext();
      } catch {
        traceContext = fallbackTraceContext();
      }
      const handle = async (): Promise<void> => {
        if (allowedOrigin === undefined) {
          statusCode = 403;
          send(response, statusCode, {
            error: { code: "origin_forbidden", message: "Review request is not allowed." },
          });
          return;
        }
        if (classification.outcome === "options") {
          statusCode = 204;
          response.statusCode = 204;
          response.setHeader("access-control-allow-origin", allowedOrigin);
          response.setHeader("access-control-allow-methods", "GET, DELETE, OPTIONS");
          response.setHeader("access-control-allow-headers", "traceparent, tracestate");
          response.setHeader(
            "access-control-expose-headers",
            "x-muster-review-capability, x-muster-review-ready-at, x-muster-review-expires-at, x-muster-review-cleanup-path",
          );
          response.setHeader("vary", "Origin");
          response.end();
          return;
        }
        if (classification.outcome === "method_not_allowed") {
          statusCode = 405;
          send(
            response,
            statusCode,
            { error: { code: "method_not_allowed", message: "Review request is not allowed." } },
            allowedOrigin,
          );
          return;
        }
        if (classification.outcome === "operation") {
          if (isLiveDemoReviewExpired(lease, input.now())) {
            const result = await cleanupAtExpiry();
            statusCode = result.outcome === "deleted" ? 410 : 503;
            send(
              response,
              statusCode,
              result.outcome === "deleted"
                ? { error: { code: "review_expired", message: "Demo review expired." } }
                : { outcome: result.outcome, message: result.message },
              allowedOrigin,
            );
            if (result.outcome === "deleted") {
              response.once("finish", () => void closeAfterDeletion());
            }
            return;
          }
          if (!projectionAvailable) {
            statusCode = 410;
            send(
              response,
              statusCode,
              { error: { code: "review_deleted", message: "Demo review was deleted." } },
              allowedOrigin,
            );
            return;
          }
          const source = await input.readExactProjection(lease.identity);
          let projection: LiveDemoReviewProjection | undefined;
          try {
            projection =
              source === undefined
                ? undefined
                : restoreLiveDemoReviewProjection(source, lease.identity);
          } catch {
            projection = undefined;
          }
          if (projection === undefined) {
            statusCode = source === undefined ? 404 : 409;
            send(
              response,
              statusCode,
              {
                error: {
                  code: "review_unavailable",
                  message: "Exact demo review is unavailable.",
                },
              },
              allowedOrigin,
            );
            return;
          }
          statusCode = 200;
          send(response, statusCode, projection, allowedOrigin, {
            "x-muster-review-capability": "closed",
            "x-muster-review-ready-at": lease.reviewReadyAt,
            "x-muster-review-expires-at": lease.reviewExpiresAt,
            "x-muster-review-cleanup-path": exactCleanupPath,
            "access-control-expose-headers":
              "x-muster-review-capability, x-muster-review-ready-at, x-muster-review-expires-at, x-muster-review-cleanup-path",
          });
          return;
        }
        const result = await runCleanup("finish");
        statusCode = result.outcome === "deleted" ? 200 : 503;
        send(
          response,
          statusCode,
          { outcome: result.outcome, message: result.message },
          allowedOrigin,
        );
        if (result.outcome === "deleted") {
          response.once("finish", () => void closeAfterDeletion());
        }
      };
      if (input.runRequestSpan === undefined) await handle();
      else await input.runRequestSpan({ method, route, traceContext }, handle);
    } catch {
      statusCode = 500;
      send(
        response,
        statusCode,
        { error: { code: "unexpected_error", message: "Review request failed safely." } },
        allowedOrigin,
      );
    } finally {
      if (route !== undefined) {
        try {
          input.recordHttpRequest?.({
            method,
            route,
            statusCode,
            durationSeconds: (performance.now() - startedAt) / 1_000,
          });
        } catch {
          // Telemetry cannot alter the fail-closed response.
        }
      }
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, input.host, resolve);
    });
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === "string") {
    clearTimeout(timer);
    server.close();
    throw new Error("Live demo review listener failed safely");
  }
  const closeRuntime = (): Promise<void> =>
    (closePromise ??= (async () => {
      clearTimeout(timer);
      projectionAvailable = false;
      input.revokeProjection?.();
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        });
      }
      await input.closeObservability?.();
    })());
  closeAfterDeletion = closeRuntime;
  return Object.freeze({
    baseUrl: `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${String(address.port)}`,
    routes: Object.freeze([operationRoute, cleanupRoute] as const),
    close: closeRuntime,
  });
}
