import {
  createSimulationOrigin,
  type SimulationOrigin,
  type SimulatorScenario,
} from "@muster/contracts";
import {
  type CallAttempt,
  type EndpointObservationProfile,
  type EvidenceAnchor,
  type EvidenceRecord,
  type ExtractedCandidate,
  type Observation,
  type OrganizationId,
} from "@muster/domain";

import type { CallAttemptRepository } from "../ports/call-attempt.repository.js";
import type { Clock } from "../ports/clock.port.js";
import type { EvidenceRepository } from "../ports/evidence.repository.js";
import type { IdentifierGenerator } from "../ports/identifier-generator.port.js";
import type { ObservationDispatchPolicyPort } from "../ports/observation-dispatch-policy.port.js";
import type { ObservationJobSchedulerPort } from "../ports/observation-job-scheduler.port.js";
import type { ObservationProfileRepository } from "../ports/observation-profile.repository.js";
import type { ObservationRepository } from "../ports/observation.repository.js";
import type {
  VoiceCallPort,
  VoiceCallPortFactory,
  VoiceCallRequest,
  VoiceCallResult,
} from "../ports/voice-call.port.js";
import { RecordObservationResult } from "../use-cases/record-observation-result.js";
import { RequestObservation } from "../use-cases/request-observation.js";
import { StartObservationCall } from "../use-cases/start-observation-call.js";
import type { SimulatorScenarioCatalog } from "./simulator-scenario-catalog.js";

export interface RunSimulatedObservationDependencies {
  readonly catalog: SimulatorScenarioCatalog;
  readonly profiles: ObservationProfileRepository;
  readonly attempts: CallAttemptRepository;
  readonly scheduler: ObservationJobSchedulerPort;
  readonly evidence: EvidenceRepository;
  readonly observations: ObservationRepository;
  readonly policy: ObservationDispatchPolicyPort;
  readonly clock: Clock;
  readonly identifiers: IdentifierGenerator;
}

export interface RunSimulatedObservationInput {
  readonly organizationId: OrganizationId;
  readonly endpointId: string;
  readonly scenarioId: string;
  readonly revision: number;
  readonly simulationRunId: string;
  readonly correlationId: string;
  readonly predecessorOrigin?: unknown;
}

export interface SimulatedRecoveryCandidate {
  readonly kind: "recovery_candidate";
  readonly predecessorSimulationRunId: string;
}

export interface RunSimulatedObservationOutput {
  readonly origin: SimulationOrigin;
  readonly attempt: CallAttempt;
  readonly evidence: EvidenceRecord | null;
  readonly observation: Observation | null;
  readonly recovery: SimulatedRecoveryCandidate | null;
}

const opaqueIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function requireOpaqueIdentifier(value: string, label: string, maximumLength: number): string {
  if (value.length === 0 || value.length > maximumLength || !opaqueIdentifierPattern.test(value)) {
    throw new Error(`${label} must be an opaque repository-safe identifier`);
  }
  return value;
}

function sourceCompletenessFor(scenario: SimulatorScenario): "complete" | "truncated" | "unknown" {
  if (
    scenario.expectedEvidenceQuality === "complete" ||
    scenario.expectedEvidenceQuality === "invalid"
  ) {
    return "complete";
  }
  if (scenario.expectedEvidenceQuality === "partial") return "truncated";
  return "unknown";
}

function mappingFor(
  profile: EndpointObservationProfile,
  zoneId: string,
  normalizedUnit: string,
): { readonly spokenUnit: string; readonly ruleId: string } {
  const zone = profile.expectedZones.find((candidate) => candidate.zoneId === zoneId);
  const mapping = zone?.allowedUnitMappings.find(
    (candidate) => candidate.normalizedUnit === normalizedUnit,
  );
  if (mapping === undefined) {
    throw new Error(`Simulator scenario value has no admitted unit mapping for ${zoneId}`);
  }
  return { spokenUnit: mapping.spokenUnit, ruleId: mapping.ruleId };
}

function buildEvidenceResult(input: {
  readonly scenario: SimulatorScenario;
  readonly profile: EndpointObservationProfile;
  readonly request: VoiceCallRequest;
  readonly simulationRunId: string;
  readonly capturedAt: string;
}): VoiceCallResult {
  if (input.scenario.expectedOutcomeFamily === "no-answer") {
    return Object.freeze({
      kind: "terminal_failure",
      outcome: "no_answer",
      retryable: false,
    });
  }
  if (input.request.dtmfPolicy.kind !== "forbidden") {
    throw new Error("Deterministic simulator replay requires forbidden DTMF");
  }

  const providerRunId = `simulator-run-${input.simulationRunId}`;
  const providerRevisionId = `${input.scenario.scenarioId}-r${String(input.scenario.revision)}`;
  const anchors: EvidenceAnchor[] = [];
  const candidates: ExtractedCandidate[] = [];
  const appendCandidate = (zoneId: string, value: string, normalizedUnit: string): void => {
    const ordinal = candidates.filter((candidate) => candidate.zoneId === zoneId).length + 1;
    const anchorId = `anchor-${zoneId}-${String(ordinal)}`;
    const candidateId = `candidate-${zoneId}-${String(ordinal)}`;
    const mapping = mappingFor(input.profile, zoneId, normalizedUnit);
    anchors.push(
      Object.freeze({
        anchorId,
        providerRunId,
        evidenceRevisionId: providerRevisionId,
        valueToken: value,
        spokenUnitToken: mapping.spokenUnit,
        opaqueSourceRef: `simulator-fixture:${input.scenario.scenarioId}:${zoneId}:${String(ordinal)}`,
        supportsTruncatedSource: input.scenario.expectedEvidenceQuality === "partial",
      }),
    );
    candidates.push(
      Object.freeze({
        candidateId,
        zoneId,
        providerRunId,
        evidenceRevisionId: providerRevisionId,
        callAttemptId: input.request.operationId,
        adapterVersionId: input.profile.adapterVersionId,
        provenance: "SIMULATED",
        sourceAnchorIds: Object.freeze([anchorId]),
        value,
        spokenUnit: mapping.spokenUnit,
        normalizedUnit,
        unitMappingRuleId: mapping.ruleId,
        confidenceToken: "high",
        confidenceSemanticsVersion: "simulator-confidence.v1",
      }),
    );
  };

  for (const expected of input.scenario.expectedValues) {
    appendCandidate(expected.zoneId, expected.value, expected.normalizedUnit);
  }
  for (const contradiction of input.scenario.contradictions) {
    const normalizedUnit =
      input.profile.expectedZones.find(({ zoneId }) => zoneId === contradiction.zoneId)
        ?.allowedUnitMappings[0]?.normalizedUnit ?? "";
    for (const value of contradiction.values) {
      appendCandidate(contradiction.zoneId, value, normalizedUnit);
    }
  }

  return Object.freeze({
    kind: "evidence",
    providerRunId,
    providerRevisionId,
    capturedAt: input.capturedAt,
    opaqueCustodyRef: `simulator-fixture://${input.scenario.scenarioId}/${String(input.scenario.revision)}`,
    provenance: "SIMULATED",
    sourceCompleteness: sourceCompletenessFor(input.scenario),
    admittedAnchors: Object.freeze(anchors),
    candidates: Object.freeze(candidates),
    confidencePolicy: Object.freeze({
      semanticsVersion: "simulator-confidence.v1",
      acceptableTokens: Object.freeze(["high"]),
    }),
  });
}

class DeterministicSimulatorVoiceCallPort implements VoiceCallPort {
  public constructor(
    private readonly scenario: SimulatorScenario,
    private readonly profile: EndpointObservationProfile,
    private readonly simulationRunId: string,
    private readonly capturedAt: string,
  ) {}

  public async createOrReconcile(request: VoiceCallRequest): Promise<VoiceCallResult> {
    return buildEvidenceResult({
      scenario: this.scenario,
      profile: this.profile,
      request,
      simulationRunId: this.simulationRunId,
      capturedAt: this.capturedAt,
    });
  }
}

function recoveryFor(
  scenario: SimulatorScenario,
  predecessorOrigin: unknown,
): SimulatedRecoveryCandidate | null {
  if (scenario.expectedOutcomeFamily !== "recovery-candidate") {
    if (predecessorOrigin !== undefined) {
      throw new Error("Only recovery simulator replay accepts a predecessor");
    }
    return null;
  }
  const predecessor = scenario.recoveryPredecessor;
  if (
    predecessor === null ||
    predecessorOrigin === undefined ||
    typeof predecessorOrigin !== "object" ||
    predecessorOrigin === null
  ) {
    throw new Error("Recovery simulator replay requires its exact simulated predecessor");
  }
  const value = predecessorOrigin as Partial<SimulationOrigin>;
  if (
    value.kind !== "SIMULATED" ||
    value.mode !== "DETERMINISTIC_REPLAY" ||
    value.scenarioId !== predecessor.scenarioId ||
    value.scenarioRevision !== predecessor.revision ||
    typeof value.simulationRunId !== "string" ||
    value.simulationRunId.length === 0 ||
    value.compatibility !== "simulator-tested"
  ) {
    throw new Error("Recovery simulator replay requires its exact simulated predecessor");
  }
  const predecessorSimulationRunId = requireOpaqueIdentifier(
    value.simulationRunId,
    "Predecessor simulation run ID",
    128,
  );
  return Object.freeze({
    kind: "recovery_candidate",
    predecessorSimulationRunId,
  });
}

export class RunSimulatedObservation {
  public constructor(private readonly dependencies: RunSimulatedObservationDependencies) {}

  public async execute(
    input: RunSimulatedObservationInput,
  ): Promise<RunSimulatedObservationOutput> {
    const simulationRunId = requireOpaqueIdentifier(
      input.simulationRunId,
      "Simulation run ID",
      128,
    );
    const correlationId = requireOpaqueIdentifier(input.correlationId, "Correlation ID", 128);
    const scenario = this.dependencies.catalog.get(input.scenarioId, input.revision);
    if (!scenario.supportedModes.includes("DETERMINISTIC_REPLAY")) {
      throw new Error("Simulator scenario does not support deterministic replay");
    }
    const origin = createSimulationOrigin({
      kind: "SIMULATED",
      mode: "DETERMINISTIC_REPLAY",
      scenarioId: scenario.scenarioId,
      scenarioRevision: scenario.revision,
      simulationRunId,
      compatibility: "simulator-tested",
    });
    const recovery = recoveryFor(scenario, input.predecessorOrigin);
    const profile = await this.dependencies.profiles.findByEndpoint(
      input.organizationId,
      input.endpointId,
    );
    if (
      profile === undefined ||
      profile.provenance !== "SIMULATED" ||
      profile.compatibility !== "simulator-tested" ||
      profile.dtmfPolicy.kind !== "forbidden"
    ) {
      throw new Error("Simulator replay requires a SIMULATED, DTMF-forbidden endpoint profile");
    }

    const requestObservation = new RequestObservation(this.dependencies);
    const requested = await requestObservation.execute({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
      pollWindowId: `${scenario.scenarioId}@${String(scenario.revision)}`,
      idempotencyKey: `simulator-run:${simulationRunId}`,
      correlationId,
      trigger: "manual",
    });
    const recordResult = new RecordObservationResult(this.dependencies);
    const providerFactory: VoiceCallPortFactory = Object.freeze({
      create: () =>
        new DeterministicSimulatorVoiceCallPort(
          scenario,
          profile,
          simulationRunId,
          this.dependencies.clock.now(),
        ),
    });
    const startObservation = new StartObservationCall({
      attempts: this.dependencies.attempts,
      profiles: this.dependencies.profiles,
      policy: this.dependencies.policy,
      providerFactory,
      clock: this.dependencies.clock,
      recordResult,
    });
    const attempt = await startObservation.execute({
      organizationId: input.organizationId,
      operationId: requested.operation.id,
      correlationId,
    });
    const evidence =
      attempt.latestEvidenceId === null
        ? null
        : ((await this.dependencies.evidence.findById(
            input.organizationId,
            attempt.latestEvidenceId,
          )) ?? null);
    const observation =
      attempt.latestObservationId === null
        ? null
        : ((await this.dependencies.observations.findById(
            input.organizationId,
            attempt.latestObservationId,
          )) ?? null);
    return Object.freeze({ origin, attempt, evidence, observation, recovery });
  }
}
