import type { OrganizationId } from "@muster/domain";

export interface SchedulerHeartbeatFact {
  readonly observedAt: string;
  readonly checkOutcome: "ready" | "degraded";
}

export interface SchedulerHeartbeatPort {
  readLatest(organizationId: OrganizationId): Promise<SchedulerHeartbeatFact | null>;
}
