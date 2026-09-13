import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const spikeDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(spikeDirectory, '..', '..', '..');
const fixtureDirectory = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'providers',
  'calle',
  'grounded-reading',
);
const manifestPath = path.join(fixtureDirectory, 'manifest.json');
const simulatedFixturePath = path.join(fixtureDirectory, 'simulated-edge-cases.json');
const evaluatorPath = path.join(spikeDirectory, 'evaluate-fixture.mjs');
const fixtureMatrixPath = path.join(
  repositoryRoot,
  'docs',
  'spikes',
  'grounded-reading-extraction',
  'fixture-matrix.md',
);
const evidenceProtocolPath = path.join(
  repositoryRoot,
  'docs',
  'spikes',
  'grounded-reading-extraction',
  'evidence-protocol.md',
);
const goNoGoDecisionPath = path.join(
  repositoryRoot,
  'docs',
  'spikes',
  'grounded-reading-extraction',
  'go-no-go-decision.md',
);
const gitignorePath = path.join(repositoryRoot, '.gitignore');

const requiredFixtureFields = [
  'fixtureId',
  'fixtureRevisionId',
  'revision',
  'lifecycleStatus',
  'coverageTags',
  'proofScope',
  'provenance',
  'custody',
  'availability',
  'reviewStatus',
  'artifactRefs',
  'expectedZoneInventoryRef',
  'adapterReportShapeRef',
  'lineage',
  'expectedQuality',
  'requiredDecisionGates',
];
const artifactReferenceRequiredFields = [
  'path',
  'recordId',
  'pointer',
  'sha256',
  'recordRole',
];
const committedRecordRoles = [
  'provider_lifecycle',
  'retained_evidence',
  'reviewed_evidence_assertion',
  'structured_provider_output',
  'reviewed_ground_truth',
  'expected_derived',
];
const provenanceClasses = [
  'provider_observed',
  'primary_source',
  'hardware_observed',
  'simulated',
  'repository_review',
  'derived',
  'inferred',
  'unknown',
];
const custodyClasses = [
  'protected_external',
  'repository_redacted',
  'repository_reviewed',
  'runtime_only',
];
const availabilityStates = [
  'present',
  'unavailable',
  'withheld_by_policy',
  'unresolvable',
];
const requiredAcquisitionGates = [
  ['explicit_authorization', 'authorization_reviewer'],
  ['capture_policy', 'capture_policy_reviewer'],
  ['protected_storage', 'protected_custody_reviewer'],
  ['provider_configuration', 'provider_configuration_reviewer'],
  ['redaction', 'redaction_reviewer'],
  ['source_correlation', 'source_correlation_reviewer'],
  ['source_review', 'independent_source_reviewer'],
  ['responsible_operator', 'authorized_operator'],
  ['responsible_reviewer', 'independent_evidence_reviewer'],
  ['provider_observed_samples', 'final_audit_reviewer'],
];
const repositoryReferenceContract = {
  allowedFixtureRoot: 'tests/fixtures/providers/calle/grounded-reading/',
  recordIdPattern: '^[a-z0-9][a-z0-9_-]{2,127}$',
  opaqueRunReferencePattern: '^run_ref_[a-z0-9][a-z0-9_-]{15,63}$',
  simulatedRunReferencePattern: '^sim_run_ref_[a-z0-9][a-z0-9_-]{15,63}$',
  opaqueProtectedEvidenceReferencePattern:
    '^evidence_ref_[a-z0-9][a-z0-9_-]{15,63}$',
};
const fixtureValidationContract = {
  committedRecordRoles,
  fixtureProvenanceClasses: ['provider_observed', 'simulated'],
  custodyClasses,
  availabilityStates,
  proofScopes: ['contract_only', 'calle_result_contract'],
  lifecycleStatuses: ['active', 'superseded', 'withdrawn'],
  reviewStatuses: ['reviewed', 'unreviewed', 'review_blocked'],
  expectedQualities: ['complete', 'partial', 'unknown', 'invalid'],
  repositoryReferenceContract,
};

async function readRequiredText(filePath, purpose) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${purpose} is missing at ${path.relative(repositoryRoot, filePath)}`);
    }
    throw error;
  }
}

async function readManifest() {
  const source = await readRequiredText(manifestPath, 'Phase 1 fixture manifest');
  return parseManifest(source);
}

async function readSimulatedFixtureSet() {
  const source = await readRequiredText(
    simulatedFixturePath,
    'Phase 2 SIMULATED fixture set',
  );
  return JSON.parse(source);
}

async function loadEvaluator() {
  return import(pathToFileURL(evaluatorPath).href);
}

function recordByRole(fixtureRevision, recordRole) {
  const matches = fixtureRevision.records.filter((record) => record.recordRole === recordRole);
  assert.equal(matches.length, 1, `${fixtureRevision.fixtureId} must have one ${recordRole} record`);
  return matches[0];
}

function fixtureById(fixtureSet, fixtureId) {
  const matches = fixtureSet.fixtureRevisions.filter((fixture) => fixture.fixtureId === fixtureId);
  assert.equal(matches.length, 1, `expected one fixture revision for ${fixtureId}`);
  return matches[0];
}

function createObservationInput(fixtureSet, fixtureRevision) {
  const lifecycle = recordByRole(fixtureRevision, 'provider_lifecycle');
  const retainedEvidence = recordByRole(fixtureRevision, 'retained_evidence');
  const evidenceAssertions = recordByRole(
    fixtureRevision,
    'reviewed_evidence_assertion',
  );
  const structuredProviderOutput = recordByRole(
    fixtureRevision,
    'structured_provider_output',
  );

  return {
    evaluatorPolicyVersion: fixtureSet.groundingPolicy.policyVersion,
    groundingPolicy: structuredClone(fixtureSet.groundingPolicy),
    fixtureIdentity: {
      fixtureId: fixtureRevision.fixtureId,
      fixtureVersion: fixtureRevision.revision,
      fixtureRevisionId: fixtureRevision.fixtureRevisionId,
      fixtureProvenance: fixtureRevision.provenance,
      proofScope: fixtureRevision.proofScope,
      displayLabel: fixtureRevision.displayLabel,
    },
    opaqueRunRef: fixtureRevision.opaqueRunRef,
    lifecycleFacts: [structuredClone(lifecycle)],
    evidenceRecords: structuredClone(retainedEvidence.evidenceRecords),
    evidenceAssertions: structuredClone(evidenceAssertions.assertions),
    structuredResult: structuredClone(structuredProviderOutput.result),
    expectedZones: structuredClone(fixtureRevision.expectedZoneInventory.zones),
    expectedDeviceStates: structuredClone(fixtureRevision.expectedDeviceStates),
    sourceCompleteness: structuredClone(fixtureRevision.sourceCompleteness),
  };
}

function expectedDerivedFor(fixtureRevision) {
  return recordByRole(fixtureRevision, 'expected_derived');
}

function assertDerivedMatchesReviewedExpectation(fixtureRevision, derived) {
  const expected = expectedDerivedFor(fixtureRevision);
  assert.equal(derived.quality, expected.quality);
  assert.deepEqual(
    derived.zoneReconciliation.map(({ zoneId, status }) => ({ zoneId, status })),
    expected.zoneReconciliation,
  );
  assert.deepEqual(
    [...new Set(derived.diagnostics.map(({ code }) => code))].sort(),
    [...expected.reasonCodes].sort(),
  );
  assert.equal(derived.provenanceSummary.displayLabel, 'SIMULATED');
  assert.equal(derived.provenanceSummary.fixtureProvenance, 'simulated');
  assert.equal(derived.provenanceSummary.proofScope, 'contract_only');
  assert.equal(derived.operationalDecisionAllowed, false);
  assert.equal(JSON.stringify(derived).includes('normal_observed'), false);
  verifyReviewedGroundTruth(fixtureRevision, derived);
}

function parseManifest(source) {
  try {
    return JSON.parse(source);
  } catch {
    assert.fail('Phase 1 fixture manifest is not valid JSON');
  }
}

function assertExactClosedSet(actual, expected, label) {
  assert.ok(Array.isArray(actual), `${label} must be an array`);
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} must be the exact closed set`,
  );
  assert.equal(new Set(actual).size, actual.length, `${label} must not contain duplicates`);
}

function assertRequiredFields(value, requiredFields, label) {
  assert.equal(typeof value, 'object', `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  for (const field of requiredFields) {
    assert.ok(Object.hasOwn(value, field), `${label} is missing required field ${field}`);
  }
}

function validateOpaqueReference(value, pattern, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.match(value, new RegExp(pattern, 'u'), `${label} must be opaque and repository-safe`);
}

function validateRepositoryArtifactReference(reference, contract) {
  assertRequiredFields(reference, artifactReferenceRequiredFields, 'artifact reference');
  assert.equal(typeof reference.path, 'string', 'artifact reference path must be a string');
  assert.notEqual(reference.path, '', 'artifact reference path must not be empty');
  assert.equal(reference.path.includes('\\'), false, 'backslashes are forbidden');
  assert.doesNotMatch(reference.path, /^[a-z][a-z0-9+.-]*:/iu, 'URLs are forbidden');
  assert.doesNotMatch(reference.path, /^[a-z]:\//iu, 'drive-absolute paths are forbidden');
  assert.equal(path.posix.isAbsolute(reference.path), false, 'absolute paths are forbidden');
  assert.equal(
    reference.path.split('/').includes('..'),
    false,
    'parent traversal is forbidden',
  );
  assert.equal(
    path.posix.normalize(reference.path),
    reference.path,
    'artifact reference path must be normalized POSIX syntax',
  );

  // Resolve from the allowed POSIX root so similarly prefixed sibling paths cannot escape it.
  const allowedRoot = contract.repositoryReferenceContract.allowedFixtureRoot.replace(/\/$/u, '');
  const relativePath = path.posix.relative(allowedRoot, reference.path);
  assert.notEqual(relativePath, '', 'artifact reference must name a file below the fixture root');
  assert.equal(relativePath === '..' || relativePath.startsWith('../'), false);
  assert.equal(path.posix.isAbsolute(relativePath), false);

  validateOpaqueReference(
    reference.recordId,
    contract.repositoryReferenceContract.recordIdPattern,
    'record ID',
  );
  assert.match(reference.pointer, /^\/(?:[^/~]|~[01])*?(?:\/(?:[^/~]|~[01])*)*$/u);
  assert.match(reference.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(contract.committedRecordRoles.includes(reference.recordRole));
}

function validateFixture(fixture, contract) {
  assertRequiredFields(fixture, requiredFixtureFields, 'fixture');
  assert.match(fixture.fixtureId, /^[a-z0-9][a-z0-9_-]*$/u);
  assert.match(fixture.fixtureRevisionId, /^[a-z0-9][a-z0-9_-]*$/u);
  assert.ok(Number.isInteger(fixture.revision) && fixture.revision > 0);
  assert.ok(contract.fixtureProvenanceClasses.includes(fixture.provenance));
  assert.ok(contract.custodyClasses.includes(fixture.custody));
  assert.ok(contract.availabilityStates.includes(fixture.availability));
  assert.ok(contract.proofScopes.includes(fixture.proofScope));
  assert.ok(contract.lifecycleStatuses.includes(fixture.lifecycleStatus));
  assert.ok(contract.reviewStatuses.includes(fixture.reviewStatus));
  assert.ok(contract.expectedQualities.includes(fixture.expectedQuality));
  assert.ok(Array.isArray(fixture.coverageTags) && fixture.coverageTags.length > 0);
  assert.ok(Array.isArray(fixture.requiredDecisionGates) && fixture.requiredDecisionGates.length > 0);
  assert.ok(Array.isArray(fixture.artifactRefs) && fixture.artifactRefs.length > 0);
  assert.equal(fixture.availability, 'present', 'committed fixture material must be present');
  if (fixture.lifecycleStatus === 'active') {
    assert.equal(fixture.reviewStatus, 'reviewed', 'an active fixture revision must be reviewed');
  }

  const artifactRoles = new Set();
  const recordIds = new Set();
  for (const artifactRef of fixture.artifactRefs) {
    validateRepositoryArtifactReference(artifactRef, contract);
    assert.equal(
      recordIds.has(artifactRef.recordId),
      false,
      `duplicate immutable record ID ${artifactRef.recordId}`,
    );
    recordIds.add(artifactRef.recordId);
    assert.equal(
      artifactRoles.has(artifactRef.recordRole),
      false,
      `duplicate artifact record role ${artifactRef.recordRole}`,
    );
    artifactRoles.add(artifactRef.recordRole);
  }
  assert.deepEqual([...artifactRoles].sort(), [...contract.committedRecordRoles].sort());

  if (fixture.provenance === 'simulated') {
    assert.equal(fixture.proofScope, 'contract_only');
    assert.equal(fixture.custody, 'repository_reviewed');
    assert.equal(fixture.displayLabel, 'SIMULATED');
    validateOpaqueReference(
      fixture.opaqueRunRef,
      contract.repositoryReferenceContract.simulatedRunReferencePattern,
      'simulated opaque run reference',
    );
  }

  if (fixture.provenance === 'provider_observed') {
    assert.equal(fixture.proofScope, 'calle_result_contract');
    assert.equal(fixture.custody, 'repository_redacted');
    assert.notEqual(fixture.displayLabel, 'SIMULATED');
    validateOpaqueReference(
      fixture.opaqueRunRef,
      contract.repositoryReferenceContract.opaqueRunReferencePattern,
      'opaque run reference',
    );
  }

  assert.equal(typeof fixture.lineage, 'object');
  assert.notEqual(fixture.lineage, null);
  if (fixture.revision === 1) {
    assert.equal(fixture.lineage.supersedes, null);
  } else {
    assertRequiredFields(
      fixture.lineage,
      ['supersedes', 'correctionReason', 'reviewedAt', 'reviewerRole', 'basisRefs'],
      'correction lineage',
    );
    assert.match(fixture.lineage.supersedes, /^[a-z0-9][a-z0-9_-]*$/u);
    assert.ok(fixture.lineage.correctionReason.length > 0);
    assert.match(fixture.lineage.reviewedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
    assert.ok(fixture.lineage.reviewerRole.length > 0);
    assert.ok(Array.isArray(fixture.lineage.basisRefs) && fixture.lineage.basisRefs.length > 0);
  }
}

function validateFixtureInventory(fixtures, contract) {
  assert.ok(Array.isArray(fixtures));
  const fixtureRevisionIds = new Set();
  const fixtureVersions = new Set();
  for (const fixture of fixtures) {
    validateFixture(fixture, contract);
    assert.equal(fixtureRevisionIds.has(fixture.fixtureRevisionId), false);
    fixtureRevisionIds.add(fixture.fixtureRevisionId);
    const fixtureVersionKey = `${fixture.fixtureId}@${fixture.revision}`;
    assert.equal(fixtureVersions.has(fixtureVersionKey), false);
    fixtureVersions.add(fixtureVersionKey);
  }
}

function createTestArtifactReferences() {
  return committedRecordRoles.map((recordRole, index) => ({
    path: `tests/fixtures/providers/calle/grounded-reading/test-local-${recordRole}.json`,
    recordId: `${recordRole}_001`,
    pointer: `/records/${index}`,
    sha256: `${index}`.repeat(64),
    recordRole,
  }));
}

function createValidTestFixture() {
  return {
    fixtureId: 'test_local_complete',
    fixtureRevisionId: 'test_local_complete_rev_1',
    revision: 1,
    lifecycleStatus: 'active',
    coverageTags: ['test_local_contract'],
    proofScope: 'contract_only',
    provenance: 'simulated',
    custody: 'repository_reviewed',
    availability: 'present',
    reviewStatus: 'reviewed',
    artifactRefs: createTestArtifactReferences(),
    expectedZoneInventoryRef: 'inventory_test_local_v1',
    adapterReportShapeRef: 'report_shape_test_local_v1',
    lineage: { supersedes: null },
    expectedQuality: 'complete',
    requiredDecisionGates: ['contract_only'],
    displayLabel: 'SIMULATED',
    opaqueRunRef: 'sim_run_ref_0123456789abcdef',
  };
}

function collectForbiddenProperties(value, forbiddenProperties, location = 'manifest') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectForbiddenProperties(item, forbiddenProperties, `${location}[${index}]`),
    );
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }

  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (forbiddenProperties.has(key)) {
      findings.push(childLocation);
    }
    findings.push(...collectForbiddenProperties(child, forbiddenProperties, childLocation));
  }
  return findings;
}

function normalizePropertyName(value) {
  return value.replace(/[_-]/gu, '').toLowerCase();
}

function collectForbiddenPropertyAliases(value, forbiddenProperties, location = 'artifact') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectForbiddenPropertyAliases(item, forbiddenProperties, `${location}[${index}]`),
    );
  }
  if (value === null || typeof value !== 'object') return [];

  const forbidden = new Set(
    [...forbiddenProperties].map((property) => normalizePropertyName(property)),
  );
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (forbidden.has(normalizePropertyName(key))) findings.push(childLocation);
    findings.push(...collectForbiddenPropertyAliases(child, forbiddenProperties, childLocation));
  }
  return findings;
}

async function listFilesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
    }),
  );
  return nested.flat().sort(compareAscii);
}

function isUnsafeFixturePath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return /(?:^|\/)(?:provider-observed-|provider-capture-)|(?:\.unredacted\.|\.local\.|\.recording\.|\.transcript\.)/iu.test(
    normalized,
  );
}

function findLikelyProtectedValues(source, label) {
  const patterns = [
    ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ['phone', /\b(?:\+?1[ .-]?)?\(?[2-9][0-9]{2}\)?[ .-][0-9]{3}[ .-][0-9]{4}\b/u],
    ['authorization', /\b(?:Basic|Bearer)[ \t]+[A-Za-z0-9+/_=-]{8,}\b/u],
    [
      'secret-assignment',
      /\b(?:api[_-]?key|password|secret|token|credential)[ \t]*[:=][ \t]*["']?[A-Za-z0-9+/_=-]{8,}/iu,
    ],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([kind]) => `${label}:${kind}`);
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveJsonPointer(document, pointer) {
  if (pointer === '') return document;
  let current = document;
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = encodedSegment.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.hasOwn(current, segment)
    ) {
      throw new Error(`MANIFEST_POINTER_UNRESOLVED:${pointer}`);
    }
    current = current[segment];
  }
  return current;
}

function validateManifestRecordGraph(manifest, containers) {
  const manifestFixtureIds = manifest.fixtures
    .map(({ fixtureId }) => fixtureId)
    .sort(compareAscii);
  const referencedPaths = [...new Set(
    manifest.fixtures.flatMap(({ artifactRefs }) => artifactRefs.map(({ path: value }) => value)),
  )].sort(compareAscii);
  const containerFixtureIds = [];

  for (const containerPath of referencedPaths) {
    const container = containers.get(containerPath);
    if (!container) throw new Error(`MANIFEST_CONTAINER_PATH_UNRESOLVED:${containerPath}`);
    if (!Array.isArray(container.fixtureRevisions)) {
      throw new Error(`MANIFEST_CONTAINER_FIXTURE_SET_MISMATCH:${containerPath}`);
    }
    containerFixtureIds.push(...container.fixtureRevisions.map(({ fixtureId }) => fixtureId));
  }
  containerFixtureIds.sort(compareAscii);
  if (JSON.stringify(containerFixtureIds) !== JSON.stringify(manifestFixtureIds)) {
    throw new Error('MANIFEST_CONTAINER_FIXTURE_SET_MISMATCH');
  }

  for (const fixture of manifest.fixtures) {
    const referencedRecordIds = [];
    for (const reference of fixture.artifactRefs) {
      const container = containers.get(reference.path);
      if (!container) throw new Error(`MANIFEST_CONTAINER_PATH_UNRESOLVED:${reference.path}`);
      const pointedRecord = resolveJsonPointer(container, reference.pointer);
      if (pointedRecord?.recordId !== reference.recordId) {
        throw new Error(`MANIFEST_RECORD_ID_MISMATCH:${reference.recordId}`);
      }
      if (pointedRecord.recordRole !== reference.recordRole) {
        throw new Error(`MANIFEST_RECORD_ROLE_MISMATCH:${reference.recordId}`);
      }

      const pointerMatch = /^\/fixtureRevisions\/(\d+)\/records\/(\d+)$/u.exec(
        reference.pointer,
      );
      if (!pointerMatch) throw new Error(`MANIFEST_POINTER_UNRESOLVED:${reference.pointer}`);
      const containerFixture = container.fixtureRevisions[Number(pointerMatch[1])];
      if (
        containerFixture?.fixtureId !== fixture.fixtureId ||
        containerFixture.fixtureRevisionId !== fixture.fixtureRevisionId
      ) {
        throw new Error(`MANIFEST_POINTER_FIXTURE_MISMATCH:${reference.recordId}`);
      }
      referencedRecordIds.push(reference.recordId);
    }

    const containerFixture = [...containers.values()]
      .flatMap(({ fixtureRevisions }) => fixtureRevisions)
      .find(({ fixtureRevisionId }) => fixtureRevisionId === fixture.fixtureRevisionId);
    const containerRecordIds = containerFixture.records
      .map(({ recordId }) => recordId)
      .sort(compareAscii);
    referencedRecordIds.sort(compareAscii);
    if (JSON.stringify(containerRecordIds) !== JSON.stringify(referencedRecordIds)) {
      throw new Error(`MANIFEST_RECORD_SET_MISMATCH:${fixture.fixtureRevisionId}`);
    }
  }
}

function failMatrixRow(label) {
  throw new Error(`MATRIX_ROW_MISMATCH:${label}`);
}

function parseMatrixCells(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function markdownSection(source, heading) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing Markdown section: ${marker}`);
  const bodyStart = start + marker.length;
  const remaining = source.slice(bodyStart);
  const nextHeading = remaining.search(/\n## /u);
  return nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
}

function parseAuditTable(source, heading, expectedColumns) {
  const rows = markdownSection(source, heading)
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('|'));
  assert.ok(rows.length >= 2, `${heading} must contain a Markdown table`);
  const parsed = rows
    .filter((line) => !/^\|\s*:?-{3,}/u.test(line))
    .map(parseMatrixCells);
  const [header, ...body] = parsed;
  assert.equal(header.length, expectedColumns, `${heading} header column count`);
  for (const [index, row] of body.entries()) {
    assert.equal(row.length, expectedColumns, `${heading} row ${index + 1} column count`);
  }
  return body;
}

function unquoteAuditToken(value) {
  const match = value.match(/^`([^`]+)`$/u);
  return match ? match[1] : value;
}

function decisionLineFrom(source) {
  const decisionLines = source.match(/^Decision: (?:GO|NO-GO)$/gmu) ?? [];
  assert.equal(decisionLines.length, 1, 'decision document must contain exactly one decision line');
  return decisionLines[0];
}

function validateDecisionContract({
  decisionLine,
  acceptanceStatuses,
  acquisitionGates,
  confidenceSemanticsStatus,
}) {
  assert.ok(
    decisionLine === 'Decision: GO' || decisionLine === 'Decision: NO-GO',
    `invalid decision line: ${decisionLine}`,
  );
  const blockers = [
    ...[...acceptanceStatuses.entries()]
      .filter(([, status]) => status !== 'PASS')
      .map(([criterion]) => criterion),
    ...acquisitionGates
      .filter(({ status }) => status !== 'PASS')
      .map(({ gateId }) => gateId),
  ];
  if (confidenceSemanticsStatus !== 'PASS') {
    blockers.push('calle_confidence_semantics');
  }
  if (decisionLine === 'Decision: GO' && blockers.length > 0) {
    throw new Error(`GO_WITH_UNMET_MANDATORY_GATE: ${blockers.join(', ')}`);
  }
}

function backtickTokens(cell) {
  return [...cell.matchAll(/`([^`]+)`/gu)].map((match) => match[1]);
}

// The matrix is a review projection, so every row is rebound to fixtures and fresh output.
function validateFixtureMatrixRows(manifest, fixtureSet, matrix, evaluateObservation) {
  const lines = matrix.split(/\r?\n/u);
  const headerLine = lines.find((line) => line.startsWith('| Fixture revision |'));
  if (!headerLine) failMatrixRow('header-missing');
  const headers = parseMatrixCells(headerLine);
  if (JSON.stringify(headers) !== JSON.stringify(manifest.fixtureMatrixContract.requiredColumns)) {
    failMatrixRow('header-columns');
  }

  const rows = new Map();
  for (const line of lines) {
    if (!line.startsWith('| `')) continue;
    const cells = parseMatrixCells(line);
    const identity = /^`([^`]+)` \(`([^`]+)`\)$/u.exec(cells[0] ?? '');
    if (!identity) continue;
    const [, fixtureRevisionId, fixtureId] = identity;
    if (rows.has(fixtureId)) failMatrixRow(`duplicate:${fixtureId}`);
    rows.set(fixtureId, { cells, fixtureRevisionId });
  }

  const manifestFixtureIds = manifest.fixtures
    .map(({ fixtureId }) => fixtureId)
    .sort(compareAscii);
  const matrixFixtureIds = [...rows.keys()].sort(compareAscii);
  if (JSON.stringify(matrixFixtureIds) !== JSON.stringify(manifestFixtureIds)) {
    failMatrixRow('fixture-set');
  }

  const coveragePhrases = {
    complete: 'complete',
    negative_value: 'negative value',
    decimal_value: 'decimal value',
    spoken_unit: 'spoken unit',
    normalized_unit: 'normalized unit',
    device_alarm: 'device alarm',
    power_state: 'power',
    battery_state: 'battery',
    confidence_linkage: 'confidence linkage',
    input_specific_values: 'input-specific exact values',
    missing_zone: 'missing zone',
    not_applicable_zone: 'not-applicable zone',
    expected_zone_reconciliation: 'expected-zone reconciliation',
    ambiguous: 'ambiguous',
    contradictory: 'contradictory',
    truncated: 'truncated',
    null_structured_result: 'null structured result',
    unexpected_zone: 'unexpected zone',
  };

  for (const manifestFixture of manifest.fixtures) {
    const row = rows.get(manifestFixture.fixtureId);
    if (!row || row.fixtureRevisionId !== manifestFixture.fixtureRevisionId) {
      failMatrixRow(`identity:${manifestFixture.fixtureId}`);
    }
    const [
      ,
      provenanceCell,
      coverageCell,
      evidenceCell,
      truthReviewCell,
      reconciliationCell,
      expectedQualityCell,
      actualQualityCell,
      failedRuleCell,
      contractResultCell,
    ] = row.cells;
    if (
      provenanceCell !==
      `\`${manifestFixture.displayLabel}\` / \`${manifestFixture.proofScope}\``
    ) {
      failMatrixRow(`provenance:${manifestFixture.fixtureId}`);
    }
    for (const coverageTag of manifestFixture.coverageTags) {
      const phrase = coveragePhrases[coverageTag];
      if (!phrase || !coverageCell.includes(phrase)) {
        failMatrixRow(`coverage:${manifestFixture.fixtureId}:${coverageTag}`);
      }
    }

    const fixtureRevision = fixtureById(fixtureSet, manifestFixture.fixtureId);
    const evidence = recordByRole(fixtureRevision, 'retained_evidence');
    const assertions = recordByRole(fixtureRevision, 'reviewed_evidence_assertion');
    const expectedEvidenceRefs = [
      ...evidence.evidenceRecords.map(({ evidenceId }) => evidenceId),
      ...assertions.assertions.map(({ assertionId }) => assertionId),
    ].sort(compareAscii);
    if (
      JSON.stringify(backtickTokens(evidenceCell).sort(compareAscii)) !==
      JSON.stringify(expectedEvidenceRefs)
    ) {
      failMatrixRow(`evidence:${manifestFixture.fixtureId}`);
    }

    const truth = recordByRole(fixtureRevision, 'reviewed_ground_truth');
    const expectedTruthReview = [truth.recordId, truth.reviewerRole, truth.reviewedAt].sort(
      compareAscii,
    );
    if (
      JSON.stringify(backtickTokens(truthReviewCell).sort(compareAscii)) !==
      JSON.stringify(expectedTruthReview)
    ) {
      failMatrixRow(`truth-review:${manifestFixture.fixtureId}`);
    }

    const expected = expectedDerivedFor(fixtureRevision);
    const derived = evaluateObservation(createObservationInput(fixtureSet, fixtureRevision));
    if (expectedQualityCell !== `\`${expected.quality}\``) {
      failMatrixRow(`expected-quality:${manifestFixture.fixtureId}`);
    }
    if (actualQualityCell !== `\`${derived.quality}\``) {
      failMatrixRow(`actual-quality:${manifestFixture.fixtureId}`);
    }

    const expectedReconciliationTokens = [
      ...expected.zoneReconciliation.map(({ zoneId, status }) => `${zoneId}: ${status}`),
      ...expected.unexpectedZones.map(({ zoneId }) => zoneId),
      ...expected.unexpectedStates.map(({ subjectId }) => subjectId),
    ].sort(compareAscii);
    if (
      JSON.stringify(backtickTokens(reconciliationCell).sort(compareAscii)) !==
      JSON.stringify(expectedReconciliationTokens)
    ) {
      failMatrixRow(`reconciliation:${manifestFixture.fixtureId}`);
    }
    const actualReasonCodes = backtickTokens(failedRuleCell).sort(compareAscii);
    const expectedReasonCodes = [...expected.reasonCodes].sort(compareAscii);
    if (JSON.stringify(actualReasonCodes) !== JSON.stringify(expectedReasonCodes)) {
      failMatrixRow(`reasons:${manifestFixture.fixtureId}`);
    }
    if (expectedReasonCodes.length === 0 && failedRuleCell !== 'none') {
      failMatrixRow(`reasons:${manifestFixture.fixtureId}`);
    }
    if (contractResultCell === '') failMatrixRow(`contract-result:${manifestFixture.fixtureId}`);
  }
}

function failGroundTruth(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`GROUND_TRUTH_MISMATCH:${label}`);
  }
}

function confidenceLinkProjection(derived) {
  return [
    ...derived.readings,
    ...derived.alarmStates,
    ...derived.powerStates,
    ...derived.batteryStates,
  ]
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      rawLexeme: candidate.confidenceToken?.rawLexeme,
      semanticsVersion: candidate.confidenceToken?.semanticsVersion,
      sourceRef: candidate.confidenceToken?.sourceRef,
      disposition: candidate.confidenceDisposition,
    }))
    .sort((left, right) => compareAscii(left.candidateId, right.candidateId));
}

function verifyReviewedGroundTruth(fixtureRevision, derived) {
  const groundTruth = recordByRole(fixtureRevision, 'reviewed_ground_truth');
  const expected = expectedDerivedFor(fixtureRevision);
  const assertions = recordByRole(
    fixtureRevision,
    'reviewed_evidence_assertion',
  ).assertions;
  const assertionIndex = new Map(assertions.map((assertion) => [assertion.assertionId, assertion]));
  const evidenceIds = new Set(
    recordByRole(fixtureRevision, 'retained_evidence').evidenceRecords.map(
      ({ evidenceId }) => evidenceId,
    ),
  );
  assert.ok(Array.isArray(groundTruth.evidenceBasisRefs));
  for (const reference of groundTruth.evidenceBasisRefs) {
    const assertion = assertionIndex.get(reference);
    assert.ok(assertion, `ground-truth basis ${reference} must resolve`);
    assert.ok(
      evidenceIds.has(assertion.evidenceId),
      `ground-truth basis ${reference} must resolve to retained evidence`,
    );
    assert.equal(assertion.runId, fixtureRevision.opaqueRunRef);
  }

  const evidenceRecordsFor = (basisRefs) =>
    [...new Set(basisRefs.map((reference) => assertionIndex.get(reference).evidenceId))].sort(
      compareAscii,
    );

  const actualReadings = derived.readings.map(
    ({ zoneId, exactDecimal, spokenUnit, normalizedUnit, evidenceAssertionIds, evidenceIds: links }) => ({
      zoneId,
      lexeme: exactDecimal.lexeme,
      spokenUnit,
      normalizedUnit,
      evidenceBasisRefs: evidenceAssertionIds,
      evidenceRecordRefs: links,
    }),
  );
  const expectedReadings = (groundTruth.readings ?? []).map(
    ({ zoneId, lexeme, spokenUnit, normalizedUnit, evidenceBasisRefs }) => ({
      zoneId,
      lexeme,
      spokenUnit,
      normalizedUnit,
      evidenceBasisRefs,
      evidenceRecordRefs: evidenceRecordsFor(evidenceBasisRefs),
    }),
  );
  failGroundTruth('readings', actualReadings, expectedReadings);

  const actualStates = [
    ...derived.alarmStates.map((state) => ({ ...state, subjectId: state.alarmId })),
    ...derived.powerStates.map((state) => ({ ...state, subjectId: state.powerSourceId })),
    ...derived.batteryStates.map((state) => ({ ...state, subjectId: state.batteryId })),
  ]
    .map(({ kind, subjectId, normalizedState, evidenceAssertionIds, evidenceIds: links }) => ({
      kind,
      subjectId,
      normalizedState,
      evidenceBasisRefs: evidenceAssertionIds,
      evidenceRecordRefs: links,
    }))
    .sort((left, right) =>
      compareAscii(`${left.kind}:${left.subjectId}`, `${right.kind}:${right.subjectId}`),
    );
  const expectedStates = (groundTruth.states ?? [])
    .map(({ kind, subjectId, normalizedState, evidenceBasisRefs }) => ({
      kind,
      subjectId,
      normalizedState,
      evidenceBasisRefs,
      evidenceRecordRefs: evidenceRecordsFor(evidenceBasisRefs),
    }))
    .sort((left, right) =>
      compareAscii(`${left.kind}:${left.subjectId}`, `${right.kind}:${right.subjectId}`),
    );
  failGroundTruth('states', actualStates, expectedStates);
  if (groundTruth.confidenceExpectations !== undefined) {
    failGroundTruth(
      'confidence-linkage',
      confidenceLinkProjection(derived),
      [...groundTruth.confidenceExpectations].sort((left, right) =>
        compareAscii(left.candidateId, right.candidateId),
      ),
    );
  }
  failGroundTruth('quality', derived.quality, expected.quality);
  failGroundTruth(
    'zone-reconciliation',
    derived.zoneReconciliation.map(({ zoneId, status }) => ({ zoneId, status })),
    expected.zoneReconciliation,
  );
  failGroundTruth(
    'state-reconciliation',
    derived.stateReconciliation.map(({ kind, subjectId, status }) => ({
      kind,
      subjectId,
      status,
    })),
    expected.stateReconciliation,
  );
  failGroundTruth(
    'unexpected-zones',
    derived.unexpectedZones.map(({ zoneId, candidates }) => ({
      zoneId,
      candidateIds: candidates.map(({ candidateId }) => candidateId),
    })),
    expected.unexpectedZones,
  );
  failGroundTruth(
    'unexpected-states',
    derived.unexpectedStates.map(({ kind, subjectId, candidates }) => ({
      kind,
      subjectId,
      candidateIds: candidates.map(({ candidateId }) => candidateId),
    })),
    expected.unexpectedStates,
  );
  failGroundTruth(
    'missing-zones',
    derived.zoneReconciliation
      .filter(({ reasonCodes }) => reasonCodes.includes('EXPECTED_ZONE_MISSING'))
      .map(({ zoneId }) => zoneId)
      .sort(compareAscii),
    [...(groundTruth.missingZones ?? [])].sort(compareAscii),
  );
  failGroundTruth(
    'ambiguous-zones',
    derived.zoneReconciliation
      .filter(
        ({ status, reasonCodes }) =>
          status === 'ambiguous' && !reasonCodes.includes('SOURCE_TRUNCATED'),
      )
      .map(({ zoneId }) => zoneId)
      .sort(compareAscii),
    [...(groundTruth.ambiguousZones ?? [])].sort(compareAscii),
  );
  failGroundTruth(
    'contradictions',
    derived.zoneReconciliation
      .filter(({ status }) => status === 'contradictory')
      .map(({ zoneId, candidates }) => ({
        zoneId,
        lexemes: candidates
          .map(({ exactDecimal }) => exactDecimal.lexeme)
          .sort(compareAscii),
      }))
      .sort((left, right) => compareAscii(left.zoneId, right.zoneId)),
    (groundTruth.contradictions ?? [])
      .map(({ zoneId, lexemes }) => ({
        zoneId,
        lexemes: [...lexemes].sort(compareAscii),
      }))
      .sort((left, right) => compareAscii(left.zoneId, right.zoneId)),
  );
  failGroundTruth(
    'truncated-subjects',
    [
      ...derived.zoneReconciliation
        .filter(({ reasonCodes }) => reasonCodes.includes('SOURCE_TRUNCATED'))
        .map(({ zoneId }) => zoneId),
      ...derived.stateReconciliation
        .filter(({ reasonCodes }) => reasonCodes.includes('SOURCE_TRUNCATED'))
        .map(({ subjectId }) => subjectId),
    ].sort(compareAscii),
    [...(groundTruth.truncatedSubjects ?? [])].sort(compareAscii),
  );
  failGroundTruth(
    'unexpected-zone-declarations',
    derived.unexpectedZones.map(({ zoneId }) => zoneId).sort(compareAscii),
    [...(groundTruth.unexpectedZones ?? [])].sort(compareAscii),
  );
  failGroundTruth(
    'reason-codes',
    [...new Set(derived.diagnostics.map(({ code }) => code))].sort(compareAscii),
    [...expected.reasonCodes].sort(compareAscii),
  );
}

test('manifest declares unique immutable fixture revisions and every required field', async () => {
  const manifest = await readManifest();
  const validFixture = createValidTestFixture();

  assert.doesNotThrow(() => validateFixtureInventory([validFixture], fixtureValidationContract));

  const reusedRecordIdFixture = structuredClone(validFixture);
  reusedRecordIdFixture.artifactRefs[1].recordId =
    reusedRecordIdFixture.artifactRefs[0].recordId;
  assert.notEqual(
    reusedRecordIdFixture.artifactRefs[1].recordRole,
    reusedRecordIdFixture.artifactRefs[0].recordRole,
  );
  assert.throws(() => validateFixture(reusedRecordIdFixture, fixtureValidationContract));

  const invalidFixtures = [
    { ...structuredClone(validFixture), provenance: 'provider_observed' },
    { ...structuredClone(validFixture), proofScope: 'calle_result_contract' },
    { ...structuredClone(validFixture), artifactRefs: [] },
    { ...structuredClone(validFixture), lifecycleStatus: 'draft' },
    { ...structuredClone(validFixture), reviewStatus: 'rubber_stamped' },
    { ...structuredClone(validFixture), provenance: 'schema_valid' },
    { ...structuredClone(validFixture), provenance: 'primary_source' },
    { ...structuredClone(validFixture), opaqueRunRef: 'provider-native-id-123' },
    { ...structuredClone(validFixture), lineage: 'accepted' },
    {
      ...structuredClone(validFixture),
      fixtureRevisionId: 'test_local_complete_rev_2',
      revision: 2,
      lineage: { supersedes: null },
    },
  ];
  for (const invalidFixture of invalidFixtures) {
    assert.throws(() => validateFixture(invalidFixture, fixtureValidationContract));
  }
  assert.throws(() =>
    validateFixtureInventory([validFixture, structuredClone(validFixture)], fixtureValidationContract),
  );

  assert.match(manifest.contractVersion, /^1\.[0-9]+\.[0-9]+$/u);
  assert.equal(Number.isInteger(manifest.manifestRevision), true);
  assert.ok(manifest.manifestRevision > 0);
  assert.equal(manifest.evaluatorVersion, 'grounded-reading-extraction/phase-2-v2');
  assert.deepEqual(manifest.fixtureContract.requiredFields, requiredFixtureFields);
  assert.deepEqual(
    manifest.fixtureContract.artifactReferenceRequiredFields,
    artifactReferenceRequiredFields,
  );
  assert.deepEqual(manifest.fixtureContract.requiredArtifactRoles, committedRecordRoles);
  assert.deepEqual(
    manifest.fixtureContract.fixtureProvenanceClasses,
    fixtureValidationContract.fixtureProvenanceClasses,
  );
  assert.deepEqual(manifest.fixtureContract.reviewStatuses, fixtureValidationContract.reviewStatuses);
  assert.deepEqual(
    manifest.fixtureContract.expectedQualities,
    fixtureValidationContract.expectedQualities,
  );
  assert.deepEqual(manifest.fixtureContract.requiredIndependentAxes, [
    'provenance',
    'custody',
    'availability',
  ]);
  assert.deepEqual(manifest.inventoryContract.requiredFields, [
    'inventoryId',
    'version',
    'adapterReportShapeRef',
    'shapeVerification',
    'zones',
  ]);
  assert.match(manifest.runtimeObservation.nodeVersion, /^v\d+\.\d+\.\d+$/u);
  assert.equal(
    manifest.runtimeObservation.scope,
    'local_spike_observation_not_production_decision',
  );
  assert.deepEqual(manifest.lineageContract.uniqueKeys, [
    'fixtureRevisionId',
    'fixtureId+revision',
  ]);
  assert.equal(manifest.lineageContract.positiveRevisionRequired, true);
  assert.equal(manifest.lineageContract.atMostOneActiveRevisionPerFixtureId, true);
  assert.equal(manifest.lineageContract.acyclic, true);
  assert.equal(manifest.lineageContract.contiguous, true);
  assert.equal(manifest.lineageContract.semanticCorrectionRequiresNewRevision, true);
  assert.equal(manifest.lineageContract.lateMaterialRequiresNewRevision, true);
  assert.equal(manifest.lineageContract.lastWriteWinsPermitted, false);
  assert.equal(manifest.lineageContract.supersededRecordsRemainAuditable, true);
  assert.deepEqual(manifest.lineageContract.correctionRequiredFields, [
    'supersedes',
    'correctionReason',
    'reviewedAt',
    'reviewerRole',
    'basisRefs',
  ]);
  assert.ok(Array.isArray(manifest.fixtures));
  assert.deepEqual(manifest.recordGraphIntegrity, {
    resolveEveryJsonPointer: true,
    pointedRecordIdMustMatch: true,
    pointedRecordRoleMustMatch: true,
    pointedFixtureRevisionMustMatch: true,
    manifestAndContainerFixtureIdSetsMustMatch: true,
    manifestAndContainerRecordIdSetsMustMatch: true,
  });

  validateFixtureInventory(manifest.fixtures, fixtureValidationContract);
});

test('provenance, custody, availability, proof scope, and record role use closed sets', async () => {
  const manifest = await readManifest();

  assertExactClosedSet(
    manifest.closedSets.committedRecordRoles,
    committedRecordRoles,
    'committed record roles',
  );
  assertExactClosedSet(
    manifest.closedSets.runtimeOnlyRecordRoles,
    ['actual_derived'],
    'runtime-only record roles',
  );
  assertExactClosedSet(
    manifest.closedSets.provenanceClasses,
    provenanceClasses,
    'provenance classes',
  );
  assertExactClosedSet(
    manifest.closedSets.custodyClasses,
    custodyClasses,
    'custody classes',
  );
  assertExactClosedSet(
    manifest.closedSets.availabilityStates,
    availabilityStates,
    'availability states',
  );
  assertExactClosedSet(
    manifest.closedSets.proofScopes,
    ['contract_only', 'calle_result_contract'],
    'proof scopes',
  );
  assertExactClosedSet(
    manifest.closedSets.fixtureLifecycleStatuses,
    ['active', 'superseded', 'withdrawn'],
    'fixture lifecycle statuses',
  );
  assertExactClosedSet(
    manifest.closedSets.reviewStatuses,
    fixtureValidationContract.reviewStatuses,
    'fixture review statuses',
  );
  assertExactClosedSet(
    manifest.closedSets.expectedQualities,
    fixtureValidationContract.expectedQualities,
    'expected qualities',
  );
  assert.deepEqual(manifest.fixtureContract.provenanceProofScopeRules, {
    simulated: {
      proofScope: 'contract_only',
      custody: 'repository_reviewed',
      displayLabel: 'SIMULATED',
      opaqueRunReferencePattern: 'simulatedRunReferencePattern',
    },
    provider_observed: {
      proofScope: 'calle_result_contract',
      custody: 'repository_redacted',
      displayLabelForbidden: 'SIMULATED',
      opaqueRunReferencePattern: 'opaqueRunReferencePattern',
    },
  });
  assert.equal(manifest.recordRoleContract.exclusiveRolePerRecord, true);
  assertExactClosedSet(
    Object.keys(manifest.recordRoleContract.committedRoles),
    committedRecordRoles,
    'role-separated committed record contract',
  );
  assert.deepEqual(manifest.recordRoleContract.runtimeOnlyRole, {
    role: 'actual_derived',
    fixtureMutationPermitted: false,
    mayBecomeGroundTruth: false,
  });

  for (const fixture of manifest.fixtures) {
    assert.ok(provenanceClasses.includes(fixture.provenance));
    assert.ok(custodyClasses.includes(fixture.custody));
    assert.ok(availabilityStates.includes(fixture.availability));
    assert.ok(manifest.closedSets.proofScopes.includes(fixture.proofScope));
    for (const artifactRef of fixture.artifactRefs) {
      assert.ok(committedRecordRoles.includes(artifactRef.recordRole));
      assert.notEqual(artifactRef.recordRole, 'actual_derived');
    }
  }
});

test('authorization and unavailable provider evidence fail closed without placeholder observed evidence', async () => {
  const protocol = await readRequiredText(evidenceProtocolPath, 'Phase 1 evidence protocol');
  const manifest = await readManifest();
  const requiredProtocolHeadings = [
    '## Authorization gate',
    '## Protected storage gate',
    '## Capture gate',
    '## Redaction gate',
    '## Provenance and admission gate',
    '## Review gate',
    '## Unavailability gate',
    '## Repository boundary and evidence references',
    '## Runtime and harness boundary',
  ];
  for (const heading of requiredProtocolHeadings) {
    assert.ok(protocol.includes(heading), `evidence protocol is missing ${heading}`);
  }
  assert.ok(protocol.includes('No external provider or hardware activity is authorized'));
  assert.ok(protocol.includes('Decision: NO-GO'));
  assert.ok(protocol.includes('SIMULATED'));
  assert.ok(protocol.includes(manifest.runtimeObservation.nodeVersion));
  assert.ok(protocol.includes('Native alarms remain authoritative.'));
  assert.ok(protocol.includes('DTMF is prohibited.'));
  assert.ok(protocol.includes('Device control is prohibited.'));
  assert.ok(protocol.includes('opaque protected-evidence reference'));
  assert.ok(protocol.includes('opaque run reference'));
  assert.equal(protocol.includes('opaque external reference'), false);

  const requiredGateIds = requiredAcquisitionGates.map(([gateId]) => gateId);
  assert.deepEqual(
    manifest.evidenceAcquisition.requiredGates.map(({ gateId }) => gateId),
    requiredGateIds,
  );
  assert.equal(manifest.evidenceAcquisition.externalActivityAuthorized, false);
  assert.equal(manifest.evidenceAcquisition.currentDecision, 'Decision: NO-GO');
  for (const gate of manifest.evidenceAcquisition.requiredGates) {
    assertRequiredFields(
      gate,
      [
        'gateId',
        'availability',
        'activityPermitted',
        'decisionImpact',
        'responsibleRole',
        'reconsiderationRequirement',
      ],
      `evidence gate ${gate.gateId}`,
    );
    assert.equal(gate.availability, 'unavailable');
    assert.equal(gate.activityPermitted, false);
    assert.equal(gate.decisionImpact, 'Decision: NO-GO');
    assert.equal(
      gate.responsibleRole,
      requiredAcquisitionGates.find(([gateId]) => gateId === gate.gateId)[1],
    );
    assert.doesNotMatch(
      gate.responsibleRole,
      /placeholder|responsible_role|tbd|todo|unknown|unassigned/iu,
    );
    assert.doesNotMatch(
      gate.reconsiderationRequirement,
      /placeholder|responsible_role|tbd|todo|unknown|unassigned/iu,
    );
    assert.ok(protocol.includes(`\`${gate.gateId}\``));
    assert.ok(protocol.includes(`\`${gate.responsibleRole}\``));
  }

  const forbiddenPlaceholderProperties = new Set([
    'artifactPath',
    'digest',
    'evidenceRef',
    'nativeProviderId',
    'opaqueRunRef',
    'payload',
    'providerFixturePath',
    'recording',
    'transcript',
  ]);
  assert.deepEqual(
    collectForbiddenProperties(
      manifest.evidenceAcquisition,
      forbiddenPlaceholderProperties,
      'manifest.evidenceAcquisition',
    ),
    [],
    'unavailable evidence gates must not contain placeholder evidence, run, path, or digest data',
  );
  assert.equal(
    manifest.fixtures.some((fixture) => fixture.provenance === 'provider_observed'),
    false,
  );

  const fixtureFiles = await readdir(fixtureDirectory);
  assert.deepEqual(
    fixtureFiles.filter((name) => /^provider-observed-.*\.json$/u.test(name)),
    [],
    'conditional provider-observed fixtures must not exist before admission gates pass',
  );
});

test('repository evidence references are opaque, contained, and protected by defense-in-depth ignores', async () => {
  const manifest = await readManifest();
  const gitignore = await readRequiredText(gitignorePath, 'repository ignore policy');
  const validReference = createTestArtifactReferences()[0];

  assert.doesNotThrow(() =>
    validateRepositoryArtifactReference(validReference, fixtureValidationContract),
  );
  validateOpaqueReference(
    'evidence_ref_0123456789abcdef',
    repositoryReferenceContract.opaqueProtectedEvidenceReferencePattern,
    'opaque protected-evidence reference',
  );

  const referencesWithMissingRequiredFields = artifactReferenceRequiredFields.map((missingField) =>
    Object.fromEntries(Object.entries(validReference).filter(([key]) => key !== missingField)),
  );
  const invalidReferences = [
    { ...validReference, path: 'tests\\fixtures\\providers\\calle\\record.json' },
    {
      ...validReference,
      path: 'tests/fixtures/providers/calle/grounded-reading\\..\\protected.json',
    },
    { ...validReference, path: 'C:/protected/record.json' },
    { ...validReference, path: 'C:\\protected\\record.json' },
    { ...validReference, path: '/protected/record.json' },
    { ...validReference, path: '//server/share/record.json' },
    {
      ...validReference,
      path: 'tests/fixtures/providers/calle/grounded-reading/../protected.json',
    },
    { ...validReference, path: 'https://example.invalid/record.json' },
    ...referencesWithMissingRequiredFields,
    { ...validReference, recordId: 'invalid/record id' },
    { ...validReference, sha256: 'not-a-digest' },
  ];
  for (const invalidReference of invalidReferences) {
    assert.throws(() =>
      validateRepositoryArtifactReference(invalidReference, fixtureValidationContract),
    );
  }
  assert.throws(() =>
    validateOpaqueReference(
      'provider-native-id-123',
      repositoryReferenceContract.opaqueProtectedEvidenceReferencePattern,
      'opaque protected-evidence reference',
    ),
  );

  const secretFragment = 'S3CRET999';
  assert.throws(
    () => parseManifest(`${secretFragment}{"contractVersion":"1.0.0"}`),
    (error) => {
      assert.equal(error.message, 'Phase 1 fixture manifest is not valid JSON');
      assert.equal(error.message.includes(secretFragment), false);
      return true;
    },
  );

  assert.deepEqual(manifest.repositorySafety, {
    repositoryReferenceKind: 'repository_relative',
    allowedFixtureRoot: 'tests/fixtures/providers/calle/grounded-reading/',
    protectedEvidenceReferenceKind: 'opaque_protected_evidence_reference_only',
    recordIdPattern: repositoryReferenceContract.recordIdPattern,
    opaqueRunReferencePattern: repositoryReferenceContract.opaqueRunReferencePattern,
    simulatedRunReferencePattern: repositoryReferenceContract.simulatedRunReferencePattern,
    opaqueProtectedEvidenceReferencePattern:
      repositoryReferenceContract.opaqueProtectedEvidenceReferencePattern,
    forbiddenRepositoryReferenceForms: [
      'absolute_path',
      'parent_traversal',
      'url',
      'protected_evidence_path',
      'native_provider_identifier',
    ],
    forbiddenCommittedContent: [
      'target',
      'phone_number',
      'credential',
      'authorization_header',
      'raw_consent',
      'recording',
      'transcript',
      'unredacted_provider_payload',
    ],
  });

  const allowedRoot = manifest.repositorySafety.allowedFixtureRoot;
  for (const fixture of manifest.fixtures) {
    for (const artifactRef of fixture.artifactRefs) {
      validateRepositoryArtifactReference(artifactRef, fixtureValidationContract);
      assert.ok(artifactRef.path.startsWith(allowedRoot));
    }
  }

  const requiredIgnoreEntries = [
    'evidence/grounded-reading-extraction/',
    'tests/fixtures/providers/calle/grounded-reading/*.unredacted.*',
    'tests/fixtures/providers/calle/grounded-reading/*.local.*',
    'tests/fixtures/providers/calle/grounded-reading/provider-capture-*',
  ];
  const ignoreLines = new Set(
    gitignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  for (const entry of requiredIgnoreEntries) {
    assert.ok(ignoreLines.has(entry), `.gitignore is missing defense-in-depth rule ${entry}`);
  }
});

test('SIMULATED matrix has a dedicated assertion target for every Phase 2 reading and uncertainty class', async () => {
  const manifest = await readManifest();
  const fixtureSet = await readSimulatedFixtureSet();
  const matrix = await readRequiredText(fixtureMatrixPath, 'Phase 2 fixture matrix');
  const fixtureSource = await readRequiredText(
    simulatedFixturePath,
    'Phase 2 SIMULATED fixture set',
  );
  const actualDigest = createHash('sha256').update(fixtureSource).digest('hex');
  const coverage = new Set(manifest.fixtures.flatMap(({ coverageTags }) => coverageTags));

  assert.ok(coverage.has('complete'));
  assert.ok(coverage.has('negative_value'));
  assert.ok(coverage.has('decimal_value'));
  assert.ok(coverage.has('spoken_unit'));
  assert.ok(coverage.has('normalized_unit'));
  assert.ok(coverage.has('device_alarm'));
  assert.ok(coverage.has('power_state'));
  assert.ok(coverage.has('battery_state'));
  assert.ok(coverage.has('confidence_linkage'));
  assert.ok(coverage.has('missing_zone'));
  assert.ok(coverage.has('not_applicable_zone'));
  assert.ok(coverage.has('unexpected_zone'));
  assert.ok(coverage.has('ambiguous'));
  assert.ok(coverage.has('contradictory'));
  assert.ok(coverage.has('truncated'));
  assert.ok(coverage.has('null_structured_result'));

  assert.equal(manifest.fixtures.length, 9);
  assert.equal(fixtureSet.fixtureRevisions.length, manifest.fixtures.length);
  assert.equal(manifest.fixtureMatrixContract.fixtureCount, manifest.fixtures.length);
  assert.deepEqual(
    manifest.fixtureMatrixContract.requiredCoverageTags,
    fixtureSet.requiredCoverageTags,
  );
  const expectedMatrixHeader = `| ${manifest.fixtureMatrixContract.requiredColumns.join(' | ')} |`;
  assert.ok(matrix.includes(expectedMatrixHeader));
  validateManifestRecordGraph(
    manifest,
    new Map([[manifest.fixtureMatrixContract.fixtureContainerPath, fixtureSet]]),
  );
  for (const fixture of manifest.fixtures) {
    assert.equal(fixture.displayLabel, 'SIMULATED');
    assert.equal(fixture.provenance, 'simulated');
    assert.equal(fixture.proofScope, 'contract_only');
    assert.ok(matrix.includes(`\`${fixture.fixtureId}\``));
    const fixtureRevision = fixtureById(fixtureSet, fixture.fixtureId);
    const evidence = recordByRole(fixtureRevision, 'retained_evidence');
    const assertions = recordByRole(fixtureRevision, 'reviewed_evidence_assertion');
    const truth = recordByRole(fixtureRevision, 'reviewed_ground_truth');
    for (const { evidenceId } of evidence.evidenceRecords) assert.ok(matrix.includes(`\`${evidenceId}\``));
    for (const { assertionId } of assertions.assertions) assert.ok(matrix.includes(`\`${assertionId}\``));
    assert.ok(matrix.includes(`\`${truth.recordId}\``));
    assert.ok(matrix.includes(`\`${truth.reviewerRole}\``));
    assert.ok(matrix.includes(`\`${truth.reviewedAt}\``));
    for (const artifactRef of fixture.artifactRefs) {
      assert.equal(artifactRef.path, manifest.fixtureMatrixContract.fixtureContainerPath);
      assert.equal(artifactRef.sha256, actualDigest);
    }
  }
  assert.equal(JSON.stringify(fixtureSet).includes('actual_derived'), false);

  const { evaluateObservation } = await loadEvaluator();
  const completeFixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const derived = evaluateObservation(createObservationInput(fixtureSet, completeFixture));
  assertDerivedMatchesReviewedExpectation(completeFixture, derived);

  for (const fixtureRevision of fixtureSet.fixtureRevisions) {
    verifyReviewedGroundTruth(
      fixtureRevision,
      evaluateObservation(createObservationInput(fixtureSet, fixtureRevision)),
    );
  }
});

test('signed decimal lexemes preserve exact sign, precision, and input-specific values without numeric coercion', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const primaryFixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const secondaryFixture = fixtureById(fixtureSet, 'sim_complete_secondary');
  const { evaluateObservation, parseExactDecimal } = await loadEvaluator();

  assert.deepEqual(parseExactDecimal('-4.5'), {
    lexeme: '-4.5',
    signToken: '-',
    integralDigits: '4',
    fractionalDigits: '5',
    scale: 1,
  });
  assert.deepEqual(parseExactDecimal('13.50'), {
    lexeme: '13.50',
    signToken: '',
    integralDigits: '13',
    fractionalDigits: '50',
    scale: 2,
  });
  assert.throws(() => parseExactDecimal(-4.5));
  assert.throws(() => parseExactDecimal('4e1'));

  const primaryInput = createObservationInput(fixtureSet, primaryFixture);
  assert.equal(Object.hasOwn(primaryInput, 'groundTruth'), false);
  assert.equal(Object.hasOwn(primaryInput, 'expectedDerived'), false);
  const changedGroundTruthFixture = structuredClone(primaryFixture);
  recordByRole(changedGroundTruthFixture, 'reviewed_ground_truth').readings[0].lexeme = '-999.0';
  assert.deepEqual(
    createObservationInput(fixtureSet, changedGroundTruthFixture),
    primaryInput,
    'changing ground truth alone must not change evaluator input',
  );

  const primary = evaluateObservation(primaryInput);
  const secondary = evaluateObservation(createObservationInput(fixtureSet, secondaryFixture));
  assert.deepEqual(
    primary.readings.map(({ zoneId, exactDecimal }) => [zoneId, exactDecimal.lexeme]),
    [
      ['zone_freezer', '-4.5'],
      ['zone_incubator', '12.25'],
    ],
  );
  assert.deepEqual(
    secondary.readings.map(({ zoneId, exactDecimal }) => [zoneId, exactDecimal.lexeme]),
    [
      ['zone_freezer', '-6.75'],
      ['zone_incubator', '13.50'],
    ],
  );
  assert.notDeepEqual(primary.readings, secondary.readings);
  assertDerivedMatchesReviewedExpectation(primaryFixture, primary);
  assertDerivedMatchesReviewedExpectation(secondaryFixture, secondary);
});

test('spoken units and exact normalized units remain separately evidence-linked', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));

  assert.deepEqual(
    derived.readings.map(
      ({ zoneId, spokenUnit, normalizedUnit, unitMappingRuleId, evidenceAssertionIds }) => ({
        zoneId,
        spokenUnit,
        normalizedUnit,
        unitMappingRuleId,
        evidenceAssertionIds,
      }),
    ),
    [
      {
        zoneId: 'zone_freezer',
        spokenUnit: 'degrees Fahrenheit',
        normalizedUnit: '[degF]',
        unitMappingRuleId: 'unit_degrees_fahrenheit_to_ucum_v1',
        evidenceAssertionIds: [
          'assert_primary_freezer_decimal',
          'assert_primary_freezer_spoken_unit',
        ],
      },
      {
        zoneId: 'zone_incubator',
        spokenUnit: 'degrees Celsius',
        normalizedUnit: 'Cel',
        unitMappingRuleId: 'unit_degrees_celsius_to_ucum_v1',
        evidenceAssertionIds: [
          'assert_primary_incubator_decimal',
          'assert_primary_incubator_spoken_unit',
        ],
      },
    ],
  );
  assertDerivedMatchesReviewedExpectation(fixture, derived);
});

test('alarm, power, and battery states stay discriminated from measurements and from each other', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));

  assert.deepEqual(
    derived.alarmStates.map(({ kind, alarmId, normalizedState }) => ({
      kind,
      alarmId,
      normalizedState,
    })),
    [{ kind: 'alarm_state', alarmId: 'alarm_primary', normalizedState: 'active' }],
  );
  assert.deepEqual(
    derived.powerStates.map(({ kind, powerSourceId, normalizedState }) => ({
      kind,
      powerSourceId,
      normalizedState,
    })),
    [{ kind: 'power_state', powerSourceId: 'power_primary', normalizedState: 'mains_available' }],
  );
  assert.deepEqual(
    derived.batteryStates.map(({ kind, batteryId, normalizedState }) => ({
      kind,
      batteryId,
      normalizedState,
    })),
    [{ kind: 'battery_state', batteryId: 'battery_primary', normalizedState: 'normal' }],
  );
  assert.equal(derived.readings.some(({ kind }) => kind !== 'measurement'), false);
  assertDerivedMatchesReviewedExpectation(fixture, derived);
});

test('expected-zone reconciliation names every expected zone and never infers the dedicated missing-zone reading', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_missing_zone');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));

  assert.deepEqual(
    derived.zoneReconciliation.map(({ zoneId, status }) => ({ zoneId, status })),
    [
      { zoneId: 'zone_freezer', status: 'supported' },
      { zoneId: 'zone_incubator', status: 'missing' },
    ],
  );
  assert.equal(derived.readings.some(({ zoneId }) => zoneId === 'zone_incubator'), false);
  assert.equal(derived.unexpectedZones.length, 0);
  assert.equal(derived.quality, 'partial');
  assert.ok(derived.diagnostics.some(({ code }) => code === 'EXPECTED_ZONE_MISSING'));
  assertDerivedMatchesReviewedExpectation(fixture, derived);
});

test('equivalent duplicate candidates remain visible as ambiguous and fail closed', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_ambiguous_duplicate');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));
  const freezer = derived.zoneReconciliation.find(({ zoneId }) => zoneId === 'zone_freezer');

  assert.equal(freezer.status, 'ambiguous');
  assert.deepEqual(freezer.candidateIds, [
    'candidate_ambiguous_freezer_a',
    'candidate_ambiguous_freezer_b',
  ]);
  assert.equal(derived.readings.some(({ zoneId }) => zoneId === 'zone_freezer'), false);
  assert.notEqual(derived.quality, 'complete');
  assert.ok(
    derived.diagnostics.some(({ code }) => code === 'DUPLICATE_EQUIVALENT_CANDIDATES'),
  );
  assertDerivedMatchesReviewedExpectation(fixture, derived);
});

test('contradictory -4.5 and +4.5 candidates remain visible with no convenient winner', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_contradictory_sign');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));
  const freezer = derived.zoneReconciliation.find(({ zoneId }) => zoneId === 'zone_freezer');

  assert.equal(freezer.status, 'contradictory');
  assert.deepEqual(
    freezer.candidates.map(({ exactDecimal }) => exactDecimal.lexeme),
    ['-4.5', '+4.5'],
  );
  assert.equal(derived.readings.some(({ zoneId }) => zoneId === 'zone_freezer'), false);
  assert.notEqual(derived.quality, 'complete');
  assert.ok(derived.diagnostics.some(({ code }) => code === 'EVIDENCE_CONTRADICTORY'));
  assertDerivedMatchesReviewedExpectation(fixture, derived);
});

test('truncated source anchors preserve supported readings while blocking affected readings and completeness', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_truncated_report');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));

  assert.deepEqual(derived.readings.map(({ zoneId }) => zoneId), ['zone_freezer']);
  assert.equal(
    derived.zoneReconciliation.find(({ zoneId }) => zoneId === 'zone_incubator').status,
    'ambiguous',
  );
  assert.equal(derived.quality, 'partial');
  assert.ok(derived.diagnostics.some(({ code }) => code === 'SOURCE_TRUNCATED'));
  assertDerivedMatchesReviewedExpectation(fixture, derived);
});

test('explicit null structured result retains correlation but emits no invented reading or normal state', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_null_structured_result');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));

  assert.equal(derived.runCorrelation.structuredResultStageStatus, 'null');
  assert.equal(derived.quality, 'unknown');
  assert.deepEqual(derived.readings, []);
  assert.deepEqual(derived.alarmStates, []);
  assert.deepEqual(derived.powerStates, []);
  assert.deepEqual(derived.batteryStates, []);
  assert.ok(derived.diagnostics.some(({ code }) => code === 'NULL_STRUCTURED_RESULT'));
  assertDerivedMatchesReviewedExpectation(fixture, derived);
});

test('competing active same-run evidence assertions veto a single referenced candidate without selecting a winner', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const { evaluateObservation } = await loadEvaluator();

  const contradictoryInput = createObservationInput(fixtureSet, fixture);
  contradictoryInput.evidenceAssertions.push({
    assertionId: 'assert_primary_freezer_competing_positive',
    evidenceId: 'evidence_primary_001',
    runId: contradictoryInput.opaqueRunRef,
    reviewStatus: 'reviewed',
    subjectKind: 'measurement',
    subjectId: 'zone_freezer',
    fieldPath: 'exactDecimal.lexeme',
    assertedValue: '+4.5',
  });
  const contradictory = evaluateObservation(contradictoryInput);
  const contradictoryFreezer = contradictory.zoneReconciliation.find(
    ({ zoneId }) => zoneId === 'zone_freezer',
  );
  assert.equal(contradictoryFreezer.status, 'contradictory');
  assert.equal(contradictory.readings.some(({ zoneId }) => zoneId === 'zone_freezer'), false);
  assert.notEqual(contradictory.quality, 'complete');
  assert.ok(
    contradictory.diagnostics.some(({ code }) => code === 'EVIDENCE_CONTRADICTORY'),
  );

  const equivalentInput = createObservationInput(fixtureSet, fixture);
  equivalentInput.evidenceAssertions.push({
    assertionId: 'assert_primary_freezer_equivalent_duplicate',
    evidenceId: 'evidence_primary_001',
    runId: equivalentInput.opaqueRunRef,
    reviewStatus: 'reviewed',
    subjectKind: 'measurement',
    subjectId: 'zone_freezer',
    fieldPath: 'exactDecimal.lexeme',
    assertedValue: '-4.5',
  });
  const equivalent = evaluateObservation(equivalentInput);
  assert.equal(
    equivalent.zoneReconciliation.find(({ zoneId }) => zoneId === 'zone_freezer').status,
    'ambiguous',
  );
  assert.notEqual(equivalent.quality, 'complete');
});

test('confidence source references must resolve to same-run evidence linked to the candidate', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const { evaluateObservation } = await loadEvaluator();

  const danglingInput = createObservationInput(fixtureSet, fixture);
  danglingInput.structuredResult.value.measurements[0].confidenceToken.sourceRef =
    'evidence_dangling_001';
  const dangling = evaluateObservation(danglingInput);
  assert.equal(dangling.quality, 'invalid');
  assert.ok(dangling.diagnostics.some(({ code }) => code === 'EVIDENCE_REF_DANGLING'));

  const crossRunInput = createObservationInput(fixtureSet, fixture);
  crossRunInput.evidenceRecords.push({
    evidenceId: 'evidence_cross_run_001',
    runId: 'sim_run_ref_cross_run_confidence_01',
    availability: 'present',
    reviewStatus: 'reviewed',
    sourceRevision: 1,
  });
  crossRunInput.structuredResult.value.measurements[0].confidenceToken.sourceRef =
    'evidence_cross_run_001';
  const crossRun = evaluateObservation(crossRunInput);
  assert.equal(crossRun.quality, 'invalid');
  assert.ok(crossRun.diagnostics.some(({ code }) => code === 'EVIDENCE_REF_CROSS_RUN'));
});

test('null structured results validate run and selected-revision identity before reducing to unknown', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_null_structured_result');
  const { evaluateObservation } = await loadEvaluator();

  const crossRunInput = createObservationInput(fixtureSet, fixture);
  crossRunInput.structuredResult.runId = 'sim_run_ref_conflicting_null_0001';
  const crossRun = evaluateObservation(crossRunInput);
  assert.equal(crossRun.quality, 'invalid');
  assert.ok(crossRun.diagnostics.some(({ code }) => code === 'EVIDENCE_REF_CROSS_RUN'));

  const conflictingRevisionInput = createObservationInput(fixtureSet, fixture);
  conflictingRevisionInput.structuredResult.resultRevisionId = 'result_null_rev_conflict';
  const conflictingRevision = evaluateObservation(conflictingRevisionInput);
  assert.equal(conflictingRevision.quality, 'invalid');
  assert.ok(
    conflictingRevision.diagnostics.some(
      ({ code }) => code === 'RESULT_REVISION_AMBIGUOUS',
    ),
  );
});

test('derived output is byte-stable under permutations of every input collection', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const { evaluateObservation } = await loadEvaluator();
  const baselineInput = createObservationInput(fixtureSet, fixture);

  for (const suffix of ['b', 'a']) {
    const candidate = structuredClone(baselineInput.structuredResult.value.measurements[0]);
    candidate.candidateId = `candidate_unexpected_${suffix}`;
    candidate.zoneId = 'zone_unexpected';
    candidate.evidenceRefs = {
      'exactDecimal.lexeme': `assert_unexpected_${suffix}_decimal`,
      spokenUnit: `assert_unexpected_${suffix}_unit`,
    };
    baselineInput.structuredResult.value.measurements.push(candidate);
    baselineInput.evidenceAssertions.push(
      {
        assertionId: `assert_unexpected_${suffix}_decimal`,
        evidenceId: 'evidence_primary_001',
        runId: baselineInput.opaqueRunRef,
        reviewStatus: 'reviewed',
        subjectKind: 'measurement',
        subjectId: 'zone_unexpected',
        fieldPath: 'exactDecimal.lexeme',
        assertedValue: '-4.5',
      },
      {
        assertionId: `assert_unexpected_${suffix}_unit`,
        evidenceId: 'evidence_primary_001',
        runId: baselineInput.opaqueRunRef,
        reviewStatus: 'reviewed',
        subjectKind: 'measurement',
        subjectId: 'zone_unexpected',
        fieldPath: 'spokenUnit',
        assertedValue: 'degrees Fahrenheit',
      },
    );
  }

  const duplicateAlarm = structuredClone(
    baselineInput.structuredResult.value.alarmStates[0],
  );
  duplicateAlarm.candidateId = 'candidate_primary_alarm_duplicate';
  duplicateAlarm.evidenceRefs.spokenState = 'assert_primary_alarm_state_duplicate';
  baselineInput.structuredResult.value.alarmStates.push(duplicateAlarm);
  baselineInput.evidenceAssertions.push({
    assertionId: 'assert_primary_alarm_state_duplicate',
    evidenceId: 'evidence_primary_001',
    runId: baselineInput.opaqueRunRef,
    reviewStatus: 'reviewed',
    subjectKind: 'alarm_state',
    subjectId: 'alarm_primary',
    fieldPath: 'spokenState',
    assertedValue: 'alarm active',
  });

  const permutedInput = structuredClone(baselineInput);
  permutedInput.lifecycleFacts.reverse();
  permutedInput.evidenceRecords.reverse();
  permutedInput.evidenceAssertions.reverse();
  permutedInput.expectedZones.reverse();
  permutedInput.expectedDeviceStates.reverse();
  permutedInput.sourceCompleteness.affectedSubjectIds.reverse();
  for (const collection of ['measurements', 'alarmStates', 'powerStates', 'batteryStates']) {
    permutedInput.structuredResult.value[collection].reverse();
  }

  const baseline = evaluateObservation(baselineInput);
  const permuted = evaluateObservation(permutedInput);
  assert.deepEqual(permuted, baseline);
  assert.equal(JSON.stringify(permuted), JSON.stringify(baseline));
});

test('independent reviewed-ground-truth verification detects drift without influencing evaluation', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const { evaluateObservation } = await loadEvaluator();
  const input = createObservationInput(fixtureSet, fixture);
  const derived = evaluateObservation(input);

  assert.doesNotThrow(() => verifyReviewedGroundTruth(fixture, derived));

  const driftedFixture = structuredClone(fixture);
  recordByRole(driftedFixture, 'reviewed_ground_truth').readings[0].lexeme = '-999.0';
  const derivedAfterDrift = evaluateObservation(
    createObservationInput(fixtureSet, driftedFixture),
  );
  assert.deepEqual(derivedAfterDrift, derived);
  assert.throws(
    () => verifyReviewedGroundTruth(driftedFixture, derivedAfterDrift),
    /GROUND_TRUTH_MISMATCH/u,
  );
});

test('manifest immutable record graph resolves every pointer and matches record and fixture identity', async () => {
  const manifest = await readManifest();
  const fixtureSet = await readSimulatedFixtureSet();
  const containers = new Map([
    [manifest.fixtureMatrixContract.fixtureContainerPath, fixtureSet],
  ]);

  assert.doesNotThrow(() => validateManifestRecordGraph(manifest, containers));

  const brokenPointer = structuredClone(manifest);
  brokenPointer.fixtures[0].artifactRefs[0].pointer = '/fixtureRevisions/0/records/99';
  assert.throws(
    () => validateManifestRecordGraph(brokenPointer, containers),
    /MANIFEST_POINTER_UNRESOLVED/u,
  );

  const misdirectedPointer = structuredClone(manifest);
  misdirectedPointer.fixtures[0].artifactRefs[0].pointer = '/fixtureRevisions/0/records/1';
  assert.throws(
    () => validateManifestRecordGraph(misdirectedPointer, containers),
    /MANIFEST_RECORD_ID_MISMATCH/u,
  );

  const missingContainerFixture = structuredClone(fixtureSet);
  missingContainerFixture.fixtureRevisions.pop();
  assert.throws(
    () =>
      validateManifestRecordGraph(
        manifest,
        new Map([[manifest.fixtureMatrixContract.fixtureContainerPath, missingContainerFixture]]),
      ),
    /MANIFEST_CONTAINER_FIXTURE_SET_MISMATCH/u,
  );
});

test('committed SIMULATED unexpected-zone fixture stays visible and blocks complete quality', async () => {
  const manifest = await readManifest();
  const fixtureSet = await readSimulatedFixtureSet();
  const matrix = await readRequiredText(fixtureMatrixPath, 'Phase 2 fixture matrix');
  const fixture = fixtureById(fixtureSet, 'sim_unexpected_zone');
  const manifestFixture = manifest.fixtures.find(
    ({ fixtureId }) => fixtureId === fixture.fixtureId,
  );
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));

  assert.ok(manifestFixture.coverageTags.includes('unexpected_zone'));
  assert.equal(manifestFixture.displayLabel, 'SIMULATED');
  assert.equal(manifestFixture.proofScope, 'contract_only');
  assert.deepEqual(
    derived.unexpectedZones.map(({ zoneId }) => zoneId),
    ['zone_unexpected'],
  );
  assert.equal(derived.quality, 'partial');
  assert.ok(derived.diagnostics.some(({ code }) => code === 'UNEXPECTED_ZONE'));
  assert.ok(matrix.includes('`sim_unexpected_zone`'));
  assertDerivedMatchesReviewedExpectation(fixture, derived);
  verifyReviewedGroundTruth(fixture, derived);
});

async function assertGroundTruthSemanticDriftRejected(fixtureId, mutateGroundTruth) {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, fixtureId);
  const { evaluateObservation } = await loadEvaluator();
  const baseline = evaluateObservation(createObservationInput(fixtureSet, fixture));
  assert.doesNotThrow(() => verifyReviewedGroundTruth(fixture, baseline));

  const driftedFixture = structuredClone(fixture);
  mutateGroundTruth(recordByRole(driftedFixture, 'reviewed_ground_truth'));
  const derivedAfterDrift = evaluateObservation(
    createObservationInput(fixtureSet, driftedFixture),
  );
  assert.deepEqual(derivedAfterDrift, baseline);
  assert.throws(
    () => verifyReviewedGroundTruth(driftedFixture, derivedAfterDrift),
    /GROUND_TRUTH_MISMATCH/u,
  );
}

function mutateMatrixFixtureRow(matrix, fixtureId, transform) {
  let found = false;
  const mutated = matrix
    .split(/\r?\n/u)
    .map((line) => {
      if (!line.includes(`(\`${fixtureId}\`)`)) return line;
      found = true;
      return transform(line);
    })
    .join('\n');
  assert.equal(found, true, `matrix row ${fixtureId} must exist before mutation`);
  return mutated;
}

test('null and absent reduction validates every evidence record and assertion correlation first', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_null_structured_result');
  const { evaluateObservation } = await loadEvaluator();

  const ordinaryNull = evaluateObservation(createObservationInput(fixtureSet, fixture));
  assert.equal(ordinaryNull.quality, 'unknown');
  assert.ok(ordinaryNull.diagnostics.some(({ code }) => code === 'NULL_STRUCTURED_RESULT'));

  const ordinaryAbsentInput = createObservationInput(fixtureSet, fixture);
  ordinaryAbsentInput.structuredResult.state = 'absent';
  const ordinaryAbsent = evaluateObservation(ordinaryAbsentInput);
  assert.equal(ordinaryAbsent.quality, 'unknown');
  assert.ok(
    ordinaryAbsent.diagnostics.some(({ code }) => code === 'STRUCTURED_RESULT_ABSENT'),
  );

  const crossRunRecordInput = createObservationInput(fixtureSet, fixture);
  crossRunRecordInput.evidenceRecords[0].runId = 'sim_run_ref_conflicting_null_evidence';
  const crossRunRecord = evaluateObservation(crossRunRecordInput);
  assert.equal(crossRunRecord.quality, 'invalid');
  assert.ok(
    crossRunRecord.diagnostics.some(({ code }) => code === 'EVIDENCE_REF_CROSS_RUN'),
  );

  const conflictingRevisionInput = createObservationInput(fixtureSet, fixture);
  conflictingRevisionInput.evidenceRecords[0].sourceRevision = 2;
  const conflictingRevision = evaluateObservation(conflictingRevisionInput);
  assert.equal(conflictingRevision.quality, 'invalid');
  assert.ok(
    conflictingRevision.diagnostics.some(
      ({ code }) => code === 'RESULT_REVISION_AMBIGUOUS',
    ),
  );

  const crossRunAssertionInput = createObservationInput(fixtureSet, fixture);
  crossRunAssertionInput.evidenceAssertions.push({
    assertionId: 'assert_null_cross_run',
    evidenceId: 'evidence_null_001',
    runId: 'sim_run_ref_conflicting_null_assertion',
    reviewStatus: 'reviewed',
    subjectKind: 'measurement',
    subjectId: 'zone_freezer',
    fieldPath: 'exactDecimal.lexeme',
    assertedValue: '-4.5',
  });
  const crossRunAssertion = evaluateObservation(crossRunAssertionInput);
  assert.equal(crossRunAssertion.quality, 'invalid');
  assert.ok(
    crossRunAssertion.diagnostics.some(({ code }) => code === 'EVIDENCE_REF_CROSS_RUN'),
  );

  const danglingAssertionInput = createObservationInput(fixtureSet, fixture);
  danglingAssertionInput.evidenceAssertions.push({
    assertionId: 'assert_null_dangling',
    evidenceId: 'evidence_null_dangling',
    runId: danglingAssertionInput.opaqueRunRef,
    reviewStatus: 'reviewed',
    subjectKind: 'measurement',
    subjectId: 'zone_freezer',
    fieldPath: 'exactDecimal.lexeme',
    assertedValue: '-4.5',
  });
  const danglingAssertion = evaluateObservation(danglingAssertionInput);
  assert.equal(danglingAssertion.quality, 'invalid');
  assert.ok(
    danglingAssertion.diagnostics.some(({ code }) => code === 'EVIDENCE_REF_DANGLING'),
  );
});

test('reviewed ground truth missingZones drift cannot diverge from derived reconciliation', async () => {
  await assertGroundTruthSemanticDriftRejected('sim_missing_zone', (groundTruth) => {
    groundTruth.missingZones = [];
  });
});

test('reviewed ground truth ambiguousZones drift cannot diverge from derived ambiguity', async () => {
  await assertGroundTruthSemanticDriftRejected('sim_ambiguous_duplicate', (groundTruth) => {
    groundTruth.ambiguousZones = [];
  });
});

test('reviewed ground truth contradiction drift cannot change exact conflicting lexemes', async () => {
  await assertGroundTruthSemanticDriftRejected('sim_contradictory_sign', (groundTruth) => {
    groundTruth.contradictions[0].lexemes[1] = '+999.0';
  });
});

test('reviewed ground truth truncatedSubjects drift cannot diverge from truncation reasons', async () => {
  await assertGroundTruthSemanticDriftRejected('sim_truncated_report', (groundTruth) => {
    groundTruth.truncatedSubjects = [];
  });
});

test('reviewed ground truth unexpectedZones drift cannot hide derived unexpected groups', async () => {
  await assertGroundTruthSemanticDriftRejected('sim_unexpected_zone', (groundTruth) => {
    groundTruth.unexpectedZones = [];
  });
});

test('matrix validator binds evidence, review, quality, reconciliation, and coverage to each exact fixture row', async () => {
  const manifest = await readManifest();
  const fixtureSet = await readSimulatedFixtureSet();
  const matrix = await readRequiredText(fixtureMatrixPath, 'Phase 2 fixture matrix');
  const { evaluateObservation } = await loadEvaluator();

  assert.doesNotThrow(() =>
    validateFixtureMatrixRows(manifest, fixtureSet, matrix, evaluateObservation),
  );

  const rowMutations = [
    (line) =>
      line.replace(
        '`assert_missing_freezer_decimal`',
        '`assert_secondary_freezer_decimal`',
      ),
    (line) => line.replace('`truth_missing_zone`', '`truth_complete_primary`'),
    (line) => line.replace('`2026-08-03T20:02:00Z`', '`2026-08-03T20:01:00Z`'),
    (line) => line.replace('| `partial` | `partial` |', '| `complete` | `partial` |'),
    (line) => line.replace('| `partial` | `partial` |', '| `partial` | `complete` |'),
    (line) => line.replace('`zone_incubator: missing`', '`zone_incubator: supported`'),
    (line) => line.replace('missing zone; expected-zone reconciliation', 'complete'),
  ];
  for (const mutateRow of rowMutations) {
    const driftedMatrix = mutateMatrixFixtureRow(
      matrix,
      'sim_missing_zone',
      mutateRow,
    );
    assert.notEqual(driftedMatrix, matrix, 'matrix mutation must change its target row');
    assert.throws(
      () =>
        validateFixtureMatrixRows(
          manifest,
          fixtureSet,
          driftedMatrix,
          evaluateObservation,
        ),
      /MATRIX_ROW_MISMATCH/u,
    );
  }
});

test('Phase 3 records the missing provider-observed pair while SIMULATED anti-stub inputs remain contract-only', async () => {
  const manifest = await readManifest();
  const fixtureSet = await readSimulatedFixtureSet();
  const matrix = await readRequiredText(fixtureMatrixPath, 'Phase 3 provider assessment');
  const { evaluateObservation } = await loadEvaluator();
  const assessment = manifest.phase3ProviderAssessment;

  assert.equal(manifest.contractVersion, '1.4.0');
  assert.equal(manifest.manifestRevision, 5);
  assertRequiredFields(
    assessment,
    [
      'assessmentVersion',
      'assessedAt',
      'externalActivityAttempted',
      'providerObservedPair',
      'syntheticAntiStub',
      'decisionImpact',
    ],
    'Phase 3 provider assessment',
  );
  assert.equal(assessment.assessmentVersion, 'grounded-reading-extraction/phase-3-v1');
  assert.match(assessment.assessedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
  assert.equal(assessment.externalActivityAttempted, false);
  assert.deepEqual(assessment.providerObservedPair, {
    requiredCount: 2,
    admittedCount: 0,
    status: 'UNMET',
    inputSpecificityStatus: 'not_evaluable_without_admitted_pair',
    reasonCodes: ['PROVIDER_OBSERVED_PAIR_MISSING'],
  });

  const primary = evaluateObservation(
    createObservationInput(fixtureSet, fixtureById(fixtureSet, 'sim_complete_primary')),
  );
  const secondary = evaluateObservation(
    createObservationInput(fixtureSet, fixtureById(fixtureSet, 'sim_complete_secondary')),
  );
  assert.notDeepEqual(primary.readings, secondary.readings);
  assert.deepEqual(assessment.syntheticAntiStub, {
    fixtureIds: ['sim_complete_primary', 'sim_complete_secondary'],
    inputSpecificContractCheck: 'PASS',
    proofScope: 'contract_only',
    providerGateSatisfied: false,
  });
  assert.equal(assessment.decisionImpact, 'Decision: NO-GO');
  assert.equal(manifest.fixtures.some(({ provenance }) => provenance === 'provider_observed'), false);
  assert.ok(matrix.includes('## Phase 3 provider evidence assessment'));
  assert.ok(matrix.includes('`PROVIDER_OBSERVED_PAIR_MISSING`'));
  assert.ok(matrix.includes('`AC-INTEGRATION-1`: `UNMET`'));
});

test('Phase 3 provider/run correlation remains explicitly unevaluable without an admitted run', async () => {
  const manifest = await readManifest();
  const assessment = manifest.phase3ProviderAssessment;

  assert.deepEqual(assessment.providerRunCorrelation, {
    status: 'UNMET',
    observedRunCount: 0,
    requiredStages: [
      'provider_lifecycle',
      'retained_evidence',
      'structured_provider_output',
      'reviewed_ground_truth',
    ],
    missingStages: [
      'provider_lifecycle',
      'retained_evidence',
      'structured_provider_output',
      'reviewed_ground_truth',
    ],
    reasonCodes: [
      'LIFECYCLE_STAGE_MISSING',
      'EVIDENCE_STAGE_MISSING',
      'STRUCTURED_RESULT_ABSENT',
    ],
  });
  assert.deepEqual(
    collectForbiddenProperties(
      assessment.providerRunCorrelation,
      new Set(['artifactPath', 'evidenceRef', 'nativeProviderId', 'opaqueRunRef', 'payload']),
      'manifest.phase3ProviderAssessment.providerRunCorrelation',
    ),
    [],
  );
});

test('Phase 3 lineage assessment forbids late, duplicate, or correction claims without provider revisions', async () => {
  const manifest = await readManifest();
  const assessment = manifest.phase3ProviderAssessment;

  assert.deepEqual(assessment.providerLineage, {
    status: 'UNMET',
    observedRevisionCount: 0,
    lateMaterialStatus: 'not_observed',
    duplicateMaterialStatus: 'not_observed',
    correctionStatus: 'not_observed',
    lastWriteWinsPermitted: false,
    reasonCodes: ['PROVIDER_OBSERVED_PAIR_MISSING'],
  });
  assert.equal(manifest.lineageContract.lateMaterialRequiresNewRevision, true);
  assert.equal(manifest.lineageContract.semanticCorrectionRequiresNewRevision, true);
  assert.equal(manifest.lineageContract.lastWriteWinsPermitted, false);
  assert.equal(manifest.lineageContract.supersededRecordsRemainAuditable, true);
});

test('Phase 3 unavailable evidence path enforces provenance, privacy, and acceptance impact without provider fixtures', async () => {
  const manifest = await readManifest();
  const protocol = await readRequiredText(evidenceProtocolPath, 'Phase 3 evidence protocol');
  const matrix = await readRequiredText(fixtureMatrixPath, 'Phase 3 provider assessment');
  const fixtureFiles = await listFilesRecursively(fixtureDirectory);
  const assessment = manifest.phase3ProviderAssessment;

  assert.deepEqual(assessment.privacyAndAdmission, {
    status: 'UNMET',
    activityPermitted: false,
    providerFixtureFilesCreated: false,
    protectedContentCommitted: false,
    reasonCodes: ['PRIVACY_OR_AUTHORIZATION_GATE_UNMET'],
  });
  assert.deepEqual(assessment.acceptance, {
    'AC-INTEGRATION-1': 'UNMET',
    'AC-ASYNC-1': 'UNMET',
    'AC-ERROR-2': 'PASS',
  });
  assert.deepEqual(
    fixtureFiles
      .map((filePath) => path.relative(repositoryRoot, filePath).replaceAll('\\', '/'))
      .filter((name) => isUnsafeFixturePath(name)),
    [],
  );
  for (const unsafePath of [
    'provider-observed-a.redacted.json',
    'nested/provider-capture-a.json',
    'nested/capture.unredacted.json',
    'nested/capture.local.json',
    'nested/capture.recording.json',
    'nested/capture.transcript.json',
  ]) {
    assert.equal(isUnsafeFixturePath(unsafePath), true, `${unsafePath} must be rejected`);
  }
  for (const safePath of ['manifest.json', 'nested/simulated-edge-cases.json']) {
    assert.equal(isUnsafeFixturePath(safePath), false, `${safePath} must remain allowed`);
  }
  const forbiddenProperties = new Set(manifest.repositorySafety.forbiddenCommittedContent);
  const jsonArtifacts = [manifestPath, ...fixtureFiles.filter((filePath) => filePath.endsWith('.json'))];
  const protectedPropertyFindings = [];
  const protectedValueFindings = [];
  for (const artifactPath of jsonArtifacts) {
    const source = await readRequiredText(artifactPath, 'repository-safe JSON artifact');
    const relativePath = path.relative(repositoryRoot, artifactPath).replaceAll('\\', '/');
    protectedPropertyFindings.push(
      ...collectForbiddenPropertyAliases(JSON.parse(source), forbiddenProperties, relativePath),
    );
    protectedValueFindings.push(...findLikelyProtectedValues(source, relativePath));
  }
  for (const [artifactPath, source] of [
    [evidenceProtocolPath, protocol],
    [fixtureMatrixPath, matrix],
  ]) {
    protectedValueFindings.push(
      ...findLikelyProtectedValues(
        source,
        path.relative(repositoryRoot, artifactPath).replaceAll('\\', '/'),
      ),
    );
  }
  assert.deepEqual(protectedPropertyFindings, []);
  assert.deepEqual(protectedValueFindings, []);
  assert.notDeepEqual(
    collectForbiddenPropertyAliases(
      { nested: { authorizationHeader: 'test-only', phone_number: 'test-only' } },
      forbiddenProperties,
      'mutated-artifact',
    ),
    [],
    'privacy scan must reject camelCase and snake_case forbidden properties',
  );
  for (const protectedMutation of [
    'reviewer@example.test',
    '(212) 555-1212',
    'Authorization: Bearer testonlytoken123',
    'api_key=testonlysecret123',
  ]) {
    assert.notDeepEqual(
      findLikelyProtectedValues(protectedMutation, 'mutated-artifact'),
      [],
      `privacy scan must reject ${protectedMutation}`,
    );
  }
  assert.ok(protocol.includes('## Phase 3 evidence re-evaluation'));
  assert.ok(protocol.includes('No external activity was attempted'));
  assert.ok(protocol.includes('`AC-ERROR-2` is `PASS`'));
  assert.ok(protocol.includes('Phase 4 still owns publication of the final decision document'));
  assert.ok(protocol.includes('`AC-INTEGRATION-1` and `AC-ASYNC-1` remain `UNMET`'));
});

test('Phase 4 audit exhaustively maps every fixture, evidence class, success metric, assertion, and 8/8 MUST criteria', async () => {
  const manifest = await readManifest();
  const matrix = await readRequiredText(fixtureMatrixPath, 'fixture matrix');
  const decision = await readRequiredText(goNoGoDecisionPath, 'Phase 4 go/no-go decision');
  const testSource = await readRequiredText(
    fileURLToPath(import.meta.url),
    'fixture-contract test source',
  );

  const fixtureRows = parseAuditTable(decision, 'Fixture and matrix row audit', 4);
  assert.equal(fixtureRows.length, manifest.fixtures.length);
  for (const fixture of manifest.fixtures) {
    const rows = fixtureRows.filter(
      ([fixtureRevisionId]) => unquoteAuditToken(fixtureRevisionId) === fixture.fixtureRevisionId,
    );
    assert.equal(rows.length, 1, `${fixture.fixtureRevisionId} must have one audit row`);
    const [, auditResult, reviewedOutcome, evidence] = rows[0];
    assert.equal(unquoteAuditToken(auditResult), 'PASS');
    assert.equal(unquoteAuditToken(reviewedOutcome), fixture.expectedQuality);
    assert.ok(matrix.includes(`\`${fixture.fixtureRevisionId}\``));
    assert.match(evidence, /`tests\/fixtures\/[^`]+manifest\.json`/u);
    assert.match(evidence, /`docs\/spikes\/[^`]+fixture-matrix\.md`/u);
  }

  const evidenceRows = parseAuditTable(decision, 'Evidence class audit', 4);
  assert.equal(evidenceRows.length, provenanceClasses.length);
  for (const provenanceClass of provenanceClasses) {
    const rows = evidenceRows.filter(
      ([evidenceClass]) => unquoteAuditToken(evidenceClass) === provenanceClass,
    );
    assert.equal(rows.length, 1, `${provenanceClass} must have one evidence-class audit row`);
    assert.notEqual(rows[0][1], '');
    assert.equal(unquoteAuditToken(rows[0][2]), 'PASS');
    assert.match(rows[0][3], /`(?:docs|tests|tools)\//u);
  }
  const simulatedNarrative = evidenceRows.find(
    ([evidenceClass]) => unquoteAuditToken(evidenceClass) === 'simulated',
  )?.[1];
  assert.ok(
    simulatedNarrative?.includes(
      `in ${manifest.fixtures.length} visibly labeled contract rows`,
    ),
    'simulated evidence narrative count must match the manifest fixture count',
  );

  const expectedSuccessMetrics = new Map([
    ['SM-01', 'PASS'],
    ['SM-02', 'PASS'],
    ['SM-03', 'UNMET'],
    ['SM-04', 'UNMET'],
    ['SM-05', 'PASS'],
    ['SM-06', 'PASS'],
    ['SM-07', 'PASS'],
  ]);
  const successRows = parseAuditTable(decision, 'Success metric audit', 4);
  assert.equal(successRows.length, expectedSuccessMetrics.size);
  for (const [metricId, expectedStatus] of expectedSuccessMetrics) {
    const rows = successRows.filter(([id]) => unquoteAuditToken(id) === metricId);
    assert.equal(rows.length, 1, `${metricId} must have one success-metric audit row`);
    assert.equal(unquoteAuditToken(rows[0][1]), expectedStatus);
    assert.notEqual(rows[0][2], '');
    assert.match(rows[0][3], /`(?:docs|tests|tools)\//u);
  }

  const expectedAcceptance = new Map([
    ['AC-VERIFY-1', 'PASS'],
    ['AC-VERIFY-2', 'PASS'],
    ['AC-INTEGRATION-1', 'UNMET'],
    ['AC-ERROR-1', 'PASS'],
    ['AC-VERIFY-3', 'PASS'],
    ['AC-ASYNC-1', 'UNMET'],
    ['AC-ERROR-2', 'PASS'],
    ['AC-VERIFY-4', 'PASS'],
  ]);
  const acceptanceRows = parseAuditTable(decision, 'Acceptance criterion audit', 4);
  assert.equal(acceptanceRows.length, expectedAcceptance.size);
  for (const [criterion, expectedStatus] of expectedAcceptance) {
    const rows = acceptanceRows.filter(([id]) => unquoteAuditToken(id) === criterion);
    assert.equal(rows.length, 1, `${criterion} must have one acceptance audit row`);
    assert.equal(unquoteAuditToken(rows[0][1]), expectedStatus);
    assert.notEqual(rows[0][2], '');
    assert.match(rows[0][3], /`(?:docs|tests|tools)\//u);
  }

  const testNames = [...testSource.matchAll(/^test\('([^']+)'/gmu)].map((match) => match[1]);
  const assertionRows = parseAuditTable(decision, 'Deterministic assertion audit', 3);
  assert.equal(assertionRows.length, testNames.length);
  for (const [index, testName] of testNames.entries()) {
    const rows = assertionRows.filter(([, assertion]) => unquoteAuditToken(assertion) === testName);
    assert.equal(rows.length, 1, `${testName} must have one deterministic assertion audit row`);
    assert.equal(unquoteAuditToken(rows[0][0]), `A${String(index + 1).padStart(2, '0')}`);
    assert.equal(unquoteAuditToken(rows[0][2]), 'PASS');
  }
});

test('Phase 4 handoff contains one NO-GO decision and all unresolved CALL-E semantics with reconsideration evidence', async () => {
  const manifest = await readManifest();
  const decision = await readRequiredText(goNoGoDecisionPath, 'Phase 4 go/no-go decision');

  assert.equal(decisionLineFrom(decision), 'Decision: NO-GO');
  assert.ok(
    decision.includes(
      'This decision does not claim Sensaphone compatibility, read-only hardware behavior, or native-alarm coexistence.',
    ),
  );
  const expectedSemantics = [
    'terminal-result payload shape and version',
    'confidence attachment scope',
    'confidence token calibration and ordering',
    'lexical decimal preservation',
    'field-level evidence anchors',
    'protected evidence span representation',
    'truncated, incomplete, late, superseded, and null results',
    'duplicate callbacks and authoritative revision identity',
    'spoken and normalized unit contract',
    'alarm, power, and battery representation',
    'lifecycle identifier stability',
    'redacted result and evidence field allowlist',
    'confidence disposition evidence threshold',
  ];
  const semanticsRows = parseAuditTable(decision, 'Unresolved CALL-E semantics', 5);
  assert.equal(semanticsRows.length, expectedSemantics.length);
  for (const [index, expectedDescription] of expectedSemantics.entries()) {
    const row = semanticsRows[index];
    assert.equal(unquoteAuditToken(row[0]), `CS-${String(index + 1).padStart(2, '0')}`);
    assert.equal(unquoteAuditToken(row[1]), 'UNRESOLVED');
    assert.ok(
      row[2].toLowerCase().includes(expectedDescription.toLowerCase()),
      `missing semantics: ${expectedDescription}`,
    );
    assert.match(row[3], /authorized provider-observed/iu);
    assert.notEqual(row[3].trim(), '');
    assert.equal(unquoteAuditToken(row[4]), 'NO-GO');
  }

  const forbiddenProperties = new Set(manifest.repositorySafety.forbiddenCommittedContent);
  assert.deepEqual(
    collectForbiddenPropertyAliases(
      { auditDocument: decision },
      forbiddenProperties,
      'go-no-go-decision.md',
    ),
    [],
  );
  assert.deepEqual(findLikelyProtectedValues(decision, 'go-no-go-decision.md'), []);
});

test('decision contract rejects GO when any mandatory evidence or safety gate is unmet', async () => {
  const manifest = await readManifest();
  const decision = await readRequiredText(goNoGoDecisionPath, 'Phase 4 go/no-go decision');
  const gateRows = parseAuditTable(decision, 'Mandatory evidence and safety gate audit', 4);

  assert.equal(gateRows.length, manifest.evidenceAcquisition.requiredGates.length);
  for (const gate of manifest.evidenceAcquisition.requiredGates) {
    const rows = gateRows.filter(([gateId]) => unquoteAuditToken(gateId) === gate.gateId);
    assert.equal(rows.length, 1, `${gate.gateId} must have one mandatory-gate audit row`);
    assert.equal(unquoteAuditToken(rows[0][1]), 'UNMET');
    assert.match(rows[0][2], /`tests\/fixtures\/[^`]+manifest\.json`/u);
    assert.ok(rows[0][3].includes(gate.reconsiderationRequirement));
  }

  const acceptanceStatuses = new Map(
    parseAuditTable(decision, 'Acceptance criterion audit', 4).map(([id, status]) => [
      unquoteAuditToken(id),
      unquoteAuditToken(status),
    ]),
  );
  const actualGates = gateRows.map(([gateId, status]) => ({
    gateId: unquoteAuditToken(gateId),
    status: unquoteAuditToken(status),
  }));
  validateDecisionContract({
    decisionLine: decisionLineFrom(decision),
    acceptanceStatuses,
    acquisitionGates: actualGates,
    confidenceSemanticsStatus: 'UNRESOLVED',
  });
  assert.throws(
    () =>
      validateDecisionContract({
        decisionLine: 'Decision: GO',
        acceptanceStatuses,
        acquisitionGates: actualGates,
        confidenceSemanticsStatus: 'UNRESOLVED',
      }),
    /GO_WITH_UNMET_MANDATORY_GATE/u,
  );

  const allAcceptancePass = new Map(
    [...acceptanceStatuses.keys()].map((criterion) => [criterion, 'PASS']),
  );
  const allGatesPass = actualGates.map(({ gateId }) => ({ gateId, status: 'PASS' }));
  for (const criterion of allAcceptancePass.keys()) {
    const oneUnmet = new Map(allAcceptancePass);
    oneUnmet.set(criterion, 'UNMET');
    assert.throws(
      () =>
        validateDecisionContract({
          decisionLine: 'Decision: GO',
          acceptanceStatuses: oneUnmet,
          acquisitionGates: allGatesPass,
          confidenceSemanticsStatus: 'PASS',
        }),
      new RegExp(`GO_WITH_UNMET_MANDATORY_GATE:.*${criterion}`, 'u'),
    );
  }
  for (const gate of allGatesPass) {
    const oneUnmet = allGatesPass.map((candidate) =>
      candidate.gateId === gate.gateId ? { ...candidate, status: 'UNMET' } : candidate,
    );
    assert.throws(
      () =>
        validateDecisionContract({
          decisionLine: 'Decision: GO',
          acceptanceStatuses: allAcceptancePass,
          acquisitionGates: oneUnmet,
          confidenceSemanticsStatus: 'PASS',
        }),
      new RegExp(`GO_WITH_UNMET_MANDATORY_GATE:.*${gate.gateId}`, 'u'),
    );
  }
  assert.throws(
    () =>
      validateDecisionContract({
        decisionLine: 'Decision: GO',
        acceptanceStatuses: allAcceptancePass,
        acquisitionGates: allGatesPass,
        confidenceSemanticsStatus: 'UNRESOLVED',
      }),
    /GO_WITH_UNMET_MANDATORY_GATE:.*calle_confidence_semantics/u,
  );
});

test('insufficient, unresolved, unavailable, and unreviewed confidence evidence omits unsupported readings', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_complete_primary');
  const decision = await readRequiredText(goNoGoDecisionPath, 'Phase 4 go/no-go decision');
  const { evaluateObservation } = await loadEvaluator();

  const confidenceCases = [
    {
      code: 'CONFIDENCE_INSUFFICIENT',
      mutate(input) {
        input.structuredResult.value.measurements[0].confidenceToken.rawLexeme = 'INSUFFICIENT';
      },
    },
    {
      code: 'CONFIDENCE_SEMANTICS_UNRESOLVED',
      mutate(input) {
        input.structuredResult.value.measurements[0].confidenceToken.semanticsVersion =
          'calle-grounding/v0-unconfigured';
      },
    },
    {
      code: 'EVIDENCE_UNAVAILABLE',
      mutate(input) {
        assert.equal(input.evidenceRecords[0].runId, input.opaqueRunRef);
        input.evidenceRecords[0].availability = 'unavailable';
      },
    },
    {
      code: 'EVIDENCE_UNREVIEWED',
      mutate(input) {
        assert.equal(input.evidenceRecords[0].runId, input.opaqueRunRef);
        input.evidenceRecords[0].reviewStatus = 'unreviewed';
      },
    },
  ];

  for (const { code, mutate } of confidenceCases) {
    const input = createObservationInput(fixtureSet, fixture);
    mutate(input);
    const derived = evaluateObservation(input);
    assert.notEqual(derived.quality, 'complete', `${code} must block complete quality`);
    assert.equal(
      derived.readings.some(({ zoneId }) => zoneId === 'zone_freezer'),
      false,
      `${code} must omit the unsupported reading`,
    );
    assert.ok(
      derived.diagnostics.some((diagnosticEntry) => diagnosticEntry.code === code),
      `${code} must be emitted exactly`,
    );
    assert.equal(derived.operationalDecisionAllowed, false);
    const acceptanceRow = parseAuditTable(decision, 'Acceptance criterion audit', 4).find(
      ([criterion]) => unquoteAuditToken(criterion) === 'AC-ERROR-1',
    );
    assert.ok(acceptanceRow?.[2].includes(`\`${code}\``), `${code} must appear in the audit`);
  }
});

test('reviewed expectations bind exact confidence linkage on every derived measurement and device state', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const fixture = fixtureById(fixtureSet, 'sim_reviewed_contract');
  const groundTruth = recordByRole(fixture, 'reviewed_ground_truth');
  const { evaluateObservation } = await loadEvaluator();
  const derived = evaluateObservation(createObservationInput(fixtureSet, fixture));

  assert.equal(groundTruth.confidenceExpectations?.length, 5);
  assert.deepEqual(
    confidenceLinkProjection(derived),
    [...groundTruth.confidenceExpectations].sort((left, right) =>
      compareAscii(left.candidateId, right.candidateId),
    ),
  );
  verifyReviewedGroundTruth(fixture, derived);

  const collections = ['readings', 'alarmStates', 'powerStates', 'batteryStates'];
  for (const expected of groundTruth.confidenceExpectations) {
    const collection = collections.find((name) =>
      derived[name].some(({ candidateId }) => candidateId === expected.candidateId),
    );
    assert.ok(collection, `${expected.candidateId} must be derived`);
    for (const field of ['rawLexeme', 'semanticsVersion', 'sourceRef', 'disposition']) {
      const altered = structuredClone(derived);
      const candidate = altered[collection].find(
        ({ candidateId }) => candidateId === expected.candidateId,
      );
      if (field === 'disposition') {
        candidate.confidenceDisposition = 'altered';
      } else {
        candidate.confidenceToken[field] = 'altered';
      }
      assert.throws(
        () => verifyReviewedGroundTruth(fixture, altered),
        /GROUND_TRUTH_MISMATCH:confidence-linkage/u,
      );
    }
    const removed = structuredClone(derived);
    const candidate = removed[collection].find(
      ({ candidateId }) => candidateId === expected.candidateId,
    );
    delete candidate.confidenceToken;
    assert.throws(
      () => verifyReviewedGroundTruth(fixture, removed),
      /GROUND_TRUTH_MISMATCH:confidence-linkage/u,
    );
  }
});

test('reviewed not-applicable evidence is explicit and a missing zone cannot be relabeled retroactively', async () => {
  const fixtureSet = await readSimulatedFixtureSet();
  const completeFixture = fixtureById(fixtureSet, 'sim_reviewed_contract');
  const missingFixture = fixtureById(fixtureSet, 'sim_missing_zone');
  const groundTruth = recordByRole(completeFixture, 'reviewed_ground_truth');
  const { evaluateObservation } = await loadEvaluator();

  const notApplicableExpectation = completeFixture.expectedZoneInventory.zones.find(
    ({ applicability }) => applicability === 'not_applicable',
  );
  assert.ok(notApplicableExpectation, 'a reviewed not-applicable expected zone must exist');
  assert.equal(notApplicableExpectation.reasonCode, 'NOT_APPLICABLE_REVIEWED');
  assert.equal(notApplicableExpectation.evidenceBasisRefs.length, 1);
  assert.deepEqual(groundTruth.notApplicableZones, [
    {
      zoneId: notApplicableExpectation.zoneId,
      reasonCode: notApplicableExpectation.reasonCode,
      evidenceBasisRefs: notApplicableExpectation.evidenceBasisRefs,
    },
  ]);

  const complete = evaluateObservation(createObservationInput(fixtureSet, completeFixture));
  const notApplicable = complete.zoneReconciliation.find(
    ({ zoneId }) => zoneId === notApplicableExpectation.zoneId,
  );
  assert.deepEqual(notApplicable, {
    zoneId: notApplicableExpectation.zoneId,
    status: 'not_applicable',
    candidateIds: [],
    candidates: [],
    reasonCodes: ['NOT_APPLICABLE_REVIEWED'],
    evidenceBasisRefs: notApplicableExpectation.evidenceBasisRefs,
  });
  assert.equal(complete.quality, 'complete');

  const beforeRelabel = evaluateObservation(createObservationInput(fixtureSet, missingFixture));
  assert.equal(
    beforeRelabel.zoneReconciliation.find(({ zoneId }) => zoneId === 'zone_incubator').status,
    'missing',
  );
  const retroactive = createObservationInput(fixtureSet, missingFixture);
  const missingZone = retroactive.expectedZones.find(({ zoneId }) => zoneId === 'zone_incubator');
  missingZone.applicability = 'not_applicable';
  assert.throws(
    () => evaluateObservation(retroactive),
    /HARNESS_ERROR:NOT_APPLICABLE_REASON_REQUIRED/u,
  );

  const missingEvidence = createObservationInput(fixtureSet, completeFixture);
  const reviewedZone = missingEvidence.expectedZones.find(
    ({ zoneId }) => zoneId === notApplicableExpectation.zoneId,
  );
  reviewedZone.evidenceBasisRefs = [];
  assert.throws(
    () => evaluateObservation(missingEvidence),
    /HARNESS_ERROR:NOT_APPLICABLE_EVIDENCE_REQUIRED/u,
  );

  const unsupported = createObservationInput(fixtureSet, missingFixture);
  unsupported.expectedZones.find(
    ({ zoneId }) => zoneId === 'zone_incubator',
  ).applicability = 'optional';
  assert.throws(
    () => evaluateObservation(unsupported),
    /HARNESS_ERROR:EXPECTED_ZONE_APPLICABILITY_UNSUPPORTED/u,
  );
});
