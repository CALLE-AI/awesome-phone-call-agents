import type { StartObservationCall } from "@muster/application";
import type { ObservationJobPayload, ObservationJobResult } from "@muster/contracts";

export interface ObservationTraceContextBoundary {
  run<T>(payload: ObservationJobPayload, operation: () => Promise<T>): Promise<T>;
}

export interface ObservationJobExecutionContext {
  readonly retryCount: number;
  readonly retryLimit: number;
}

const directTraceBoundary: ObservationTraceContextBoundary = {
  run: async (_payload, operation) => await operation(),
};

export class ObservationJobHandler {
  public constructor(
    private readonly runner: Pick<StartObservationCall, "executeJob">,
    private readonly traceBoundary: ObservationTraceContextBoundary = directTraceBoundary,
  ) {}

  public async handle(
    payload: ObservationJobPayload,
    context: ObservationJobExecutionContext = { retryCount: 0, retryLimit: 0 },
  ): Promise<ObservationJobResult> {
    return await this.traceBoundary.run(payload, async () => {
      const attempt = await this.runner.executeJob(payload, {
        attemptNumber: context.retryCount + 1,
        finalAttempt: context.retryCount >= context.retryLimit,
      });
      if (attempt.stage !== "terminal" || attempt.terminalOutcome === null) {
        throw new Error("Observation job did not reach a durable terminal state");
      }
      return Object.freeze({
        version: "1",
        operationId: attempt.id,
        stage: "terminal",
        terminalOutcome: attempt.terminalOutcome,
        completedAt: attempt.lastTransitionAt,
      });
    });
  }
}
