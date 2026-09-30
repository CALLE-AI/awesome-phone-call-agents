import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { W3CTraceContext } from "@muster/contracts";

import type { LiveDemoViewerReadinessObservation } from "./live-demo-review-session.js";

const opaqueIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const capabilityRoute = "/api/v1/live-simulator/capability" as const;
const operationsRoute = "/api/v1/live-simulator/operations" as const;
const operationRoute = "/api/v1/live-simulator/operations/{operationId}" as const;

export type SimulatorHostHttpRoute =
  | typeof capabilityRoute
  | typeof operationsRoute
  | typeof operationRoute
  | "/twilio/voice"
  | "/twilio/status"
  | "/twilio/canary/{callbackHandle}";

interface ScenarioCapability {
  readonly scenarioId: string;
  readonly revision: number;
  readonly supportedModes: readonly string[];
}

interface LiveHttpResult {
  readonly statusCode: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface LiveSimulatorController {
  capability(): Promise<LiveHttpResult>;
  request(body: unknown, traceContext: W3CTraceContext): Promise<LiveHttpResult>;
  status(operationId: string): Promise<LiveHttpResult>;
}

function safeError(
  statusCode: number,
  code:
    | "authorization_invalid"
    | "validation_error"
    | "not_found"
    | "conflict"
    | "dependency_unavailable"
    | "unexpected_error",
  message: string,
): LiveHttpResult {
  return Object.freeze({
    statusCode,
    body: Object.freeze({ error: Object.freeze({ code, message }) }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createLiveSimulatorController(input: {
  readonly runtimeProfile: "demo" | "development" | "test" | "ci";
  readonly enabled: boolean;
  readonly scenarios: readonly ScenarioCapability[];
  readonly requestLiveObservation: (input: {
    readonly scenarioId: string;
    readonly scenarioRevision: number;
    readonly permit: string;
    readonly traceContext: W3CTraceContext;
  }) => Promise<Readonly<{ operationId: string; resourceVersion: number }>>;
  readonly getLiveObservation: (operationId: string) => Promise<unknown | undefined>;
}): LiveSimulatorController {
  const runtimeProfile = input.runtimeProfile === "ci" ? "test" : input.runtimeProfile;
  const supportedScenarioRevisions = Object.freeze(
    input.scenarios
      .filter((scenario) => scenario.supportedModes.includes("LIVE_SMOKE"))
      .map(({ scenarioId, revision }) => Object.freeze({ scenarioId, revision })),
  );
  return Object.freeze({
    capability: async () =>
      Object.freeze({
        statusCode: 200,
        body: Object.freeze({
          enabled: input.enabled,
          runtimeProfile,
          supportedScenarioRevisions,
        }),
      }),
    request: async (body: unknown, traceContext: W3CTraceContext) => {
      if (!isRecord(body) || Object.keys(body).length !== 3) {
        return safeError(400, "validation_error", "Live observation request is invalid.");
      }
      const scenarioId = body["scenarioId"];
      const scenarioRevision = body["scenarioRevision"];
      const permit = body["permit"];
      if (
        typeof scenarioId !== "string" ||
        !opaqueIdentifier.test(scenarioId) ||
        !Number.isSafeInteger(scenarioRevision) ||
        Number(scenarioRevision) < 1 ||
        Number(scenarioRevision) > 100 ||
        typeof permit !== "string" ||
        permit.length < 1 ||
        permit.length > 4_096 ||
        !supportedScenarioRevisions.some(
          (candidate) =>
            candidate.scenarioId === scenarioId && candidate.revision === scenarioRevision,
        )
      ) {
        return safeError(400, "validation_error", "Live observation request is invalid.");
      }
      try {
        const accepted = await input.requestLiveObservation({
          scenarioId,
          scenarioRevision: Number(scenarioRevision),
          permit,
          traceContext,
        });
        if (
          !opaqueIdentifier.test(accepted.operationId) ||
          !Number.isSafeInteger(accepted.resourceVersion) ||
          accepted.resourceVersion < 0
        ) {
          return safeError(
            500,
            "unexpected_error",
            "Live observation could not be started safely.",
          );
        }
        const location = `${operationsRoute}/${accepted.operationId}`;
        return Object.freeze({
          statusCode: 202,
          headers: Object.freeze({ location, "retry-after": "1" }),
          body: Object.freeze({
            operationId: accepted.operationId,
            resourceVersion: accepted.resourceVersion,
          }),
        });
      } catch (error: unknown) {
        const kind = isRecord(error) ? error["kind"] : undefined;
        const code = isRecord(error) ? error["code"] : undefined;
        if (kind === "validation" && code === "live_authorization_invalid") {
          return safeError(
            400,
            "authorization_invalid",
            "Permit rejected. Mint a fresh scenario-bound permit.",
          );
        }
        if (kind === "validation") {
          return safeError(400, "validation_error", "Live observation request is invalid.");
        }
        if (kind === "idempotency_conflict") {
          return safeError(
            409,
            "conflict",
            "This live observation request conflicts with its permit.",
          );
        }
        if (kind === "dependency_unavailable") {
          return safeError(
            503,
            "dependency_unavailable",
            "The live observation dependency is temporarily unavailable.",
          );
        }
        return safeError(500, "unexpected_error", "Live observation could not be started safely.");
      }
    },
    status: async (operationId: string) => {
      if (!opaqueIdentifier.test(operationId)) {
        return safeError(400, "validation_error", "Live operation identity is invalid.");
      }
      try {
        const projection = await input.getLiveObservation(operationId);
        return projection === undefined
          ? safeError(404, "not_found", "Live observation was not found.")
          : Object.freeze({ statusCode: 200, body: projection });
      } catch {
        return safeError(503, "dependency_unavailable", "Status is temporarily unavailable.");
      }
    },
  });
}

class SafeHttpError extends Error {
  public constructor(public readonly statusCode: number) {
    super("Simulator host request rejected");
  }
}

function requestHeaders(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}

async function boundedBody(request: IncomingMessage, maximumBytes: number): Promise<string> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) throw new SafeHttpError(413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new SafeHttpError(413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(body: string): unknown {
  if (body.length === 0) throw new SafeHttpError(400);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SafeHttpError(400);
  }
}

function parseForm(body: string): Readonly<Record<string, string>> {
  if (body.length === 0 || /%(?![0-9a-f]{2})/iu.test(body)) throw new SafeHttpError(400);
  const values = new URLSearchParams(body);
  const form: Record<string, string> = {};
  for (const [key, value] of values) {
    if (key.length === 0 || Object.hasOwn(form, key)) throw new SafeHttpError(400);
    form[key] = value;
  }
  return Object.freeze(form);
}

function fallbackTraceContext(): W3CTraceContext {
  return Object.freeze({
    traceparent: `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
  });
}

function isExactOrigin(value: string, allowLoopbackHttp: boolean): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname === "[::1]" ? "::1" : parsed.hostname;
    const loopbackHttp =
      allowLoopbackHttp &&
      parsed.protocol === "http:" &&
      ["127.0.0.1", "::1", "localhost"].includes(hostname);
    return (
      (parsed.protocol === "https:" || loopbackHttp) &&
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
  contentType: string,
  body: string,
  headers: Readonly<Record<string, string>> = {},
  allowedOrigin?: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  if (allowedOrigin !== undefined) {
    response.setHeader("access-control-allow-origin", allowedOrigin);
    response.setHeader("vary", "Origin");
  }
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(body);
}

export async function startSimulatorHostHttpRuntime(input: {
  readonly host: string;
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly allowedDemoOrigin: string;
  readonly maxBodyBytes: number;
  readonly closeTimeoutMs?: number;
  readonly liveController: LiveSimulatorController;
  readonly twilioController: {
    voice(
      input: Readonly<{
        requestUrl: string;
        twilioSignature: string;
        form: Readonly<Record<string, string>>;
        traceContext: W3CTraceContext;
      }>,
    ): Promise<Readonly<{ statusCode: number; contentType: string; body: string }>>;
    canary(
      input: Readonly<{
        requestUrl: string;
        callbackHandle: string;
        twilioSignature: string;
        form: Readonly<Record<string, string>>;
        traceContext: W3CTraceContext;
      }>,
    ): Promise<Readonly<{ statusCode: number; contentType: string; body: string }>>;
    status(
      input: Readonly<{
        requestUrl: string;
        twilioSignature: string;
        form: Readonly<Record<string, string>>;
        traceContext: W3CTraceContext;
      }>,
    ): Promise<Readonly<{ statusCode: number; contentType: string; body: string }>>;
  };
  readonly establishTraceContext: (
    headers: Readonly<Record<string, string | undefined>>,
  ) => W3CTraceContext;
  readonly runRestSpan?: <T>(
    input: Readonly<{
      method: "GET" | "POST" | "OPTIONS" | "OTHER";
      route: typeof capabilityRoute | typeof operationsRoute | typeof operationRoute;
      traceContext: W3CTraceContext;
    }>,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly runCallbackSpan?: <T>(
    traceContext: W3CTraceContext,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly recordHttpRequest?: (input: {
    readonly method: "GET" | "POST" | "OPTIONS" | "OTHER";
    readonly route: SimulatorHostHttpRoute;
    readonly statusCode: number;
    readonly durationSeconds: number;
  }) => void;
  readonly observeViewerReadiness?: (observation: LiveDemoViewerReadinessObservation) => void;
}): Promise<Readonly<{ baseUrl: string; close(): Promise<void> }>> {
  const closeTimeoutMs = input.closeTimeoutMs ?? 5_000;
  if (
    !["127.0.0.1", "::1", "localhost"].includes(input.host) ||
    !Number.isSafeInteger(input.port) ||
    input.port < 0 ||
    input.port > 65_535 ||
    !Number.isSafeInteger(input.maxBodyBytes) ||
    input.maxBodyBytes < 1 ||
    input.maxBodyBytes > 65_536 ||
    !Number.isSafeInteger(closeTimeoutMs) ||
    closeTimeoutMs < 1 ||
    !isExactOrigin(input.publicBaseUrl, false) ||
    !isExactOrigin(input.allowedDemoOrigin, true)
  ) {
    throw new Error("Simulator host HTTP configuration is invalid");
  }
  const server = createServer(async (request, response) => {
    const startedAt = performance.now();
    let metricRoute: SimulatorHostHttpRoute | undefined;
    const metricMethod: "GET" | "POST" | "OPTIONS" | "OTHER" =
      request.method === "GET" || request.method === "POST" || request.method === "OPTIONS"
        ? request.method
        : "OTHER";
    let restTraceContext: W3CTraceContext | undefined;
    let restSpanStarted = false;
    let statusCode = 500;
    const origin = request.headers.origin;
    const allowedOrigin = origin === input.allowedDemoOrigin ? input.allowedDemoOrigin : undefined;
    try {
      const requestTarget = request.url ?? "/";
      if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
        throw new SafeHttpError(400);
      }
      let path: string;
      try {
        path = new URL(requestTarget, "http://localhost").pathname;
        decodeURI(path);
      } catch {
        throw new SafeHttpError(400);
      }
      const operationMatch =
        /^\/api\/v1\/live-simulator\/operations\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/u.exec(path);
      const callbackMatch = /^\/twilio\/canary\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/u.exec(path);
      metricRoute =
        path === capabilityRoute
          ? capabilityRoute
          : path === operationsRoute
            ? operationsRoute
            : operationMatch !== null
              ? operationRoute
              : path === "/twilio/voice"
                ? "/twilio/voice"
                : path === "/twilio/status"
                  ? "/twilio/status"
                  : callbackMatch === null
                    ? undefined
                    : "/twilio/canary/{callbackHandle}";
      if (metricRoute?.startsWith("/api/") === true) {
        try {
          restTraceContext = input.establishTraceContext(requestHeaders(request));
        } catch {
          restTraceContext = fallbackTraceContext();
        }
      }
      if (request.method === "OPTIONS" && metricRoute?.startsWith("/api/") === true) {
        if (origin !== input.allowedDemoOrigin) throw new SafeHttpError(403);
        if (input.runRestSpan !== undefined) {
          restSpanStarted = true;
          await input.runRestSpan(
            {
              method: "OPTIONS",
              route: metricRoute as
                typeof capabilityRoute | typeof operationsRoute | typeof operationRoute,
              traceContext: restTraceContext!,
            },
            async () => undefined,
          );
        }
        statusCode = 204;
        response.statusCode = 204;
        response.setHeader("access-control-allow-origin", input.allowedDemoOrigin);
        response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type, traceparent, tracestate");
        response.setHeader("vary", "Origin");
        response.end();
        return;
      }
      if (metricRoute === undefined) throw new SafeHttpError(404);
      if (origin !== undefined && allowedOrigin === undefined && metricRoute.startsWith("/api/")) {
        throw new SafeHttpError(403);
      }
      const traceContext =
        restTraceContext ??
        (() => {
          try {
            return input.establishTraceContext(requestHeaders(request));
          } catch {
            return fallbackTraceContext();
          }
        })();
      if (
        metricRoute === capabilityRoute ||
        metricRoute === operationRoute ||
        metricRoute === operationsRoute
      ) {
        const method = metricRoute === operationsRoute ? "POST" : "GET";
        if (request.method !== method) throw new SafeHttpError(405);
        if (
          method === "POST" &&
          request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
            "application/json"
        ) {
          throw new SafeHttpError(415);
        }
        const operation = async (): Promise<LiveHttpResult> => {
          if (metricRoute === capabilityRoute) return await input.liveController.capability();
          if (metricRoute === operationRoute)
            return await input.liveController.status(operationMatch![1]!);
          return await input.liveController.request(
            parseJson(await boundedBody(request, input.maxBodyBytes)),
            traceContext,
          );
        };
        const result =
          input.runRestSpan === undefined
            ? await operation()
            : await (() => {
                restSpanStarted = true;
                return input.runRestSpan!({ method, route: metricRoute, traceContext }, operation);
              })();
        statusCode = result.statusCode;
        send(
          response,
          statusCode,
          "application/json",
          JSON.stringify(result.body),
          result.headers,
          allowedOrigin,
        );
        if (
          metricRoute === operationRoute &&
          method === "GET" &&
          statusCode === 200 &&
          allowedOrigin !== undefined &&
          typeof result.body === "object" &&
          result.body !== null &&
          !Array.isArray(result.body)
        ) {
          const projection = result.body as Readonly<Record<string, unknown>>;
          if (
            typeof projection["operationId"] === "string" &&
            typeof projection["scenarioId"] === "string" &&
            Number.isSafeInteger(projection["scenarioRevision"])
          ) {
            try {
              input.observeViewerReadiness?.({
                source: "server_http_runtime",
                method: "GET",
                route: `/api/v1/live-simulator/operations/${encodeURIComponent(operationMatch![1]!)}`,
                statusCode,
                projectionIdentity: {
                  operationId: projection["operationId"],
                  scenarioId: projection["scenarioId"],
                  scenarioRevision: Number(projection["scenarioRevision"]),
                },
              });
            } catch {
              // Viewer notification cannot alter the already-sent safe response.
            }
          }
        }
        return;
      }
      if (request.method !== "POST") throw new SafeHttpError(405);
      if (
        request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded"
      ) {
        throw new SafeHttpError(415);
      }
      const signature = request.headers["x-twilio-signature"];
      if (typeof signature !== "string" || signature.length < 1 || signature.length > 512) {
        throw new SafeHttpError(403);
      }
      const form = parseForm(await boundedBody(request, input.maxBodyBytes));
      const operation = async () =>
        path === "/twilio/status"
          ? await input.twilioController.status({
              requestUrl: `${input.publicBaseUrl}${path}`,
              twilioSignature: signature,
              form,
              traceContext,
            })
          : callbackMatch === null
            ? await input.twilioController.voice({
                requestUrl: `${input.publicBaseUrl}${path}`,
                twilioSignature: signature,
                form,
                traceContext,
              })
            : await input.twilioController.canary({
                requestUrl: `${input.publicBaseUrl}${path}`,
                callbackHandle: callbackMatch[1]!,
                twilioSignature: signature,
                form,
                traceContext,
              });
      const result =
        input.runCallbackSpan === undefined
          ? await operation()
          : await input.runCallbackSpan(traceContext, operation);
      statusCode = result.statusCode;
      send(response, statusCode, result.contentType, result.body);
    } catch (error: unknown) {
      statusCode = error instanceof SafeHttpError ? error.statusCode : 500;
      if (metricRoute?.startsWith("/api/") === true) {
        const body =
          statusCode === 400
            ? {
                error: {
                  code: "validation_error",
                  message: "Live observation request is invalid.",
                },
              }
            : {
                error: {
                  code: "unexpected_error",
                  message: "Live observation request failed safely.",
                },
              };
        send(response, statusCode, "application/json", JSON.stringify(body), {}, allowedOrigin);
      } else {
        send(response, statusCode, "text/plain", "");
      }
    } finally {
      if (
        metricRoute?.startsWith("/api/") === true &&
        !restSpanStarted &&
        restTraceContext !== undefined &&
        input.runRestSpan !== undefined
      ) {
        try {
          restSpanStarted = true;
          await input.runRestSpan(
            {
              method: metricMethod,
              route: metricRoute as
                typeof capabilityRoute | typeof operationsRoute | typeof operationRoute,
              traceContext: restTraceContext,
            },
            async () => {
              throw new SafeHttpError(statusCode);
            },
          );
        } catch {
          // Telemetry must not alter the response.
        }
      }
      if (metricRoute !== undefined) {
        try {
          input.recordHttpRequest?.({
            method: metricMethod,
            route: metricRoute,
            statusCode,
            durationSeconds: (performance.now() - startedAt) / 1_000,
          });
        } catch {
          // Telemetry must not alter the response.
        }
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Simulator host listener failed safely");
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    baseUrl: `http://${input.host === "::1" ? "[::1]" : input.host}:${String(address.port)}`,
    close: () =>
      (closePromise ??= new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          server.closeAllConnections();
          reject(new Error("Simulator host HTTP shutdown timed out"));
        }, closeTimeoutMs);
        server.close((error) => {
          clearTimeout(timeout);
          if (error === undefined) resolve();
          else reject(new Error("Simulator host HTTP shutdown failed"));
        });
      })),
  });
}
