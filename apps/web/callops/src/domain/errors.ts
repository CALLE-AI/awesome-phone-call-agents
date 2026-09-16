export class CallOpsError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidTransitionError extends CallOpsError {
  public constructor(from: string, to: string) {
    super(`Transition refused: ${from} -> ${to}.`, 'INVALID_TRANSITION');
  }
}

export class ApprovalGateError extends CallOpsError {
  public constructor(message: string, code = 'APPROVAL_GATE_CLOSED') {
    super(message, code);
  }
}

export interface SyntheticDataIssue {
  readonly path: string;
  readonly kind: 'EMAIL' | 'PHONE' | 'URL' | 'SECRET_LIKE' | 'REAL_DATA_MARKER';
}

export class SyntheticDataError extends CallOpsError {
  public constructor(public readonly issues: readonly SyntheticDataIssue[]) {
    super(
      `Synthetic-data validation refused ${String(issues.length)} field(s).`,
      'NON_SYNTHETIC_DATA',
    );
  }
}

export class LiveProviderDisabledError extends CallOpsError {
  public constructor() {
    super(
      'The CALL-E live provider is disabled in the mock vertical slice.',
      'LIVE_PROVIDER_DISABLED',
    );
  }
}
