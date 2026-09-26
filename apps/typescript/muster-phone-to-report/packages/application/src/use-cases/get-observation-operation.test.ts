import { describe, expect, it } from "vitest";

import { OrganizationId } from "@muster/domain";

describe("GetObservationOperation", () => {
  it("returns monotonic scheduled/calling/extracting/terminal projections and conceals another organization", async () => {
    const application = await import("../index.js");
    const testing = await import("@muster/testing");
    const GetObservationOperation = Reflect.get(application, "GetObservationOperation") as
      | (new (dependencies: Record<string, unknown>) => {
          execute(input: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
        })
      | undefined;
    const FakeObservationRepository = Reflect.get(testing, "FakeObservationRepository") as
      | (new () => {
          setOperationProjection(
            organizationId: OrganizationId,
            projection: Record<string, unknown>,
          ): void;
        })
      | undefined;
    if (GetObservationOperation === undefined || FakeObservationRepository === undefined) {
      throw new Error("Phase 3 observation status workflow is not implemented");
    }
    const organizationId = OrganizationId.create("org_status");
    const otherOrganizationId = OrganizationId.create("org_status_other");
    const observations = new FakeObservationRepository();
    const useCase = new GetObservationOperation({ observations });
    const stages = ["scheduled", "calling", "extracting", "terminal"] as const;
    const seen: string[] = [];

    for (const [index, stage] of stages.entries()) {
      observations.setOperationProjection(organizationId, {
        contractVersion: "1",
        operationId: "operation_status",
        resourceVersion: index + 1,
        stage,
        terminal: stage === "terminal",
        lastTransitionAt: `2026-08-06T14:2${String(index)}:00.000Z`,
        latestRevisionAt: null,
        attempt: {
          trigger: "manual",
          provenance: "SIMULATED",
          acceptedAt: "2026-08-06T14:20:00.000Z",
          retryable: stage === "terminal" ? false : null,
        },
        terminalOutcome: stage === "terminal" ? "blocked" : null,
        evidence: null,
        observation: null,
        recommendedAction: stage === "terminal" ? "create_new_request_after_remediation" : "poll",
      });
      const projection = await useCase.execute({ organizationId, operationId: "operation_status" });
      seen.push(String(projection?.stage));
      expect(projection?.resourceVersion).toBe(index + 1);
    }

    expect(seen).toEqual(stages);
    await expect(
      useCase.execute({ organizationId: otherOrganizationId, operationId: "operation_status" }),
    ).resolves.toBeUndefined();
  });
});
