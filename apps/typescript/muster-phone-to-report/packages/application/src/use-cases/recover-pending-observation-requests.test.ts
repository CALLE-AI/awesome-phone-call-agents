import { describe, expect, it } from "vitest";

import { CallAttempt, OrganizationId } from "@muster/domain";

describe("RecoverPendingObservationRequests", () => {
  it("re-enqueues a durable scheduled intent idempotently after the first enqueue is lost", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const RecoverPendingObservationRequests = Reflect.get(
      application,
      "RecoverPendingObservationRequests",
    ) as
      | (new (dependencies: Record<string, unknown>) => {
          execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
        })
      | undefined;
    const FakeCallAttemptRepository = Reflect.get(testing, "FakeCallAttemptRepository") as
      (new () => { seed(attempt: CallAttempt, idempotencyKey: string): void }) | undefined;
    const FakeObservationJobScheduler = Reflect.get(testing, "FakeObservationJobScheduler") as
      (new () => { readonly logicalJobs: readonly unknown[] }) | undefined;
    const FakeIdentifierGenerator = Reflect.get(testing, "FakeIdentifierGenerator") as
      (new (values: readonly string[]) => unknown) | undefined;
    if (
      RecoverPendingObservationRequests === undefined ||
      FakeCallAttemptRepository === undefined ||
      FakeObservationJobScheduler === undefined ||
      FakeIdentifierGenerator === undefined
    ) {
      throw new Error("Phase 3 observation recovery workflow is not implemented");
    }
    const attempts = new FakeCallAttemptRepository();
    attempts.seed(
      CallAttempt.establish({
        id: "operation_recovery",
        organizationId: OrganizationId.create("org_recovery"),
        endpointId: "endpoint_recovery",
        adapterVersionId: "adapter_recovery",
        trigger: "scheduled",
        provenance: "SIMULATED",
        semanticFingerprint: "request-fingerprint-recovery",
        providerDispatchIdentity: "provider-dispatch-recovery",
        acceptedAt: "2026-08-06T13:10:00.000Z",
      }),
      "idempotency_recovery",
    );
    const scheduler = new FakeObservationJobScheduler();
    const recovery = new RecoverPendingObservationRequests({
      attempts,
      scheduler,
      identifiers: new FakeIdentifierGenerator([
        "correlation_recovery_first",
        "correlation_recovery_second",
      ]),
    });

    const first = await recovery.execute({ limit: 10 });
    const second = await recovery.execute({ limit: 10 });

    expect(first).toMatchObject({ examined: 1, scheduled: 1, duplicates: 0, deferred: 0 });
    expect(second).toMatchObject({ examined: 1, scheduled: 0, duplicates: 1, deferred: 0 });
    expect(scheduler.logicalJobs).toHaveLength(1);
  });
});
