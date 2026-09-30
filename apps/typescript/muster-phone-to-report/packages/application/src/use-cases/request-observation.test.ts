import { describe, expect, it } from "vitest";

import { EndpointObservationProfile, OrganizationId } from "@muster/domain";

function profile() {
  return EndpointObservationProfile.create({
    endpointId: "endpoint_phase3",
    organizationId: OrganizationId.create("org_phase3"),
    adapterVersionId: "adapter_version_simulated_v1",
    expectedZones: [
      {
        zoneId: "zone-01",
        ordinal: 0,
        applicability: "required",
        requiredFacet: "measurement",
        allowedUnitMappings: [
          {
            ruleId: "unit_rule_fahrenheit_v1",
            spokenUnit: "degrees fahrenheit",
            normalizedUnit: "degF",
          },
        ],
      },
    ],
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: "authorization_ref_phase3",
  });
}

describe("RequestObservation", () => {
  // Test strategy: this file owns database-established request identity and manual/scheduled
  // convergence. Real PostgreSQL races stay in the repository contract suite; HTTP is Phase 4.
  it("replays database-established values and reuses one intention for manual and scheduled ingress", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const RequestObservation = Reflect.get(application, "RequestObservation") as
      | (new (dependencies: Record<string, unknown>) => {
          execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
        })
      | undefined;
    const FakeObservationProfileRepository = Reflect.get(
      testing,
      "FakeObservationProfileRepository",
    ) as (new (profiles: readonly unknown[]) => unknown) | undefined;
    const FakeCallAttemptRepository = Reflect.get(testing, "FakeCallAttemptRepository") as
      (new () => { readonly attempts: readonly unknown[] }) | undefined;
    const FakeObservationJobScheduler = Reflect.get(testing, "FakeObservationJobScheduler") as
      (new () => { readonly scheduledPayloads: readonly Record<string, unknown>[] }) | undefined;
    const FakeClock = Reflect.get(testing, "FakeClock") as
      (new (instant: string) => { set(instant: string): void }) | undefined;
    const FakeIdentifierGenerator = Reflect.get(testing, "FakeIdentifierGenerator") as
      (new (values: readonly string[]) => unknown) | undefined;
    if (
      RequestObservation === undefined ||
      FakeObservationProfileRepository === undefined ||
      FakeCallAttemptRepository === undefined ||
      FakeObservationJobScheduler === undefined ||
      FakeClock === undefined ||
      FakeIdentifierGenerator === undefined
    ) {
      throw new Error("Phase 3 observation request workflow is not implemented");
    }

    const observationProfile = profile();
    const profiles = new FakeObservationProfileRepository([observationProfile]);
    const attempts = new FakeCallAttemptRepository();
    const scheduler = new FakeObservationJobScheduler();
    const clock = new FakeClock("2026-08-06T13:00:00.000Z");
    const useCase = new RequestObservation({
      profiles,
      attempts,
      scheduler,
      clock,
      identifiers: new FakeIdentifierGenerator([
        "operation_established",
        "operation_retry_candidate",
      ]),
    });
    const common = {
      organizationId: observationProfile.organizationId,
      endpointId: observationProfile.endpointId,
      pollWindowId: "poll_window_2026_08_06_13",
      idempotencyKey: "idempotency_phase3_request",
      correlationId: "correlation_phase3_request",
      traceContext: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    };

    const original = await useCase.execute({ ...common, trigger: "manual" });
    clock.set("2026-08-06T13:01:00.000Z");
    const replay = await useCase.execute({ ...common, trigger: "scheduled" });

    expect(original).toMatchObject({
      outcome: "established",
      operation: { id: "operation_established", acceptedAt: "2026-08-06T13:00:00.000Z" },
    });
    expect(replay).toMatchObject({
      outcome: "replayed",
      operation: { id: "operation_established", acceptedAt: "2026-08-06T13:00:00.000Z" },
    });
    expect(attempts.attempts).toHaveLength(1);
    expect(scheduler.scheduledPayloads).toHaveLength(2);
    expect(scheduler.scheduledPayloads.map(({ operationId }) => operationId)).toEqual([
      "operation_established",
      "operation_established",
    ]);
  });
});
