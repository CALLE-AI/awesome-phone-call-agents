import type { SystemHealthStatus } from "@muster/contracts";
import { AuditEvent, type OrganizationId } from "@muster/domain";

import type { AuditEventRepository } from "../ports/audit-event.repository.js";
import type { Clock } from "../ports/clock.port.js";
import type { IdentifierGenerator } from "../ports/identifier-generator.port.js";

export interface RecordFoundationAuditEventDependencies {
  readonly clock: Clock;
  readonly identifiers: IdentifierGenerator;
  readonly auditEvents: AuditEventRepository;
}

export interface RecordFoundationAuditEventInput {
  readonly organizationId: OrganizationId;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly outcome: SystemHealthStatus;
}

export class RecordFoundationAuditEvent {
  public constructor(private readonly dependencies: RecordFoundationAuditEventDependencies) {}

  public async execute(input: RecordFoundationAuditEventInput): Promise<AuditEvent> {
    const event = AuditEvent.create({
      id: this.dependencies.identifiers.generate(),
      organizationId: input.organizationId,
      kind: "foundation.health.checked",
      occurredAt: this.dependencies.clock.now(),
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      outcome: input.outcome,
    });

    const appendResult = await this.dependencies.auditEvents.append(event);
    // The repository owns idempotency; on replay its established event preserves the original
    // identifier, timestamp, and outcome even if the current attempt produced new candidates.
    return appendResult.event;
  }
}
