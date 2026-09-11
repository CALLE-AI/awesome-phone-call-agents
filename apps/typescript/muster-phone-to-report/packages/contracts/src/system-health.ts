export const SYSTEM_HEALTH_CONTRACT_VERSION = "1" as const;

export type SystemHealthStatus = "ready" | "degraded";

export interface SystemHealthResponse {
  readonly status: SystemHealthStatus;
}
