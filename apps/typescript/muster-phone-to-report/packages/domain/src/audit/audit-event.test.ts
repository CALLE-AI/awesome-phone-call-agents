import { describe, expect, it } from "vitest";

describe("AuditEvent", () => {
  // Test strategy: prove the domain record carries the minimum foundation evidence and
  // cannot be mutated after construction. Persistence, ORM mapping, and product events are
  // deliberately not tested in Phase 2.
  it("constructs an immutable organization-scoped foundation audit event", async () => {
    const { AuditEvent, OrganizationId } = await import("../index.js");
    const organizationId = OrganizationId.create("org_test_001");

    const event = AuditEvent.create({
      id: "audit_test_001",
      organizationId,
      kind: "foundation.health.checked",
      occurredAt: "2026-08-04T16:00:00.000Z",
      correlationId: "correlation_test_001",
      idempotencyKey: "idempotency_test_001",
      outcome: "ready",
    });

    expect(event).toMatchObject({
      id: "audit_test_001",
      organizationId,
      kind: "foundation.health.checked",
      occurredAt: "2026-08-04T16:00:00.000Z",
      correlationId: "correlation_test_001",
      idempotencyKey: "idempotency_test_001",
      outcome: "ready",
    });
    expect(Object.isFrozen(organizationId)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Reflect.set(event, "outcome", "degraded")).toBe(false);
    expect(event.outcome).toBe("ready");
  });
});
