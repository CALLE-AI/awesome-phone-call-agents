import type { ObservationOperationResponse } from "@muster/contracts";
import type { OrganizationId } from "@muster/domain";

import { ApplicationError } from "../errors/application-error.js";
import type { ObservationRepository } from "../ports/observation.repository.js";

export class GetLiveSimulatedObservation {
  public constructor(
    private readonly dependencies: { readonly observations: ObservationRepository },
  ) {}

  public async execute(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): Promise<ObservationOperationResponse | undefined> {
    const projection = await this.dependencies.observations.findOperation(
      input.organizationId,
      input.operationId,
    );
    if (projection !== undefined && projection.attempt.provenance !== "SIMULATED") {
      throw ApplicationError.validation("live_observation_not_simulated");
    }
    return projection;
  }
}
