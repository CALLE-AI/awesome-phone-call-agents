import {
  SIMULATOR_SCENARIO_SCHEMA_VERSION,
  type SimulatorScenario,
  validateSimulatorScenario,
} from "@muster/contracts";

type ScenarioKind = "normal" | "abnormal" | "ambiguous" | "no-answer" | "truncated" | "recovery";

const revisionOneExpectedZones = [
  { zoneId: "zone-01", ordinal: 0 },
  { zoneId: "zone-02", ordinal: 1 },
] as const;

const revisionTwoExpectedZones = [
  {
    zoneId: "zone-01",
    ordinal: 0,
    label: "North house air temperature",
    normalizedUnit: "degF",
  },
  {
    zoneId: "zone-02",
    ordinal: 1,
    label: "Propagation bench temperature",
    normalizedUnit: "degF",
  },
  {
    zoneId: "zone-03",
    ordinal: 2,
    label: "Greenhouse relative humidity",
    normalizedUnit: "percent",
  },
  {
    zoneId: "zone-04",
    ordinal: 3,
    label: "Irrigation reservoir level",
    normalizedUnit: "percent",
  },
] as const;

const base = {
  schemaVersion: SIMULATOR_SCENARIO_SCHEMA_VERSION,
  revision: 1,
  origin: "SIMULATED",
  supportedModes: ["DETERMINISTIC_REPLAY"],
  expectedZones: revisionOneExpectedZones,
  dtmf: { policy: "forbidden", allowlist: [] },
  interpretationLimit: {
    compatibility: "simulator-tested",
    hardwareCompatibility: "unverified",
  },
} as const;

const liveSmokeModes = ["DETERMINISTIC_REPLAY", "LIVE_SMOKE"] as const;
const deterministicReplayMode = ["DETERMINISTIC_REPLAY"] as const;
const normalAuxiliaryStatuses = [
  { statusId: "sound", value: "normal" },
  { statusId: "power", value: "mains-available" },
  { statusId: "battery", value: "normal" },
  { statusId: "output", value: "off" },
] as const;
const allAuxiliaryStatusOmissions = ["sound", "power", "battery", "output"] as const;

const revisionTwoBase = {
  schemaVersion: SIMULATOR_SCENARIO_SCHEMA_VERSION,
  revision: 2,
  origin: "SIMULATED",
  supportedModes: liveSmokeModes,
  expectedZones: revisionTwoExpectedZones,
  dtmf: { policy: "forbidden", allowlist: [] },
  interpretationLimit: {
    compatibility: "simulator-tested",
    hardwareCompatibility: "unverified",
  },
} as const;

function completedLifecycle() {
  return [
    { eventId: "dispatch", relativeOffsetMs: 0, type: "dispatch-accepted" },
    { eventId: "ringing", relativeOffsetMs: 1000, type: "ringing" },
    { eventId: "answered", relativeOffsetMs: 2000, type: "answered" },
    { eventId: "evidence", relativeOffsetMs: 5000, type: "evidence-available" },
    { eventId: "completed", relativeOffsetMs: 5100, type: "completed" },
  ] as const;
}

function noAnswerLifecycle() {
  return [
    { eventId: "dispatch", relativeOffsetMs: 0, type: "dispatch-accepted" },
    { eventId: "ringing", relativeOffsetMs: 1000, type: "ringing" },
    { eventId: "no-answer", relativeOffsetMs: 6000, type: "terminal-no-answer" },
  ] as const;
}

function report(...segments: readonly string[]) {
  return segments.map((text, index) => ({
    segmentId: `segment-${String(index + 1).padStart(2, "0")}`,
    text,
  }));
}

function scenarioDefinition(kind: ScenarioKind): unknown {
  switch (kind) {
    case "normal":
      return {
        ...base,
        supportedModes: liveSmokeModes,
        scenarioId: "synthetic-normal",
        label: "Normal synthetic report",
        reportSegments: report(
          "This is a SIMULATED synthetic phone report.",
          "Zone 1 measurement is 71.5 degrees Fahrenheit.",
          "Zone 2 measurement is 68.0 degrees Fahrenheit.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "complete",
        expectedOutcomeFamily: "normal",
        expectedValues: [
          { zoneId: "zone-01", value: "71.5", normalizedUnit: "degF" },
          { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF" },
        ],
        omissions: [],
        contradictions: [],
        recoveryPredecessor: null,
      };
    case "abnormal":
      return {
        ...base,
        scenarioId: "synthetic-abnormal",
        label: "Abnormal synthetic report",
        reportSegments: report(
          "This is a SIMULATED synthetic phone report.",
          "Zone 1 measurement is 91.25 degrees Fahrenheit.",
          "Zone 2 measurement is 84.5 degrees Fahrenheit.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "complete",
        expectedOutcomeFamily: "abnormal",
        expectedValues: [
          { zoneId: "zone-01", value: "91.25", normalizedUnit: "degF" },
          { zoneId: "zone-02", value: "84.5", normalizedUnit: "degF" },
        ],
        omissions: [],
        contradictions: [],
        recoveryPredecessor: null,
      };
    case "ambiguous":
      return {
        ...base,
        scenarioId: "synthetic-ambiguous",
        label: "Ambiguous synthetic report",
        reportSegments: report(
          "This is a SIMULATED synthetic phone report.",
          "Zone 1 measurement is 71.5 degrees Fahrenheit.",
          "Zone 1 measurement is also reported as 75.5 degrees Fahrenheit.",
          "Zone 2 measurement is 68.0 degrees Fahrenheit.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "invalid",
        expectedOutcomeFamily: "ambiguous",
        expectedValues: [{ zoneId: "zone-02", value: "68.0", normalizedUnit: "degF" }],
        omissions: [],
        contradictions: [{ zoneId: "zone-01", values: ["71.5", "75.5"] }],
        recoveryPredecessor: null,
      };
    case "no-answer":
      return {
        ...base,
        scenarioId: "synthetic-no-answer",
        label: "No-answer synthetic lifecycle",
        reportSegments: [],
        lifecycleEvents: noAnswerLifecycle(),
        expectedEvidenceQuality: "not-produced",
        expectedOutcomeFamily: "no-answer",
        expectedValues: [],
        omissions: ["zone-01", "zone-02"],
        contradictions: [],
        recoveryPredecessor: null,
      };
    case "truncated":
      return {
        ...base,
        scenarioId: "synthetic-truncated",
        label: "Truncated synthetic report",
        reportSegments: report(
          "This is a SIMULATED synthetic phone report.",
          "Zone 1 measurement is 72.0 degrees Fahrenheit.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "partial",
        expectedOutcomeFamily: "truncated",
        expectedValues: [{ zoneId: "zone-01", value: "72.0", normalizedUnit: "degF" }],
        omissions: ["zone-02"],
        contradictions: [],
        recoveryPredecessor: null,
      };
    case "recovery":
      return {
        ...base,
        scenarioId: "synthetic-recovery",
        label: "Recovery-candidate synthetic report",
        reportSegments: report(
          "This is a SIMULATED synthetic phone recovery report.",
          "Zone 1 measurement is 70.0 degrees Fahrenheit.",
          "Zone 2 measurement is 67.5 degrees Fahrenheit.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "complete",
        expectedOutcomeFamily: "recovery-candidate",
        expectedValues: [
          { zoneId: "zone-01", value: "70.0", normalizedUnit: "degF" },
          { zoneId: "zone-02", value: "67.5", normalizedUnit: "degF" },
        ],
        omissions: [],
        contradictions: [],
        recoveryPredecessor: { scenarioId: "synthetic-abnormal", revision: 1 },
      };
  }
}

function revisionTwoScenarioDefinition(kind: ScenarioKind): unknown {
  switch (kind) {
    case "normal":
      return {
        ...revisionTwoBase,
        scenarioId: "synthetic-normal",
        label: "Normal four-zone greenhouse report",
        reportSegments: report(
          "This is a SIMULATED synthetic greenhouse phone report.",
          "Zone 1, North house air temperature, is 71.5 degrees Fahrenheit, status OK.",
          "Zone 2, Propagation bench temperature, is 68.0 degrees Fahrenheit, status OK.",
          "Zone 3, Greenhouse relative humidity, is 68 percent, status OK.",
          "Zone 4, Irrigation reservoir level, is 82 percent, status OK.",
          "Sound is normal. Power is mains available. Battery is normal. Output is off.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "complete",
        expectedOutcomeFamily: "normal",
        expectedValues: [
          { zoneId: "zone-01", value: "71.5", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-03", value: "68", normalizedUnit: "percent", status: "OK" },
          { zoneId: "zone-04", value: "82", normalizedUnit: "percent", status: "OK" },
        ],
        omissions: [],
        contradictions: [],
        expectedAuxiliaryStatuses: normalAuxiliaryStatuses,
        auxiliaryStatusOmissions: [],
        recoveryPredecessor: null,
      };
    case "abnormal":
      return {
        ...revisionTwoBase,
        scenarioId: "synthetic-abnormal",
        label: "Abnormal four-zone greenhouse report",
        reportSegments: report(
          "This is a SIMULATED synthetic greenhouse phone report.",
          "Zone 1, North house air temperature, is 95.0 degrees Fahrenheit, status ALARM.",
          "Zone 2, Propagation bench temperature, is 68.0 degrees Fahrenheit, status OK.",
          "Zone 3, Greenhouse relative humidity, is 91 percent, status ALARM.",
          "Zone 4, Irrigation reservoir level, is 20 percent, status LOW.",
          "Sound alarm is active. Power is mains available. Battery is normal. Output is on.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "complete",
        expectedOutcomeFamily: "abnormal",
        expectedValues: [
          { zoneId: "zone-01", value: "95.0", normalizedUnit: "degF", status: "ALARM" },
          { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-03", value: "91", normalizedUnit: "percent", status: "ALARM" },
          { zoneId: "zone-04", value: "20", normalizedUnit: "percent", status: "LOW" },
        ],
        omissions: [],
        contradictions: [],
        expectedAuxiliaryStatuses: [
          { statusId: "sound", value: "alarm-active" },
          { statusId: "power", value: "mains-available" },
          { statusId: "battery", value: "normal" },
          { statusId: "output", value: "on" },
        ],
        auxiliaryStatusOmissions: [],
        recoveryPredecessor: null,
      };
    case "ambiguous":
      return {
        ...revisionTwoBase,
        scenarioId: "synthetic-ambiguous",
        label: "Ambiguous four-zone greenhouse report",
        reportSegments: report(
          "This is a SIMULATED synthetic greenhouse phone report.",
          "Zone 1, North house air temperature, is 71.5 degrees Fahrenheit.",
          "Zone 1, North house air temperature, is also 75.5 degrees Fahrenheit.",
          "Zone 2, Propagation bench temperature, is 68.0 degrees Fahrenheit, status OK.",
          "Zone 3, Greenhouse relative humidity, is 68 percent, status OK.",
          "Zone 4, Irrigation reservoir level, is 82 percent, status OK.",
          "Sound is normal. Power is mains available. Battery is normal. Output is off.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "invalid",
        expectedOutcomeFamily: "ambiguous",
        expectedValues: [
          { zoneId: "zone-02", value: "68.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-03", value: "68", normalizedUnit: "percent", status: "OK" },
          { zoneId: "zone-04", value: "82", normalizedUnit: "percent", status: "OK" },
        ],
        omissions: [],
        contradictions: [{ zoneId: "zone-01", values: ["71.5", "75.5"] }],
        expectedAuxiliaryStatuses: normalAuxiliaryStatuses,
        auxiliaryStatusOmissions: [],
        recoveryPredecessor: null,
      };
    case "no-answer":
      return {
        ...revisionTwoBase,
        supportedModes: deterministicReplayMode,
        scenarioId: "synthetic-no-answer",
        label: "No-answer four-zone greenhouse lifecycle",
        reportSegments: [],
        lifecycleEvents: noAnswerLifecycle(),
        expectedEvidenceQuality: "not-produced",
        expectedOutcomeFamily: "no-answer",
        expectedValues: [],
        omissions: ["zone-01", "zone-02", "zone-03", "zone-04"],
        contradictions: [],
        expectedAuxiliaryStatuses: [],
        auxiliaryStatusOmissions: allAuxiliaryStatusOmissions,
        recoveryPredecessor: null,
      };
    case "truncated":
      return {
        ...revisionTwoBase,
        scenarioId: "synthetic-truncated",
        label: "Truncated four-zone greenhouse report",
        reportSegments: report(
          "This is a SIMULATED synthetic greenhouse phone report.",
          "Zone 1, North house air temperature, is 72.0 degrees Fahrenheit, status OK.",
          "Zone 2, Propagation bench temperature, is 67.5 degrees Fahrenheit, status OK.",
          "The synthetic report ends unexpectedly before zones 3 and 4 or auxiliary status.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "partial",
        expectedOutcomeFamily: "truncated",
        expectedValues: [
          { zoneId: "zone-01", value: "72.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-02", value: "67.5", normalizedUnit: "degF", status: "OK" },
        ],
        omissions: ["zone-03", "zone-04"],
        contradictions: [],
        expectedAuxiliaryStatuses: [],
        auxiliaryStatusOmissions: allAuxiliaryStatusOmissions,
        recoveryPredecessor: null,
      };
    case "recovery":
      return {
        ...revisionTwoBase,
        scenarioId: "synthetic-recovery",
        label: "Recovery-candidate four-zone greenhouse report",
        reportSegments: report(
          "This is a SIMULATED synthetic greenhouse recovery report.",
          "Zone 1, North house air temperature, is 70.0 degrees Fahrenheit, status OK.",
          "Zone 2, Propagation bench temperature, is 67.5 degrees Fahrenheit, status OK.",
          "Zone 3, Greenhouse relative humidity, is 66 percent, status OK.",
          "Zone 4, Irrigation reservoir level, is 80 percent, status OK.",
          "Sound is normal. Power is mains available. Battery is normal. Output is off.",
        ),
        lifecycleEvents: completedLifecycle(),
        expectedEvidenceQuality: "complete",
        expectedOutcomeFamily: "recovery-candidate",
        expectedValues: [
          { zoneId: "zone-01", value: "70.0", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-02", value: "67.5", normalizedUnit: "degF", status: "OK" },
          { zoneId: "zone-03", value: "66", normalizedUnit: "percent", status: "OK" },
          { zoneId: "zone-04", value: "80", normalizedUnit: "percent", status: "OK" },
        ],
        omissions: [],
        contradictions: [],
        expectedAuxiliaryStatuses: normalAuxiliaryStatuses,
        auxiliaryStatusOmissions: [],
        recoveryPredecessor: { scenarioId: "synthetic-abnormal", revision: 2 },
      };
  }
}

function buildScenario(kind: ScenarioKind, revision = 1): SimulatorScenario {
  return validateSimulatorScenario(
    revision === 1 ? scenarioDefinition(kind) : revisionTwoScenarioDefinition(kind),
  );
}

export function buildNormalSimulatorScenario(): SimulatorScenario {
  return buildScenario("normal");
}

export function buildAbnormalSimulatorScenario(): SimulatorScenario {
  return buildScenario("abnormal");
}

export function buildAmbiguousSimulatorScenario(): SimulatorScenario {
  return buildScenario("ambiguous");
}

export function buildNoAnswerSimulatorScenario(): SimulatorScenario {
  return buildScenario("no-answer");
}

export function buildTruncatedSimulatorScenario(): SimulatorScenario {
  return buildScenario("truncated");
}

export function buildRecoverySimulatorScenario(): SimulatorScenario {
  return buildScenario("recovery");
}

export const SIMULATOR_SCENARIO_CATALOG: readonly SimulatorScenario[] = Object.freeze([
  buildNormalSimulatorScenario(),
  buildAbnormalSimulatorScenario(),
  buildAmbiguousSimulatorScenario(),
  buildNoAnswerSimulatorScenario(),
  buildTruncatedSimulatorScenario(),
  buildRecoverySimulatorScenario(),
  buildScenario("normal", 2),
  buildScenario("abnormal", 2),
  buildScenario("ambiguous", 2),
  buildScenario("no-answer", 2),
  buildScenario("truncated", 2),
  buildScenario("recovery", 2),
]);

export function findSimulatorScenario(scenarioId: string, revision: number): SimulatorScenario {
  const scenario = SIMULATOR_SCENARIO_CATALOG.find(
    (candidate) => candidate.scenarioId === scenarioId && candidate.revision === revision,
  );
  if (scenario === undefined) {
    throw new Error(`Unknown simulator scenario: ${scenarioId}@${String(revision)}`);
  }
  return scenario;
}

export function renderSyntheticReport(value: unknown): string {
  const scenario = validateSimulatorScenario(value);
  return scenario.reportSegments.map(({ text }) => text).join(" ");
}
