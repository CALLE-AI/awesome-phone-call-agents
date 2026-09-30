import {
  ApplicationError,
  type AuditEventAppendResult,
  type AuditEventRepository,
} from "@muster/application";
import { AuditEvent, OrganizationId } from "@muster/domain";

import type { PrismaClient } from "./generated/prisma/client.js";

interface PersistedAuditEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly outcome: "ready" | "degraded";
}

function toDomainEvent(record: PersistedAuditEvent): AuditEvent {
  return AuditEvent.create({
    id: record.id,
    organizationId: OrganizationId.create(record.organizationId),
    kind: "foundation.health.checked",
    occurredAt: record.occurredAt.toISOString(),
    correlationId: record.correlationId,
    idempotencyKey: record.idempotencyKey,
    outcome: record.outcome,
  });
}

export class PrismaAuditEventRepository implements AuditEventRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async append(event: AuditEvent): Promise<AuditEventAppendResult> {
    try {
      const created = await this.client.auditEvent.create({
        data: {
          id: event.id,
          organizationId: event.organizationId.value,
          kind: "foundationHealthChecked",
          occurredAt: new Date(event.occurredAt),
          correlationId: event.correlationId,
          idempotencyKey: event.idempotencyKey,
          outcome: event.outcome,
        },
      });
      return Object.freeze({ outcome: "appended", event: toDomainEvent(created) });
    } catch {
      // A uniqueness race and an indeterminate write failure share the same safe recovery:
      // consult database-established evidence without exposing Prisma error details.
      const established = await this.findEstablished(event);
      if (established === undefined) {
        throw ApplicationError.dependencyUnavailable("audit_repository_unavailable");
      }
      if (established.correlationId !== event.correlationId) {
        throw ApplicationError.idempotencyConflict("audit_event_idempotency_conflict");
      }
      return Object.freeze({ outcome: "replayed", event: toDomainEvent(established) });
    }
  }

  private async findEstablished(event: AuditEvent): Promise<PersistedAuditEvent | undefined> {
    try {
      return (
        (await this.client.auditEvent.findUnique({
          where: {
            organizationId_kind_idempotencyKey: {
              organizationId: event.organizationId.value,
              kind: "foundationHealthChecked",
              idempotencyKey: event.idempotencyKey,
            },
          },
        })) ?? undefined
      );
    } catch {
      throw ApplicationError.dependencyUnavailable("audit_repository_unavailable");
    }
  }
}
