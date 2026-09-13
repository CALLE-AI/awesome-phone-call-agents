import { describe, expect, it } from "vitest";

describe("Observation", () => {
  // Test strategy: prove a derivation version owns a complete immutable reconciled-zone set
  // with exact source lineage. Persistence and latest-version projection are later phases.
  it("preserves immutable reading provenance and requires explicit correction lineage", async () => {
    const { Observation, Reading } = await import("../index.js");
    const reading = Reading.create({
      zoneId: "zone-01",
      ordinal: 0,
      disposition: "grounded",
      value: "71.5",
      spokenUnit: "degrees fahrenheit",
      normalizedUnit: "degF",
      confidenceToken: "reviewed_exact",
      confidenceSemanticsVersion: "simulated-confidence.v1",
      candidateIds: ["candidate_001"],
      evidenceAnchorIds: ["anchor_001"],
      reasonCodes: [],
      evidenceId: "evidence_001",
      evidenceRevisionId: "provider_revision_001",
      providerRunId: "provider_run_001",
      adapterVersionId: "adapter_version_001",
      extractorVersionId: "extractor_version_001",
      sourceCapturedAt: "2026-08-05T20:00:01.000Z",
      derivedAt: "2026-08-05T20:00:03.000Z",
    });
    const first = Observation.create({
      id: "observation_001",
      operationId: "operation_001",
      version: 1,
      predecessorObservationId: null,
      createdAt: "2026-08-05T20:00:03.000Z",
      evidenceId: "evidence_001",
      evidenceRevisionId: "provider_revision_001",
      adapterVersionId: "adapter_version_001",
      extractorVersionId: "extractor_version_001",
      reconciliationPolicyVersion: "reconciliation_policy_v1",
      provenance: "SIMULATED",
      quality: "complete",
      inputFingerprint: "input_fingerprint_v1_001",
      readings: [reading],
    });
    const correction = Observation.create({
      ...first.toValue(),
      id: "observation_002",
      version: 2,
      predecessorObservationId: first.id,
      evidenceId: "evidence_002",
      evidenceRevisionId: "provider_revision_002",
      inputFingerprint: "input_fingerprint_v1_002",
      createdAt: "2026-08-05T20:05:03.000Z",
      readings: [
        Reading.create({
          ...reading.toValue(),
          value: "72.0",
          evidenceId: "evidence_002",
          evidenceRevisionId: "provider_revision_002",
          derivedAt: "2026-08-05T20:05:03.000Z",
        }),
      ],
    });

    expect(first.readings[0]).toMatchObject({
      value: "71.5",
      evidenceId: "evidence_001",
      providerRunId: "provider_run_001",
      disposition: "grounded",
    });
    expect(correction).toMatchObject({
      version: 2,
      predecessorObservationId: "observation_001",
      evidenceId: "evidence_002",
    });
    expect(first.readings[0]?.value).toBe("71.5");
    expect(Object.isFrozen(first.readings)).toBe(true);
    expect(Object.isFrozen(first.readings[0])).toBe(true);
    expect(() =>
      Observation.create({
        ...first.toValue(),
        id: "observation_bad_lineage",
        version: 2,
        predecessorObservationId: null,
      }),
    ).toThrowError("Observation versions after 1 require a predecessorObservationId");
  });
});
