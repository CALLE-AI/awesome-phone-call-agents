import type { LiveSimulatorAuthorizationRecord } from "@muster/application";
import type { ObservationOperationResponse } from "@muster/contracts";
import type { EvidenceRecord } from "@muster/domain";

export type LiveSimulatorAdmission = Readonly<{
  evidence: Readonly<{
    transcript?: readonly Readonly<{
      speaker: "agent" | "device" | "system";
      text: string;
    }>[];
    readings: readonly Readonly<{
      zoneId: string;
      status: "OK" | "ALARM" | "LOW" | "UNKNOWN";
    }>[];
    auxiliaryStatus: Readonly<{
      sound: "normal" | "alarm" | "unknown";
      power: "mains_available" | "mains_failed" | "unknown";
      battery: "normal" | "low" | "unknown";
      output: "off" | "on" | "unknown";
    }>;
  }> | null;
}>;

const zoneInventory = Object.freeze([
  Object.freeze({
    zoneId: "zone-01",
    label: "North house air temperature",
    unit: "degF",
  }),
  Object.freeze({
    zoneId: "zone-02",
    label: "Propagation bench temperature",
    unit: "degF",
  }),
  Object.freeze({
    zoneId: "zone-03",
    label: "Greenhouse relative humidity",
    unit: "percent",
  }),
  Object.freeze({
    zoneId: "zone-04",
    label: "Irrigation reservoir level",
    unit: "percent",
  }),
]);

type ResultFreeTerminalOutcome = Exclude<
  NonNullable<ObservationOperationResponse["terminalOutcome"]>,
  "observation_recorded"
>;

function emptyProjection(
  operation: ObservationOperationResponse,
  authorization: LiveSimulatorAuthorizationRecord,
  terminalOutcome: ResultFreeTerminalOutcome | null,
) {
  return Object.freeze({
    operationId: operation.operationId,
    resourceVersion: operation.resourceVersion,
    stage: operation.stage,
    terminal: operation.terminal,
    terminalOutcome,
    scenarioId: authorization.scenarioId,
    scenarioRevision: authorization.scenarioRevision,
    provenance: "SIMULATED" as const,
    transcript: Object.freeze([]),
    evidence: null,
    readings: Object.freeze([]),
    reconciliation: Object.freeze([]),
    auxiliaryStatus: null,
    predecessorOperationId: authorization.predecessorOperationId,
  });
}

/**
 * Maps the durable operation plus the validated, in-process admission into the
 * closed demo REST projection. A process restart deliberately downgrades a
 * complete observation to incomplete rather than inventing transcript/status
 * facts that are not stored in the observation tables.
 */
export function projectLiveSimulatorOperation(input: {
  readonly operation: ObservationOperationResponse;
  readonly authorization: LiveSimulatorAuthorizationRecord;
  readonly evidenceRecord: EvidenceRecord | undefined;
  readonly admission: LiveSimulatorAdmission | undefined;
}) {
  const { operation, authorization } = input;
  if (!operation.terminal) return emptyProjection(operation, authorization, null);
  if (operation.terminalOutcome !== "observation_recorded") {
    return emptyProjection(
      operation,
      authorization,
      operation.terminalOutcome ?? "evidence_unavailable",
    );
  }
  if (
    operation.observation === null ||
    operation.evidence === null ||
    input.evidenceRecord === undefined
  ) {
    return emptyProjection(operation, authorization, "evidence_unavailable");
  }

  const admittedEvidence = input.admission?.evidence;
  const admittedByZone = new Map(
    (admittedEvidence?.readings ?? []).map((reading) => [reading.zoneId, reading] as const),
  );
  const observationByZone = new Map(
    operation.observation.readings.map((reading) => [reading.zoneId, reading] as const),
  );
  const readings = zoneInventory.map((identity) => {
    const reading = observationByZone.get(identity.zoneId);
    const admitted = admittedByZone.get(identity.zoneId);
    const disposition =
      reading?.disposition === "grounded" ||
      reading?.disposition === "missing" ||
      reading?.disposition === "ambiguous" ||
      reading?.disposition === "contradictory" ||
      reading?.disposition === "invalid"
        ? reading.disposition
        : "invalid";
    const grounded = disposition === "grounded";
    return Object.freeze({
      zoneId: identity.zoneId,
      label: identity.label,
      value: grounded ? (reading?.value ?? null) : null,
      unit: grounded && reading?.normalizedUnit === identity.unit ? reading.normalizedUnit : null,
      status:
        grounded &&
        (admitted?.status === "OK" || admitted?.status === "ALARM" || admitted?.status === "LOW")
          ? admitted.status
          : ("UNKNOWN" as const),
      disposition,
    });
  });
  const reconciliation = readings.map((reading) =>
    Object.freeze({
      zoneId: reading.zoneId,
      disposition: reading.disposition === "grounded" ? ("matched" as const) : reading.disposition,
    }),
  );
  const auxiliaryStatus =
    admittedEvidence?.auxiliaryStatus ??
    Object.freeze({
      sound: "unknown" as const,
      power: "unknown" as const,
      battery: "unknown" as const,
      output: "unknown" as const,
    });
  const transcript = Object.freeze([...(admittedEvidence?.transcript ?? [])]);
  const closedComplete =
    operation.observation.quality === "complete" &&
    input.evidenceRecord.sourceCompleteness === "complete" &&
    transcript.length > 0 &&
    readings.every(
      (reading) =>
        reading.disposition === "grounded" &&
        reading.value !== null &&
        reading.unit !== null &&
        reading.status !== "UNKNOWN",
    ) &&
    !Object.values(auxiliaryStatus).includes("unknown");
  const terminalOutcome = closedComplete
    ? authorization.predecessorOperationId === null
      ? ("observation_recorded" as const)
      : ("recovery_candidate" as const)
    : ("evidence_incomplete" as const);
  const quality = closedComplete
    ? ("complete" as const)
    : input.evidenceRecord.sourceCompleteness === "truncated"
      ? ("partial" as const)
      : operation.observation.quality === "complete"
        ? ("unknown" as const)
        : operation.observation.quality;

  return Object.freeze({
    operationId: operation.operationId,
    resourceVersion: operation.resourceVersion,
    stage: operation.stage,
    terminal: true,
    terminalOutcome,
    scenarioId: authorization.scenarioId,
    scenarioRevision: authorization.scenarioRevision,
    provenance: "SIMULATED" as const,
    transcript,
    evidence: Object.freeze({
      quality,
      opaqueReference: input.evidenceRecord.opaqueCustodyRef,
    }),
    readings: Object.freeze(readings),
    reconciliation: Object.freeze(reconciliation),
    auxiliaryStatus,
    predecessorOperationId: authorization.predecessorOperationId,
  });
}
