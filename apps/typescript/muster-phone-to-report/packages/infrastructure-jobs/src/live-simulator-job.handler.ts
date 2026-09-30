export interface LiveSimulatorJobPayload {
  readonly version: "1";
  readonly operationId: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly runAuthorization: string;
  readonly predecessorOperationId?: string;
  readonly traceContext?: Readonly<{ traceparent: string; tracestate?: string }>;
}

export interface LiveSimulatorJobExecutionContext {
  readonly retryCount: number;
  readonly retryLimit: number;
}

interface LiveSimulatorRunner {
  execute(input: {
    readonly operationId: string;
    readonly scenarioId: string;
    readonly scenarioRevision: number;
    readonly runAuthorization: string;
    readonly predecessorOperationId?: string;
    readonly traceContext?: Readonly<{ traceparent: string; tracestate?: string }>;
  }): Promise<
    | Readonly<{ status: "completed" }>
    | Readonly<{ status: "blocked"; reason: string }>
    | Readonly<{ status: "failed"; reason: string; retryable: false }>
  >;
}

export class LiveSimulatorJobHandler {
  public constructor(
    private readonly runner: LiveSimulatorRunner,
    private readonly terminalAttempts?: Readonly<{
      recordFailure(input: {
        readonly operationId: string;
        readonly outcome: "blocked";
        readonly retryable: false;
      }): Promise<void>;
    }>,
  ) {}

  public async handle(
    payload: LiveSimulatorJobPayload,
    context: LiveSimulatorJobExecutionContext,
  ): Promise<Readonly<{ version: "1"; operationId: string; terminalOutcome: string }>> {
    if (
      !Number.isSafeInteger(context.retryCount) ||
      !Number.isSafeInteger(context.retryLimit) ||
      context.retryCount < 0 ||
      context.retryLimit < 0 ||
      context.retryLimit > 1 ||
      context.retryCount > context.retryLimit
    ) {
      throw new Error("Live simulator job delivery context is invalid");
    }
    const result = await this.runner.execute({
      operationId: payload.operationId,
      scenarioId: payload.scenarioId,
      scenarioRevision: payload.scenarioRevision,
      runAuthorization: payload.runAuthorization,
      ...(payload.predecessorOperationId === undefined
        ? {}
        : { predecessorOperationId: payload.predecessorOperationId }),
      ...(payload.traceContext === undefined ? {} : { traceContext: payload.traceContext }),
    });
    if (result.status === "blocked" && result.reason === "authorization_store_unavailable") {
      if (context.retryCount < context.retryLimit) {
        throw new Error("Live simulator pre-reservation delivery must be redelivered");
      }
      if (this.terminalAttempts === undefined) {
        throw new Error("Live simulator final pre-reservation failure cannot be acknowledged");
      }
      await this.terminalAttempts.recordFailure({
        operationId: payload.operationId,
        outcome: "blocked",
        retryable: false,
      });
    }
    const terminalOutcome = result.status === "completed" ? "completed" : result.reason;
    return Object.freeze({
      version: "1",
      operationId: payload.operationId,
      terminalOutcome,
    });
  }
}
