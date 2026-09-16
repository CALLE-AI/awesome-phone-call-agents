import {
  ApplicationError,
  type SchedulerHeartbeatFact,
  type SchedulerHeartbeatPort,
} from "@muster/application";
import type { OrganizationId } from "@muster/domain";

import type { PrismaClient } from "./generated/prisma/client.js";

export class PrismaSchedulerHeartbeatRepository implements SchedulerHeartbeatPort {
  public constructor(private readonly client: PrismaClient) {}

  public async readLatest(organizationId: OrganizationId): Promise<SchedulerHeartbeatFact | null> {
    try {
      const event = await this.client.auditEvent.findFirst({
        where: {
          organizationId: organizationId.value,
          kind: "foundationHealthChecked",
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { occurredAt: true, outcome: true },
      });
      return event === null
        ? null
        : Object.freeze({
            observedAt: event.occurredAt.toISOString(),
            checkOutcome: event.outcome,
          });
    } catch {
      throw ApplicationError.dependencyUnavailable("audit_repository_unavailable");
    }
  }
}
