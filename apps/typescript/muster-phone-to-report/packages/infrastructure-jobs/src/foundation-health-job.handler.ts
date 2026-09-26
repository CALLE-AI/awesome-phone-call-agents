import type { RunFoundationHealthCheck } from "@muster/application";
import type { FoundationHealthJobPayload, FoundationHealthJobResult } from "@muster/contracts";

export interface TraceContextBoundary {
  run<T>(payload: FoundationHealthJobPayload, operation: () => Promise<T>): Promise<T>;
}

const directTraceBoundary: TraceContextBoundary = {
  run: async (_payload, operation) => await operation(),
};

export class FoundationHealthJobHandler {
  public constructor(
    private readonly useCase: RunFoundationHealthCheck,
    private readonly traceBoundary: TraceContextBoundary = directTraceBoundary,
  ) {}

  public async handle(payload: FoundationHealthJobPayload): Promise<FoundationHealthJobResult> {
    return await this.traceBoundary.run(payload, async () => await this.useCase.execute(payload));
  }
}
