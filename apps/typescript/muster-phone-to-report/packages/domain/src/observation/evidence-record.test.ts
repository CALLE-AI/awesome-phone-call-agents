import { describe, expect, it } from "vitest";

describe("EvidenceRecord", () => {
  // Test strategy: verify immutable opaque source metadata and append-only revision lineage.
  // Protected payload custody, provider SDKs, and repository append behavior are out of scope.
  it("retains opaque SIMULATED revision lineage and rejects protected or malformed metadata", async () => {
    const { EvidenceRecord, OrganizationId } = await import("../index.js");
    const organizationId = OrganizationId.create("org_test_001");
    const first = EvidenceRecord.create({
      id: "evidence_001",
      revision: 1,
      predecessorEvidenceId: null,
      organizationId,
      callAttemptId: "operation_001",
      adapterVersionId: "adapter_version_001",
      providerRunId: "provider_run_opaque_001",
      providerRevisionId: "provider_revision_opaque_001",
      capturedAt: "2026-08-05T20:00:01.000Z",
      retainedAt: "2026-08-05T20:00:02.000Z",
      opaqueCustodyRef: "custody_ref_opaque_001",
      provenance: "SIMULATED",
      sourceCompleteness: "complete",
    });
    const correction = EvidenceRecord.create({
      ...first.toValue(),
      id: "evidence_002",
      revision: 2,
      predecessorEvidenceId: first.id,
      providerRevisionId: "provider_revision_opaque_002",
      retainedAt: "2026-08-05T20:05:00.000Z",
    });

    expect(first.predecessorEvidenceId).toBeNull();
    expect(correction).toMatchObject({
      revision: 2,
      predecessorEvidenceId: "evidence_001",
      provenance: "SIMULATED",
      opaqueCustodyRef: "custody_ref_opaque_001",
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.set(first, "opaqueCustodyRef", "rewritten")).toBe(false);
    expect(JSON.stringify(first)).not.toContain("transcript");

    expect(() =>
      EvidenceRecord.create({
        ...first.toValue(),
        id: "evidence_unsafe",
        rawPayload: "protected transcript content",
      }),
    ).toThrowError("EvidenceRecord contains unsupported or protected fields: rawPayload");
    expect(() =>
      EvidenceRecord.create({
        ...first.toValue(),
        id: "evidence_bad_lineage",
        revision: 2,
        predecessorEvidenceId: null,
      }),
    ).toThrowError("EvidenceRecord revisions after 1 require a predecessorEvidenceId");
    expect(() =>
      EvidenceRecord.create({
        ...first.toValue(),
        id: "evidence_retained_before_capture",
        retainedAt: "2026-08-05T20:00:00.999Z",
      }),
    ).toThrowError("EvidenceRecord retainedAt must not precede capturedAt");
  });
});
