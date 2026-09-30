import type {
  ExpectedZone,
  ObservationProvenance,
  UnitMappingRule,
} from "./endpoint-observation-profile.js";
import type { EvidenceSourceCompleteness } from "./evidence-record.js";
import type { ObservationQuality, ReadingDisposition } from "./observation.js";

export interface EvidenceAnchor {
  readonly anchorId: string;
  readonly providerRunId: string;
  readonly evidenceRevisionId: string;
  readonly valueToken: string;
  readonly spokenUnitToken: string;
  readonly opaqueSourceRef: string;
  readonly supportsTruncatedSource: boolean;
}

export interface AdmittedEvidenceRevision {
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly providerRunId: string;
  readonly callAttemptId: string;
  readonly adapterVersionId: string;
  readonly provenance: ObservationProvenance;
  readonly availability: "available" | "unavailable";
  readonly sourceCompleteness: EvidenceSourceCompleteness;
  readonly opaqueCustodyRef: string;
  readonly capturedAt: string;
  readonly admittedAnchors: readonly EvidenceAnchor[];
}

export interface ExtractedCandidate {
  readonly candidateId: string;
  readonly zoneId: string;
  readonly providerRunId: string;
  readonly evidenceRevisionId: string;
  readonly callAttemptId: string;
  readonly adapterVersionId: string;
  readonly provenance: ObservationProvenance;
  readonly sourceAnchorIds: readonly string[];
  readonly value: string;
  readonly spokenUnit: string;
  readonly normalizedUnit: string | null;
  readonly unitMappingRuleId: string | null;
  readonly confidenceToken: string | null;
  readonly confidenceSemanticsVersion: string | null;
}

export interface ReconciliationConfidencePolicy {
  readonly semanticsVersion: string;
  readonly acceptableTokens: readonly string[];
}

export interface ReconciliationInput {
  readonly operationId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly reconciliationPolicyVersion: string;
  readonly provenance: ObservationProvenance;
  readonly expectedZones: readonly ExpectedZone[];
  readonly evidence: AdmittedEvidenceRevision;
  readonly candidates: readonly ExtractedCandidate[] | null;
  readonly confidencePolicy: ReconciliationConfidencePolicy;
}

export interface ReconciledReading {
  readonly value: string;
  readonly spokenUnit: string;
  readonly normalizedUnit: string;
  readonly confidenceToken: string;
  readonly confidenceSemanticsVersion: string;
  readonly candidateId: string;
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly providerRunId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly sourceCapturedAt: string;
  readonly evidenceAnchorIds: readonly string[];
}

export interface ReconciledZone {
  readonly zoneId: string;
  readonly ordinal: number;
  readonly disposition: ReadingDisposition;
  readonly reading: ReconciledReading | null;
  readonly candidateIds: readonly string[];
  readonly evidenceAnchorIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface UnexpectedCandidate {
  readonly zoneId: string;
  readonly candidateId: string;
}

export type ReconciliationOutcome =
  | Readonly<{ kind: "no_observation"; reason: "evidence_unavailable" }>
  | Readonly<{
      kind: "observation";
      quality: ObservationQuality;
      provenance: ObservationProvenance;
      zones: readonly ReconciledZone[];
      unexpectedCandidates: readonly UnexpectedCandidate[];
      diagnostics: readonly string[];
      inputFingerprint: string;
    }>;

const exactDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const forbiddenOracleFields = new Set(["expectedQuality", "reviewedOracle", "groundTruth"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze(Reflect.get(value, key));
    }
    Object.freeze(value);
  }
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function containsForbiddenOracleField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenOracleField);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) => forbiddenOracleFields.has(key) || containsForbiddenOracleField(child),
    );
  }
  return false;
}

function exactDecimalParts(
  value: string,
): { readonly negative: boolean; readonly digits: string; readonly scale: number } | null {
  if (!exactDecimalPattern.test(value)) {
    return null;
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    negative,
    digits: `${whole}${fraction}`.replace(/^0+(?=\d)/u, ""),
    scale: fraction.length,
  };
}

function compareExactDecimals(left: string, right: string): number | null {
  const leftParts = exactDecimalParts(left);
  const rightParts = exactDecimalParts(right);
  if (leftParts === null || rightParts === null) {
    return null;
  }
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftMagnitude = BigInt(leftParts.digits) * 10n ** BigInt(scale - leftParts.scale);
  const rightMagnitude = BigInt(rightParts.digits) * 10n ** BigInt(scale - rightParts.scale);
  const leftValue = leftParts.negative ? -leftMagnitude : leftMagnitude;
  const rightValue = rightParts.negative ? -rightMagnitude : rightMagnitude;
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function candidateSemanticKey(candidate: ExtractedCandidate): string {
  return JSON.stringify(
    canonicalize({
      value: candidate.value,
      spokenUnit: candidate.spokenUnit,
      normalizedUnit: candidate.normalizedUnit,
      unitMappingRuleId: candidate.unitMappingRuleId,
      confidenceToken: candidate.confidenceToken,
      confidenceSemanticsVersion: candidate.confidenceSemanticsVersion,
      sourceAnchorIds: [...candidate.sourceAnchorIds].sort(compareText),
    }),
  );
}

function mappingForCandidate(
  candidate: ExtractedCandidate,
  mappings: readonly UnitMappingRule[],
): { readonly mapping: UnitMappingRule | null; readonly invalid: boolean } {
  if (candidate.unitMappingRuleId === null || candidate.normalizedUnit === null) {
    return { mapping: null, invalid: false };
  }
  const mapping = mappings.find(({ ruleId }) => ruleId === candidate.unitMappingRuleId) ?? null;
  if (mapping === null) {
    return { mapping: null, invalid: false };
  }
  return {
    mapping,
    invalid:
      mapping.spokenUnit !== candidate.spokenUnit ||
      mapping.normalizedUnit !== candidate.normalizedUnit,
  };
}

function stableFingerprint(input: ReconciliationInput): string {
  const stableInput = {
    ...input,
    expectedZones: [...input.expectedZones]
      .map((zone) => ({
        ...zone,
        allowedUnitMappings: [...zone.allowedUnitMappings].sort((left, right) =>
          compareText(left.ruleId, right.ruleId),
        ),
      }))
      .sort(
        (left, right) => left.ordinal - right.ordinal || compareText(left.zoneId, right.zoneId),
      ),
    evidence: {
      ...input.evidence,
      admittedAnchors: [...input.evidence.admittedAnchors].sort((left, right) =>
        compareText(left.anchorId, right.anchorId),
      ),
    },
    candidates:
      input.candidates === null
        ? null
        : [...input.candidates]
            .map((candidate) => ({
              ...candidate,
              sourceAnchorIds: [...candidate.sourceAnchorIds].sort(compareText),
            }))
            .sort(
              (left, right) =>
                compareText(left.zoneId, right.zoneId) ||
                compareText(left.candidateId, right.candidateId),
            ),
    confidencePolicy: {
      ...input.confidencePolicy,
      acceptableTokens: [...input.confidencePolicy.acceptableTokens].sort(compareText),
    },
  };
  return `reconciliation-v1-${fnv1a64(JSON.stringify(canonicalize(stableInput)))}`;
}

type ClaimContractValidation =
  | Readonly<{ valid: false; reason: string }>
  | Readonly<{
      valid: true;
      mapping: UnitMappingRule | null;
      anchors: readonly EvidenceAnchor[];
    }>;

function validateClaimContract(input: {
  readonly claim: ExtractedCandidate;
  readonly zone: ExpectedZone;
  readonly reconciliation: ReconciliationInput;
  readonly anchorById: ReadonlyMap<string, EvidenceAnchor>;
}): ClaimContractValidation {
  const { claim, zone, reconciliation, anchorById } = input;
  if (
    claim.providerRunId !== reconciliation.evidence.providerRunId ||
    claim.evidenceRevisionId !== reconciliation.evidence.evidenceRevisionId ||
    !exactDecimalPattern.test(claim.value)
  ) {
    return { valid: false, reason: "INVALID_CANDIDATE_CONTRACT" };
  }
  if (zone.admissibleRange !== undefined) {
    const minimumComparison = compareExactDecimals(claim.value, zone.admissibleRange.minimum);
    const maximumComparison = compareExactDecimals(claim.value, zone.admissibleRange.maximum);
    if (
      minimumComparison === null ||
      maximumComparison === null ||
      minimumComparison < 0 ||
      maximumComparison > 0
    ) {
      return { valid: false, reason: "PINNED_RANGE_VIOLATION" };
    }
  }
  const { mapping, invalid: mappingInvalid } = mappingForCandidate(claim, zone.allowedUnitMappings);
  if (mappingInvalid) {
    return { valid: false, reason: "UNIT_MAPPING_CONTRADICTION" };
  }

  const anchors = claim.sourceAnchorIds.map((anchorId) => anchorById.get(anchorId));
  const anchorContractInvalid =
    claim.sourceAnchorIds.length === 0 ||
    new Set(claim.sourceAnchorIds).size !== claim.sourceAnchorIds.length ||
    anchors.some(
      (anchor) =>
        anchor === undefined ||
        anchor.providerRunId !== reconciliation.evidence.providerRunId ||
        anchor.evidenceRevisionId !== reconciliation.evidence.evidenceRevisionId,
    );
  if (anchorContractInvalid) {
    return { valid: false, reason: "INVALID_EVIDENCE_ANCHOR" };
  }

  return {
    valid: true,
    mapping,
    anchors: anchors.filter((anchor): anchor is EvidenceAnchor => anchor !== undefined),
  };
}

function reconcileZone(input: {
  readonly zone: ExpectedZone;
  readonly claims: readonly ExtractedCandidate[];
  readonly reconciliation: ReconciliationInput;
  readonly anchorById: ReadonlyMap<string, EvidenceAnchor>;
  readonly nullResult: boolean;
  readonly globalInvalidReasons: readonly string[];
}): ReconciledZone {
  const { zone, claims, reconciliation, anchorById, nullResult, globalInvalidReasons } = input;
  const candidateIds = Object.freeze(
    claims.map(({ candidateId }) => candidateId).sort(compareText),
  );
  const evidenceAnchorIds = Object.freeze(
    [...new Set(claims.flatMap(({ sourceAnchorIds }) => sourceAnchorIds))].sort(compareText),
  );
  const base = { zoneId: zone.zoneId, ordinal: zone.ordinal, candidateIds, evidenceAnchorIds };

  if (globalInvalidReasons.length > 0) {
    return Object.freeze({
      ...base,
      disposition: "invalid",
      reading: null,
      reasonCodes: Object.freeze([...globalInvalidReasons]),
    });
  }

  if (zone.applicability === "reviewed_not_applicable") {
    return claims.length === 0
      ? Object.freeze({
          ...base,
          disposition: "reviewed_not_applicable",
          reading: null,
          reasonCodes: Object.freeze(["REVIEWED_NOT_APPLICABLE"]),
        })
      : Object.freeze({
          ...base,
          disposition: "contradictory",
          reading: null,
          reasonCodes: Object.freeze(["CANDIDATE_FOR_NOT_APPLICABLE_ZONE"]),
        });
  }

  if (claims.length === 0) {
    const reason = nullResult
      ? "NULL_RESULT"
      : reconciliation.evidence.sourceCompleteness === "truncated"
        ? "SOURCE_TRUNCATED"
        : "EXPECTED_ZONE_MISSING";
    return Object.freeze({
      ...base,
      disposition: "missing",
      reading: null,
      reasonCodes: Object.freeze([reason]),
    });
  }

  // Validate before duplicate reduction so repeated malformed claims remain invalid instead of
  // being softened into an ambiguous result.
  const claimValidations = claims.map((claim) =>
    validateClaimContract({ claim, zone, reconciliation, anchorById }),
  );
  const invalidClaimReasons = claimValidations
    .flatMap((validation) => (validation.valid ? [] : [validation.reason]))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort(compareText);
  if (invalidClaimReasons.length > 0) {
    return Object.freeze({
      ...base,
      disposition: "invalid",
      reading: null,
      reasonCodes: Object.freeze(invalidClaimReasons),
    });
  }

  if (claims.length > 1) {
    const semanticKeys = new Set(claims.map(candidateSemanticKey));
    return Object.freeze({
      ...base,
      disposition: semanticKeys.size === 1 ? "ambiguous" : "contradictory",
      reading: null,
      reasonCodes: Object.freeze([
        semanticKeys.size === 1 ? "DUPLICATE_CLAIMS" : "CONFLICTING_CLAIMS",
      ]),
    });
  }

  const claim = claims[0];
  if (claim === undefined) {
    throw new Error("reconciliation claim selection failed");
  }
  const claimValidation = claimValidations[0];
  if (claimValidation === undefined || !claimValidation.valid) {
    throw new Error("reconciliation claim validation failed");
  }
  const { anchors, mapping } = claimValidation;

  const exactAnchors = anchors.filter(
    (anchor) => anchor.valueToken === claim.value && anchor.spokenUnitToken === claim.spokenUnit,
  );
  const confidenceAccepted =
    claim.confidenceSemanticsVersion === reconciliation.confidencePolicy.semanticsVersion &&
    claim.confidenceToken !== null &&
    reconciliation.confidencePolicy.acceptableTokens.includes(claim.confidenceToken);
  const truncatedSourceSupported =
    reconciliation.evidence.sourceCompleteness === "complete" ||
    (reconciliation.evidence.sourceCompleteness === "truncated" &&
      exactAnchors.every(({ supportsTruncatedSource }) => supportsTruncatedSource));
  const sourceCompletenessReason =
    reconciliation.evidence.sourceCompleteness === "truncated"
      ? "SOURCE_TRUNCATED"
      : "SOURCE_COMPLETENESS_UNKNOWN";
  if (
    exactAnchors.length !== anchors.length ||
    mapping === null ||
    !confidenceAccepted ||
    !truncatedSourceSupported
  ) {
    return Object.freeze({
      ...base,
      disposition: "ambiguous",
      reading: null,
      reasonCodes: Object.freeze([
        !confidenceAccepted
          ? "CONFIDENCE_SEMANTICS_UNREVIEWED"
          : mapping === null
            ? "UNIT_MAPPING_UNSUPPORTED"
            : !truncatedSourceSupported
              ? sourceCompletenessReason
              : "EVIDENCE_SUPPORT_INSUFFICIENT",
      ]),
    });
  }

  const reading: ReconciledReading = Object.freeze({
    value: claim.value,
    spokenUnit: claim.spokenUnit,
    normalizedUnit: mapping.normalizedUnit,
    confidenceToken: claim.confidenceToken ?? "",
    confidenceSemanticsVersion: claim.confidenceSemanticsVersion ?? "",
    candidateId: claim.candidateId,
    evidenceId: reconciliation.evidence.evidenceId,
    evidenceRevisionId: reconciliation.evidence.evidenceRevisionId,
    providerRunId: reconciliation.evidence.providerRunId,
    adapterVersionId: reconciliation.adapterVersionId,
    extractorVersionId: reconciliation.extractorVersionId,
    sourceCapturedAt: reconciliation.evidence.capturedAt,
    evidenceAnchorIds,
  });
  return Object.freeze({
    ...base,
    disposition: "grounded",
    reading,
    reasonCodes: Object.freeze([]),
  });
}

export function reconcileObservation(input: ReconciliationInput): ReconciliationOutcome {
  if (input.evidence.availability === "unavailable") {
    return Object.freeze({ kind: "no_observation", reason: "evidence_unavailable" });
  }

  const expectedZones = [...input.expectedZones].sort(
    (left, right) => left.ordinal - right.ordinal || compareText(left.zoneId, right.zoneId),
  );
  const candidates =
    input.candidates === null
      ? []
      : [...input.candidates].sort(
          (left, right) =>
            compareText(left.zoneId, right.zoneId) ||
            compareText(left.candidateId, right.candidateId),
        );
  const anchors = [...input.evidence.admittedAnchors].sort((left, right) =>
    compareText(left.anchorId, right.anchorId),
  );
  const anchorById = new Map(anchors.map((anchor) => [anchor.anchorId, anchor]));
  const expectedIds = new Set(expectedZones.map(({ zoneId }) => zoneId));
  const globalDiagnostics: string[] = [];
  if (
    expectedZones.length === 0 ||
    expectedIds.size !== expectedZones.length ||
    new Set(expectedZones.map(({ ordinal }) => ordinal)).size !== expectedZones.length
  ) {
    globalDiagnostics.push("INVALID_EXPECTED_ZONE_INVENTORY");
  }
  if (new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length) {
    globalDiagnostics.push("DUPLICATE_CANDIDATE_ID");
  }
  const hasDuplicateEvidenceAnchorIds =
    new Set(anchors.map(({ anchorId }) => anchorId)).size !== anchors.length;
  if (hasDuplicateEvidenceAnchorIds) {
    globalDiagnostics.push("DUPLICATE_EVIDENCE_ANCHOR_ID");
  }
  if (containsForbiddenOracleField(input)) {
    globalDiagnostics.push("ORACLE_FIELD_FORBIDDEN");
  }
  if (input.evidence.callAttemptId !== input.operationId) {
    globalDiagnostics.push("EVIDENCE_CALL_ATTEMPT_MISMATCH");
  }
  if (input.evidence.adapterVersionId !== input.adapterVersionId) {
    globalDiagnostics.push("EVIDENCE_ADAPTER_MISMATCH");
  }
  if (input.evidence.provenance !== input.provenance) {
    globalDiagnostics.push("EVIDENCE_PROVENANCE_MISMATCH");
  }
  if (candidates.some(({ callAttemptId }) => callAttemptId !== input.operationId)) {
    globalDiagnostics.push("CANDIDATE_CALL_ATTEMPT_MISMATCH");
  }
  if (candidates.some(({ adapterVersionId }) => adapterVersionId !== input.adapterVersionId)) {
    globalDiagnostics.push("CANDIDATE_ADAPTER_MISMATCH");
  }
  if (candidates.some(({ provenance }) => provenance !== input.provenance)) {
    globalDiagnostics.push("CANDIDATE_PROVENANCE_MISMATCH");
  }
  if (candidates.some(({ providerRunId }) => providerRunId !== input.evidence.providerRunId)) {
    globalDiagnostics.push("CANDIDATE_PROVIDER_RUN_MISMATCH");
  }
  if (
    candidates.some(
      ({ evidenceRevisionId }) => evidenceRevisionId !== input.evidence.evidenceRevisionId,
    )
  ) {
    globalDiagnostics.push("CANDIDATE_EVIDENCE_REVISION_MISMATCH");
  }
  if (candidates.some(({ value }) => !exactDecimalPattern.test(value))) {
    globalDiagnostics.push("INVALID_CANDIDATE_CONTRACT");
  }
  if (
    !hasDuplicateEvidenceAnchorIds &&
    candidates.some(({ sourceAnchorIds }) => {
      return (
        sourceAnchorIds.length === 0 ||
        new Set(sourceAnchorIds).size !== sourceAnchorIds.length ||
        sourceAnchorIds.some((anchorId) => {
          const anchor = anchorById.get(anchorId);
          return (
            anchor === undefined ||
            anchor.providerRunId !== input.evidence.providerRunId ||
            anchor.evidenceRevisionId !== input.evidence.evidenceRevisionId
          );
        })
      );
    })
  ) {
    globalDiagnostics.push("INVALID_EVIDENCE_ANCHOR");
  }

  // A lineage or correlation mismatch invalidates every zone; no reading may survive evidence
  // attributed to another attempt, adapter, provider run, revision, or provenance.
  const globalInvalidReasons = Object.freeze(
    globalDiagnostics
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort(compareText),
  );

  const zones = expectedZones.map((zone) =>
    reconcileZone({
      zone,
      claims: candidates.filter(({ zoneId }) => zoneId === zone.zoneId),
      reconciliation: input,
      anchorById,
      nullResult: input.candidates === null,
      globalInvalidReasons,
    }),
  );
  const unexpectedCandidates = Object.freeze(
    candidates
      .filter(({ zoneId }) => !expectedIds.has(zoneId))
      .map(({ zoneId, candidateId }) => Object.freeze({ zoneId, candidateId })),
  );
  const invalid =
    globalDiagnostics.length > 0 || zones.some(({ disposition }) => disposition === "invalid");
  // Completeness is proved across the entire expected-zone inventory and requires complete source
  // evidence with no invalid or unexpected claims.
  const complete =
    !invalid &&
    zones.every(
      ({ disposition }) => disposition === "grounded" || disposition === "reviewed_not_applicable",
    ) &&
    unexpectedCandidates.length === 0 &&
    input.evidence.sourceCompleteness === "complete";
  const grounded = zones.some(({ disposition }) => disposition === "grounded");
  const quality: ObservationQuality = invalid
    ? "invalid"
    : complete
      ? "complete"
      : grounded
        ? "partial"
        : "unknown";
  const diagnostics = Object.freeze(
    [
      ...globalDiagnostics,
      ...zones.flatMap(({ reasonCodes }) => reasonCodes),
      ...(unexpectedCandidates.length === 0 ? [] : ["UNEXPECTED_CANDIDATE"]),
    ]
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort(compareText),
  );

  return deepFreeze({
    kind: "observation",
    quality,
    provenance: input.evidence.provenance,
    zones,
    unexpectedCandidates,
    diagnostics,
    inputFingerprint: stableFingerprint(input),
  });
}
