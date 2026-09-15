import type { ObservationOperationResponse } from "@muster/contracts";
import type { Observation, OrganizationId } from "@muster/domain";

export type ObservationAppendResult = Readonly<{
  outcome: "appended" | "replayed";
  value: Observation;
}>;

export interface ObservationRepository {
  append(input: {
    readonly organizationId: OrganizationId;
    readonly observation: Observation;
  }): Promise<ObservationAppendResult>;
  findById(organizationId: OrganizationId, observationId: string): Promise<Observation | undefined>;
  findByDerivation(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly evidenceId: string;
    readonly adapterVersionId: string;
    readonly extractorVersionId: string;
    readonly reconciliationPolicyVersion: string;
  }): Promise<Observation | undefined>;
  findOperation(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<ObservationOperationResponse | undefined>;
}
