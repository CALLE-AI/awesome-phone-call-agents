import { randomUUID } from "node:crypto";

import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  classifyApplicationError,
  type GetFleetHealth,
  type LoggerPort,
} from "@muster/application";
import type { FleetHealthResponse } from "@muster/contracts";

type FleetOrganizationId = Parameters<GetFleetHealth["execute"]>[0];

export const FLEET_HTTP_ROUTE = "/api/v1/fleet" as const;
export type FleetHttpOutcome =
  "found" | "concealed" | "dependency_unavailable" | "unexpected_error";

export interface FleetRequestAuthorizer {
  (input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly resource: Readonly<{ kind: "fleet" }>;
  }): Promise<Readonly<{ organizationId: FleetOrganizationId }> | undefined>;
}

export interface FleetHttpTelemetry {
  run<T>(input: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly method: "GET";
    readonly route: typeof FLEET_HTTP_ROUTE;
    readonly operation: () => Promise<T>;
  }): Promise<T>;
  recordRequest(input: {
    readonly method: "GET";
    readonly route: typeof FLEET_HTTP_ROUTE;
    readonly statusCode: 200 | 404 | 500 | 503;
    readonly outcome: FleetHttpOutcome;
    readonly durationSeconds: number;
  }): void;
}

export const FLEET_TOKENS = Object.freeze({
  getFleetHealth: Symbol("GetFleetHealth"),
  logger: Symbol("FleetLogger"),
  maxEndpoints: Symbol("FleetMaxEndpoints"),
  requestAuthorizer: Symbol("FleetRequestAuthorizer"),
  retryAfterSeconds: Symbol("FleetRetryAfterSeconds"),
  telemetry: Symbol("FleetHttpTelemetry"),
});

interface FastifyRequestLike {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
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

function correlationId(headers: FastifyRequestLike["headers"]): string {
  const value = headers["x-correlation-id"];
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value)
    ? value.toLowerCase()
    : randomUUID();
}

@Controller("api/v1")
export class FleetController {
  public constructor(
    @Inject(FLEET_TOKENS.getFleetHealth)
    private readonly getFleetHealth: Pick<GetFleetHealth, "execute">,
    @Inject(FLEET_TOKENS.requestAuthorizer)
    private readonly requestAuthorizer: FleetRequestAuthorizer,
    @Inject(FLEET_TOKENS.logger)
    private readonly logger: LoggerPort,
    @Inject(FLEET_TOKENS.telemetry)
    private readonly telemetry: FleetHttpTelemetry,
    @Inject(FLEET_TOKENS.maxEndpoints)
    private readonly maxEndpoints: number,
    @Inject(FLEET_TOKENS.retryAfterSeconds)
    private readonly retryAfterSeconds: number,
  ) {}

  private record(input: {
    readonly correlationId: string;
    readonly statusCode: 200 | 404 | 500 | 503;
    readonly outcome: FleetHttpOutcome;
    readonly startedAt: number;
  }): void {
    const durationSeconds = Math.max(0, (performance.now() - input.startedAt) / 1_000);
    const statusClass = input.statusCode === 200 ? "2xx" : input.statusCode === 404 ? "4xx" : "5xx";
    try {
      this.logger.info({
        event: "http.request.completed",
        correlationId: input.correlationId,
        method: "GET",
        route: FLEET_HTTP_ROUTE,
        statusClass,
        outcome: input.outcome,
        duration: durationSeconds,
      });
    } catch {
      // Completion logging is best effort and cannot change the response.
    }
    try {
      this.telemetry.recordRequest({
        method: "GET",
        route: FLEET_HTTP_ROUTE,
        statusCode: input.statusCode,
        outcome: input.outcome,
        durationSeconds,
      });
    } catch {
      // Metrics are best effort and cannot change the response.
    }
  }

  @Get("fleet")
  public async readFleet(
    @Req() request: FastifyRequestLike,
    @Res({ passthrough: true }) reply: FastifyReplyLike,
  ): Promise<FleetHealthResponse> {
    const startedAt = performance.now();
    const requestCorrelationId = correlationId(request.headers);
    const operation = async (): Promise<FleetHealthResponse> => {
      setSafeHeaders(reply);
      let organizationId: FleetOrganizationId;
      try {
        const authorization = await this.requestAuthorizer({
          headers: request.headers,
          resource: { kind: "fleet" },
        });
        if (authorization?.organizationId === undefined) throw new Error("concealed");
        organizationId = authorization.organizationId;
      } catch {
        this.record({
          correlationId: requestCorrelationId,
          statusCode: 404,
          outcome: "concealed",
          startedAt,
        });
        throw new NotFoundException();
      }
      try {
        const result = await this.getFleetHealth.execute(organizationId);
        if (result.endpoints.length > this.maxEndpoints) {
          reply.header("Retry-After", String(this.retryAfterSeconds));
          this.record({
            correlationId: requestCorrelationId,
            statusCode: 503,
            outcome: "dependency_unavailable",
            startedAt,
          });
          throw new ServiceUnavailableException();
        }
        reply.code(200);
        this.record({
          correlationId: requestCorrelationId,
          statusCode: 200,
          outcome: "found",
          startedAt,
        });
        return result;
      } catch (error: unknown) {
        if (error instanceof ServiceUnavailableException) throw error;
        const safe = classifyApplicationError(error);
        if (safe.kind === "dependency_unavailable") {
          reply.header("Retry-After", String(this.retryAfterSeconds));
          this.record({
            correlationId: requestCorrelationId,
            statusCode: 503,
            outcome: "dependency_unavailable",
            startedAt,
          });
          throw new ServiceUnavailableException();
        }
        this.record({
          correlationId: requestCorrelationId,
          statusCode: 500,
          outcome: "unexpected_error",
          startedAt,
        });
        throw new InternalServerErrorException();
      }
    };
    // Recover span-wrapper failures without allowing instrumentation to run fleet work twice.
    let operationStarted = false;
    let operationCompleted = false;
    let completedResult: FleetHealthResponse | undefined;
    try {
      return await this.telemetry.run({
        headers: request.headers,
        method: "GET",
        route: FLEET_HTTP_ROUTE,
        operation: async () => {
          operationStarted = true;
          const result = await operation();
          completedResult = result;
          operationCompleted = true;
          return result;
        },
      });
    } catch (error: unknown) {
      if (operationCompleted && completedResult !== undefined) return completedResult;
      if (!operationStarted) return await operation();
      throw error;
    }
  }
}
