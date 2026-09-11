import type { SystemHealthStatus } from "./system-health.js";

export const FOUNDATION_HEALTH_JOB_NAME = "foundation-health.v1" as const;
export const FOUNDATION_HEALTH_JOB_VERSION = "1" as const;

export interface W3CTraceContext {
  readonly traceparent: string;
  readonly tracestate?: string;
}

export interface FoundationHealthJobPayload {
  readonly version: typeof FOUNDATION_HEALTH_JOB_VERSION;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly traceContext?: W3CTraceContext;
}

export interface FoundationHealthJobResult {
  readonly version: typeof FOUNDATION_HEALTH_JOB_VERSION;
  readonly correlationId: string;
  readonly status: SystemHealthStatus;
  readonly auditEventId: string;
  readonly completedAt: string;
}

export type FoundationHealthSchedulingOutcome =
  | Readonly<{ outcome: "scheduled"; jobId: string }>
  | Readonly<{ outcome: "duplicate" }>
  | Readonly<{ outcome: "rejected" }>;
