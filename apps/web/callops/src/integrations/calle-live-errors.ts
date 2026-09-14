export class CalleLiveAdapterError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class CalleRemoteExecutionUncertainError extends CalleLiveAdapterError {
  public constructor() {
    super(
      'The remote execution outcome is unknown; another run is forbidden.',
      'REMOTE_EXECUTION_UNCERTAIN',
    );
  }
}

export class CalleRunRejectedBeforeExecutionError extends CalleLiveAdapterError {
  public constructor(public readonly reasonCode: string) {
    super('The run request was rejected before remote execution.', 'RUN_REJECTED_BEFORE_EXECUTION');
  }
}
