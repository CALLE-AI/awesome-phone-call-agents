import type { EvidenceRecord, OrganizationId } from "@muster/domain";

export type EvidenceAppendResult = Readonly<{
  outcome: "appended" | "replayed";
  value: EvidenceRecord;
}>;

export interface EvidenceRepository {
  append(record: EvidenceRecord): Promise<EvidenceAppendResult>;
  findById(organizationId: OrganizationId, evidenceId: string): Promise<EvidenceRecord | undefined>;
  findByProviderRevision(
    organizationId: OrganizationId,
    providerRunId: string,
    providerRevisionId: string,
  ): Promise<EvidenceRecord | undefined>;
}
