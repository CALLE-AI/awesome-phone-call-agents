import type { ReconciliationInput } from "@muster/domain";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze(Reflect.get(value, key));
    }
    Object.freeze(value);
  }
  return value;
}

function createSourceFixture(input: {
  readonly suffix: "alpha" | "beta";
  readonly values: readonly [string, string];
}): ReconciliationInput {
  const providerRunId = `simulated_provider_run_${input.suffix}`;
  const evidenceRevisionId = `simulated_evidence_revision_${input.suffix}`;
  return deepFreeze({
    operationId: `simulated_operation_${input.suffix}`,
    adapterVersionId: "adapter_version_simulated_v1",
    extractorVersionId: "extractor_version_deterministic_v1",
    reconciliationPolicyVersion: "reconciliation_policy_v1",
    provenance: "SIMULATED",
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
      {
        zoneId: "zone-02",
        ordinal: 1,
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
    evidence: {
      evidenceId: `simulated_evidence_${input.suffix}`,
      evidenceRevisionId,
      providerRunId,
      callAttemptId: `simulated_operation_${input.suffix}`,
      adapterVersionId: "adapter_version_simulated_v1",
      provenance: "SIMULATED",
      availability: "available",
      sourceCompleteness: "complete",
      opaqueCustodyRef: `simulated_custody_ref_${input.suffix}`,
      capturedAt: "2026-08-05T20:00:01.000Z",
      admittedAnchors: [
        {
          anchorId: `simulated_anchor_${input.suffix}_zone_01`,
          providerRunId,
          evidenceRevisionId,
          valueToken: input.values[0],
          spokenUnitToken: "degrees fahrenheit",
          opaqueSourceRef: `simulated_source_ref_${input.suffix}_zone_01`,
          supportsTruncatedSource: false,
        },
        {
          anchorId: `simulated_anchor_${input.suffix}_zone_02`,
          providerRunId,
          evidenceRevisionId,
          valueToken: input.values[1],
          spokenUnitToken: "degrees fahrenheit",
          opaqueSourceRef: `simulated_source_ref_${input.suffix}_zone_02`,
          supportsTruncatedSource: true,
        },
      ],
    },
    candidates: [
      {
        candidateId: `simulated_candidate_${input.suffix}_zone_01`,
        zoneId: "zone-01",
        providerRunId,
        evidenceRevisionId,
        callAttemptId: `simulated_operation_${input.suffix}`,
        adapterVersionId: "adapter_version_simulated_v1",
        provenance: "SIMULATED",
        sourceAnchorIds: [`simulated_anchor_${input.suffix}_zone_01`],
        value: input.values[0],
        spokenUnit: "degrees fahrenheit",
        normalizedUnit: "degF",
        unitMappingRuleId: "unit_rule_fahrenheit_v1",
        confidenceToken: "reviewed_exact",
        confidenceSemanticsVersion: "simulated-confidence.v1",
      },
      {
        candidateId: `simulated_candidate_${input.suffix}_zone_02`,
        zoneId: "zone-02",
        providerRunId,
        evidenceRevisionId,
        callAttemptId: `simulated_operation_${input.suffix}`,
        adapterVersionId: "adapter_version_simulated_v1",
        provenance: "SIMULATED",
        sourceAnchorIds: [`simulated_anchor_${input.suffix}_zone_02`],
        value: input.values[1],
        spokenUnit: "degrees fahrenheit",
        normalizedUnit: "degF",
        unitMappingRuleId: "unit_rule_fahrenheit_v1",
        confidenceToken: "reviewed_exact",
        confidenceSemanticsVersion: "simulated-confidence.v1",
      },
    ],
    confidencePolicy: {
      semanticsVersion: "simulated-confidence.v1",
      acceptableTokens: ["reviewed_exact"],
    },
  } satisfies ReconciliationInput);
}

export const OBSERVATION_SOURCE_FIXTURES = Object.freeze([
  createSourceFixture({ suffix: "alpha", values: ["71.5", "68.0"] }),
  createSourceFixture({ suffix: "beta", values: ["73.25", "69.5"] }),
] as const);
