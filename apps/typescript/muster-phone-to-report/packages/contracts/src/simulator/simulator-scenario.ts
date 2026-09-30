export const SIMULATOR_SCENARIO_SCHEMA_VERSION = "simulator-scenario.v1" as const;

export const SIMULATOR_EXECUTION_MODES = Object.freeze([
  "DETERMINISTIC_REPLAY",
  "LIVE_SMOKE",
] as const);

export const SIMULATOR_LIFECYCLE_EVENT_TYPES = Object.freeze([
  "dispatch-accepted",
  "ringing",
  "answered",
  "evidence-available",
  "completed",
  "terminal-no-answer",
] as const);

export const SIMULATOR_AUXILIARY_STATUS_IDS = Object.freeze([
  "sound",
  "power",
  "battery",
  "output",
] as const);

export type SimulatorExecutionMode = (typeof SIMULATOR_EXECUTION_MODES)[number];
export type SimulatorLifecycleEventType = (typeof SIMULATOR_LIFECYCLE_EVENT_TYPES)[number];
export type SimulatorAuxiliaryStatusId = (typeof SIMULATOR_AUXILIARY_STATUS_IDS)[number];
export type SimulatorEvidenceQuality =
  "complete" | "partial" | "unknown" | "invalid" | "not-produced";
export type SimulatorOutcomeFamily =
  "normal" | "abnormal" | "ambiguous" | "no-answer" | "truncated" | "recovery-candidate";

export interface SimulatorScenarioReference {
  readonly scenarioId: string;
  readonly revision: number;
}

export interface SyntheticReportSegment {
  readonly segmentId: string;
  readonly text: string;
}

export interface SimulatorExpectedZoneReference {
  readonly zoneId: string;
  readonly ordinal: number;
  readonly label?: string;
  readonly normalizedUnit?: string;
}

export interface SimulatorExpectedValue {
  readonly zoneId: string;
  readonly value: string;
  readonly normalizedUnit: string;
  readonly status?: "OK" | "ALARM" | "LOW" | "UNKNOWN";
}

export interface SimulatorExpectedAuxiliaryStatus {
  readonly statusId: SimulatorAuxiliaryStatusId;
  readonly value: string;
}

export interface SimulatorContradiction {
  readonly zoneId: string;
  readonly values: readonly string[];
}

export interface SimulatorLifecycleEvent {
  readonly eventId: string;
  readonly relativeOffsetMs: number;
  readonly type: SimulatorLifecycleEventType;
}

export interface SimulatorScenario {
  readonly schemaVersion: typeof SIMULATOR_SCENARIO_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly revision: number;
  readonly label: string;
  readonly origin: "SIMULATED";
  readonly supportedModes: readonly SimulatorExecutionMode[];
  readonly reportSegments: readonly SyntheticReportSegment[];
  readonly expectedZones: readonly SimulatorExpectedZoneReference[];
  readonly lifecycleEvents: readonly SimulatorLifecycleEvent[];
  readonly expectedEvidenceQuality: SimulatorEvidenceQuality;
  readonly expectedOutcomeFamily: SimulatorOutcomeFamily;
  readonly expectedValues: readonly SimulatorExpectedValue[];
  readonly omissions: readonly string[];
  readonly contradictions: readonly SimulatorContradiction[];
  readonly expectedAuxiliaryStatuses?: readonly SimulatorExpectedAuxiliaryStatus[];
  readonly auxiliaryStatusOmissions?: readonly SimulatorAuxiliaryStatusId[];
  readonly recoveryPredecessor: SimulatorScenarioReference | null;
  readonly dtmf: Readonly<{ policy: "forbidden"; allowlist: readonly never[] }>;
  readonly interpretationLimit: Readonly<{
    compatibility: "simulator-tested";
    hardwareCompatibility: "unverified";
  }>;
}

export interface SimulationOrigin {
  readonly kind: "SIMULATED";
  readonly mode: SimulatorExecutionMode;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly simulationRunId: string;
  readonly compatibility: "simulator-tested";
}

const exactDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const identifierPattern = /^[a-z][a-z0-9-]*$/u;
const simulatorModes = new Set<string>(SIMULATOR_EXECUTION_MODES);
const lifecycleTypes = new Set<string>(SIMULATOR_LIFECYCLE_EVENT_TYPES);
const auxiliaryStatusIds = new Set<string>(SIMULATOR_AUXILIARY_STATUS_IDS);
const zoneStatuses = new Set<string>(["OK", "ALARM", "LOW", "UNKNOWN"]);
const evidenceQualities = new Set<string>([
  "complete",
  "partial",
  "unknown",
  "invalid",
  "not-produced",
]);
const outcomeFamilies = new Set<string>([
  "normal",
  "abnormal",
  "ambiguous",
  "no-answer",
  "truncated",
  "recovery-candidate",
]);
const scenarioKeys = new Set([
  "schemaVersion",
  "scenarioId",
  "revision",
  "label",
  "origin",
  "supportedModes",
  "reportSegments",
  "expectedZones",
  "lifecycleEvents",
  "expectedEvidenceQuality",
  "expectedOutcomeFamily",
  "expectedValues",
  "omissions",
  "contradictions",
  "recoveryPredecessor",
  "dtmf",
  "interpretationLimit",
]);
const revisionTwoScenarioKeys = new Set([
  ...scenarioKeys,
  "expectedAuxiliaryStatuses",
  "auxiliaryStatusOmissions",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  field: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new Error(`${field} contains unsupported or missing fields`);
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty, trimmed string`);
  }
  return value;
}

function requireIdentifier(value: unknown, field: string): string {
  const result = requireNonEmptyString(value, field);
  if (!identifierPattern.test(result)) {
    throw new Error(`${field} must be a stable lowercase identifier`);
  }
  return result;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value as number;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function requireArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value;
}

function requireUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} must be unique`);
  }
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((child) => cloneAndFreeze(child))) as T;
  }
  if (isRecord(value)) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAndFreeze(child)])),
    ) as T;
  }
  return value;
}

function validateScenarioReference(value: unknown, field: string): void {
  const reference = requireRecord(value, field);
  requireExactKeys(reference, new Set(["scenarioId", "revision"]), field);
  requireIdentifier(reference["scenarioId"], `${field}.scenarioId`);
  requirePositiveInteger(reference["revision"], `${field}.revision`);
}

function validateSupportedModes(value: unknown): void {
  const modes = requireArray(value, "Simulator scenario supportedModes");
  if (modes.length === 0) {
    throw new Error("Simulator scenario requires at least one supported mode");
  }
  const validated = modes.map((mode) => {
    const result = requireNonEmptyString(mode, "Simulator scenario supported mode");
    if (!simulatorModes.has(result)) {
      throw new Error(`Unsupported simulator execution mode: ${result}`);
    }
    return result;
  });
  requireUnique(validated, "Simulator scenario supported modes");
}

function validateReportSegments(value: unknown): void {
  const segments = requireArray(value, "Simulator scenario reportSegments");
  const ids = segments.map((segmentValue, index) => {
    const segment = requireRecord(segmentValue, `reportSegments[${String(index)}]`);
    requireExactKeys(segment, new Set(["segmentId", "text"]), "Simulator report segment");
    const segmentId = requireIdentifier(segment["segmentId"], "Simulator report segmentId");
    requireNonEmptyString(segment["text"], "Simulator report segment text");
    return segmentId;
  });
  requireUnique(ids, "Simulator report segment IDs");
  if (
    segments.length > 0 &&
    !segments.some((segment) =>
      requireRecord(segment, "report segment")["text"]?.toString().includes("SIMULATED"),
    )
  ) {
    throw new Error("Synthetic report content must identify itself as SIMULATED");
  }
}

function validateExpectedZones(value: unknown, revision: number): readonly string[] {
  const zones = requireArray(value, "Simulator scenario expectedZones");
  if (zones.length === 0) {
    throw new Error("Simulator scenario requires an expected-zone inventory");
  }
  const zoneIds: string[] = [];
  const ordinals: number[] = [];
  zones.forEach((zoneValue, index) => {
    const zone = requireRecord(zoneValue, `expectedZones[${String(index)}]`);
    requireExactKeys(
      zone,
      revision >= 2
        ? new Set(["zoneId", "ordinal", "label", "normalizedUnit"])
        : new Set(["zoneId", "ordinal"]),
      "Simulator expected zone",
    );
    zoneIds.push(requireIdentifier(zone["zoneId"], "Simulator expected zoneId"));
    ordinals.push(requireNonNegativeInteger(zone["ordinal"], "Simulator expected zone ordinal"));
    if (revision >= 2) {
      requireNonEmptyString(zone["label"], "Simulator expected zone label");
      requireNonEmptyString(zone["normalizedUnit"], "Simulator expected zone normalizedUnit");
    }
  });
  requireUnique(zoneIds, "Simulator expected zone IDs");
  requireUnique(ordinals.map(String), "Simulator expected zone ordinals");
  return zoneIds;
}

function validateLifecycleEvents(value: unknown): void {
  const events = requireArray(value, "Simulator scenario lifecycleEvents");
  if (events.length === 0) {
    throw new Error("Simulator scenario requires lifecycle events");
  }
  let previousOffset = -1;
  const eventIds = events.map((eventValue, index) => {
    const event = requireRecord(eventValue, `lifecycleEvents[${String(index)}]`);
    requireExactKeys(
      event,
      new Set(["eventId", "relativeOffsetMs", "type"]),
      "Simulator lifecycle event",
    );
    const eventId = requireIdentifier(event["eventId"], "Simulator lifecycle eventId");
    const offset = requireNonNegativeInteger(
      event["relativeOffsetMs"],
      "Simulator lifecycle relativeOffsetMs",
    );
    if (offset < previousOffset) {
      throw new Error("Simulator lifecycle events must use deterministic offset ordering");
    }
    previousOffset = offset;
    const type = requireNonEmptyString(event["type"], "Simulator lifecycle event type");
    if (!lifecycleTypes.has(type)) {
      throw new Error(`Unsupported simulator lifecycle event type: ${type}`);
    }
    return eventId;
  });
  requireUnique(eventIds, "Simulator lifecycle event IDs");
}

function validateExpectedValues(
  value: unknown,
  zoneIds: readonly string[],
  revision: number,
): readonly string[] {
  const values = requireArray(value, "Simulator scenario expectedValues");
  const referencedZones = values.map((expectedValue, index) => {
    const expected = requireRecord(expectedValue, `expectedValues[${String(index)}]`);
    requireExactKeys(
      expected,
      revision >= 2
        ? new Set(["zoneId", "value", "normalizedUnit", "status"])
        : new Set(["zoneId", "value", "normalizedUnit"]),
      "Simulator expected value",
    );
    const zoneId = requireIdentifier(expected["zoneId"], "Simulator expected value zoneId");
    if (!zoneIds.includes(zoneId)) {
      throw new Error(`Simulator expected value references unknown zone: ${zoneId}`);
    }
    const numericValue = requireNonEmptyString(expected["value"], "Simulator expected value");
    if (!exactDecimalPattern.test(numericValue)) {
      throw new Error("Simulator expected values must use exact decimal strings");
    }
    requireNonEmptyString(expected["normalizedUnit"], "Simulator expected normalizedUnit");
    if (revision >= 2 && !zoneStatuses.has(String(expected["status"]))) {
      throw new Error("Unsupported simulator expected zone status");
    }
    return zoneId;
  });
  requireUnique(referencedZones, "Simulator expected value zones");
  return referencedZones;
}

function validateExpectedAuxiliaryStatuses(value: unknown): readonly string[] {
  const statuses = requireArray(value, "Simulator scenario expectedAuxiliaryStatuses");
  const statusIds = statuses.map((statusValue, index) => {
    const status = requireRecord(statusValue, `expectedAuxiliaryStatuses[${String(index)}]`);
    requireExactKeys(status, new Set(["statusId", "value"]), "Simulator expected auxiliary status");
    const statusId = requireIdentifier(status["statusId"], "Simulator expected auxiliary statusId");
    if (!auxiliaryStatusIds.has(statusId)) {
      throw new Error(`Unsupported simulator auxiliary status: ${statusId}`);
    }
    requireIdentifier(status["value"], "Simulator expected auxiliary status value");
    return statusId;
  });
  requireUnique(statusIds, "Simulator expected auxiliary status IDs");
  return statusIds;
}

function validateAuxiliaryStatusOmissions(value: unknown): readonly string[] {
  const omissions = requireArray(value, "Simulator scenario auxiliaryStatusOmissions").map(
    (statusId) => requireIdentifier(statusId, "Simulator auxiliary status omission"),
  );
  requireUnique(omissions, "Simulator auxiliary status omission IDs");
  if (omissions.some((statusId) => !auxiliaryStatusIds.has(statusId))) {
    throw new Error("Simulator auxiliary omission references an unknown status");
  }
  return omissions;
}

function validateOmissions(value: unknown, zoneIds: readonly string[]): readonly string[] {
  const omissions = requireArray(value, "Simulator scenario omissions").map((omission) =>
    requireIdentifier(omission, "Simulator omission zoneId"),
  );
  requireUnique(omissions, "Simulator omission zone IDs");
  if (omissions.some((zoneId) => !zoneIds.includes(zoneId))) {
    throw new Error("Simulator omission references an unknown zone");
  }
  return omissions;
}

function validateContradictions(value: unknown, zoneIds: readonly string[]): readonly string[] {
  const contradictions = requireArray(value, "Simulator scenario contradictions");
  const contradictionZones = contradictions.map((contradictionValue, index) => {
    const contradiction = requireRecord(contradictionValue, `contradictions[${String(index)}]`);
    requireExactKeys(contradiction, new Set(["zoneId", "values"]), "Simulator contradiction");
    const zoneId = requireIdentifier(contradiction["zoneId"], "Simulator contradiction zoneId");
    if (!zoneIds.includes(zoneId)) {
      throw new Error(`Simulator contradiction references unknown zone: ${zoneId}`);
    }
    const values = requireArray(contradiction["values"], "Simulator contradiction values").map(
      (contradictoryValue) =>
        requireNonEmptyString(contradictoryValue, "Simulator contradictory value"),
    );
    if (values.length < 2 || new Set(values).size !== values.length) {
      throw new Error("Simulator contradiction requires at least two distinct values");
    }
    if (values.some((contradictoryValue) => !exactDecimalPattern.test(contradictoryValue))) {
      throw new Error("Simulator contradictory values must use exact decimal strings");
    }
    return zoneId;
  });
  requireUnique(contradictionZones, "Simulator contradiction zones");
  return contradictionZones;
}

function validateDtmf(value: unknown): void {
  const dtmf = requireRecord(value, "Simulator scenario dtmf");
  requireExactKeys(dtmf, new Set(["policy", "allowlist"]), "Simulator scenario dtmf");
  if (dtmf["policy"] !== "forbidden") {
    throw new Error("Simulator scenario DTMF policy must be forbidden");
  }
  if (requireArray(dtmf["allowlist"], "Simulator scenario DTMF allowlist").length !== 0) {
    throw new Error("Simulator scenario DTMF allowlist must be empty");
  }
}

function validateInterpretationLimit(value: unknown): void {
  const limit = requireRecord(value, "Simulator scenario interpretationLimit");
  requireExactKeys(
    limit,
    new Set(["compatibility", "hardwareCompatibility"]),
    "Simulator scenario interpretationLimit",
  );
  if (limit["compatibility"] !== "simulator-tested") {
    throw new Error("Simulator compatibility is capped at simulator-tested");
  }
  if (limit["hardwareCompatibility"] !== "unverified") {
    throw new Error("Simulator scenario cannot claim hardware compatibility");
  }
}

function validateOutcomeConsistency(input: {
  readonly scenario: Record<string, unknown>;
  readonly zoneIds: readonly string[];
  readonly expectedValueZones: readonly string[];
  readonly omissions: readonly string[];
  readonly contradictionZones: readonly string[];
  readonly auxiliaryStatuses: readonly string[];
  readonly auxiliaryOmissions: readonly string[];
}): void {
  const {
    scenario,
    zoneIds,
    expectedValueZones,
    omissions,
    contradictionZones,
    auxiliaryStatuses,
    auxiliaryOmissions,
  } = input;
  const outcome = scenario["expectedOutcomeFamily"];
  const quality = scenario["expectedEvidenceQuality"];
  const recovery = scenario["recoveryPredecessor"];

  if (outcome === "no-answer") {
    if (
      quality !== "not-produced" ||
      requireArray(scenario["reportSegments"], "reportSegments").length !== 0 ||
      expectedValueZones.length !== 0 ||
      omissions.length !== zoneIds.length
    ) {
      throw new Error("No-answer scenarios must omit the complete expected-zone inventory");
    }
  } else if (outcome === "ambiguous") {
    if (contradictionZones.length === 0 || quality === "complete") {
      throw new Error("Ambiguous scenarios require explicit non-complete contradictions");
    }
  } else if (outcome === "truncated") {
    if (omissions.length === 0 || quality === "complete") {
      throw new Error("Truncated scenarios require explicit non-complete omissions");
    }
  } else if (
    expectedValueZones.length !== zoneIds.length ||
    omissions.length !== 0 ||
    contradictionZones.length !== 0 ||
    quality !== "complete"
  ) {
    throw new Error("Complete simulator outcomes require concrete values for every expected zone");
  }

  if (outcome === "recovery-candidate") {
    if (recovery === null) {
      throw new Error("Recovery scenarios require an exact predecessor reference");
    }
  } else if (recovery !== null) {
    throw new Error("Only recovery scenarios may declare a predecessor reference");
  }

  if (Number(scenario["revision"]) >= 2) {
    // A zone belongs to exactly one evidence partition so omitted or contradictory
    // evidence cannot also be admitted as a Reading.
    const zoneClassifications = [...expectedValueZones, ...omissions, ...contradictionZones];
    if (
      zoneClassifications.length !== zoneIds.length ||
      new Set(zoneClassifications).size !== zoneIds.length
    ) {
      throw new Error("Revision-2 scenarios must classify every expected zone exactly once");
    }

    if (
      outcome === "no-answer" &&
      (auxiliaryStatuses.length !== 0 ||
        auxiliaryOmissions.length !== SIMULATOR_AUXILIARY_STATUS_IDS.length)
    ) {
      throw new Error("No-answer scenarios must omit the complete auxiliary-status inventory");
    }

    const auxiliaryInventory = [...auxiliaryStatuses, ...auxiliaryOmissions];
    if (
      auxiliaryInventory.length !== SIMULATOR_AUXILIARY_STATUS_IDS.length ||
      new Set(auxiliaryInventory).size !== SIMULATOR_AUXILIARY_STATUS_IDS.length
    ) {
      throw new Error("Revision-2 scenarios must reconcile every auxiliary status exactly once");
    }
    if (
      (outcome === "normal" || outcome === "abnormal" || outcome === "recovery-candidate") &&
      auxiliaryOmissions.length !== 0
    ) {
      throw new Error("Complete revision-2 outcomes require every auxiliary status");
    }
  }
}

export function validateSimulatorScenario(value: unknown): SimulatorScenario {
  const scenario = requireRecord(value, "Simulator scenario");
  const revision = requirePositiveInteger(scenario["revision"], "Simulator scenario revision");
  requireExactKeys(
    scenario,
    revision >= 2 ? revisionTwoScenarioKeys : scenarioKeys,
    "Simulator scenario",
  );
  if (scenario["schemaVersion"] !== SIMULATOR_SCENARIO_SCHEMA_VERSION) {
    throw new Error("Unsupported simulator scenario schemaVersion");
  }
  requireIdentifier(scenario["scenarioId"], "Simulator scenarioId");
  requireNonEmptyString(scenario["label"], "Simulator scenario label");
  if (scenario["origin"] !== "SIMULATED") {
    throw new Error("Simulator scenario origin must be SIMULATED");
  }
  validateSupportedModes(scenario["supportedModes"]);
  validateReportSegments(scenario["reportSegments"]);
  const zoneIds = validateExpectedZones(scenario["expectedZones"], revision);
  validateLifecycleEvents(scenario["lifecycleEvents"]);

  if (!evidenceQualities.has(String(scenario["expectedEvidenceQuality"]))) {
    throw new Error("Unsupported simulator expected evidence quality");
  }
  if (!outcomeFamilies.has(String(scenario["expectedOutcomeFamily"]))) {
    throw new Error("Unsupported simulator expected outcome family");
  }
  const expectedValueZones = validateExpectedValues(scenario["expectedValues"], zoneIds, revision);
  const omissions = validateOmissions(scenario["omissions"], zoneIds);
  const contradictionZones = validateContradictions(scenario["contradictions"], zoneIds);
  const auxiliaryStatuses =
    revision >= 2 ? validateExpectedAuxiliaryStatuses(scenario["expectedAuxiliaryStatuses"]) : [];
  const auxiliaryOmissions =
    revision >= 2 ? validateAuxiliaryStatusOmissions(scenario["auxiliaryStatusOmissions"]) : [];
  if (scenario["recoveryPredecessor"] !== null) {
    validateScenarioReference(scenario["recoveryPredecessor"], "Simulator recoveryPredecessor");
  }
  validateDtmf(scenario["dtmf"]);
  validateInterpretationLimit(scenario["interpretationLimit"]);
  validateOutcomeConsistency({
    scenario,
    zoneIds,
    expectedValueZones,
    omissions,
    contradictionZones,
    auxiliaryStatuses,
    auxiliaryOmissions,
  });

  return cloneAndFreeze(scenario) as unknown as SimulatorScenario;
}

export function createSimulationOrigin(value: SimulationOrigin): SimulationOrigin {
  return validateSimulationOrigin(value);
}

export function validateSimulationOrigin(value: unknown): SimulationOrigin {
  const origin = requireRecord(value, "Simulation origin");
  requireExactKeys(
    origin,
    new Set(["kind", "mode", "scenarioId", "scenarioRevision", "simulationRunId", "compatibility"]),
    "Simulation origin",
  );
  if (origin["kind"] !== "SIMULATED") {
    throw new Error("Simulation origin kind must be SIMULATED");
  }
  const mode = requireNonEmptyString(origin["mode"], "Simulation origin mode");
  if (!simulatorModes.has(mode)) {
    throw new Error(`Unsupported simulator execution mode: ${mode}`);
  }
  requireIdentifier(origin["scenarioId"], "Simulation origin scenarioId");
  requirePositiveInteger(origin["scenarioRevision"], "Simulation origin scenarioRevision");
  requireNonEmptyString(origin["simulationRunId"], "Simulation origin simulationRunId");
  if (origin["compatibility"] !== "simulator-tested") {
    throw new Error("Simulation compatibility is capped at simulator-tested");
  }
  return cloneAndFreeze(origin) as unknown as SimulationOrigin;
}

export function assertConsistentSimulationLineage(
  values: readonly unknown[],
): readonly SimulationOrigin[] {
  if (values.length === 0) {
    throw new Error("Simulation lineage requires at least one origin");
  }
  const origins = values.map(validateSimulationOrigin);
  const root = origins[0];
  if (root === undefined) {
    throw new Error("Simulation lineage requires at least one origin");
  }
  if (
    origins.some(
      (origin) =>
        origin.kind !== root.kind ||
        origin.mode !== root.mode ||
        origin.scenarioId !== root.scenarioId ||
        origin.scenarioRevision !== root.scenarioRevision ||
        origin.simulationRunId !== root.simulationRunId ||
        origin.compatibility !== root.compatibility,
    )
  ) {
    throw new Error("Mixed simulation lineage is forbidden");
  }
  return Object.freeze(origins);
}
