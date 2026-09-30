import type { FleetIncident } from "@muster/contracts";
import type { OrganizationId } from "@muster/domain";

export interface FleetEndpointIncidentSummary {
  readonly endpointId: string;
  readonly incident: FleetIncident;
}

export interface FleetIncidentSummaryPort {
  listForEndpoints(
    organizationId: OrganizationId,
    endpointIds: readonly string[],
  ): Promise<readonly FleetEndpointIncidentSummary[]>;
}
