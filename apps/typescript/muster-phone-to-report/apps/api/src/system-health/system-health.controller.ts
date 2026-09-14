import { randomUUID } from "node:crypto";

import { Controller, Get, Inject, NotFoundException, Req, Res } from "@nestjs/common";

import type { GetSystemHealth, HealthAccessPolicy, LoggerPort } from "@muster/application";
import type { SystemHealthResponse } from "@muster/contracts";
export const SYSTEM_HEALTH_TOKENS = Object.freeze({
  accessPolicy: Symbol("SystemHealthAccessPolicy"),
  getSystemHealth: Symbol("GetSystemHealth"),
  listenerScope: Symbol("SystemHealthListenerScope"),
  logger: Symbol("SystemHealthLogger"),
  requestAuthorizer: Symbol("SystemHealthRequestAuthorizer"),
  telemetry: Symbol("SystemHealthHttpTelemetry"),
  readinessTimeoutMs: Symbol("SystemHealthReadinessTimeoutMs"),
});

export interface SystemHealthHttpTelemetry {
  run(
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
    operation: () => Promise<SystemHealthResponse>,
  ): Promise<SystemHealthResponse>;
  recordRequest(input: {
    readonly method: "GET";
    readonly route: "/api/v1/system/health";
    readonly statusCode: 200 | 503;
    readonly durationSeconds: number;
  }): void;
}

export type SystemHealthRequestAuthorizer = (input: {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly peerScope: "loopback" | "non-loopback";
}) => Promise<boolean>;

interface FastifyRequestLike {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly ip?: string;
}

interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function correlationId(headers: FastifyRequestLike["headers"]): string {
  const supplied = headers["x-correlation-id"];
  return typeof supplied === "string" && /^[0-9a-f-]{36}$/iu.test(supplied)
    ? supplied.toLowerCase()
    : randomUUID();
}

function setSafeHealthHeaders(reply: FastifyReplyLike): void {
  reply
    .header("Cache-Control", "no-store, max-age=0")
    .header("Pragma", "no-cache")
    .header("Expires", "0")
    .header("X-Content-Type-Options", "nosniff");
}

async function withReadinessDeadline(
  operation: Promise<SystemHealthResponse>,
  timeoutMs: number,
): Promise<SystemHealthResponse> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SystemHealthResponse>((resolve) => {
    handle = setTimeout(() => resolve({ status: "degraded" }), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

@Controller("api/v1/system")
export class SystemHealthController {
  public constructor(
    @Inject(SYSTEM_HEALTH_TOKENS.getSystemHealth)
    private readonly getSystemHealth: GetSystemHealth,
    @Inject(SYSTEM_HEALTH_TOKENS.accessPolicy)
    private readonly accessPolicy: HealthAccessPolicy,
    @Inject(SYSTEM_HEALTH_TOKENS.requestAuthorizer)
    private readonly requestAuthorizer: SystemHealthRequestAuthorizer,
    @Inject(SYSTEM_HEALTH_TOKENS.listenerScope)
    private readonly listenerScope: "loopback" | "non-loopback",
    @Inject(SYSTEM_HEALTH_TOKENS.logger)
    private readonly logger: LoggerPort,
    @Inject(SYSTEM_HEALTH_TOKENS.telemetry)
    private readonly telemetry: SystemHealthHttpTelemetry,
    @Inject(SYSTEM_HEALTH_TOKENS.readinessTimeoutMs)
    private readonly readinessTimeoutMs: number,
  ) {}

  @Get("health")
  public async readSystemHealth(
    @Req() request: FastifyRequestLike,
    @Res({ passthrough: true }) reply: FastifyReplyLike,
  ): Promise<SystemHealthResponse> {
    const requestCorrelationId = correlationId(request.headers);
    const peerScope = isLoopback(request.ip) ? "loopback" : "non-loopback";
    try {
      const requestAuthorized = await this.requestAuthorizer({
        headers: request.headers,
        peerScope,
      });
      const access = await this.accessPolicy.evaluate({
        listenerScope: this.listenerScope,
        peerScope,
        harnessAuthorized: requestAuthorized,
        internalPolicyAuthorized: requestAuthorized,
      });
      if (access !== "allowed") throw new NotFoundException();
    } catch {
      throw new NotFoundException();
    }

    const startedAt = performance.now();
    return await this.telemetry.run(request.headers, async () => {
      const result = await withReadinessDeadline(
        this.getSystemHealth.execute(),
        this.readinessTimeoutMs,
      );
      const statusCode = result.status === "ready" ? 200 : 503;
      const durationSeconds = Math.max(0, (performance.now() - startedAt) / 1_000);
      setSafeHealthHeaders(reply);
      reply.code(statusCode);
      try {
        this.logger.info({
          event: "http.request.completed",
          correlationId: requestCorrelationId,
          method: "GET",
          route: "/api/v1/system/health",
          statusCode,
          outcome: result.status,
          duration: durationSeconds,
        });
        this.telemetry.recordRequest({
          method: "GET",
          route: "/api/v1/system/health",
          statusCode,
          durationSeconds,
        });
      } catch {
        // Telemetry cannot change the readiness response.
      }
      return result;
    });
  }
}
