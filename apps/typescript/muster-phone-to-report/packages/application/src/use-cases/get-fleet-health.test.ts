import { OrganizationId } from "@muster/domain";
import { describe, expect, it, vi } from "vitest";

interface GetFleetHealthModule {
  readonly GetFleetHealth?: new (dependencies: {
    readonly fleetHealthRepository: {
      listFacts(organizationId: OrganizationId): Promise<readonly unknown[]>;
    };
    readonly schedulerHeartbeat: { readLatest(organizationId: OrganizationId): Promise<unknown> };
    readonly incidentSummaries: {
      listForEndpoints(
        organizationId: OrganizationId,
        endpointIds: readonly string[],
      ): Promise<readonly unknown[]>;
    };
    readonly clock: { now(): string };
    readonly heartbeatMaxAgeSeconds: number;
  }) => { execute(organizationId: OrganizationId): Promise<unknown> };
}

async function loadGetFleetHealth(): Promise<NonNullable<GetFleetHealthModule["GetFleetHealth"]>> {
  const loaded = (await import("../index.js")) as GetFleetHealthModule;
  if (loaded.GetFleetHealth === undefined) {
    throw new Error("GetFleetHealth is not implemented");
  }
  return loaded.GetFleetHealth;
}

describe("GetFleetHealth", () => {
  // Test strategy: cover organization scoping, stable presentation ordering, explicit optional-
  // dependency availability, and canonical domain projection in one composed application proof.
  // Prisma selection and HTTP serialization are deliberately tested at their own boundaries.
  it("composes stable organization-scoped endpoint, heartbeat, and incident projections without promoting unavailable evidence", async () => {
    const GetFleetHealth = await loadGetFleetHealth();
    const organizationId = OrganizationId.create("org_fleet_application_001");
    const fleetHealthRepository = {
      listFacts: vi.fn().mockResolvedValue([
        {
          endpointId: "endpoint_zeta",
          siteDisplayName: "Warehouse",
          endpointDisplayName: "Zulu monitor",
          provenance: "SIMULATED",
          freshnessWindowSeconds: 900,
          lastAttempt: null,
          latestTerminalAttempt: null,
          lastCompleteObservation: null,
          activeManualOperation: null,
        },
        {
          endpointId: "endpoint_alpha",
          siteDisplayName: "Campus",
          endpointDisplayName: "Alpha monitor",
          provenance: "PROVIDER_OBSERVED",
          freshnessWindowSeconds: 900,
          lastAttempt: {
            operationId: "operation_alpha",
            resourceVersion: 4,
            trigger: "manual",
            provenance: "PROVIDER_OBSERVED",
            acceptedAt: "2026-08-08T12:00:00.000Z",
            lastTransitionAt: "2026-08-08T12:00:06.000Z",
            stage: "terminal",
            terminalOutcome: "observation_recorded",
            retryable: false,
            observationQuality: "complete",
          },
          latestTerminalAttempt: {
            operationId: "operation_alpha",
            acceptedAt: "2026-08-08T12:00:00.000Z",
            terminalOutcome: "observation_recorded",
            observationQuality: "complete",
          },
          lastCompleteObservation: {
            observationId: "observation_alpha",
            operationId: "operation_alpha",
            originatingAttemptAcceptedAt: "2026-08-08T12:00:00.000Z",
            version: 1,
            observedAt: "2026-08-08T12:00:05.000Z",
            completedAt: "2026-08-08T12:00:06.000Z",
            provenance: "PROVIDER_OBSERVED",
            evidenceId: "evidence_alpha",
            adapterVersionId: "adapter_alpha",
            extractorVersionId: "extractor_v1",
            reconciliationPolicyVersion: "reconciliation_v1",
            quality: "complete",
          },
          activeManualOperation: null,
        },
      ]),
    };
    const schedulerHeartbeat = {
      readLatest: vi.fn().mockRejectedValue(new Error("synthetic protected dependency detail")),
    };
    const incidentSummaries = {
      listForEndpoints: vi
        .fn()
        .mockResolvedValue([{ endpointId: "endpoint_alpha", incident: { status: "none" } }]),
    };

    const result = await new GetFleetHealth({
      fleetHealthRepository,
      schedulerHeartbeat,
      incidentSummaries,
      clock: { now: () => "2026-08-08T12:10:00.000Z" },
      heartbeatMaxAgeSeconds: 900,
    }).execute(organizationId);

    expect(fleetHealthRepository.listFacts).toHaveBeenCalledWith(organizationId);
    expect(schedulerHeartbeat.readLatest).toHaveBeenCalledWith(organizationId);
    expect(incidentSummaries.listForEndpoints).toHaveBeenCalledWith(organizationId, [
      "endpoint_alpha",
    ]);
    expect(result).toEqual({
      contractVersion: "1",
      generatedAt: "2026-08-08T12:10:00.000Z",
      schedulerHeartbeat: {
        status: "unavailable",
        observedAt: null,
        checkOutcome: null,
        evidenceKind: "foundation_health_job_completion",
      },
      endpoints: [
        expect.objectContaining({
          endpointId: "endpoint_alpha",
          operationalState: "normal_observed",
          incident: { status: "none" },
          provenance: "PROVIDER_OBSERVED",
        }),
        expect.objectContaining({
          endpointId: "endpoint_zeta",
          operationalState: "not_observed",
          incident: { status: "unavailable" },
          provenance: "SIMULATED",
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("synthetic protected");
  });

  it("classifies heartbeat boundaries and malformed instants deterministically", async () => {
    const GetFleetHealth = await loadGetFleetHealth();
    const organizationId = OrganizationId.create("org_fleet_heartbeat_001");
    const scenarios = [
      [{ observedAt: "2026-08-08T12:00:00.001Z", checkOutcome: "ready" }, "current"],
      [{ observedAt: "2026-08-08T12:00:00.001Z", checkOutcome: "degraded" }, "current"],
      [{ observedAt: "2026-08-08T12:00:00.000Z", checkOutcome: "ready" }, "stale"],
      [null, "missing"],
      [{ observedAt: "2026-08-08", checkOutcome: "ready" }, "unavailable"],
      [{ observedAt: "invalid", checkOutcome: "ready" }, "unavailable"],
      [{ observedAt: "2026-08-08T12:15:00.001Z", checkOutcome: "ready" }, "unavailable"],
    ] as const;
    for (const [heartbeat, status] of scenarios) {
      const result = await new GetFleetHealth({
        fleetHealthRepository: { listFacts: vi.fn().mockResolvedValue([]) },
        schedulerHeartbeat: { readLatest: vi.fn().mockResolvedValue(heartbeat) },
        incidentSummaries: { listForEndpoints: vi.fn().mockResolvedValue([]) },
        clock: { now: () => "2026-08-08T12:15:00.000Z" },
        heartbeatMaxAgeSeconds: 900,
      }).execute(organizationId);
      expect(result).toMatchObject({
        schedulerHeartbeat: {
          status,
          checkOutcome: status === "unavailable" ? null : (heartbeat?.checkOutcome ?? null),
        },
      });
    }
  });

  it("accepts only canonical safe open-incident summaries", async () => {
    const GetFleetHealth = await loadGetFleetHealth();
    const organizationId = OrganizationId.create("org_fleet_incident_001");
    const endpoint = {
      endpointId: "endpoint_incident",
      siteDisplayName: "Site",
      endpointDisplayName: "Endpoint",
      provenance: "PROVIDER_OBSERVED",
      freshnessWindowSeconds: 900,
      lastAttempt: null,
      latestTerminalAttempt: null,
      lastCompleteObservation: null,
      activeManualOperation: null,
    };
    const valid = {
      status: "open",
      incidentId: "INC-42",
      displayLabel: "Investigating",
      openedAt: "2026-08-08T12:00:00.000Z",
      detailPath: "/incidents/INC-42",
    };
    const invalid = [
      { ...valid, incidentId: " INC-42" },
      { ...valid, openedAt: "2026-08-08" },
      { ...valid, detailPath: "/\\evil.example/path" },
      { ...valid, detailPath: "/incidents/%2fadmin" },
      { ...valid, detailPath: "/incidents/../admin" },
      { ...valid, detailPath: `/incidents/INC-42${String.fromCharCode(0)}` },
    ];
    for (const [incident, status] of [
      [valid, "open"],
      ...invalid.map((value) => [value, "unavailable"]),
    ] as const) {
      const result = await new GetFleetHealth({
        fleetHealthRepository: { listFacts: vi.fn().mockResolvedValue([endpoint]) },
        schedulerHeartbeat: { readLatest: vi.fn().mockResolvedValue(null) },
        incidentSummaries: {
          listForEndpoints: vi
            .fn()
            .mockResolvedValue([{ endpointId: endpoint.endpointId, incident }]),
        },
        clock: { now: () => "2026-08-08T12:15:00.000Z" },
        heartbeatMaxAgeSeconds: 900,
      }).execute(organizationId);
      expect(result).toMatchObject({ endpoints: [{ incident: { status } }] });
    }
  });

  it("maps unknown, missing, null, and non-string incident members to unavailable without failing the fleet", async () => {
    const GetFleetHealth = await loadGetFleetHealth();
    const organizationId = OrganizationId.create("org_fleet_malformed_incident_001");
    const endpoint = {
      endpointId: "endpoint_malformed_incident",
      siteDisplayName: "Site",
      endpointDisplayName: "Endpoint",
      provenance: "PROVIDER_OBSERVED",
      freshnessWindowSeconds: 900,
      lastAttempt: null,
      latestTerminalAttempt: null,
      lastCompleteObservation: null,
      activeManualOperation: null,
    };
    const malformedIncidents: readonly unknown[] = [
      { status: "unknown" },
      { status: "open" },
      {
        status: "open",
        incidentId: null,
        displayLabel: "Incident",
        openedAt: "2026-08-08T12:00:00.000Z",
        detailPath: "/incidents/1",
      },
      {
        status: "open",
        incidentId: "INC-1",
        displayLabel: 42,
        openedAt: "2026-08-08T12:00:00.000Z",
        detailPath: "/incidents/1",
      },
      null,
      "open",
    ];
    for (const incident of malformedIncidents) {
      const result = await new GetFleetHealth({
        fleetHealthRepository: { listFacts: vi.fn().mockResolvedValue([endpoint]) },
        schedulerHeartbeat: { readLatest: vi.fn().mockResolvedValue(null) },
        incidentSummaries: {
          listForEndpoints: vi
            .fn()
            .mockResolvedValue([{ endpointId: endpoint.endpointId, incident }]),
        },
        clock: { now: () => "2026-08-08T12:15:00.000Z" },
        heartbeatMaxAgeSeconds: 900,
      }).execute(organizationId);
      expect(result).toMatchObject({ endpoints: [{ incident: { status: "unavailable" } }] });
    }
  });

  it("rejects malformed or noncanonical clock output before reading dependencies or emitting generatedAt", async () => {
    const GetFleetHealth = await loadGetFleetHealth();
    const organizationId = OrganizationId.create("org_fleet_invalid_clock_001");
    for (const now of ["not-an-instant", "2026-08-08"] as const) {
      const listFacts = vi.fn().mockResolvedValue([]);
      const execution = new GetFleetHealth({
        fleetHealthRepository: { listFacts },
        schedulerHeartbeat: { readLatest: vi.fn().mockResolvedValue(null) },
        incidentSummaries: { listForEndpoints: vi.fn().mockResolvedValue([]) },
        clock: { now: () => now },
        heartbeatMaxAgeSeconds: 900,
      }).execute(organizationId);
      await expect(execution).rejects.toMatchObject({
        kind: "unexpected",
        code: "unexpected_error",
        retryable: false,
      });
      expect(listFacts).not.toHaveBeenCalled();
    }
  });
});
