import { describe, expect, it } from "vitest";

describe("CallAttempt", () => {
  // Test strategy: exercise the monotonic operation state machine and its client-safe
  // canonical states. Repository replay/concurrency and provider dispatch are later phases.
  it("returns new immutable values for legal transitions and rejects backward or terminal mutation", async () => {
    const domain = await import("../index.js");
    const contracts = await import("@muster/contracts");
    const scheduled = domain.CallAttempt.establish({
      id: "operation_001",
      organizationId: domain.OrganizationId.create("org_test_001"),
      endpointId: "endpoint_001",
      adapterVersionId: "adapter_version_001",
      trigger: "manual",
      provenance: "SIMULATED",
      semanticFingerprint: "request_fingerprint_v1_001",
      providerDispatchIdentity: "provider_dispatch_opaque_001",
      acceptedAt: "2026-08-05T20:00:00.000Z",
    });

    const calling = scheduled.transitionToCalling("2026-08-05T20:00:01.000Z");
    const extracting = calling.transitionToExtracting({
      evidenceId: "evidence_001",
      transitionedAt: "2026-08-05T20:00:02.000Z",
    });
    const terminal = extracting.transitionToTerminal({
      outcome: "observation_recorded",
      observationId: "observation_001",
      retryable: false,
      transitionedAt: "2026-08-05T20:00:03.000Z",
    });

    expect([scheduled.stage, calling.stage, extracting.stage, terminal.stage]).toEqual([
      "scheduled",
      "calling",
      "extracting",
      "terminal",
    ]);
    expect(scheduled).not.toBe(calling);
    expect(scheduled.stage).toBe("scheduled");
    expect(terminal).toMatchObject({
      id: "operation_001",
      terminalOutcome: "observation_recorded",
      latestEvidenceId: "evidence_001",
      latestObservationId: "observation_001",
      retryable: false,
    });
    expect(Object.isFrozen(terminal)).toBe(true);
    expect(() => calling.transitionToCalling("2026-08-05T20:00:02.000Z")).toThrowError(
      "Illegal CallAttempt transition from calling to calling",
    );
    expect(() =>
      terminal.transitionToExtracting({
        evidenceId: "evidence_late_001",
        transitionedAt: "2026-08-05T20:00:04.000Z",
      }),
    ).toThrowError("Illegal CallAttempt transition from terminal to extracting");
    expect(contracts.OBSERVATION_STAGES).toEqual([
      "scheduled",
      "calling",
      "extracting",
      "terminal",
    ]);
    expect(contracts.OBSERVATION_TERMINAL_OUTCOMES).toEqual([
      "observation_recorded",
      "blocked",
      "no_answer",
      "busy",
      "provider_failed",
      "evidence_unavailable",
    ]);
  });

  it("allows a re-evaluated safety block from calling but never from extracting or terminal", async () => {
    const domain = await import("../index.js");
    const scheduled = domain.CallAttempt.establish({
      id: "operation_calling_block",
      organizationId: domain.OrganizationId.create("org_calling_block"),
      endpointId: "endpoint_calling_block",
      adapterVersionId: "adapter_calling_block",
      trigger: "scheduled",
      provenance: "SIMULATED",
      semanticFingerprint: "fingerprint_calling_block",
      providerDispatchIdentity: "provider_dispatch_calling_block",
      acceptedAt: "2026-08-06T15:00:00.000Z",
    });
    const calling = scheduled.transitionToCalling("2026-08-06T15:00:01.000Z");
    const blocked = calling.transitionToTerminal({
      outcome: "blocked",
      retryable: false,
      transitionedAt: "2026-08-06T15:00:02.000Z",
    });
    const extracting = calling.transitionToExtracting({
      evidenceId: "evidence_calling_block",
      transitionedAt: "2026-08-06T15:00:02.000Z",
    });

    expect(blocked).toMatchObject({
      stage: "terminal",
      terminalOutcome: "blocked",
      retryable: false,
    });
    expect(() =>
      extracting.transitionToTerminal({
        outcome: "blocked",
        retryable: false,
        transitionedAt: "2026-08-06T15:00:03.000Z",
      }),
    ).toThrowError("blocked must be recorded before extracting");
    expect(() =>
      blocked.transitionToTerminal({
        outcome: "blocked",
        retryable: false,
        transitionedAt: "2026-08-06T15:00:03.000Z",
      }),
    ).toThrowError("Illegal CallAttempt transition from terminal to terminal");
  });
});
