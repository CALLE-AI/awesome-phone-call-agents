import {
  ApplicationError,
  type AuditEventAppendResult,
  type AuditEventRepository,
} from "@muster/application";
import type { AuditEvent } from "@muster/domain";

export class FakeAuditEventRepository implements AuditEventRepository {
  private readonly appendedEvents: AuditEvent[] = [];
  private readonly eventsByOrganizationAndKey = new Map<string, Map<string, AuditEvent>>();

  public get events(): readonly AuditEvent[] {
    return [...this.appendedEvents];
  }

  public async append(event: AuditEvent): Promise<AuditEventAppendResult> {
    let eventsByKey = this.eventsByOrganizationAndKey.get(event.organizationId.value);
    if (eventsByKey === undefined) {
      eventsByKey = new Map<string, AuditEvent>();
      this.eventsByOrganizationAndKey.set(event.organizationId.value, eventsByKey);
    }

    const established = eventsByKey.get(event.idempotencyKey);
    if (established !== undefined) {
      if (!this.hasMatchingSemanticPayload(established, event)) {
        throw ApplicationError.idempotencyConflict("audit_event_idempotency_conflict");
      }
      return Object.freeze({ outcome: "replayed", event: established });
    }

    eventsByKey.set(event.idempotencyKey, event);
    this.appendedEvents.push(event);
    return Object.freeze({ outcome: "appended", event });
  }

  private hasMatchingSemanticPayload(established: AuditEvent, candidate: AuditEvent): boolean {
    // Readiness is recomputed on delivery, so generated values and outcome are replay data rather
    // than operation identity; only the stable operation and correlation semantics may match.
    return (
      established.kind === candidate.kind && established.correlationId === candidate.correlationId
    );
  }
}
