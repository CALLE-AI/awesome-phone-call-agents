import { describe, expect, it } from "vitest";

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function withExactCorrelation<
  T extends {
    readonly operationId: string;
    readonly adapterVersionId: string;
    readonly provenance: string;
    readonly evidence: object;
    readonly candidates: readonly object[] | null;
  },
>(input: T): T {
  return {
    ...input,
    evidence: {
      ...input.evidence,
      callAttemptId: input.operationId,
      adapterVersionId: input.adapterVersionId,
      provenance: input.provenance,
    },
    candidates:
      input.candidates === null
        ? null
        : input.candidates.map((candidate) => ({
            ...candidate,
            callAttemptId: input.operationId,
            adapterVersionId: input.adapterVersionId,
            provenance: input.provenance,
          })),
  };
}

describe("reconcileObservation", () => {
  // Test strategy: the three cases exhaust the ratified completeness proof obligations:
  // source-specific happy path, every named uncertainty class, all four qualities,
  // no-observation admission, deterministic ordering, and an independent reviewed oracle.
  // Provider transport, persistence replay, threshold/normal policy, and live hardware are
  // deliberately not tested here.
  it("derives two distinct complete SIMULATED results from source fixtures before consulting the oracle", async () => {
    const { reconcileObservation } = await import("../index.js");
    const testing = await import("@muster/testing");

    const first = reconcileObservation(testing.OBSERVATION_SOURCE_FIXTURES[0]);
    const second = reconcileObservation(testing.OBSERVATION_SOURCE_FIXTURES[1]);
    const firstOracle = testing.OBSERVATION_REVIEWED_ORACLE.find(
      ({ fixtureId }: { readonly fixtureId: string }) => fixtureId === "simulated_complete_alpha",
    );
    const secondOracle = testing.OBSERVATION_REVIEWED_ORACLE.find(
      ({ fixtureId }: { readonly fixtureId: string }) => fixtureId === "simulated_complete_beta",
    );

    expect(first).toMatchObject({
      kind: "observation",
      quality: "complete",
      provenance: "SIMULATED",
    });
    expect(second).toMatchObject({
      kind: "observation",
      quality: "complete",
      provenance: "SIMULATED",
    });
    expect(
      first.kind === "observation"
        ? first.zones.map(
            ({ reading }: { readonly reading: { readonly value: string } | null }) =>
              reading?.value,
          )
        : [],
    ).toEqual(firstOracle?.values);
    expect(
      second.kind === "observation"
        ? second.zones.map(
            ({ reading }: { readonly reading: { readonly value: string } | null }) =>
              reading?.value,
          )
        : [],
    ).toEqual(secondOracle?.values);
    expect(first.kind === "observation" ? first.zones[0]?.reading?.value : null).not.toBe(
      second.kind === "observation" ? second.zones[0]?.reading?.value : null,
    );
    expect(
      first.kind === "observation" ? first.zones[0]?.reading?.evidenceAnchorIds : [],
    ).not.toEqual(second.kind === "observation" ? second.zones[0]?.reading?.evidenceAnchorIds : []);
    expect(JSON.stringify(testing.OBSERVATION_SOURCE_FIXTURES)).not.toContain("expectedQuality");
    expect(JSON.stringify(testing.OBSERVATION_SOURCE_FIXTURES)).not.toContain("reviewedOracle");
  });

  it("classifies every expected zone and prevents missing, ambiguous, contradictory, truncated, null, unexpected, and unsupported evidence from becoming complete", async () => {
    const { reconcileObservation } = await import("../index.js");
    const { OBSERVATION_SOURCE_FIXTURES } = await import("@muster/testing");
    const complete = cloneValue(OBSERVATION_SOURCE_FIXTURES[0]);
    const zoneOne = complete.candidates[0];
    const zoneTwo = complete.candidates[1];
    const cases = [
      {
        name: "missing",
        input: { ...cloneValue(complete), candidates: [cloneValue(zoneOne)] },
        quality: "partial",
        disposition: "missing",
      },
      {
        name: "ambiguous",
        input: {
          ...cloneValue(complete),
          candidates: [
            cloneValue(zoneOne),
            { ...cloneValue(zoneOne), candidateId: "candidate_duplicate" },
          ],
        },
        quality: "unknown",
        disposition: "ambiguous",
      },
      {
        name: "contradictory",
        input: {
          ...cloneValue(complete),
          candidates: [
            cloneValue(zoneOne),
            { ...cloneValue(zoneOne), candidateId: "candidate_conflict", value: "999.0" },
          ],
        },
        quality: "unknown",
        disposition: "contradictory",
      },
      {
        name: "truncated",
        input: {
          ...cloneValue(complete),
          evidence: { ...cloneValue(complete.evidence), sourceCompleteness: "truncated" },
        },
        quality: "partial",
        disposition: "ambiguous",
      },
      {
        name: "null",
        input: { ...cloneValue(complete), candidates: null },
        quality: "unknown",
        disposition: "missing",
      },
      {
        name: "unexpected",
        input: {
          ...cloneValue(complete),
          candidates: [
            cloneValue(zoneOne),
            cloneValue(zoneTwo),
            { ...cloneValue(zoneOne), candidateId: "candidate_unexpected", zoneId: "zone-03" },
          ],
        },
        quality: "partial",
        disposition: "grounded",
      },
      {
        name: "unsupported",
        input: {
          ...cloneValue(complete),
          candidates: [
            { ...cloneValue(zoneOne), confidenceSemanticsVersion: "unreviewed-confidence.v1" },
            cloneValue(zoneTwo),
          ],
        },
        quality: "partial",
        disposition: "ambiguous",
      },
      {
        name: "reviewed-not-applicable contradiction",
        input: {
          ...cloneValue(complete),
          expectedZones: [
            { ...cloneValue(complete.expectedZones[0]), applicability: "reviewed_not_applicable" },
            cloneValue(complete.expectedZones[1]),
          ],
        },
        quality: "partial",
        disposition: "contradictory",
      },
    ];

    for (const scenario of cases) {
      const result = reconcileObservation(scenario.input);

      expect(result, scenario.name).toMatchObject({
        kind: "observation",
        quality: scenario.quality,
      });
      expect(result.kind === "observation" ? result.zones : [], scenario.name).toHaveLength(2);
      expect(
        result.kind === "observation"
          ? result.zones.some(
              ({ disposition }: { readonly disposition: string }) =>
                disposition === scenario.disposition,
            )
          : false,
        scenario.name,
      ).toBe(true);
      expect(result.kind === "observation" && result.quality === "complete", scenario.name).toBe(
        false,
      );
      if (result.kind === "observation") {
        for (const zone of result.zones) {
          if (zone.disposition !== "grounded") {
            expect(zone.reading, scenario.name).toBeNull();
          }
        }
      }
    }
  });

  it("returns invalid for corrupt contracts, no observation for unavailable evidence, and byte-stable output for permutations", async () => {
    const { reconcileObservation } = await import("../index.js");
    const { OBSERVATION_SOURCE_FIXTURES } = await import("@muster/testing");
    const complete = cloneValue(OBSERVATION_SOURCE_FIXTURES[0]);
    const invalid = reconcileObservation({
      ...cloneValue(complete),
      candidates: [
        {
          ...cloneValue(complete.candidates[0]),
          providerRunId: "cross_run_reference",
        },
      ],
    });
    const unavailable = reconcileObservation({
      ...cloneValue(complete),
      evidence: { ...cloneValue(complete.evidence), availability: "unavailable" },
    });
    const permuted = reconcileObservation({
      ...cloneValue(complete),
      expectedZones: [...complete.expectedZones].reverse(),
      candidates: [...complete.candidates].reverse(),
      evidence: {
        ...cloneValue(complete.evidence),
        admittedAnchors: [...complete.evidence.admittedAnchors].reverse(),
      },
    });
    const original = reconcileObservation(complete);

    expect(invalid).toMatchObject({ kind: "observation", quality: "invalid" });
    expect(unavailable).toEqual({
      kind: "no_observation",
      reason: "evidence_unavailable",
    });
    expect(JSON.stringify(permuted)).toBe(JSON.stringify(original));
    expect(Object.isFrozen(original)).toBe(true);
  });

  it("rejects caller-controlled provenance and cross-attempt or cross-adapter attribution before emitting readings", async () => {
    const { reconcileObservation } = await import("../index.js");
    const { OBSERVATION_SOURCE_FIXTURES } = await import("@muster/testing");
    const complete = withExactCorrelation(cloneValue(OBSERVATION_SOURCE_FIXTURES[0]));
    const scenarios = [
      {
        name: "evidence provenance",
        diagnostic: "EVIDENCE_PROVENANCE_MISMATCH",
        input: { ...complete, provenance: "PROVIDER_OBSERVED" },
      },
      {
        name: "evidence call attempt",
        diagnostic: "EVIDENCE_CALL_ATTEMPT_MISMATCH",
        input: {
          ...complete,
          evidence: { ...complete.evidence, callAttemptId: "operation_cross_attribution" },
        },
      },
      {
        name: "evidence adapter",
        diagnostic: "EVIDENCE_ADAPTER_MISMATCH",
        input: {
          ...complete,
          evidence: { ...complete.evidence, adapterVersionId: "adapter_version_cross_attribution" },
        },
      },
      {
        name: "candidate provenance",
        diagnostic: "CANDIDATE_PROVENANCE_MISMATCH",
        input: {
          ...complete,
          candidates: complete.candidates?.map((candidate, index) =>
            index === 0 ? { ...candidate, provenance: "PROVIDER_OBSERVED" } : candidate,
          ),
        },
      },
      {
        name: "candidate call attempt",
        diagnostic: "CANDIDATE_CALL_ATTEMPT_MISMATCH",
        input: {
          ...complete,
          candidates: complete.candidates?.map((candidate, index) =>
            index === 0
              ? { ...candidate, callAttemptId: "operation_cross_attribution" }
              : candidate,
          ),
        },
      },
      {
        name: "candidate adapter",
        diagnostic: "CANDIDATE_ADAPTER_MISMATCH",
        input: {
          ...complete,
          candidates: complete.candidates?.map((candidate, index) =>
            index === 0
              ? { ...candidate, adapterVersionId: "adapter_version_cross_attribution" }
              : candidate,
          ),
        },
      },
    ];

    for (const scenario of scenarios) {
      const result = reconcileObservation(scenario.input);

      expect(result, scenario.name).toMatchObject({ kind: "observation", quality: "invalid" });
      expect(result.kind === "observation" ? result.diagnostics : [], scenario.name).toContain(
        scenario.diagnostic,
      );
      expect(
        result.kind === "observation"
          ? result.zones.every(
              ({ reading }: { readonly reading: object | null }) => reading === null,
            )
          : false,
        scenario.name,
      ).toBe(true);
      expect(result.kind === "observation" && result.quality === "complete", scenario.name).toBe(
        false,
      );
      expect(result.kind === "observation" ? result.provenance : null, scenario.name).toBe(
        "SIMULATED",
      );
    }
  });

  it("handles reviewed-not-applicable and unknown source completeness with exact dispositions", async () => {
    const { reconcileObservation } = await import("../index.js");
    const { OBSERVATION_SOURCE_FIXTURES } = await import("@muster/testing");
    const complete = withExactCorrelation(cloneValue(OBSERVATION_SOURCE_FIXTURES[0]));
    const reviewedNotApplicable = reconcileObservation({
      ...complete,
      expectedZones: [
        { ...complete.expectedZones[0], applicability: "reviewed_not_applicable" },
        complete.expectedZones[1],
      ],
      candidates: complete.candidates?.slice(1),
    });
    const unknownSource = reconcileObservation({
      ...complete,
      evidence: { ...complete.evidence, sourceCompleteness: "unknown" },
    });

    expect(reviewedNotApplicable).toMatchObject({ kind: "observation", quality: "complete" });
    expect(
      reviewedNotApplicable.kind === "observation" ? reviewedNotApplicable.zones[0] : null,
    ).toMatchObject({
      zoneId: "zone-01",
      disposition: "reviewed_not_applicable",
      reading: null,
      reasonCodes: ["REVIEWED_NOT_APPLICABLE"],
    });
    expect(unknownSource).toMatchObject({ kind: "observation", quality: "unknown" });
    expect(
      unknownSource.kind === "observation"
        ? unknownSource.zones.map(
            ({ disposition }: { readonly disposition: string }) => disposition,
          )
        : [],
    ).toEqual(["ambiguous", "ambiguous"]);
    expect(unknownSource.kind === "observation" ? unknownSource.diagnostics : []).toEqual([
      "SOURCE_COMPLETENESS_UNKNOWN",
    ]);
  });

  it("makes case mismatch, duplicate identities, and missing anchors explicit and non-complete", async () => {
    const { reconcileObservation } = await import("../index.js");
    const { OBSERVATION_SOURCE_FIXTURES } = await import("@muster/testing");
    const complete = withExactCorrelation(cloneValue(OBSERVATION_SOURCE_FIXTURES[0]));
    const firstCandidate = complete.candidates?.[0];
    const firstAnchor = complete.evidence.admittedAnchors[0];
    if (firstCandidate === undefined || firstAnchor === undefined) {
      throw new Error("reviewed fixture must contain a first candidate and anchor");
    }
    const scenarios = [
      {
        name: "case mismatch",
        input: {
          ...complete,
          candidates: [{ ...firstCandidate, zoneId: "Zone-01" }],
        },
        quality: "unknown",
        disposition: "missing",
        diagnostics: ["EXPECTED_ZONE_MISSING", "UNEXPECTED_CANDIDATE"],
      },
      {
        name: "duplicate candidate id",
        input: {
          ...complete,
          candidates: [firstCandidate, { ...firstCandidate }],
        },
        quality: "invalid",
        disposition: "invalid",
        diagnostics: ["DUPLICATE_CANDIDATE_ID"],
      },
      {
        name: "duplicate anchor id",
        input: {
          ...complete,
          evidence: {
            ...complete.evidence,
            admittedAnchors: [firstAnchor, { ...firstAnchor }],
          },
        },
        quality: "invalid",
        disposition: "invalid",
        diagnostics: ["DUPLICATE_EVIDENCE_ANCHOR_ID"],
      },
      {
        name: "missing anchor",
        input: {
          ...complete,
          candidates: [
            { ...firstCandidate, sourceAnchorIds: ["anchor_missing"] },
            complete.candidates?.[1],
          ].filter(
            (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
          ),
        },
        quality: "invalid",
        disposition: "invalid",
        diagnostics: ["INVALID_EVIDENCE_ANCHOR"],
      },
    ];

    for (const scenario of scenarios) {
      const result = reconcileObservation(scenario.input);

      expect(result, scenario.name).toMatchObject({
        kind: "observation",
        quality: scenario.quality,
      });
      expect(
        result.kind === "observation"
          ? result.zones.some(
              ({ disposition }: { readonly disposition: string }) =>
                disposition === scenario.disposition,
            )
          : false,
        scenario.name,
      ).toBe(true);
      expect(result.kind === "observation" ? result.diagnostics : [], scenario.name).toEqual(
        scenario.diagnostics,
      );
      expect(result.kind === "observation" && result.quality === "complete", scenario.name).toBe(
        false,
      );
    }
  });

  it("classifies unavailable or contradictory unit policy, pinned range violations, and zero inventory exactly", async () => {
    const { reconcileObservation } = await import("../index.js");
    const { OBSERVATION_SOURCE_FIXTURES } = await import("@muster/testing");
    const complete = withExactCorrelation(cloneValue(OBSERVATION_SOURCE_FIXTURES[0]));
    const firstCandidate = complete.candidates?.[0];
    if (firstCandidate === undefined) {
      throw new Error("reviewed fixture must contain a first candidate");
    }
    const scenarios = [
      {
        name: "unit mapping unavailable",
        input: {
          ...complete,
          candidates: [
            { ...firstCandidate, unitMappingRuleId: "unit_rule_unavailable" },
            complete.candidates?.[1],
          ].filter(
            (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
          ),
        },
        quality: "partial",
        disposition: "ambiguous",
        diagnostics: ["UNIT_MAPPING_UNSUPPORTED"],
      },
      {
        name: "unit mapping contradiction",
        input: {
          ...complete,
          candidates: [
            { ...firstCandidate, normalizedUnit: "degC" },
            complete.candidates?.[1],
          ].filter(
            (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
          ),
        },
        quality: "invalid",
        disposition: "invalid",
        diagnostics: ["UNIT_MAPPING_CONTRADICTION"],
      },
      {
        name: "pinned range violation",
        input: {
          ...complete,
          expectedZones: [
            { ...complete.expectedZones[0], admissibleRange: { minimum: "0", maximum: "70" } },
            complete.expectedZones[1],
          ],
        },
        quality: "invalid",
        disposition: "invalid",
        diagnostics: ["PINNED_RANGE_VIOLATION"],
      },
      {
        name: "zero expected zones",
        input: { ...complete, expectedZones: [] },
        quality: "invalid",
        disposition: null,
        diagnostics: ["INVALID_EXPECTED_ZONE_INVENTORY", "UNEXPECTED_CANDIDATE"],
      },
    ];

    for (const scenario of scenarios) {
      const result = reconcileObservation(scenario.input);

      expect(result, scenario.name).toMatchObject({
        kind: "observation",
        quality: scenario.quality,
      });
      expect(result.kind === "observation" ? result.diagnostics : [], scenario.name).toEqual(
        scenario.diagnostics,
      );
      if (scenario.disposition !== null) {
        expect(
          result.kind === "observation"
            ? result.zones.some(
                ({ disposition }: { readonly disposition: string }) =>
                  disposition === scenario.disposition,
              )
            : false,
          scenario.name,
        ).toBe(true);
      } else {
        expect(result.kind === "observation" ? result.zones : [], scenario.name).toEqual([]);
      }
      expect(result.kind === "observation" && result.quality === "complete", scenario.name).toBe(
        false,
      );
    }
  });

  it("validates unexpected and duplicate candidate contracts before grouping or ambiguity reduction", async () => {
    const { reconcileObservation } = await import("../index.js");
    const { OBSERVATION_SOURCE_FIXTURES } = await import("@muster/testing");
    const complete = withExactCorrelation(cloneValue(OBSERVATION_SOURCE_FIXTURES[0]));
    const firstCandidate = complete.candidates?.[0];
    const secondCandidate = complete.candidates?.[1];
    if (firstCandidate === undefined || secondCandidate === undefined) {
      throw new Error("reviewed fixture must contain two candidates");
    }
    const duplicateClaims = (changes: Readonly<Record<string, unknown>>): readonly object[] => [
      { ...firstCandidate, ...changes, candidateId: "candidate_invalid_duplicate_a" },
      { ...firstCandidate, ...changes, candidateId: "candidate_invalid_duplicate_b" },
      secondCandidate,
    ];
    const scenarios = [
      {
        name: "unexpected cross-run candidate",
        input: {
          ...complete,
          candidates: [
            ...(complete.candidates ?? []),
            {
              ...firstCandidate,
              candidateId: "candidate_unexpected_cross_run",
              zoneId: "zone-03",
              providerRunId: "provider_run_cross_attribution",
            },
          ],
        },
        diagnostics: ["CANDIDATE_PROVIDER_RUN_MISMATCH", "UNEXPECTED_CANDIDATE"],
      },
      {
        name: "unexpected cross-revision candidate",
        input: {
          ...complete,
          candidates: [
            ...(complete.candidates ?? []),
            {
              ...firstCandidate,
              candidateId: "candidate_unexpected_cross_revision",
              zoneId: "zone-03",
              evidenceRevisionId: "evidence_revision_cross_attribution",
            },
          ],
        },
        diagnostics: ["CANDIDATE_EVIDENCE_REVISION_MISMATCH", "UNEXPECTED_CANDIDATE"],
      },
      {
        name: "duplicate malformed decimal claims",
        input: { ...complete, candidates: duplicateClaims({ value: "not-a-decimal" }) },
        diagnostics: ["INVALID_CANDIDATE_CONTRACT"],
      },
      {
        name: "duplicate invalid anchor claims",
        input: {
          ...complete,
          candidates: duplicateClaims({ sourceAnchorIds: ["anchor_missing"] }),
        },
        diagnostics: ["INVALID_EVIDENCE_ANCHOR"],
      },
      {
        name: "duplicate contradictory unit claims",
        input: { ...complete, candidates: duplicateClaims({ normalizedUnit: "degC" }) },
        diagnostics: ["UNIT_MAPPING_CONTRADICTION"],
      },
      {
        name: "duplicate pinned-range violations",
        input: {
          ...complete,
          expectedZones: [
            {
              ...complete.expectedZones[0],
              admissibleRange: { minimum: "0", maximum: "70" },
            },
            complete.expectedZones[1],
          ],
          candidates: duplicateClaims({}),
        },
        diagnostics: ["PINNED_RANGE_VIOLATION"],
      },
    ];

    for (const scenario of scenarios) {
      const result = reconcileObservation(scenario.input);

      expect(result, scenario.name).toMatchObject({ kind: "observation", quality: "invalid" });
      expect(result.kind === "observation" ? result.diagnostics : [], scenario.name).toEqual(
        scenario.diagnostics,
      );
      expect(
        result.kind === "observation"
          ? result.zones.some(
              ({ disposition }: { readonly disposition: string }) => disposition === "invalid",
            )
          : false,
        scenario.name,
      ).toBe(true);
      expect(
        result.kind === "observation"
          ? result.zones.some(
              ({ disposition }: { readonly disposition: string }) =>
                disposition === "ambiguous" || disposition === "contradictory",
            )
          : false,
        scenario.name,
      ).toBe(false);
    }
  });
});
