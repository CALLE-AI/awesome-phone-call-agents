import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";

import { GetFleetHealth } from "./get-fleet-health.js";

describe("SIMULATED operational consumer isolation", () => {
  it("AC-HAPPY-7 displays the simulated attempt but excludes it from production health and incidents", async () => {
    const organizationId = OrganizationId.create("org-simulated-consumer-isolation");
    const incidentSummaries = {
      listForEndpoints: vi.fn(async () => [
        {
          endpointId: "endpoint-simulated",
          incident: {
            status: "open",
            incidentId: "INC-SHOULD-NOT-EXIST",
            displayLabel: "Synthetic incident",
            openedAt: "2026-08-24T20:00:00.000Z",
            detailPath: "/incidents/synthetic",
          },
        },
      ]),
    };
    const result = await new GetFleetHealth({
      fleetHealthRepository: {
        listFacts: vi.fn(async () => [
          {
            endpointId: "endpoint-simulated",
            siteDisplayName: "Hackathon lab",
            endpointDisplayName: "Synthetic greenhouse",
            provenance: "SIMULATED" as const,
            freshnessWindowSeconds: 900,
            lastAttempt: {
              operationId: "operation-simulated-terminal",
              resourceVersion: 7,
              trigger: "manual" as const,
              provenance: "SIMULATED" as const,
              acceptedAt: "2026-08-24T20:00:00.000Z",
              lastTransitionAt: "2026-08-24T20:00:07.000Z",
              stage: "terminal" as const,
              terminalOutcome: "observation_recorded" as const,
              retryable: false,
              observationQuality: "complete" as const,
            },
            latestTerminalAttempt: {
              operationId: "operation-simulated-terminal",
              acceptedAt: "2026-08-24T20:00:00.000Z",
              terminalOutcome: "observation_recorded" as const,
              observationQuality: "complete" as const,
            },
            lastCompleteObservation: {
              observationId: "observation-simulated-terminal",
              operationId: "operation-simulated-terminal",
              originatingAttemptAcceptedAt: "2026-08-24T20:00:00.000Z",
              version: 1,
              observedAt: "2026-08-24T20:00:06.000Z",
              completedAt: "2026-08-24T20:00:07.000Z",
              provenance: "SIMULATED" as const,
              evidenceId: "evidence-simulated-terminal",
              adapterVersionId: "adapter-simulated",
              extractorVersionId: "extractor-simulated",
              reconciliationPolicyVersion: "reconciliation-simulated",
              quality: "complete" as const,
            },
            activeManualOperation: null,
          },
        ]),
      },
      schedulerHeartbeat: { readLatest: vi.fn(async () => null) },
      incidentSummaries,
      clock: { now: () => "2026-08-24T20:01:00.000Z" },
      heartbeatMaxAgeSeconds: 900,
    }).execute(organizationId);

    expect(result.endpoints).toEqual([
      expect.objectContaining({
        provenance: "SIMULATED",
        lastAttempt: expect.objectContaining({ operationId: "operation-simulated-terminal" }),
        operationalState: "not_observed",
        freshness: expect.objectContaining({ status: "not_observed", observedAt: null }),
        incident: { status: "unavailable" },
      }),
    ]);
    expect(incidentSummaries.listForEndpoints).toHaveBeenCalledWith(organizationId, []);
  });
});
