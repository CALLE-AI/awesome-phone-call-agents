const exactDecimalPattern = /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

const collectionContract = [
  ['alarmStates', 'alarm_state', 'alarmId'],
  ['powerStates', 'power_state', 'powerSourceId'],
  ['batteryStates', 'battery_state', 'batteryId'],
];

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function failContract(code) {
  throw new Error(`HARNESS_ERROR:${code}`);
}

function indexUnique(values, keyName, duplicateCode) {
  const index = new Map();
  for (const value of values) {
    const key = value?.[keyName];
    if (typeof key !== 'string' || key === '' || index.has(key)) {
      failContract(duplicateCode);
    }
    index.set(key, value);
  }
  return index;
}

function diagnostic(code, subjectKind, subjectId) {
  return { code, subjectKind, subjectId };
}

function sortDiagnostics(diagnostics) {
  const unique = new Map(
    diagnostics.map((value) => [
      `${value.subjectKind}:${value.subjectId}:${value.code}`,
      value,
    ]),
  );
  return [...unique.values()].sort((left, right) =>
    compareAscii(
      `${left.subjectKind}:${left.subjectId}:${left.code}`,
      `${right.subjectKind}:${right.subjectId}:${right.code}`,
    ),
  );
}

export function parseExactDecimal(value) {
  if (typeof value !== 'string' || !exactDecimalPattern.test(value)) {
    throw new TypeError('EXACT_DECIMAL_INVALID');
  }

  const signToken = value.startsWith('-') ? '-' : value.startsWith('+') ? '+' : '';
  const unsigned = signToken === '' ? value : value.slice(1);
  const [integralDigits, fractionalDigits] = unsigned.split('.');
  return {
    lexeme: value,
    signToken,
    integralDigits,
    fractionalDigits: fractionalDigits ?? null,
    scale: fractionalDigits?.length ?? 0,
  };
}

function exactDecimalMatchesRepresentation(exactDecimal) {
  try {
    const parsed = parseExactDecimal(exactDecimal?.lexeme);
    return (
      exactDecimal !== null &&
      typeof exactDecimal === 'object' &&
      Object.keys(parsed).every((key) => parsed[key] === exactDecimal[key])
    );
  } catch {
    return false;
  }
}

function subjectIdForState(candidate) {
  if (candidate.kind === 'alarm_state') return candidate.alarmId;
  if (candidate.kind === 'power_state') return candidate.powerSourceId;
  if (candidate.kind === 'battery_state') return candidate.batteryId;
  return undefined;
}

function baseDerived(input, structuredResultStageStatus) {
  const lifecycle = input.lifecycleFacts[0];
  return {
    evaluatorPolicyVersion: input.evaluatorPolicyVersion,
    fixtureIdentity: structuredClone(input.fixtureIdentity),
    runCorrelation: {
      runId: input.opaqueRunRef,
      lifecycleStageStatus:
        lifecycle?.terminalStatus === 'completed' ? 'terminal' : 'missing',
      evidenceStageStatus: input.evidenceRecords.length > 0 ? 'present' : 'missing',
      structuredResultStageStatus,
      selectedRevisionId:
        input.structuredResult?.resultRevisionId ?? lifecycle?.selectedRevisionId ?? null,
    },
    quality: 'unknown',
    readings: [],
    alarmStates: [],
    powerStates: [],
    batteryStates: [],
    zoneReconciliation: [],
    stateReconciliation: [],
    unexpectedZones: [],
    unexpectedStates: [],
    diagnostics: [],
    provenanceSummary: {
      fixtureProvenance: input.fixtureIdentity.fixtureProvenance,
      proofScope: input.fixtureIdentity.proofScope,
      displayLabel: input.fixtureIdentity.displayLabel,
    },
    operationalDecisionAllowed: false,
  };
}

function validateInputContract(input) {
  if (input === null || typeof input !== 'object') failContract('OBSERVATION_INPUT_INVALID');
  if (Object.hasOwn(input, 'groundTruth') || Object.hasOwn(input, 'expectedDerived')) {
    failContract('GROUND_TRUTH_INPUT_FORBIDDEN');
  }
  if (
    input.fixtureIdentity?.fixtureProvenance !== 'simulated' ||
    input.fixtureIdentity?.proofScope !== 'contract_only' ||
    input.fixtureIdentity?.displayLabel !== 'SIMULATED'
  ) {
    failContract('SIMULATED_PROVENANCE_INVALID');
  }
  if (
    input.evaluatorPolicyVersion !== input.groundingPolicy?.policyVersion ||
    input.evaluatorPolicyVersion !== 'simulated-checker/v1'
  ) {
    failContract('POLICY_VERSION_UNKNOWN');
  }
  if (!Array.isArray(input.expectedZones) || !Array.isArray(input.expectedDeviceStates)) {
    failContract('EXPECTED_INVENTORY_INVALID');
  }
  if (input.expectedZones.length + input.expectedDeviceStates.length === 0) {
    failContract('EXPECTED_INVENTORY_EMPTY');
  }
  indexUnique(input.expectedZones, 'zoneId', 'EXPECTED_ZONE_DUPLICATE');
  for (const expectedZone of input.expectedZones) {
    if (!['required', 'not_applicable'].includes(expectedZone.applicability)) {
      failContract('EXPECTED_ZONE_APPLICABILITY_UNSUPPORTED');
    }
    if (expectedZone.applicability !== 'not_applicable') continue;
    if (expectedZone.reasonCode !== 'NOT_APPLICABLE_REVIEWED') {
      failContract('NOT_APPLICABLE_REASON_REQUIRED');
    }
    if (
      !Array.isArray(expectedZone.evidenceBasisRefs) ||
      expectedZone.evidenceBasisRefs.length === 0
    ) {
      failContract('NOT_APPLICABLE_EVIDENCE_REQUIRED');
    }
  }
  const stateKeys = new Set();
  for (const expectedState of input.expectedDeviceStates) {
    const key = `${expectedState.kind}:${expectedState.subjectId}`;
    if (stateKeys.has(key)) failContract('EXPECTED_STATE_DUPLICATE');
    stateKeys.add(key);
  }
  if (!['present', 'null', 'absent'].includes(input.structuredResult?.state)) {
    failContract('RESULT_DISCRIMINANT_UNSUPPORTED');
  }
  if (!Array.isArray(input.lifecycleFacts) || !Array.isArray(input.evidenceRecords)) {
    failContract('CORRELATION_INPUT_INVALID');
  }
  if (!Array.isArray(input.evidenceAssertions)) failContract('EVIDENCE_ASSERTIONS_INVALID');
}

function validateCorrelation(input, derived) {
  const lifecycle = input.lifecycleFacts[0];
  const result = input.structuredResult;
  if (
    input.lifecycleFacts.length !== 1 ||
    lifecycle?.runId !== input.opaqueRunRef ||
    result.runId !== input.opaqueRunRef
  ) {
    derived.quality = 'invalid';
    derived.diagnostics.push(
      diagnostic('EVIDENCE_REF_CROSS_RUN', 'run', input.fixtureIdentity.fixtureId),
    );
    return false;
  }
  if (result.resultRevisionId !== lifecycle.selectedRevisionId) {
    derived.quality = 'invalid';
    derived.diagnostics.push(
      diagnostic('RESULT_REVISION_AMBIGUOUS', 'run', input.fixtureIdentity.fixtureId),
    );
    return false;
  }
  return true;
}

function validateEvidenceCorrelation(input, derived, evidenceIndex) {
  const failureCodes = new Set();
  const selectedRevision = input.fixtureIdentity.fixtureVersion;

  for (const evidence of input.evidenceRecords) {
    if (evidence.runId !== input.opaqueRunRef) {
      failureCodes.add('EVIDENCE_REF_CROSS_RUN');
    }
    if (evidence.sourceRevision !== selectedRevision) {
      failureCodes.add('RESULT_REVISION_AMBIGUOUS');
    }
  }

  for (const assertion of input.evidenceAssertions) {
    const evidence = evidenceIndex.get(assertion.evidenceId);
    if (!evidence) {
      failureCodes.add('EVIDENCE_REF_DANGLING');
      continue;
    }
    if (
      assertion.runId !== input.opaqueRunRef ||
      evidence.runId !== input.opaqueRunRef
    ) {
      failureCodes.add('EVIDENCE_REF_CROSS_RUN');
    }
    if (evidence.sourceRevision !== selectedRevision) {
      failureCodes.add('RESULT_REVISION_AMBIGUOUS');
    }
  }

  if (failureCodes.size === 0) return true;
  derived.quality = 'invalid';
  // Pre-candidate correlation failures use `evidence_stage` for the evidence set as a whole.
  derived.diagnostics = sortDiagnostics(
    [...failureCodes].map((code) =>
      diagnostic(code, 'evidence_stage', input.fixtureIdentity.fixtureId),
    ),
  );
  return false;
}

function validateNotApplicableZoneExpectations(
  input,
  assertionIndex,
  evidenceIndex,
) {
  for (const expected of input.expectedZones) {
    if (expected.applicability !== 'not_applicable') continue;
    for (const reference of expected.evidenceBasisRefs) {
      const assertion = assertionIndex.get(reference);
      const evidence = evidenceIndex.get(assertion?.evidenceId);
      if (
        !assertion ||
        !evidence ||
        assertion.subjectKind !== 'expected_zone' ||
        assertion.subjectId !== expected.zoneId ||
        assertion.fieldPath !== 'applicability' ||
        assertion.assertedValue !== 'not_applicable'
      ) {
        failContract('NOT_APPLICABLE_EVIDENCE_REQUIRED');
      }
      if (assertion.runId !== input.opaqueRunRef || evidence.runId !== input.opaqueRunRef) {
        failContract('EVIDENCE_REF_CROSS_RUN');
      }
      if (evidence.sourceRevision !== input.fixtureIdentity.fixtureVersion) {
        failContract('RESULT_REVISION_AMBIGUOUS');
      }
      if (evidence.availability !== 'present') failContract('EVIDENCE_UNAVAILABLE');
      if (assertion.reviewStatus !== 'reviewed' || evidence.reviewStatus !== 'reviewed') {
        failContract('EVIDENCE_UNREVIEWED');
      }
    }
  }
}

function resolveEvidenceField({
  assertionId,
  expectedValue,
  fieldPath,
  subjectKind,
  subjectId,
  runId,
  sourceRevision,
  assertionIndex,
  evidenceIndex,
  assertionGroups,
}) {
  const assertion = assertionIndex.get(assertionId);
  if (!assertion) return { fatalCode: 'EVIDENCE_REF_DANGLING' };
  const evidence = evidenceIndex.get(assertion.evidenceId);
  if (!evidence) return { fatalCode: 'EVIDENCE_REF_DANGLING' };
  if (assertion.runId !== runId || evidence.runId !== runId) {
    return { fatalCode: 'EVIDENCE_REF_CROSS_RUN' };
  }
  if (evidence.sourceRevision !== sourceRevision) {
    return { fatalCode: 'RESULT_REVISION_AMBIGUOUS' };
  }
  if (assertion.subjectKind !== subjectKind || assertion.subjectId !== subjectId) {
    return { fatalCode: 'EVIDENCE_ASSERTION_SUBJECT_MISMATCH' };
  }
  if (assertion.fieldPath !== fieldPath || assertion.assertedValue !== expectedValue) {
    return { fatalCode: 'EVIDENCE_ASSERTION_VALUE_MISMATCH' };
  }
  const uncertaintyCodes = [];
  const slotKey = `${runId}:${subjectKind}:${subjectId}:${fieldPath}`;
  const activeAssertions = (assertionGroups.get(slotKey) ?? []).filter((candidate) => {
    const candidateEvidence = evidenceIndex.get(candidate.evidenceId);
    return (
      candidate.reviewStatus === 'reviewed' &&
      candidateEvidence?.runId === runId &&
      candidateEvidence.sourceRevision === sourceRevision &&
      candidateEvidence.availability === 'present' &&
      candidateEvidence.reviewStatus === 'reviewed'
    );
  });
  if (activeAssertions.length > 1) {
    const values = new Set(activeAssertions.map(({ assertedValue }) => assertedValue));
    uncertaintyCodes.push(
      values.size > 1
        ? 'EVIDENCE_CONTRADICTORY'
        : 'DUPLICATE_EQUIVALENT_CANDIDATES',
    );
  }
  if (evidence.availability !== 'present') uncertaintyCodes.push('EVIDENCE_UNAVAILABLE');
  if (assertion.reviewStatus !== 'reviewed' || evidence.reviewStatus !== 'reviewed') {
    uncertaintyCodes.push('EVIDENCE_UNREVIEWED');
  }
  return { assertion, evidence, uncertaintyCodes };
}

function validateConfidenceSource(
  candidate,
  runId,
  sourceRevision,
  evidenceIndex,
  linkedEvidenceIds,
) {
  const sourceRef = candidate.confidenceToken?.sourceRef;
  const evidence = evidenceIndex.get(sourceRef);
  if (!evidence) return 'EVIDENCE_REF_DANGLING';
  if (evidence.runId !== runId) return 'EVIDENCE_REF_CROSS_RUN';
  if (evidence.sourceRevision !== sourceRevision) return 'RESULT_REVISION_AMBIGUOUS';
  if (!linkedEvidenceIds.includes(sourceRef)) return 'EVIDENCE_REF_DANGLING';
  return null;
}

function groupEvidenceAssertions(assertions) {
  const groups = new Map();
  for (const assertion of assertions) {
    const key = `${assertion.runId}:${assertion.subjectKind}:${assertion.subjectId}:${assertion.fieldPath}`;
    const group = groups.get(key) ?? [];
    group.push(assertion);
    groups.set(key, group);
  }
  return groups;
}

function sortEvaluatedCandidates(values) {
  return [...values].sort((left, right) =>
    compareAscii(left.candidate.candidateId, right.candidate.candidateId),
  );
}

function confidenceDisposition(candidate, policy) {
  const token = candidate.confidenceToken;
  if (
    token?.provider !== 'simulated_checker' ||
    token?.semanticsVersion !== 'simulated-checker/v1'
  ) {
    return 'unresolved';
  }
  return policy.confidenceDispositions[token.rawLexeme] ?? 'unresolved';
}

function mappingForMeasurement(candidate, policy) {
  return policy.unitMappings.find(
    (mapping) =>
      mapping.ruleId === candidate.unitMappingRuleId &&
      mapping.spokenUnit === candidate.spokenUnit &&
      mapping.normalizedUnit === candidate.normalizedUnit,
  );
}

function mappingForState(candidate, policy) {
  return policy.stateMappings.find(
    (mapping) =>
      mapping.ruleId === candidate.stateMappingRuleId &&
      mapping.kind === candidate.kind &&
      mapping.spokenState === candidate.spokenState &&
      mapping.normalizedState === candidate.normalizedState,
  );
}

function evaluateMeasurementCandidate(candidate, context) {
  const reasons = [];
  const fatalCodes = [];
  if (candidate.kind !== 'measurement' || candidate.runId !== context.runId) {
    fatalCodes.push('RESULT_SCHEMA_INVALID');
  }
  if (!exactDecimalMatchesRepresentation(candidate.exactDecimal)) {
    fatalCodes.push('EXACT_DECIMAL_INVALID');
  }

  const evidenceAssertionIds = [];
  const evidenceIds = [];
  for (const [fieldPath, expectedValue] of [
    ['exactDecimal.lexeme', candidate.exactDecimal?.lexeme],
    ['spokenUnit', candidate.spokenUnit],
  ]) {
    const resolved = resolveEvidenceField({
      assertionId: candidate.evidenceRefs?.[fieldPath],
      expectedValue,
      fieldPath,
      subjectKind: 'measurement',
      subjectId: candidate.zoneId,
      runId: context.runId,
      sourceRevision: context.sourceRevision,
      assertionIndex: context.assertionIndex,
      evidenceIndex: context.evidenceIndex,
      assertionGroups: context.assertionGroups,
    });
    if (resolved.fatalCode) fatalCodes.push(resolved.fatalCode);
    reasons.push(...(resolved.uncertaintyCodes ?? []));
    if (resolved.assertion) evidenceAssertionIds.push(resolved.assertion.assertionId);
    if (resolved.evidence) evidenceIds.push(resolved.evidence.evidenceId);
  }

  if (!mappingForMeasurement(candidate, context.policy)) {
    reasons.push('UNIT_MAPPING_UNAVAILABLE');
  }
  const disposition = confidenceDisposition(candidate, context.policy);
  if (disposition === 'insufficient') reasons.push('CONFIDENCE_INSUFFICIENT');
  if (disposition === 'unresolved') reasons.push('CONFIDENCE_SEMANTICS_UNRESOLVED');
  if (context.truncatedSubjects.has(candidate.zoneId)) reasons.push('SOURCE_TRUNCATED');
  const confidenceSourceError = validateConfidenceSource(
    candidate,
    context.runId,
    context.sourceRevision,
    context.evidenceIndex,
    evidenceIds,
  );
  if (confidenceSourceError) fatalCodes.push(confidenceSourceError);

  return {
    candidate,
    reasons: [...new Set(reasons)].sort(compareAscii),
    fatalCodes: [...new Set(fatalCodes)].sort(compareAscii),
    grounded: {
      candidateId: candidate.candidateId,
      kind: 'measurement',
      zoneId: candidate.zoneId,
      exactDecimal: structuredClone(candidate.exactDecimal),
      spokenUnit: candidate.spokenUnit,
      normalizedUnit: candidate.normalizedUnit,
      unitMappingRuleId: candidate.unitMappingRuleId,
      evidenceAssertionIds: [...new Set(evidenceAssertionIds)].sort(compareAscii),
      evidenceIds: [...new Set(evidenceIds)].sort(compareAscii),
      confidenceToken: structuredClone(candidate.confidenceToken),
      confidenceDisposition: disposition,
      runId: candidate.runId,
    },
  };
}

function evaluateStateCandidate(candidate, context) {
  const subjectId = subjectIdForState(candidate);
  const reasons = [];
  const fatalCodes = [];
  if (typeof subjectId !== 'string' || candidate.runId !== context.runId) {
    fatalCodes.push('RESULT_SCHEMA_INVALID');
  }
  const resolved = resolveEvidenceField({
    assertionId: candidate.evidenceRefs?.spokenState,
    expectedValue: candidate.spokenState,
    fieldPath: 'spokenState',
    subjectKind: candidate.kind,
    subjectId,
    runId: context.runId,
    sourceRevision: context.sourceRevision,
    assertionIndex: context.assertionIndex,
    evidenceIndex: context.evidenceIndex,
    assertionGroups: context.assertionGroups,
  });
  if (resolved.fatalCode) fatalCodes.push(resolved.fatalCode);
  reasons.push(...(resolved.uncertaintyCodes ?? []));
  if (!mappingForState(candidate, context.policy)) reasons.push('STATE_MAPPING_UNAVAILABLE');
  const disposition = confidenceDisposition(candidate, context.policy);
  if (disposition === 'insufficient') reasons.push('CONFIDENCE_INSUFFICIENT');
  if (disposition === 'unresolved') reasons.push('CONFIDENCE_SEMANTICS_UNRESOLVED');
  if (context.truncatedSubjects.has(subjectId)) reasons.push('SOURCE_TRUNCATED');
  const confidenceSourceError = validateConfidenceSource(
    candidate,
    context.runId,
    context.sourceRevision,
    context.evidenceIndex,
    resolved.evidence ? [resolved.evidence.evidenceId] : [],
  );
  if (confidenceSourceError) fatalCodes.push(confidenceSourceError);

  return {
    candidate,
    subjectId,
    reasons: [...new Set(reasons)].sort(compareAscii),
    fatalCodes: [...new Set(fatalCodes)].sort(compareAscii),
    grounded: {
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      ...(candidate.kind === 'alarm_state' ? { alarmId: candidate.alarmId } : {}),
      ...(candidate.kind === 'power_state'
        ? { powerSourceId: candidate.powerSourceId }
        : {}),
      ...(candidate.kind === 'battery_state' ? { batteryId: candidate.batteryId } : {}),
      ...(candidate.zoneId === undefined ? {} : { zoneId: candidate.zoneId }),
      spokenState: candidate.spokenState,
      normalizedState: candidate.normalizedState,
      stateMappingRuleId: candidate.stateMappingRuleId,
      evidenceAssertionIds: resolved.assertion ? [resolved.assertion.assertionId] : [],
      evidenceIds: resolved.evidence ? [resolved.evidence.evidenceId] : [],
      confidenceToken: structuredClone(candidate.confidenceToken),
      confidenceDisposition: disposition,
      runId: candidate.runId,
    },
  };
}

function measurementPayload(candidate) {
  return JSON.stringify({
    exactDecimal: candidate.exactDecimal,
    spokenUnit: candidate.spokenUnit,
    normalizedUnit: candidate.normalizedUnit,
    unitMappingRuleId: candidate.unitMappingRuleId,
  });
}

function reconcileZones(input, evaluatedMeasurements, derived) {
  const byZone = new Map();
  for (const evaluated of evaluatedMeasurements) {
    const group = byZone.get(evaluated.candidate.zoneId) ?? [];
    group.push(evaluated);
    byZone.set(evaluated.candidate.zoneId, group);
  }

  let supportedRequired = 0;
  for (const expected of [...input.expectedZones].sort((left, right) =>
    compareAscii(left.zoneId, right.zoneId),
  )) {
    if (expected.applicability === 'not_applicable') {
      derived.zoneReconciliation.push({
        zoneId: expected.zoneId,
        status: 'not_applicable',
        candidateIds: [],
        candidates: [],
        reasonCodes: [expected.reasonCode],
        evidenceBasisRefs: [...expected.evidenceBasisRefs].sort(compareAscii),
      });
      byZone.delete(expected.zoneId);
      continue;
    }

    const group = sortEvaluatedCandidates(byZone.get(expected.zoneId) ?? []);
    byZone.delete(expected.zoneId);
    if (group.length === 0) {
      derived.zoneReconciliation.push({
        zoneId: expected.zoneId,
        status: 'missing',
        candidateIds: [],
        candidates: [],
        reasonCodes: ['EXPECTED_ZONE_MISSING'],
      });
      derived.diagnostics.push(
        diagnostic('EXPECTED_ZONE_MISSING', 'measurement', expected.zoneId),
      );
      continue;
    }

    if (group.length > 1) {
      const payloads = new Set(group.map(({ candidate }) => measurementPayload(candidate)));
      const status = payloads.size === 1 ? 'ambiguous' : 'contradictory';
      const code =
        status === 'ambiguous'
          ? 'DUPLICATE_EQUIVALENT_CANDIDATES'
          : 'EVIDENCE_CONTRADICTORY';
      derived.zoneReconciliation.push({
        zoneId: expected.zoneId,
        status,
        candidateIds: group.map(({ candidate }) => candidate.candidateId),
        candidates: group.map(({ grounded }) => grounded),
        reasonCodes: [code],
      });
      derived.diagnostics.push(diagnostic(code, 'measurement', expected.zoneId));
      continue;
    }

    const [evaluated] = group;
    if (evaluated.reasons.length > 0) {
      const status = evaluated.reasons.includes('EVIDENCE_CONTRADICTORY')
        ? 'contradictory'
        : 'ambiguous';
      derived.zoneReconciliation.push({
        zoneId: expected.zoneId,
        status,
        candidateIds: [evaluated.candidate.candidateId],
        candidates: [evaluated.grounded],
        reasonCodes: evaluated.reasons,
      });
      for (const code of evaluated.reasons) {
        derived.diagnostics.push(diagnostic(code, 'measurement', expected.zoneId));
      }
      continue;
    }

    derived.zoneReconciliation.push({
      zoneId: expected.zoneId,
      status: 'supported',
      candidateIds: [evaluated.candidate.candidateId],
      candidates: [evaluated.grounded],
      reasonCodes: [],
    });
    derived.readings.push(evaluated.grounded);
    supportedRequired += 1;
  }

  for (const [zoneId, unsortedGroup] of [...byZone.entries()].sort(([left], [right]) =>
    compareAscii(left, right),
  )) {
    const group = sortEvaluatedCandidates(unsortedGroup);
    derived.unexpectedZones.push({
      zoneId,
      candidates: group.map(({ grounded }) => grounded),
    });
    derived.diagnostics.push(diagnostic('UNEXPECTED_ZONE', 'measurement', zoneId));
  }
  derived.readings.sort((left, right) =>
    compareAscii(`${left.zoneId}:${left.candidateId}`, `${right.zoneId}:${right.candidateId}`),
  );
  return supportedRequired;
}

function reconcileStates(input, evaluatedStates, derived) {
  const byKey = new Map();
  for (const evaluated of evaluatedStates) {
    const key = `${evaluated.candidate.kind}:${evaluated.subjectId}`;
    const group = byKey.get(key) ?? [];
    group.push(evaluated);
    byKey.set(key, group);
  }

  let supportedRequired = 0;
  for (const expected of [...input.expectedDeviceStates].sort((left, right) =>
    compareAscii(`${left.kind}:${left.subjectId}`, `${right.kind}:${right.subjectId}`),
  )) {
    const key = `${expected.kind}:${expected.subjectId}`;
    const group = sortEvaluatedCandidates(byKey.get(key) ?? []);
    byKey.delete(key);
    if (group.length === 0) {
      derived.stateReconciliation.push({
        kind: expected.kind,
        subjectId: expected.subjectId,
        status: 'missing',
        candidateIds: [],
        reasonCodes: ['EXPECTED_STATE_MISSING'],
      });
      derived.diagnostics.push(
        diagnostic('EXPECTED_STATE_MISSING', expected.kind, expected.subjectId),
      );
      continue;
    }
    if (group.length > 1) {
      const payloads = new Set(
        group.map(({ candidate }) =>
          JSON.stringify({
            spokenState: candidate.spokenState,
            normalizedState: candidate.normalizedState,
            stateMappingRuleId: candidate.stateMappingRuleId,
          }),
        ),
      );
      const status = payloads.size === 1 ? 'ambiguous' : 'contradictory';
      const code =
        status === 'ambiguous'
          ? 'DUPLICATE_EQUIVALENT_CANDIDATES'
          : 'EVIDENCE_CONTRADICTORY';
      derived.stateReconciliation.push({
        kind: expected.kind,
        subjectId: expected.subjectId,
        status,
        candidateIds: group.map(({ candidate }) => candidate.candidateId),
        reasonCodes: [code],
      });
      derived.diagnostics.push(diagnostic(code, expected.kind, expected.subjectId));
      continue;
    }
    const [evaluated] = group;
    if (evaluated.reasons.length > 0) {
      const status = evaluated.reasons.includes('EVIDENCE_CONTRADICTORY')
        ? 'contradictory'
        : 'ambiguous';
      derived.stateReconciliation.push({
        kind: expected.kind,
        subjectId: expected.subjectId,
        status,
        candidateIds: [evaluated.candidate.candidateId],
        reasonCodes: evaluated.reasons,
      });
      for (const code of evaluated.reasons) {
        derived.diagnostics.push(diagnostic(code, expected.kind, expected.subjectId));
      }
      continue;
    }

    derived.stateReconciliation.push({
      kind: expected.kind,
      subjectId: expected.subjectId,
      status: 'supported',
      candidateIds: [evaluated.candidate.candidateId],
      reasonCodes: [],
    });
    if (expected.kind === 'alarm_state') derived.alarmStates.push(evaluated.grounded);
    if (expected.kind === 'power_state') derived.powerStates.push(evaluated.grounded);
    if (expected.kind === 'battery_state') derived.batteryStates.push(evaluated.grounded);
    supportedRequired += 1;
  }

  for (const [key, unsortedGroup] of [...byKey.entries()].sort(([left], [right]) =>
    compareAscii(left, right),
  )) {
    const group = sortEvaluatedCandidates(unsortedGroup);
    const [kind, subjectId] = key.split(':');
    derived.unexpectedStates.push({
      kind,
      subjectId,
      candidates: group.map(({ grounded }) => grounded),
    });
    derived.diagnostics.push(diagnostic('UNEXPECTED_STATE', kind, subjectId));
  }

  for (const field of ['alarmStates', 'powerStates', 'batteryStates']) {
    derived[field].sort((left, right) =>
      compareAscii(left.candidateId, right.candidateId),
    );
  }
  return supportedRequired;
}

function unknownWithoutStructuredResult(input) {
  const code =
    input.structuredResult.state === 'null'
      ? 'NULL_STRUCTURED_RESULT'
      : 'STRUCTURED_RESULT_ABSENT';
  const derived = baseDerived(input, input.structuredResult.state);
  derived.zoneReconciliation = [...input.expectedZones]
    .sort((left, right) => compareAscii(left.zoneId, right.zoneId))
    .map(({ zoneId, applicability, reasonCode, evidenceBasisRefs }) => ({
      zoneId,
      status: applicability === 'not_applicable' ? 'not_applicable' : 'missing',
      candidateIds: [],
      candidates: [],
      reasonCodes: [applicability === 'not_applicable' ? reasonCode : code],
      ...(applicability === 'not_applicable'
        ? { evidenceBasisRefs: [...evidenceBasisRefs].sort(compareAscii) }
        : {}),
    }));
  derived.stateReconciliation = [...input.expectedDeviceStates]
    .sort((left, right) =>
      compareAscii(`${left.kind}:${left.subjectId}`, `${right.kind}:${right.subjectId}`),
    )
    .map(({ kind, subjectId }) => ({
      kind,
      subjectId,
      status: 'missing',
      candidateIds: [],
      reasonCodes: [code],
    }));
  derived.diagnostics = [
    diagnostic(code, 'structured_result', input.fixtureIdentity.fixtureId),
  ];
  return derived;
}

export function evaluateObservation(input) {
  validateInputContract(input);
  const assertionIndex = indexUnique(
    input.evidenceAssertions,
    'assertionId',
    'EVIDENCE_ASSERTION_ID_DUPLICATE',
  );
  const evidenceIndex = indexUnique(
    input.evidenceRecords,
    'evidenceId',
    'EVIDENCE_RECORD_ID_DUPLICATE',
  );
  validateNotApplicableZoneExpectations(input, assertionIndex, evidenceIndex);
  const derived = baseDerived(input, input.structuredResult.state);
  if (!validateCorrelation(input, derived)) {
    derived.diagnostics = sortDiagnostics(derived.diagnostics);
    return derived;
  }
  if (!validateEvidenceCorrelation(input, derived, evidenceIndex)) {
    return derived;
  }
  // Correlate retained evidence first so malformed provenance cannot reduce to ordinary unknown.
  if (input.structuredResult.state !== 'present') {
    return unknownWithoutStructuredResult(input);
  }

  const result = input.structuredResult.value;
  if (
    result === null ||
    typeof result !== 'object' ||
    collectionContract.some(([collection]) => !Array.isArray(result[collection])) ||
    !Array.isArray(result.measurements)
  ) {
    derived.quality = 'invalid';
    derived.diagnostics = [
      diagnostic('RESULT_SCHEMA_INVALID', 'structured_result', input.fixtureIdentity.fixtureId),
    ];
    return derived;
  }

  const allCandidates = [
    ...result.measurements,
    ...result.alarmStates,
    ...result.powerStates,
    ...result.batteryStates,
  ];
  const candidateIds = new Set();
  for (const candidate of allCandidates) {
    if (
      typeof candidate.candidateId !== 'string' ||
      candidateIds.has(candidate.candidateId)
    ) {
      derived.quality = 'invalid';
      derived.diagnostics = [
        diagnostic('CANDIDATE_ID_DUPLICATE', 'structured_result', input.fixtureIdentity.fixtureId),
      ];
      return derived;
    }
    candidateIds.add(candidate.candidateId);
  }

  const context = {
    runId: input.opaqueRunRef,
    sourceRevision: input.fixtureIdentity.fixtureVersion,
    policy: input.groundingPolicy,
    assertionIndex,
    assertionGroups: groupEvidenceAssertions(input.evidenceAssertions),
    evidenceIndex,
    truncatedSubjects: new Set(input.sourceCompleteness?.affectedSubjectIds ?? []),
  };
  const evaluatedMeasurements = result.measurements.map((candidate) =>
    evaluateMeasurementCandidate(candidate, context),
  );
  const evaluatedStates = collectionContract.flatMap(([collection, kind]) =>
    result[collection].map((candidate) => {
      if (candidate.kind !== kind) {
        return {
          candidate,
          subjectId: subjectIdForState(candidate),
          reasons: [],
          fatalCodes: ['FIELD_TYPE_CONFLATED'],
          grounded: {},
        };
      }
      return evaluateStateCandidate(candidate, context);
    }),
  );
  const fatalCodes = [
    ...evaluatedMeasurements.flatMap(({ fatalCodes }) => fatalCodes),
    ...evaluatedStates.flatMap(({ fatalCodes }) => fatalCodes),
  ];
  if (fatalCodes.length > 0) {
    derived.quality = 'invalid';
    derived.diagnostics = sortDiagnostics(
      [...new Set(fatalCodes)].map((code) =>
        diagnostic(code, 'structured_result', input.fixtureIdentity.fixtureId),
      ),
    );
    return derived;
  }

  const supportedZones = reconcileZones(input, evaluatedMeasurements, derived);
  const supportedStates = reconcileStates(input, evaluatedStates, derived);
  const requiredCount =
    input.expectedZones.filter(({ applicability }) => applicability !== 'not_applicable').length +
    input.expectedDeviceStates.length;
  const supportedCount = supportedZones + supportedStates;
  const complete =
    supportedCount === requiredCount &&
    derived.unexpectedZones.length === 0 &&
    derived.unexpectedStates.length === 0 &&
    input.sourceCompleteness?.status === 'complete' &&
    derived.runCorrelation.lifecycleStageStatus === 'terminal' &&
    derived.runCorrelation.evidenceStageStatus === 'present';
  derived.quality = complete ? 'complete' : supportedCount > 0 ? 'partial' : 'unknown';
  derived.diagnostics = sortDiagnostics(derived.diagnostics);
  return derived;
}
