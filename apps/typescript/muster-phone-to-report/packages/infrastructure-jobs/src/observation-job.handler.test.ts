import { describe, expect, it, vi } from "vitest";

import type { ObservationJobPayload } from "@muster/contracts";
import { CallAttempt, OrganizationId } from "@muster/domain";

describe("ObservationJobHandler", () => {
  it("preserves the W3C carrier at the consumer boundary and returns the durable terminal result", async () => {
    const jobs = await import("./index.js");
    const ObservationJobHandler = Reflect.get(jobs, "ObservationJobHandler") as
      | (new (
          runner: Record<string, unknown>,
          traceBoundary: Record<string, unknown>,
        ) => {
          handle(
            payload: ObservationJobPayload,
            context: { readonly retryCount: number; readonly retryLimit: number },
          ): Promise<Record<string, unknown>>;
        })
      | undefined;
    if (ObservationJobHandler === undefined) {
      throw new Error("Phase 3 observation job handler is not implemented");
    }
    const payload: ObservationJobPayload = {
      version: "1",
      organizationId: "org_job_handler",
      operationId: "operation_job_handler",
      correlationId: "correlation_job_handler",
      traceContext: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=opaque",
      },
    };
    const executeJob = vi.fn(async () =>
      CallAttempt.establish({
        id: "operation_job_handler",
        organizationId: OrganizationId.create("org_job_handler"),
        endpointId: "endpoint_job_handler",
        adapterVersionId: "adapter_job_handler",
        trigger: "scheduled",
        provenance: "SIMULATED",
        semanticFingerprint: "fingerprint_job_handler",
        providerDispatchIdentity: "provider_dispatch_job_handler",
        acceptedAt: "2026-08-06T14:29:00.000Z",
      })
        .transitionToCalling("2026-08-06T14:29:30.000Z")
        .transitionToTerminal({
          outcome: "no_answer",
          retryable: false,
          transitionedAt: "2026-08-06T14:30:00.000Z",
        }),
    );
    const observedPayloads: ObservationJobPayload[] = [];
    const traceBoundary = {
      run: async (received: ObservationJobPayload, operation: () => Promise<unknown>) => {
        observedPayloads.push(received);
        return await operation();
      },
    };

    const result = await new ObservationJobHandler({ executeJob }, traceBoundary).handle(payload, {
      retryCount: 1,
      retryLimit: 2,
    });

    expect(observedPayloads).toEqual([payload]);
    expect(executeJob).toHaveBeenCalledWith(payload, {
      attemptNumber: 2,
      finalAttempt: false,
    });
    expect(result).toEqual({
      version: "1",
      operationId: "operation_job_handler",
      stage: "terminal",
      terminalOutcome: "no_answer",
      completedAt: "2026-08-06T14:30:00.000Z",
    });
  });

  it("marks the exhausted pg-boss delivery as the final application attempt", async () => {
    const jobs = await import("./index.js");
    const ObservationJobHandler = Reflect.get(jobs, "ObservationJobHandler") as
      | (new (runner: Record<string, unknown>) => {
          handle(
            payload: ObservationJobPayload,
            context: { readonly retryCount: number; readonly retryLimit: number },
          ): Promise<Record<string, unknown>>;
        })
      | undefined;
    if (ObservationJobHandler === undefined) {
      throw new Error("Phase 3 observation job handler is not implemented");
    }
    const payload: ObservationJobPayload = {
      version: "1",
      organizationId: "org_job_exhausted",
      operationId: "operation_job_exhausted",
      correlationId: "correlation_job_exhausted",
    };
    const terminal = CallAttempt.establish({
      id: payload.operationId,
      organizationId: OrganizationId.create(payload.organizationId),
      endpointId: "endpoint_job_exhausted",
      adapterVersionId: "adapter_job_exhausted",
      trigger: "scheduled",
      provenance: "SIMULATED",
      semanticFingerprint: "fingerprint_job_exhausted",
      providerDispatchIdentity: "provider_dispatch_job_exhausted",
      acceptedAt: "2026-08-06T16:10:00.000Z",
    })
      .transitionToCalling("2026-08-06T16:10:01.000Z")
      .transitionToTerminal({
        outcome: "provider_failed",
        retryable: true,
        transitionedAt: "2026-08-06T16:10:02.000Z",
      });
    const executeJob = vi.fn(async () => terminal);

    await new ObservationJobHandler({ executeJob }).handle(payload, {
      retryCount: 2,
      retryLimit: 2,
    });

    expect(executeJob).toHaveBeenCalledWith(payload, {
      attemptNumber: 3,
      finalAttempt: true,
    });
  });
});
