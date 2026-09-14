import type { ObservationOperationResponse } from "@muster/contracts";
import type { OrganizationId } from "@muster/domain";

import type { ObservationRepository } from "../ports/observation.repository.js";

export class GetObservationOperation {
  public constructor(
    private readonly dependencies: { readonly observations: ObservationRepository },
  ) {}

  public async execute(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
  }): Promise<ObservationOperationResponse | undefined> {
    return await this.dependencies.observations.findOperation(
      input.organizationId,
      input.operationId,
    );
  }
}
