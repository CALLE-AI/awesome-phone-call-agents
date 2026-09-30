import { createClient } from "./generated/client/index.js";
import {
  getObservationOperation as getObservationOperationRequest,
  getFleetHealth as getFleetHealthRequest,
  getSystemHealth,
  requestObservation as requestObservationRequest,
} from "./generated/sdk.gen.js";
import type {
  ErrorResponse,
  FleetHealthResponse,
  ObservationAcceptedResponse,
  ObservationOperationResponse,
  SystemHealthResponse,
} from "./generated/schema.js";

export type {
  ErrorResponse,
  FleetActiveManualOperation,
  FleetEndpoint,
  FleetFreshness,
  FleetHealthResponse,
  FleetIncident,
  FleetIncidentNone,
  FleetIncidentOpen,
  FleetIncidentUnavailable,
  FleetLastAttempt,
  FleetLastCompleteObservation,
  FleetOperationalState,
  FleetSchedulerHeartbeat,
  ObservationAcceptedResponse,
  ObservationAttempt,
  ObservationEvidenceMetadata,
  ObservationOperationResponse,
  ObservationReading,
  ObservationRequest,
  SystemHealthResponse,
  VersionedObservation,
} from "./generated/schema.js";

export interface ObservationClientResponseHeaders {
  readonly location: string | null;
  readonly retryAfterSeconds: number | null;
}

export type ObservationRequestFailureStatus = 400 | 404 | 409 | 500 | 503;
export type ObservationStatusFailureStatus = 400 | 404 | 500 | 503;
export type FleetFailureStatus = 404 | 500 | 503;

export type FleetHealthResult =
  | Readonly<{
      ok: true;
      status: 200;
      data: FleetHealthResponse;
      headers: ObservationClientResponseHeaders;
    }>
  | Readonly<{
      ok: false;
      status: FleetFailureStatus;
      error: ErrorResponse | null;
      headers: ObservationClientResponseHeaders;
    }>
  | Readonly<{
      ok: false;
      status: "transport_error";
      error: null;
      headers: ObservationClientResponseHeaders;
    }>;

export type ObservationRequestResult =
  | Readonly<{
      ok: true;
      status: 202;
      data: ObservationAcceptedResponse;
      headers: ObservationClientResponseHeaders;
    }>
  | Readonly<{
      ok: false;
      status: ObservationRequestFailureStatus;
      error: ErrorResponse | null;
      headers: ObservationClientResponseHeaders;
    }>
  | Readonly<{
      ok: false;
      status: "transport_error";
      error: null;
      headers: ObservationClientResponseHeaders;
    }>;

export type ObservationStatusResult =
  | Readonly<{
      ok: true;
      status: 200;
      data: ObservationOperationResponse;
      headers: ObservationClientResponseHeaders;
    }>
  | Readonly<{
      ok: false;
      status: ObservationStatusFailureStatus;
      error: ErrorResponse | null;
      headers: ObservationClientResponseHeaders;
    }>
  | Readonly<{
      ok: false;
      status: "transport_error";
      error: null;
      headers: ObservationClientResponseHeaders;
    }>;

export interface MusterApiClient {
  getSystemHealth(): Promise<SystemHealthResponse>;
  getFleetHealth(): Promise<FleetHealthResult>;
  requestObservation(input: {
    readonly endpointId: string;
    readonly idempotencyKey: string;
    readonly pollWindowId: string;
  }): Promise<ObservationRequestResult>;
  getObservationOperation(operationId: string): Promise<ObservationStatusResult>;
}

const safeErrorCodes = new Set([
  "validation_error",
  "not_found",
  "conflict",
  "access_denied",
  "dependency_unavailable",
  "unexpected_error",
]);

function boundedResponseHeaders(response: Response | undefined): ObservationClientResponseHeaders {
  const rawLocation = response?.headers.get("location") ?? null;
  const rawRetryAfter = response?.headers.get("retry-after") ?? null;
  const location =
    rawLocation !== null &&
    /^\/api\/v1\/observations\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(rawLocation)
      ? rawLocation
      : null;
  const retryAfter = rawRetryAfter === null ? Number.NaN : Number(rawRetryAfter);
  return Object.freeze({
    location,
    retryAfterSeconds: /^[1-9][0-9]?$/u.test(rawRetryAfter ?? "") ? retryAfter : null,
  });
}

function safeErrorResponse(value: unknown): ErrorResponse | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = Reflect.get(value, "error");
  if (typeof error !== "object" || error === null) return null;
  const code = Reflect.get(error, "code");
  const message = Reflect.get(error, "message");
  const correlationId = Reflect.get(error, "correlationId");
  if (
    typeof code !== "string" ||
    !safeErrorCodes.has(code) ||
    typeof message !== "string" ||
    message.length > 128 ||
    typeof correlationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      correlationId,
    )
  ) {
    return null;
  }
  return Object.freeze({
    error: Object.freeze({
      code: code as ErrorResponse["error"]["code"],
      message,
      correlationId,
    }),
  });
}

function isRequestFailureStatus(
  value: number | undefined,
): value is ObservationRequestFailureStatus {
  return value === 400 || value === 404 || value === 409 || value === 500 || value === 503;
}

function isStatusFailureStatus(value: number | undefined): value is ObservationStatusFailureStatus {
  return value === 400 || value === 404 || value === 500 || value === 503;
}

function isFleetFailureStatus(value: number | undefined): value is FleetFailureStatus {
  return value === 404 || value === 500 || value === 503;
}

export function createMusterApiClient(options: {
  readonly baseUrl: string;
  readonly authorization?: string;
}): MusterApiClient {
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  if (!/^https?:\/\//u.test(baseUrl)) throw new Error("Invalid Muster API base URL");
  const client = createClient({
    baseUrl,
    throwOnError: false,
    ...(options.authorization === undefined ? {} : { auth: options.authorization }),
  });
  return Object.freeze({
    async getSystemHealth(): Promise<SystemHealthResponse> {
      const response = await getSystemHealth({ client, throwOnError: false });
      if (response.data !== undefined) return response.data;
      if (
        typeof response.error === "object" &&
        response.error !== null &&
        "status" in response.error &&
        response.error.status === "degraded"
      ) {
        return { status: "degraded" };
      }
      throw new Error("System health request failed safely");
    },
    async getFleetHealth(): Promise<FleetHealthResult> {
      const response = await getFleetHealthRequest({ client, throwOnError: false });
      const headers = boundedResponseHeaders(response.response);
      if (response.data !== undefined && response.data.endpoints.length <= 500) {
        return Object.freeze({ ok: true, status: 200, data: response.data, headers });
      }
      const status = response.response?.status;
      if (isFleetFailureStatus(status)) {
        return Object.freeze({
          ok: false,
          status,
          error: safeErrorResponse(response.error),
          headers,
        });
      }
      return Object.freeze({ ok: false, status: "transport_error", error: null, headers });
    },
    async requestObservation(input: {
      readonly endpointId: string;
      readonly idempotencyKey: string;
      readonly pollWindowId: string;
    }): Promise<ObservationRequestResult> {
      const response = await requestObservationRequest({
        client,
        throwOnError: false,
        body: { pollWindowId: input.pollWindowId },
        headers: { "Idempotency-Key": input.idempotencyKey },
        path: { endpointId: input.endpointId },
      });
      const headers = boundedResponseHeaders(response.response);
      if (response.data !== undefined) {
        return Object.freeze({ ok: true, status: 202, data: response.data, headers });
      }
      const status = response.response?.status;
      if (isRequestFailureStatus(status)) {
        return Object.freeze({
          ok: false,
          status,
          error: safeErrorResponse(response.error),
          headers,
        });
      }
      return Object.freeze({ ok: false, status: "transport_error", error: null, headers });
    },
    async getObservationOperation(operationId: string): Promise<ObservationStatusResult> {
      const response = await getObservationOperationRequest({
        client,
        throwOnError: false,
        path: { operationId },
      });
      const headers = boundedResponseHeaders(response.response);
      if (response.data !== undefined) {
        return Object.freeze({ ok: true, status: 200, data: response.data, headers });
      }
      const status = response.response?.status;
      if (isStatusFailureStatus(status)) {
        return Object.freeze({
          ok: false,
          status,
          error: safeErrorResponse(response.error),
          headers,
        });
      }
      return Object.freeze({ ok: false, status: "transport_error", error: null, headers });
    },
  });
}
