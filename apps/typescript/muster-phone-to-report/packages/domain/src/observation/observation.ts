import type { ObservationProvenance } from "./endpoint-observation-profile.js";

export const OBSERVATION_QUALITIES = Object.freeze([
  "complete",
  "partial",
  "unknown",
  "invalid",
] as const);

export const READING_DISPOSITIONS = Object.freeze([
  "grounded",
  "missing",
  "ambiguous",
  "contradictory",
  "reviewed_not_applicable",
  "invalid",
] as const);

export type ObservationQuality = (typeof OBSERVATION_QUALITIES)[number];
export type ReadingDisposition = (typeof READING_DISPOSITIONS)[number];

export interface CreateReadingInput {
  readonly zoneId: string;
  readonly ordinal: number;
  readonly disposition: ReadingDisposition;
  readonly value: string | null;
  readonly spokenUnit: string | null;
  readonly normalizedUnit: string | null;
  readonly confidenceToken: string | null;
  readonly confidenceSemanticsVersion: string | null;
  readonly candidateIds: readonly string[];
  readonly evidenceAnchorIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly providerRunId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly sourceCapturedAt: string;
  readonly derivedAt: string;
}

export interface CreateObservationInput {
  readonly id: string;
  readonly operationId: string;
  readonly version: number;
  readonly predecessorObservationId: string | null;
  readonly createdAt: string;
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly adapterVersionId: string;
  readonly extractorVersionId: string;
  readonly reconciliationPolicyVersion: string;
  readonly provenance: ObservationProvenance;
  readonly quality: ObservationQuality;
  readonly inputFingerprint: string;
  readonly readings: readonly Reading[];
}

const exactDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty, trimmed value`);
  }
}

function requireIsoTimestamp(value: string, field: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
}

function freezeStrings(values: readonly string[], field: string): readonly string[] {
  for (const value of values) {
    requireNonEmpty(value, field);
  }
  return Object.freeze([...values]);
}

export class Reading {
  public readonly zoneId: string;
  public readonly ordinal: number;
  public readonly disposition: ReadingDisposition;
  public readonly value: string | null;
  public readonly spokenUnit: string | null;
  public readonly normalizedUnit: string | null;
  public readonly confidenceToken: string | null;
  public readonly confidenceSemanticsVersion: string | null;
  public readonly candidateIds: readonly string[];
  public readonly evidenceAnchorIds: readonly string[];
  public readonly reasonCodes: readonly string[];
  public readonly evidenceId: string;
  public readonly evidenceRevisionId: string;
  public readonly providerRunId: string;
  public readonly adapterVersionId: string;
  public readonly extractorVersionId: string;
  public readonly sourceCapturedAt: string;
  public readonly derivedAt: string;

  private constructor(input: CreateReadingInput) {
    this.zoneId = input.zoneId;
    this.ordinal = input.ordinal;
    this.disposition = input.disposition;
    this.value = input.value;
    this.spokenUnit = input.spokenUnit;
    this.normalizedUnit = input.normalizedUnit;
    this.confidenceToken = input.confidenceToken;
    this.confidenceSemanticsVersion = input.confidenceSemanticsVersion;
    this.candidateIds = input.candidateIds;
    this.evidenceAnchorIds = input.evidenceAnchorIds;
    this.reasonCodes = input.reasonCodes;
    this.evidenceId = input.evidenceId;
    this.evidenceRevisionId = input.evidenceRevisionId;
    this.providerRunId = input.providerRunId;
    this.adapterVersionId = input.adapterVersionId;
    this.extractorVersionId = input.extractorVersionId;
    this.sourceCapturedAt = input.sourceCapturedAt;
    this.derivedAt = input.derivedAt;
    Object.freeze(this);
  }

  public static create(input: CreateReadingInput): Reading {
    for (const [field, value] of Object.entries({
      zoneId: input.zoneId,
      evidenceId: input.evidenceId,
      evidenceRevisionId: input.evidenceRevisionId,
      providerRunId: input.providerRunId,
      adapterVersionId: input.adapterVersionId,
      extractorVersionId: input.extractorVersionId,
    })) {
      requireNonEmpty(value, field);
    }
    if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
      throw new Error("Reading ordinal must be a non-negative integer");
    }
    requireIsoTimestamp(input.sourceCapturedAt, "sourceCapturedAt");
    requireIsoTimestamp(input.derivedAt, "derivedAt");
    if (input.disposition === "grounded") {
      if (input.value === null || !exactDecimalPattern.test(input.value)) {
        throw new Error("A grounded Reading requires an exact decimal value");
      }
      for (const [field, value] of Object.entries({
        spokenUnit: input.spokenUnit,
        normalizedUnit: input.normalizedUnit,
        confidenceToken: input.confidenceToken,
        confidenceSemanticsVersion: input.confidenceSemanticsVersion,
      })) {
        if (value === null) {
          throw new Error(`A grounded Reading requires ${field}`);
        }
        requireNonEmpty(value, field);
      }
      if (input.candidateIds.length !== 1 || input.evidenceAnchorIds.length === 0) {
        throw new Error(
          "A grounded Reading requires one candidate and at least one evidence anchor",
        );
      }
    } else if (
      input.value !== null ||
      input.spokenUnit !== null ||
      input.normalizedUnit !== null ||
      input.confidenceToken !== null ||
      input.confidenceSemanticsVersion !== null
    ) {
      throw new Error("A non-grounded Reading must not contain a derived value");
    }

    return new Reading({
      ...input,
      candidateIds: freezeStrings(input.candidateIds, "candidateId"),
      evidenceAnchorIds: freezeStrings(input.evidenceAnchorIds, "evidenceAnchorId"),
      reasonCodes: freezeStrings(input.reasonCodes, "reasonCode"),
    });
  }

  public toValue(): CreateReadingInput {
    return Object.freeze({
      zoneId: this.zoneId,
      ordinal: this.ordinal,
      disposition: this.disposition,
      value: this.value,
      spokenUnit: this.spokenUnit,
      normalizedUnit: this.normalizedUnit,
      confidenceToken: this.confidenceToken,
      confidenceSemanticsVersion: this.confidenceSemanticsVersion,
      candidateIds: this.candidateIds,
      evidenceAnchorIds: this.evidenceAnchorIds,
      reasonCodes: this.reasonCodes,
      evidenceId: this.evidenceId,
      evidenceRevisionId: this.evidenceRevisionId,
      providerRunId: this.providerRunId,
      adapterVersionId: this.adapterVersionId,
      extractorVersionId: this.extractorVersionId,
      sourceCapturedAt: this.sourceCapturedAt,
      derivedAt: this.derivedAt,
    });
  }
}

export class Observation {
  public readonly id: string;
  public readonly operationId: string;
  public readonly version: number;
  public readonly predecessorObservationId: string | null;
  public readonly createdAt: string;
  public readonly evidenceId: string;
  public readonly evidenceRevisionId: string;
  public readonly adapterVersionId: string;
  public readonly extractorVersionId: string;
  public readonly reconciliationPolicyVersion: string;
  public readonly provenance: ObservationProvenance;
  public readonly quality: ObservationQuality;
  public readonly inputFingerprint: string;
  public readonly readings: readonly Reading[];

  private constructor(input: CreateObservationInput) {
    this.id = input.id;
    this.operationId = input.operationId;
    this.version = input.version;
    this.predecessorObservationId = input.predecessorObservationId;
    this.createdAt = input.createdAt;
    this.evidenceId = input.evidenceId;
    this.evidenceRevisionId = input.evidenceRevisionId;
    this.adapterVersionId = input.adapterVersionId;
    this.extractorVersionId = input.extractorVersionId;
    this.reconciliationPolicyVersion = input.reconciliationPolicyVersion;
    this.provenance = input.provenance;
    this.quality = input.quality;
    this.inputFingerprint = input.inputFingerprint;
    this.readings = input.readings;
    Object.freeze(this);
  }

  public static create(input: CreateObservationInput): Observation {
    for (const [field, value] of Object.entries({
      id: input.id,
      operationId: input.operationId,
      evidenceId: input.evidenceId,
      evidenceRevisionId: input.evidenceRevisionId,
      adapterVersionId: input.adapterVersionId,
      extractorVersionId: input.extractorVersionId,
      reconciliationPolicyVersion: input.reconciliationPolicyVersion,
      inputFingerprint: input.inputFingerprint,
    })) {
      requireNonEmpty(value, field);
    }
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new Error("Observation version must be a positive integer");
    }
    if (input.version === 1 && input.predecessorObservationId !== null) {
      throw new Error("Observation version 1 must not have a predecessorObservationId");
    }
    if (input.version > 1 && input.predecessorObservationId === null) {
      throw new Error("Observation versions after 1 require a predecessorObservationId");
    }
    requireIsoTimestamp(input.createdAt, "createdAt");

    const readings = Object.freeze([...input.readings]);
    const ordinals = new Set(readings.map(({ ordinal }) => ordinal));
    const zoneIds = new Set(readings.map(({ zoneId }) => zoneId));
    if (ordinals.size !== readings.length || zoneIds.size !== readings.length) {
      throw new Error("Observation reading zone IDs and ordinals must be unique");
    }
    for (const reading of readings) {
      if (
        reading.evidenceId !== input.evidenceId ||
        reading.evidenceRevisionId !== input.evidenceRevisionId ||
        reading.adapterVersionId !== input.adapterVersionId ||
        reading.extractorVersionId !== input.extractorVersionId
      ) {
        throw new Error("Observation readings must reference the exact derivation lineage");
      }
    }
    const groundedCount = readings.filter(({ disposition }) => disposition === "grounded").length;
    const blockerCount = readings.filter(
      ({ disposition }) => disposition !== "grounded" && disposition !== "reviewed_not_applicable",
    ).length;
    if (input.quality === "complete" && (readings.length === 0 || blockerCount > 0)) {
      throw new Error("A complete Observation requires the full grounded inventory");
    }
    if (input.quality === "partial" && (groundedCount === 0 || blockerCount === 0)) {
      throw new Error("A partial Observation requires grounded and incomplete results");
    }
    if (input.quality === "unknown" && groundedCount > 0) {
      throw new Error("An unknown Observation must not contain grounded readings");
    }

    return new Observation({ ...input, readings });
  }

  public toValue(): CreateObservationInput {
    return Object.freeze({
      id: this.id,
      operationId: this.operationId,
      version: this.version,
      predecessorObservationId: this.predecessorObservationId,
      createdAt: this.createdAt,
      evidenceId: this.evidenceId,
      evidenceRevisionId: this.evidenceRevisionId,
      adapterVersionId: this.adapterVersionId,
      extractorVersionId: this.extractorVersionId,
      reconciliationPolicyVersion: this.reconciliationPolicyVersion,
      provenance: this.provenance,
      quality: this.quality,
      inputFingerprint: this.inputFingerprint,
      readings: this.readings,
    });
  }
}
