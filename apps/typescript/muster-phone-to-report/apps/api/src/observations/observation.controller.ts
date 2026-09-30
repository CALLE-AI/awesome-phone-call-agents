import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  ApplicationError,
  classifyApplicationError,
  type GetObservationOperation,
  type LoggerPort,
  type RequestObservationInput,
} from "@muster/application";
import type {
  ObservationAcceptedResponse,
  ObservationOperationResponse,
  W3CTraceContext,
} from "@muster/contracts";

export const OBSERVATION_HTTP_ROUTES = Object.freeze({
  request: "/api/v1/endpoints/{endpointId}/observations",
  status: "/api/v1/observations/{operationId}",
} as const);

export type ObservationHttpRoute =
  (typeof OBSERVATION_HTTP_ROUTES)[keyof typeof OBSERVATION_HTTP_ROUTES];
export type ObservationHttpOutcome =
  | "accepted"
  | "replayed"
  | "validation_failed"
  | "concealed"
  | "conflict"
  | "blocked"
  | "found"
  | "unexpected_error"
  | "dependency_unavailable";

export interface ObservationHttpRequestResult {
  readonly outcome: "established" | "replayed";
  readonly operation: {
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
  };
  readonly schedulingOutcome: "scheduled" | "duplicate" | "deferred" | "blocked";
}

export interface ObservationRequestHandler {
  execute(input: RequestObservationInput): Promise<ObservationHttpRequestResult>;
}

export interface ObservationRequestAuthorizer {
  (input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly resource:
      | Readonly<{ kind: "endpoint"; endpointId: string }>
      | Readonly<{ kind: "observation"; operationId: string }>;
  }): Promise<Readonly<{ organizationId: RequestObservationInput["organizationId"] }> | undefined>;
}

export interface ObservationHttpTelemetry {
  run<T>(input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly method: "POST" | "GET";
    readonly route: ObservationHttpRoute;
    readonly operation: () => Promise<T>;
  }): Promise<T>;
  activeTraceContext(): W3CTraceContext | undefined;
  recordRequest(input: {
    readonly method: "POST" | "GET";
    readonly route: ObservationHttpRoute;
    readonly statusCode: 200 | 202 | 400 | 404 | 409 | 500 | 503;
    readonly outcome: ObservationHttpOutcome;
    readonly durationSeconds: number;
  }): void;
}

export const OBSERVATION_TOKENS = Object.freeze({
  getObservationOperation: Symbol("GetObservationOperation"),
  logger: Symbol("ObservationLogger"),
  requestAuthorizer: Symbol("ObservationRequestAuthorizer"),
  requestObservation: Symbol("RequestObservation"),
  retryAfterSeconds: Symbol("ObservationRetryAfterSeconds"),
  telemetry: Symbol("ObservationHttpTelemetry"),
});

interface FastifyRequestLike {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body?: unknown;
}

interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
}

function setSafeHeaders(reply: FastifyReplyLike): void {
  reply
    .header("Cache-Control", "no-store, max-age=0")
    .header("Pragma", "no-cache")
    .header("Expires", "0")
    .header("X-Content-Type-Options", "nosniff");
}

function headerValue(headers: FastifyRequestLike["headers"], name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

function requestCorrelationId(headers: FastifyRequestLike["headers"]): string {
  const value = headerValue(headers, "x-correlation-id");
  return value !== undefined && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value)
    ? value.toLowerCase()
    : randomUUID();
}

function isOpaqueIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

function pollWindowId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "pollWindowId") return undefined;
  const value = Reflect.get(body, "pollWindowId");
  return isOpaqueIdentifier(value) ? value : undefined;
}

@Controller("api/v1")
export class ObservationController {
  public constructor(
    @Inject(OBSERVATION_TOKENS.requestObservation)
    private readonly requestObservation: ObservationRequestHandler,
    @Inject(OBSERVATION_TOKENS.getObservationOperation)
    private readonly getObservationOperation: Pick<GetObservationOperation, "execute">,
    @Inject(OBSERVATION_TOKENS.requestAuthorizer)
    private readonly requestAuthorizer: ObservationRequestAuthorizer,
    @Inject(OBSERVATION_TOKENS.logger)
    private readonly logger: LoggerPort,
    @Inject(OBSERVATION_TOKENS.telemetry)
    private readonly telemetry: ObservationHttpTelemetry,
    @Inject(OBSERVATION_TOKENS.retryAfterSeconds)
    private readonly retryAfterSeconds: number,
  ) {}

  private record(input: {
    readonly correlationId: string;
    readonly method: "POST" | "GET";
    readonly route: ObservationHttpRoute;
    readonly statusCode: 200 | 202 | 400 | 404 | 409 | 500 | 503;
    readonly outcome: ObservationHttpOutcome;
    readonly startedAt: number;
  }): void {
    const durationSeconds = Math.max(0, (performance.now() - input.startedAt) / 1_000);
    try {
      this.logger.info({
        event: "http.request.completed",
        correlationId: input.correlationId,
        method: input.method,
        route: input.route,
        statusCode: input.statusCode,
        outcome: input.outcome,
        duration: durationSeconds,
      });
    } catch {
      // Logging is best effort and cannot change the HTTP result.
    }
    try {
      this.telemetry.recordRequest({
        method: input.method,
        route: input.route,
        statusCode: input.statusCode,
        outcome: input.outcome,
        durationSeconds,
      });
    } catch {
      // Metrics are best effort and cannot change the HTTP result.
    }
  }

  private async authorize(
    request: FastifyRequestLike,
    resource:
      | Readonly<{ kind: "endpoint"; endpointId: string }>
      | Readonly<{ kind: "observation"; operationId: string }>,
  ): Promise<Readonly<{ organizationId: RequestObservationInput["organizationId"] }>> {
    try {
      const authorized = await this.requestAuthorizer({ headers: request.headers, resource });
      if (authorized !== undefined) return authorized;
    } catch {
      // Authorization failures are intentionally indistinguishable from denied access.
    }
    throw new NotFoundException();
  }

  @Post("endpoints/:endpointId/observations")
  public async requestEndpointObservation(
    @Param("endpointId") endpointId: string,
    @Req() request: FastifyRequestLike,
    @Res({ passthrough: true }) reply: FastifyReplyLike,
  ): Promise<ObservationAcceptedResponse> {
    const route = OBSERVATION_HTTP_ROUTES.request;
    const startedAt = performance.now();
    const correlationId = requestCorrelationId(request.headers);
    return await this.telemetry.run({
      headers: request.headers,
      method: "POST",
      route,
      operation: async () => {
        setSafeHeaders(reply);
        const idempotencyKey = headerValue(request.headers, "idempotency-key");
        const requestedPollWindowId = pollWindowId(request.body);
        if (
          !isOpaqueIdentifier(endpointId) ||
          !isOpaqueIdentifier(idempotencyKey) ||
          requestedPollWindowId === undefined
        ) {
          this.record({
            correlationId,
            method: "POST",
            route,
            statusCode: 400,
            outcome: "validation_failed",
            startedAt,
          });
          throw new BadRequestException();
        }
        let authorization: Awaited<ReturnType<ObservationController["authorize"]>>;
        try {
          authorization = await this.authorize(request, { kind: "endpoint", endpointId });
        } catch {
          this.record({
            correlationId,
            method: "POST",
            route,
            statusCode: 404,
            outcome: "concealed",
            startedAt,
          });
          throw new NotFoundException();
        }
        try {
          const traceContext = this.telemetry.activeTraceContext();
          const result = await this.requestObservation.execute({
            organizationId: authorization.organizationId,
            endpointId,
            pollWindowId: requestedPollWindowId,
            idempotencyKey,
            correlationId,
            trigger: "manual",
            ...(traceContext === undefined ? {} : { traceContext }),
          });
          if (!isOpaqueIdentifier(result.operation.id)) {
            throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
          }
          const statusUrl = `/api/v1/observations/${result.operation.id}`;
          reply.header("Location", statusUrl);
          if (
            result.schedulingOutcome === "blocked" ||
            (result.operation.stage === "terminal" &&
              result.operation.terminalOutcome === "blocked")
          ) {
            this.record({
              correlationId,
              method: "POST",
              route,
              statusCode: 409,
              outcome: "blocked",
              startedAt,
            });
            throw new ConflictException();
          }
          reply.header("Retry-After", String(this.retryAfterSeconds)).code(202);
          this.record({
            correlationId,
            method: "POST",
            route,
            statusCode: 202,
            outcome: result.outcome === "replayed" ? "replayed" : "accepted",
            startedAt,
          });
          return {
            contractVersion: "1",
            operationId: result.operation.id,
            statusUrl,
            stage: result.operation.stage,
            terminalOutcome: result.operation.terminalOutcome,
            acceptedAt: result.operation.acceptedAt,
          };
        } catch (error: unknown) {
          if (error instanceof ConflictException) throw error;
          const safe = classifyApplicationError(error);
          if (safe.kind === "idempotency_conflict") {
            this.record({
              correlationId,
              method: "POST",
              route,
              statusCode: 409,
              outcome: "conflict",
              startedAt,
            });
            throw new ConflictException();
          }
          if (safe.kind === "dependency_unavailable") {
            reply.header("Retry-After", String(this.retryAfterSeconds));
            this.record({
              correlationId,
              method: "POST",
              route,
              statusCode: 503,
              outcome: "dependency_unavailable",
              startedAt,
            });
            throw new ServiceUnavailableException();
          }
          this.record({
            correlationId,
            method: "POST",
            route,
            statusCode: 500,
            outcome: "unexpected_error",
            startedAt,
          });
          throw new InternalServerErrorException();
        }
      },
    });
  }

  @Get("observations/:operationId")
  public async readObservationOperation(
    @Param("operationId") operationId: string,
    @Req() request: FastifyRequestLike,
    @Res({ passthrough: true }) reply: FastifyReplyLike,
  ): Promise<ObservationOperationResponse> {
    const route = OBSERVATION_HTTP_ROUTES.status;
    const startedAt = performance.now();
    const correlationId = requestCorrelationId(request.headers);
    return await this.telemetry.run({
      headers: request.headers,
      method: "GET",
      route,
      operation: async () => {
        setSafeHeaders(reply);
        if (!isOpaqueIdentifier(operationId)) {
          this.record({
            correlationId,
            method: "GET",
            route,
            statusCode: 400,
            outcome: "validation_failed",
            startedAt,
          });
          throw new BadRequestException();
        }
        let authorization: Awaited<ReturnType<ObservationController["authorize"]>>;
        try {
          authorization = await this.authorize(request, { kind: "observation", operationId });
        } catch {
          this.record({
            correlationId,
            method: "GET",
            route,
            statusCode: 404,
            outcome: "concealed",
            startedAt,
          });
          throw new NotFoundException();
        }
        try {
          const result = await this.getObservationOperation.execute({
            organizationId: authorization.organizationId,
            operationId,
          });
          if (result === undefined) {
            this.record({
              correlationId,
              method: "GET",
              route,
              statusCode: 404,
              outcome: "concealed",
              startedAt,
            });
            throw new NotFoundException();
          }
          if (!result.terminal) reply.header("Retry-After", String(this.retryAfterSeconds));
          reply.code(200);
          this.record({
            correlationId,
            method: "GET",
            route,
            statusCode: 200,
            outcome: "found",
            startedAt,
          });
          return result;
        } catch (error: unknown) {
          if (error instanceof NotFoundException) throw error;
          const safe = classifyApplicationError(error);
          if (safe.kind === "dependency_unavailable") {
            reply.header("Retry-After", String(this.retryAfterSeconds));
            this.record({
              correlationId,
              method: "GET",
              route,
              statusCode: 503,
              outcome: "dependency_unavailable",
              startedAt,
            });
            throw new ServiceUnavailableException();
          }
          this.record({
            correlationId,
            method: "GET",
            route,
            statusCode: 500,
            outcome: "unexpected_error",
            startedAt,
          });
          throw new InternalServerErrorException();
        }
      },
    });
  }
}
