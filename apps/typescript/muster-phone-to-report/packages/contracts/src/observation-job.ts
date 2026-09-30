import type { W3CTraceContext } from "./foundation-health-job.js";

export const OBSERVATION_JOB_NAME = "observation-request.v1" as const;
export const OBSERVATION_JOB_VERSION = "1" as const;

export interface ObservationJobPayload {
  readonly version: typeof OBSERVATION_JOB_VERSION;
  readonly organizationId: string;
  readonly operationId: string;
  readonly correlationId: string;
  readonly traceContext?: W3CTraceContext;
}

export interface ObservationJobResult {
  readonly version: typeof OBSERVATION_JOB_VERSION;
  readonly operationId: string;
  readonly stage: "terminal";
  readonly terminalOutcome: ObservationTerminalOutcome;
  readonly completedAt: string;
}

export type ObservationSchedulingOutcome =
  | Readonly<{ outcome: "scheduled"; jobId: string }>
  | Readonly<{ outcome: "duplicate" }>
  | Readonly<{ outcome: "rejected" }>;

export type ObservationTerminalOutcome =
  | "observation_recorded"
  | "blocked"
  | "no_answer"
  | "busy"
  | "provider_failed"
  | "evidence_unavailable";
