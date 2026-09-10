import type { OrganizationId } from "../shared/organization-id.js";
import type { ObservationProvenance } from "./endpoint-observation-profile.js";

export type EvidenceSourceCompleteness = "complete" | "truncated" | "unknown";

export interface CreateEvidenceRecordInput {
  readonly id: string;
  readonly revision: number;
  readonly predecessorEvidenceId: string | null;
  readonly organizationId: OrganizationId;
  readonly callAttemptId: string;
  readonly adapterVersionId: string;
  readonly providerRunId: string;
  readonly providerRevisionId: string;
  readonly capturedAt: string;
  readonly retainedAt: string;
  readonly opaqueCustodyRef: string;
  readonly provenance: ObservationProvenance;
  readonly sourceCompleteness: EvidenceSourceCompleteness;
}

const allowedFields = new Set<keyof CreateEvidenceRecordInput>([
  "id",
  "revision",
  "predecessorEvidenceId",
  "organizationId",
  "callAttemptId",
  "adapterVersionId",
  "providerRunId",
  "providerRevisionId",
  "capturedAt",
  "retainedAt",
  "opaqueCustodyRef",
  "provenance",
  "sourceCompleteness",
]);

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

export class EvidenceRecord {
  public readonly id: string;
  public readonly revision: number;
  public readonly predecessorEvidenceId: string | null;
  public readonly organizationId: OrganizationId;
  public readonly callAttemptId: string;
  public readonly adapterVersionId: string;
  public readonly providerRunId: string;
  public readonly providerRevisionId: string;
  public readonly capturedAt: string;
  public readonly retainedAt: string;
  public readonly opaqueCustodyRef: string;
  public readonly provenance: ObservationProvenance;
  public readonly sourceCompleteness: EvidenceSourceCompleteness;

  private constructor(input: CreateEvidenceRecordInput) {
    this.id = input.id;
    this.revision = input.revision;
    this.predecessorEvidenceId = input.predecessorEvidenceId;
    this.organizationId = input.organizationId;
    this.callAttemptId = input.callAttemptId;
    this.adapterVersionId = input.adapterVersionId;
    this.providerRunId = input.providerRunId;
    this.providerRevisionId = input.providerRevisionId;
    this.capturedAt = input.capturedAt;
    this.retainedAt = input.retainedAt;
    this.opaqueCustodyRef = input.opaqueCustodyRef;
    this.provenance = input.provenance;
    this.sourceCompleteness = input.sourceCompleteness;
    Object.freeze(this);
  }

  public static create(input: CreateEvidenceRecordInput): EvidenceRecord {
    const unsupportedFields = Object.keys(input).filter(
      (field) => !allowedFields.has(field as keyof CreateEvidenceRecordInput),
    );
    if (unsupportedFields.length > 0) {
      throw new Error(
        `EvidenceRecord contains unsupported or protected fields: ${unsupportedFields.sort().join(", ")}`,
      );
    }
    for (const [field, value] of Object.entries({
      id: input.id,
      callAttemptId: input.callAttemptId,
      adapterVersionId: input.adapterVersionId,
      providerRunId: input.providerRunId,
      providerRevisionId: input.providerRevisionId,
      opaqueCustodyRef: input.opaqueCustodyRef,
    })) {
      requireNonEmpty(value, field);
    }
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
      throw new Error("EvidenceRecord revision must be a positive integer");
    }
    if (input.revision === 1 && input.predecessorEvidenceId !== null) {
      throw new Error("EvidenceRecord revision 1 must not have a predecessorEvidenceId");
    }
    if (input.revision > 1 && input.predecessorEvidenceId === null) {
      throw new Error("EvidenceRecord revisions after 1 require a predecessorEvidenceId");
    }
    requireIsoTimestamp(input.capturedAt, "capturedAt");
    requireIsoTimestamp(input.retainedAt, "retainedAt");
    if (Date.parse(input.retainedAt) < Date.parse(input.capturedAt)) {
      throw new Error("EvidenceRecord retainedAt must not precede capturedAt");
    }
    return new EvidenceRecord(input);
  }

  public toValue(): CreateEvidenceRecordInput {
    return Object.freeze({
      id: this.id,
      revision: this.revision,
      predecessorEvidenceId: this.predecessorEvidenceId,
      organizationId: this.organizationId,
      callAttemptId: this.callAttemptId,
      adapterVersionId: this.adapterVersionId,
      providerRunId: this.providerRunId,
      providerRevisionId: this.providerRevisionId,
      capturedAt: this.capturedAt,
      retainedAt: this.retainedAt,
      opaqueCustodyRef: this.opaqueCustodyRef,
      provenance: this.provenance,
      sourceCompleteness: this.sourceCompleteness,
    });
  }
}
