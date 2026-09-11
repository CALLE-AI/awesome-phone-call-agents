import type { OrganizationId } from "../shared/organization-id.js";

export type AuditEventKind = "foundation.health.checked";
export type AuditEventOutcome = "ready" | "degraded";

export interface CreateAuditEventInput {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly kind: AuditEventKind;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly outcome: AuditEventOutcome;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty, trimmed value`);
  }
}

function requireIsoTimestamp(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("occurredAt must be a canonical ISO timestamp");
  }
}

export class AuditEvent {
  public readonly id: string;
  public readonly organizationId: OrganizationId;
  public readonly kind: AuditEventKind;
  public readonly occurredAt: string;
  public readonly correlationId: string;
  public readonly idempotencyKey: string;
  public readonly outcome: AuditEventOutcome;

  private constructor(input: CreateAuditEventInput) {
    this.id = input.id;
    this.organizationId = input.organizationId;
    this.kind = input.kind;
    this.occurredAt = input.occurredAt;
    this.correlationId = input.correlationId;
    this.idempotencyKey = input.idempotencyKey;
    this.outcome = input.outcome;
    Object.freeze(this);
  }

  public static create(input: CreateAuditEventInput): AuditEvent {
    requireNonEmpty(input.id, "id");
    requireNonEmpty(input.correlationId, "correlationId");
    requireNonEmpty(input.idempotencyKey, "idempotencyKey");
    requireIsoTimestamp(input.occurredAt);

    return new AuditEvent(input);
  }
}
