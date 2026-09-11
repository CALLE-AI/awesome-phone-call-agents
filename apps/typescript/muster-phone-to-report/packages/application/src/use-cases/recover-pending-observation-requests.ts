import type { W3CTraceContext } from "@muster/contracts";

import type { CallAttemptRepository } from "../ports/call-attempt.repository.js";
import type { IdentifierGenerator } from "../ports/identifier-generator.port.js";
import type { ObservationJobSchedulerPort } from "../ports/observation-job-scheduler.port.js";

export interface RecoverPendingObservationRequestsDependencies {
  readonly attempts: CallAttemptRepository;
  readonly scheduler: ObservationJobSchedulerPort;
  readonly identifiers: IdentifierGenerator;
}

export interface RecoverPendingObservationRequestsResult {
  readonly examined: number;
  readonly scheduled: number;
  readonly duplicates: number;
  readonly deferred: number;
}

export class RecoverPendingObservationRequests {
  public constructor(
    private readonly dependencies: RecoverPendingObservationRequestsDependencies,
  ) {}

  public async execute(input: {
    readonly limit: number;
    readonly traceContext?: W3CTraceContext;
  }): Promise<RecoverPendingObservationRequestsResult> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new Error("Observation recovery limit must be between 1 and 1000");
    }
    const pending = await this.dependencies.attempts.findPendingDispatches(input.limit);
    let scheduled = 0;
    let duplicates = 0;
    let deferred = 0;
    for (const attempt of pending) {
      const outcome = await this.dependencies.scheduler.scheduleObservation({
        version: "1",
        organizationId: attempt.organizationId.value,
        operationId: attempt.id,
        correlationId: this.dependencies.identifiers.generate(),
        ...(input.traceContext === undefined ? {} : { traceContext: input.traceContext }),
      });
      if (outcome.outcome === "scheduled") scheduled += 1;
      else if (outcome.outcome === "duplicate") duplicates += 1;
      else deferred += 1;
    }
    return Object.freeze({ examined: pending.length, scheduled, duplicates, deferred });
  }
}
