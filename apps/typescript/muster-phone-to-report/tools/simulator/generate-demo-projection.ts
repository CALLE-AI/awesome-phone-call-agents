import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import {
  RunSimulatedObservation,
  SimulatorScenarioCatalog,
} from "../../packages/application/dist/index.js";
import type { SimulatorScenario, SimulationOrigin } from "../../packages/contracts/src/index.ts";
import { EndpointObservationProfile, OrganizationId } from "../../packages/domain/dist/index.js";
import {
  FakeCallAttemptRepository,
  FakeClock,
  FakeEvidenceRepository,
  FakeIdentifierGenerator,
  FakeObservationDispatchPolicy,
  FakeObservationJobScheduler,
  FakeObservationProfileRepository,
  FakeObservationRepository,
  SIMULATOR_SCENARIO_CATALOG,
} from "../../packages/testing/dist/index.js";
import type {
  SimulatorDemoProjection,
  SimulatorDemoScenarioProjection,
  SimulatorDemoSourceSpan,
} from "../../packages/api-client/src/simulator-demo-projection.ts";

const adapterVersion = "simulator_adapter_v1";
const extractorVersion = "extractor_version_deterministic_v1";

function normalizedUnitFor(
  scenario: SimulatorScenario,
  zone: SimulatorScenario["expectedZones"][number],
): string {
  if (zone.normalizedUnit !== undefined) return zone.normalizedUnit;
  return (
    scenario.expectedValues.find(({ zoneId }) => zoneId === zone.zoneId)?.normalizedUnit ??
    scenario.expectedValues[0]?.normalizedUnit ??
    "degF"
  );
}

function unitMappingFor(normalizedUnit: string) {
  return normalizedUnit === "percent"
    ? { ruleId: "percent-v1", spokenUnit: "percent", normalizedUnit }
    : { ruleId: "fahrenheit-v1", spokenUnit: "degrees fahrenheit", normalizedUnit };
}

function profileFor(
  organizationId: OrganizationId,
  endpointId: string,
  scenario: SimulatorScenario,
) {
  return EndpointObservationProfile.create({
    endpointId,
    organizationId,
    adapterVersionId: adapterVersion,
    expectedZones: scenario.expectedZones.map((zone) => ({
      zoneId: zone.zoneId,
      ordinal: zone.ordinal,
      applicability: "required" as const,
      requiredFacet: "measurement" as const,
      allowedUnitMappings: [unitMappingFor(normalizedUnitFor(scenario, zone))],
    })),
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: "synthetic-fixture-authorization",
  });
}

async function replayScenario(
  scenario: SimulatorScenario,
  catalog: SimulatorScenarioCatalog,
): Promise<Awaited<ReturnType<RunSimulatedObservation["execute"]>>> {
  const suffix = scenario.scenarioId.replace(/^synthetic-/u, "");
  const organizationId = OrganizationId.create(`org-demo-${suffix}`);
  const endpointId = `endpoint-demo-${suffix}`;
  const attempts = new FakeCallAttemptRepository();
  const evidence = new FakeEvidenceRepository();
  const observations = new FakeObservationRepository(attempts);
  const runner = new RunSimulatedObservation({
    catalog,
    profiles: new FakeObservationProfileRepository([
      profileFor(organizationId, endpointId, scenario),
    ]),
    attempts,
    scheduler: new FakeObservationJobScheduler(),
    evidence,
    observations,
    policy: new FakeObservationDispatchPolicy({ outcome: "allowed" }),
    clock: new FakeClock("2026-08-07T04:00:00.000Z"),
    identifiers: new FakeIdentifierGenerator(
      Array.from({ length: 30 }, (_, index) => `demo-${suffix}-${String(index + 1)}`),
    ),
  });
  const predecessorOrigin: SimulationOrigin | undefined =
    scenario.recoveryPredecessor === null
      ? undefined
      : {
          kind: "SIMULATED",
          mode: "DETERMINISTIC_REPLAY",
          scenarioId: scenario.recoveryPredecessor.scenarioId,
          scenarioRevision: scenario.recoveryPredecessor.revision,
          simulationRunId: "demo-abnormal-predecessor",
          compatibility: "simulator-tested",
        };
  return await runner.execute({
    organizationId,
    endpointId,
    scenarioId: scenario.scenarioId,
    revision: scenario.revision,
    simulationRunId: `demo-${suffix}-run`,
    correlationId: `demo-${suffix}-correlation`,
    ...(predecessorOrigin === undefined ? {} : { predecessorOrigin }),
  });
}

function sourceSpansFor(scenario: SimulatorScenario): readonly SimulatorDemoSourceSpan[] {
  return scenario.reportSegments.map((segment) => ({
    sourceSpanId: `${segment.segmentId}-full`,
    segmentId: segment.segmentId,
    span: { start: 0, end: segment.text.length },
    text: segment.text,
  }));
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sourceSpanIdsForZoneValues(
  sourceSpans: readonly SimulatorDemoSourceSpan[],
  zone: SimulatorScenario["expectedZones"][number],
  values: readonly string[],
): readonly string[] {
  // Require both the zone ordinal and the complete numeric token so a repeated
  // value in another zone cannot become this Reading's evidence anchor.
  const zoneReference = new RegExp(`\\bzone\\s*0?${String(zone.ordinal + 1)}\\b`, "iu");
  const exactValues = values.map(
    (value) => new RegExp(`(?<![0-9.])${escapeRegularExpression(value)}(?![0-9.])`, "u"),
  );
  return sourceSpans
    .filter(
      (span) =>
        zoneReference.test(span.text) &&
        exactValues.some((exactValue) => exactValue.test(span.text)),
    )
    .map(({ sourceSpanId }) => sourceSpanId);
}

function categoryFor(outcome: SimulatorScenario["expectedOutcomeFamily"]): string {
  switch (outcome) {
    case "normal":
      return "Complete observation fixture";
    case "abnormal":
      return "Threshold scenario fixture";
    case "ambiguous":
    case "truncated":
      return "Incomplete evidence fixture";
    case "no-answer":
      return "Transport failure fixture";
    case "recovery-candidate":
      return "Recovery candidate fixture";
  }
}

function policyConsequenceFor(outcome: SimulatorScenario["expectedOutcomeFamily"]): string {
  switch (outcome) {
    case "normal":
      return "No qualifying threshold event when evidence remains complete.";
    case "abnormal":
      return "Grounded threshold evidence creates a simulated abnormal result.";
    case "ambiguous":
    case "truncated":
      return "No operational decision is permitted.";
    case "no-answer":
      return "No observation is fabricated from transport failure.";
    case "recovery-candidate":
      return "Human confirmation is required; no automatic closure.";
  }
}

async function projectScenario(
  scenario: SimulatorScenario,
  catalog: SimulatorScenarioCatalog,
): Promise<SimulatorDemoScenarioProjection> {
  const replay = await replayScenario(scenario, catalog);
  const sourceEvidence = sourceSpansFor(scenario);
  const readings =
    replay.observation?.readings.map((reading) => {
      const contradiction = scenario.contradictions.find(({ zoneId }) => zoneId === reading.zoneId);
      const expected = scenario.expectedValues.find(({ zoneId }) => zoneId === reading.zoneId);
      const zone = scenario.expectedZones.find(({ zoneId }) => zoneId === reading.zoneId);
      const values = contradiction?.values ?? (expected === undefined ? [] : [expected.value]);
      return {
        zoneId: reading.zoneId,
        disposition: reading.disposition,
        value: reading.value,
        normalizedUnit: reading.normalizedUnit,
        confidence: reading.confidenceToken,
        sourceSpanIds:
          zone === undefined ? [] : sourceSpanIdsForZoneValues(sourceEvidence, zone, values),
      };
    }) ?? [];
  const reconciliation = scenario.expectedZones.map((zone) => {
    const { zoneId } = zone;
    const reading = readings.find((candidate) => candidate.zoneId === zoneId);
    const contradiction = scenario.contradictions.find((candidate) => candidate.zoneId === zoneId);
    const expected = scenario.expectedValues.find((candidate) => candidate.zoneId === zoneId);
    const values = contradiction?.values ?? (expected === undefined ? [] : [expected.value]);
    return {
      zoneId,
      disposition: reading?.disposition ?? "missing",
      values,
      sourceSpanIds: sourceSpanIdsForZoneValues(sourceEvidence, zone, values),
      reasonCodes: replay.observation?.readings.find((candidate) => candidate.zoneId === zoneId)
        ?.reasonCodes ?? ["evidence_not_produced"],
    };
  });
  const finalLifecycle = scenario.lifecycleEvents.at(-1);
  if (finalLifecycle === undefined) throw new Error("Simulator scenario lifecycle is empty");
  const quality = replay.observation?.quality ?? scenario.expectedEvidenceQuality;
  const confidence =
    replay.observation === null
      ? "Confidence unavailable"
      : quality === "complete"
        ? "High confidence"
        : "Low confidence";
  return {
    scenarioId: scenario.scenarioId,
    revision: scenario.revision,
    label: scenario.label,
    supportedModes: scenario.supportedModes,
    provenance: {
      kind: replay.origin.kind,
      mode: "DETERMINISTIC_REPLAY",
      compatibility: replay.origin.compatibility,
    },
    preRun: {
      category: categoryFor(scenario.expectedOutcomeFamily),
      terminalState: finalLifecycle.type,
      policyConsequence: policyConsequenceFor(scenario.expectedOutcomeFamily),
      durationMs: finalLifecycle.relativeOffsetMs,
    },
    sourceEvidence,
    readings,
    reconciliation,
    observation: {
      outcome: scenario.expectedOutcomeFamily,
      quality,
      confidence,
    },
    versions: {
      adapter: replay.observation?.adapterVersionId ?? adapterVersion,
      extractor: replay.observation?.extractorVersionId ?? extractorVersion,
    },
    dispositions: {
      transport: replay.attempt.terminalOutcome ?? "recorded",
      evidence: replay.evidence === null ? "not-produced" : "persisted",
      interpretation: replay.observation === null ? "not-run" : "recorded",
      idempotency: "canonical",
    },
    recoveryPredecessor:
      scenario.recoveryPredecessor === null || replay.recovery === null
        ? null
        : {
            scenarioId: scenario.recoveryPredecessor.scenarioId,
            revision: scenario.recoveryPredecessor.revision,
            simulationRunId: replay.recovery.predecessorSimulationRunId,
          },
  };
}

export async function buildSimulatorDemoProjection(
  scenarios: readonly SimulatorScenario[],
): Promise<SimulatorDemoProjection> {
  const catalog = new SimulatorScenarioCatalog(scenarios);
  // The canonical catalog retains immutable history; Simulator Lab projects one
  // choice per scenarioId by selecting only its highest available revision.
  const latestScenarios = new Map<string, SimulatorScenario>();
  for (const scenario of scenarios) {
    const latest = latestScenarios.get(scenario.scenarioId);
    if (latest === undefined || scenario.revision > latest.revision) {
      latestScenarios.set(scenario.scenarioId, scenario);
    }
  }
  return {
    schemaVersion: "simulator-demo-projection.v1",
    generatedFrom: "canonical deterministic replay",
    scenarios: await Promise.all(
      [...latestScenarios.values()].map((scenario) => projectScenario(scenario, catalog)),
    ),
  };
}

async function writeCommittedProjection(): Promise<void> {
  const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const outputPath = path.join(
    repositoryRoot,
    "apps/web/src/generated/simulator-demo-projection.json",
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  const projection = await buildSimulatorDemoProjection(SIMULATOR_SCENARIO_CATALOG);
  const serialized = await format(JSON.stringify(projection), { parser: "json" });
  await writeFile(outputPath, serialized, "utf8");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await writeCommittedProjection();
}
