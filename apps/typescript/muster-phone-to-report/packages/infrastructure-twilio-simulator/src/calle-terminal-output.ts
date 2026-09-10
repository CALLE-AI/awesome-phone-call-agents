import type { VoiceCallResult } from "@muster/application";

export type CalleTerminalStatus =
  "completed" | "no_answer" | "busy" | "failed" | "evidence_unavailable";

export interface CalleObservedReading {
  readonly zoneId: string;
  readonly value: string;
  readonly spokenUnit: string;
  readonly normalizedUnit: string;
  readonly status: "OK" | "ALARM" | "LOW" | "UNKNOWN";
  readonly confidenceToken: string;
  readonly sourceAnchor: Readonly<{
    anchorId: string;
    valueToken: string;
    spokenUnitToken: string;
    opaqueSourceRef: string;
  }>;
}

export interface CalleTerminalOutput {
  readonly providerCallId: string;
  readonly terminalStatus: CalleTerminalStatus;
  readonly observedAt: string;
  readonly evidence: Readonly<{
    providerRevisionId: string;
    opaqueCustodyRef: string;
    sourceCompleteness: "complete" | "truncated" | "unknown";
    transcript?: readonly Readonly<{
      speaker: "agent" | "device" | "system";
      text: string;
    }>[];
    readings: readonly CalleObservedReading[];
    auxiliaryStatus: Readonly<{
      sound: "normal" | "alarm" | "unknown";
      power: "mains_available" | "mains_failed" | "unknown";
      battery: "normal" | "low" | "unknown";
      output: "off" | "on" | "unknown";
    }>;
  }> | null;
}

export interface CalleTerminalMappingContext {
  readonly operationId: string;
  readonly adapterVersionId: string;
  readonly simulationRunId: string;
}

export interface MappedCalleTerminalOutput {
  readonly providerFacts: Readonly<{
    providerCallId: string;
    terminalStatus: CalleTerminalStatus;
    observedAt: string;
  }>;
  readonly result: VoiceCallResult;
}

export interface CalleEvidencePersistence {
  persistAdmission(
    admission: Readonly<{
      readonly operationId: string;
      readonly adapterVersionId: string;
      readonly providerFacts: MappedCalleTerminalOutput["providerFacts"];
      readonly evidence: CalleTerminalOutput["evidence"];
    }>,
  ): Promise<void>;
}

export const CALLE_PROVIDER_OBSERVED_UNIT_MAPPING_RULE_ID = "calle-provider-observed.v1";
export const CALLE_PROVIDER_PERCENT_SYMBOL_UNIT_MAPPING_RULE_ID =
  "calle-provider-percent-symbol.v1";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const rfc3339Pattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const statuses = new Set<CalleTerminalStatus>([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "evidence_unavailable",
]);
const completenessValues = new Set(["complete", "truncated", "unknown"]);

function invalid(field: string): never {
  throw new Error(`Invalid CALL-E output: ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) invalid(field);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid(field);
  return value;
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) invalid(field);
  return value;
}

function requireText(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) invalid(field);
  return value;
}

function requireTimestamp(value: unknown, field: string): string {
  const text = requireText(value, field, 64);
  const match = rfc3339Pattern.exec(text);
  if (match === null) invalid(field);
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const hour = Number(match[4]!);
  const minute = Number(match[5]!);
  const second = Number(match[6]!);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    invalid(field);
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) invalid(field);
  return new Date(timestamp).toISOString();
}

function requireEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(field);
  return value as T;
}

function parseOutput(value: unknown): CalleTerminalOutput {
  const output = exactRecord(
    value,
    ["providerCallId", "terminalStatus", "observedAt", "evidence"],
    "payload",
  );
  const providerCallId = requireIdentifier(output["providerCallId"], "providerCallId");
  if (
    typeof output["terminalStatus"] !== "string" ||
    !statuses.has(output["terminalStatus"] as CalleTerminalStatus)
  ) {
    invalid("terminalStatus");
  }
  const terminalStatus = output["terminalStatus"] as CalleTerminalStatus;
  const observedAt = requireTimestamp(output["observedAt"], "observedAt");
  if (output["evidence"] === null) {
    return Object.freeze({ providerCallId, terminalStatus, observedAt, evidence: null });
  }
  const evidenceValue = output["evidence"];
  const evidenceKeys = isRecord(evidenceValue) ? Object.keys(evidenceValue) : [];
  const evidence = exactRecord(
    evidenceValue,
    evidenceKeys.includes("transcript")
      ? [
          "providerRevisionId",
          "opaqueCustodyRef",
          "sourceCompleteness",
          "transcript",
          "readings",
          "auxiliaryStatus",
        ]
      : [
          "providerRevisionId",
          "opaqueCustodyRef",
          "sourceCompleteness",
          "readings",
          "auxiliaryStatus",
        ],
    "evidence",
  );
  const providerRevisionId = requireIdentifier(
    evidence["providerRevisionId"],
    "providerRevisionId",
  );
  const opaqueCustodyRef = requireText(evidence["opaqueCustodyRef"], "opaqueCustodyRef");
  if (
    typeof evidence["sourceCompleteness"] !== "string" ||
    !completenessValues.has(evidence["sourceCompleteness"])
  ) {
    invalid("sourceCompleteness");
  }
  if (!Array.isArray(evidence["readings"]) || evidence["readings"].length !== 4) {
    invalid("readings");
  }
  const transcript =
    evidence["transcript"] === undefined
      ? undefined
      : Array.isArray(evidence["transcript"]) &&
          evidence["transcript"].length > 0 &&
          evidence["transcript"].length <= 64
        ? Object.freeze(
            evidence["transcript"].map((candidate, index) => {
              const turn = exactRecord(candidate, ["speaker", "text"], `transcript[${index}]`);
              return Object.freeze({
                speaker: requireEnum(
                  turn["speaker"],
                  ["agent", "device", "system"] as const,
                  "speaker",
                ),
                text: requireText(turn["text"], "transcript text", 2_000),
              });
            }),
          )
        : invalid("transcript");
  const readings = evidence["readings"].map((candidate, index) => {
    const reading = exactRecord(
      candidate,
      [
        "zoneId",
        "value",
        "spokenUnit",
        "normalizedUnit",
        "status",
        "confidenceToken",
        "sourceAnchor",
      ],
      `readings[${index}]`,
    );
    const source = exactRecord(
      reading["sourceAnchor"],
      ["anchorId", "valueToken", "spokenUnitToken", "opaqueSourceRef"],
      `readings[${index}].sourceAnchor`,
    );
    const valueToken = requireText(source["valueToken"], "valueToken");
    const readingValue = requireText(reading["value"], "reading value");
    if (!decimalPattern.test(readingValue) || readingValue !== valueToken) invalid("reading value");
    return Object.freeze({
      zoneId: requireIdentifier(reading["zoneId"], "zoneId"),
      value: readingValue,
      spokenUnit: requireText(reading["spokenUnit"], "spokenUnit"),
      normalizedUnit: requireIdentifier(reading["normalizedUnit"], "normalizedUnit"),
      status: requireEnum(reading["status"], ["OK", "ALARM", "LOW", "UNKNOWN"] as const, "status"),
      confidenceToken: requireIdentifier(reading["confidenceToken"], "confidenceToken"),
      sourceAnchor: Object.freeze({
        anchorId: requireIdentifier(source["anchorId"], "anchorId"),
        valueToken,
        spokenUnitToken: requireText(source["spokenUnitToken"], "spokenUnitToken"),
        opaqueSourceRef: requireText(source["opaqueSourceRef"], "opaqueSourceRef"),
      }),
    });
  });
  if (new Set(readings.map((reading) => reading.zoneId)).size !== 4) invalid("readings");
  const auxiliary = exactRecord(
    evidence["auxiliaryStatus"],
    ["sound", "power", "battery", "output"],
    "auxiliaryStatus",
  );
  const auxiliaryStatus = Object.freeze({
    sound: requireEnum(auxiliary["sound"], ["normal", "alarm", "unknown"] as const, "sound"),
    power: requireEnum(
      auxiliary["power"],
      ["mains_available", "mains_failed", "unknown"] as const,
      "power",
    ),
    battery: requireEnum(auxiliary["battery"], ["normal", "low", "unknown"] as const, "battery"),
    output: requireEnum(auxiliary["output"], ["off", "on", "unknown"] as const, "output"),
  });
  return Object.freeze({
    providerCallId,
    terminalStatus,
    observedAt,
    evidence: Object.freeze({
      providerRevisionId,
      opaqueCustodyRef,
      sourceCompleteness: evidence["sourceCompleteness"] as "complete" | "truncated" | "unknown",
      ...(transcript === undefined ? {} : { transcript }),
      readings: Object.freeze(readings),
      auxiliaryStatus,
    }),
  });
}

function terminalFailure(
  outcome: "no_answer" | "busy" | "provider_failed" | "evidence_unavailable",
): VoiceCallResult {
  return Object.freeze({ kind: "terminal_failure", outcome, retryable: false });
}

function unitMappingFor(reading: CalleObservedReading): Readonly<{
  spokenUnit: string;
  ruleId: string | null;
}> {
  const spokenUnit = reading.sourceAnchor.spokenUnitToken;
  if (spokenUnit === reading.spokenUnit) {
    return Object.freeze({
      spokenUnit,
      ruleId: CALLE_PROVIDER_OBSERVED_UNIT_MAPPING_RULE_ID,
    });
  }
  if (
    spokenUnit === "%" &&
    reading.spokenUnit === "percent" &&
    reading.normalizedUnit === "percent"
  ) {
    return Object.freeze({
      spokenUnit,
      ruleId: CALLE_PROVIDER_PERCENT_SYMBOL_UNIT_MAPPING_RULE_ID,
    });
  }
  return Object.freeze({ spokenUnit, ruleId: null });
}

export async function mapCalleTerminalOutput(
  untrustedOutput: unknown,
  context: CalleTerminalMappingContext,
  dependencies: CalleEvidencePersistence & { readonly reviewedConfidenceTokens: readonly string[] },
): Promise<MappedCalleTerminalOutput> {
  const output = parseOutput(untrustedOutput);
  requireIdentifier(context.operationId, "operationId");
  requireIdentifier(context.adapterVersionId, "adapterVersionId");
  requireIdentifier(context.simulationRunId, "simulationRunId");
  const reviewedConfidenceTokens = Object.freeze(
    [...new Set(dependencies.reviewedConfidenceTokens)].map((token) =>
      requireIdentifier(token, "reviewedConfidenceTokens"),
    ),
  );
  const providerFacts = Object.freeze({
    providerCallId: output.providerCallId,
    terminalStatus: output.terminalStatus,
    observedAt: output.observedAt,
  });

  // The persistence boundary receives validated provider facts and evidence only;
  // interpretation and candidate derivation deliberately occur after it succeeds.
  await dependencies.persistAdmission(
    Object.freeze({
      operationId: context.operationId,
      adapterVersionId: context.adapterVersionId,
      providerFacts,
      evidence: output.evidence,
    }),
  );

  if (output.terminalStatus === "no_answer") {
    return Object.freeze({ providerFacts, result: terminalFailure("no_answer") });
  }
  if (output.terminalStatus === "busy") {
    return Object.freeze({ providerFacts, result: terminalFailure("busy") });
  }
  if (output.terminalStatus === "failed") {
    return Object.freeze({ providerFacts, result: terminalFailure("provider_failed") });
  }
  if (output.terminalStatus === "evidence_unavailable" || output.evidence === null) {
    return Object.freeze({ providerFacts, result: terminalFailure("evidence_unavailable") });
  }

  const zoneValues = new Map<string, Set<string>>();
  const anchors = output.evidence.readings.map((reading) => {
    const values = zoneValues.get(reading.zoneId) ?? new Set<string>();
    values.add(reading.value);
    zoneValues.set(reading.zoneId, values);
    return Object.freeze({
      anchorId: reading.sourceAnchor.anchorId,
      providerRunId: output.providerCallId,
      evidenceRevisionId: output.evidence!.providerRevisionId,
      valueToken: reading.sourceAnchor.valueToken,
      spokenUnitToken: reading.sourceAnchor.spokenUnitToken,
      opaqueSourceRef: reading.sourceAnchor.opaqueSourceRef,
      supportsTruncatedSource: output.evidence!.sourceCompleteness === "truncated",
    });
  });
  const contradictory = [...zoneValues.values()].some((values) => values.size > 1);
  const confidenceReviewed = output.evidence.readings.every((reading) =>
    reviewedConfidenceTokens.includes(reading.confidenceToken),
  );
  const statusUncertain = output.evidence.readings.some((reading) => reading.status === "UNKNOWN");
  const candidates =
    contradictory ||
    !confidenceReviewed ||
    output.evidence.sourceCompleteness !== "complete" ||
    statusUncertain
      ? null
      : Object.freeze(
          output.evidence.readings.map((reading) => {
            const unitMapping = unitMappingFor(reading);
            return Object.freeze({
              candidateId: `calle-${reading.sourceAnchor.anchorId}`,
              zoneId: reading.zoneId,
              providerRunId: output.providerCallId,
              evidenceRevisionId: output.evidence!.providerRevisionId,
              callAttemptId: context.operationId,
              adapterVersionId: context.adapterVersionId,
              provenance: "SIMULATED" as const,
              sourceAnchorIds: Object.freeze([reading.sourceAnchor.anchorId]),
              value: reading.value,
              spokenUnit: unitMapping.spokenUnit,
              normalizedUnit: reading.normalizedUnit,
              unitMappingRuleId: unitMapping.ruleId,
              confidenceToken: reading.confidenceToken,
              confidenceSemanticsVersion: "calle-provider-observed.v1",
            });
          }),
        );
  return Object.freeze({
    providerFacts,
    result: Object.freeze({
      kind: "evidence",
      providerRunId: output.providerCallId,
      providerRevisionId: output.evidence.providerRevisionId,
      capturedAt: output.observedAt,
      opaqueCustodyRef: output.evidence.opaqueCustodyRef,
      provenance: "SIMULATED",
      sourceCompleteness:
        contradictory || !confidenceReviewed || statusUncertain
          ? "unknown"
          : output.evidence.sourceCompleteness,
      admittedAnchors: Object.freeze(anchors),
      candidates,
      confidencePolicy: Object.freeze({
        semanticsVersion: "calle-provider-observed.v1",
        acceptableTokens: reviewedConfidenceTokens,
      }),
    }),
  });
}
