import type {
  CalleConfirmToken,
  CalleLivePlanRequest,
  CallePlanId,
  CalleRunId,
} from './calle-live-types';
import { CalleLiveAdapterError } from './calle-live-errors';

export interface CalleMcpResponseEnvelope {
  readonly body: unknown;
  readonly encodedBytes: number;
}

export interface CalleAuthenticatedSessionRequest {
  readonly serviceUrl: string;
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;
  readonly telemetry: 'disabled';
  readonly doNotTrack: true;
}

export type CalleMcpMutationOutcome =
  | {
      readonly kind: 'REJECTED_BEFORE_DISPATCH';
      readonly reasonCode: string;
    }
  | {
      readonly kind: 'DISPATCHED_RESPONSE';
      readonly response: CalleMcpResponseEnvelope;
    }
  | {
      readonly kind: 'DISPATCH_OUTCOME_UNKNOWN';
    };

export interface CalleAuthenticatedMcpSession {
  planCall(
    payload: CalleLivePlanRequest,
    signal: AbortSignal,
  ): Promise<CalleMcpResponseEnvelope>;
  runCall(
    capability: {
      readonly planId: CallePlanId;
      readonly confirmToken: CalleConfirmToken;
    },
    signal: AbortSignal,
  ): Promise<CalleMcpMutationOutcome>;
  getCallRun(runId: CalleRunId, signal: AbortSignal): Promise<CalleMcpResponseEnvelope>;
}

export interface CalleBackendAuthenticationBoundary {
  withAuthenticatedSession<TResult>(
    request: CalleAuthenticatedSessionRequest,
    operation: (session: CalleAuthenticatedMcpSession) => Promise<TResult>,
  ): Promise<TResult>;
}

export type CalleLocalTokenFormat = 'NONE' | 'OPAQUE' | 'JWT_UNVERIFIED' | 'MALFORMED';

export type CalleLocalTokenState =
  | 'ABSENT'
  | 'MALFORMED'
  | 'MISSING_OR_INVALID_EXPIRATION'
  | 'EXPIRED'
  | 'INSUFFICIENT_TTL'
  | 'USABLE';

export interface SanitizedCalleLocalAuthObservation {
  readonly cacheRoot: '%LOCALAPPDATA%\\CallOps\\calle-auth';
  readonly cachePresent: boolean;
  readonly cacheAclQualified: boolean;
  readonly tokenPresent: boolean;
  readonly tokenFormat: CalleLocalTokenFormat;
  readonly tokenState: CalleLocalTokenState;
  readonly tokenLocallyUsable: boolean;
  readonly expiresAt: string | null;
  readonly remainingSeconds: number | null;
  readonly issuerPresent: boolean;
  readonly issuer: string | null;
  readonly issuerSanitized: boolean;
  readonly audiencePresent: boolean;
  readonly scopePresent: boolean;
  readonly pendingLoginInspected: false;
  readonly rawCredentialExposed: false;
}

export interface CalleLocalAuthMetadataReader {
  inspect(): Promise<SanitizedCalleLocalAuthObservation>;
}

/**
 * This boundary can inspect a local cache only through a sanitized reader. It
 * deliberately remains unable to construct an authenticated MCP session.
 */
export class PreflightOnlyCalleAuthenticationBoundary implements CalleBackendAuthenticationBoundary {
  public constructor(private readonly reader: CalleLocalAuthMetadataReader) {}

  public inspectLocalState(): Promise<SanitizedCalleLocalAuthObservation> {
    return this.reader.inspect();
  }

  public withAuthenticatedSession<TResult>(
    request: CalleAuthenticatedSessionRequest,
    operation: (session: CalleAuthenticatedMcpSession) => Promise<TResult>,
  ): Promise<TResult> {
    void request;
    void operation;
    return Promise.reject(
      new CalleLiveAdapterError(
        'CALL-E authenticated sessions remain disabled after preflight.',
        'CALLE_AUTH_SESSION_DISABLED',
      ),
    );
  }
}

/**
 * This boundary deliberately has no credential property. A later, separately
 * authorized backend implementation may acquire credentials internally and
 * expose only the three static session methods above.
 */
export class DisabledCalleAuthenticationBoundary implements CalleBackendAuthenticationBoundary {
  public withAuthenticatedSession<TResult>(
    request: CalleAuthenticatedSessionRequest,
    operation: (session: CalleAuthenticatedMcpSession) => Promise<TResult>,
  ): Promise<TResult> {
    void request;
    void operation;
    return Promise.reject(new Error('CALL-E authentication boundary is disabled.'));
  }
}
