import { CalleLiveAdapterError } from './calle-live-errors';

export const CALLE_EXPECTED_SERVICE_ORIGIN = 'https://seleven-mcp-sg.airudder.com' as const;
export const CALLE_EXPECTED_SERVICE_HOST = 'seleven-mcp-sg.airudder.com' as const;
export const CALLE_EXPECTED_MCP_PATH = '/mcp/openagent_oauth' as const;
export const CALLE_EXPECTED_MCP_URL =
  `${CALLE_EXPECTED_SERVICE_ORIGIN}${CALLE_EXPECTED_MCP_PATH}` as const;
export const CALLE_MAX_TRANSPORT_TIMEOUT_MS = 15_000 as const;
export const CALLE_MAX_REQUEST_BYTES = 32_768 as const;
export const CALLE_MAX_RESPONSE_BYTES = 1_048_576 as const;

export interface CalleLiveTransportPolicy {
  readonly enabled: boolean;
  readonly serviceUrl: string;
  readonly timeoutMs: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly telemetry: 'disabled';
  readonly doNotTrack: true;
}

export const DISABLED_CALLE_LIVE_TRANSPORT_POLICY: CalleLiveTransportPolicy = Object.freeze({
  enabled: false,
  serviceUrl: CALLE_EXPECTED_MCP_URL,
  timeoutMs: CALLE_MAX_TRANSPORT_TIMEOUT_MS,
  maximumRequestBytes: CALLE_MAX_REQUEST_BYTES,
  maximumResponseBytes: CALLE_MAX_RESPONSE_BYTES,
  telemetry: 'disabled',
  doNotTrack: true,
});

function fail(message: string, code: string): never {
  throw new CalleLiveAdapterError(message, code);
}

export function assertCalleLiveTransportPolicy(policy: CalleLiveTransportPolicy): void {
  let endpoint: URL;
  try {
    endpoint = new URL(policy.serviceUrl);
  } catch {
    fail('The CALL-E service URL is invalid.', 'CALLE_TRANSPORT_URL_INVALID');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.hostname !== CALLE_EXPECTED_SERVICE_HOST ||
    endpoint.origin !== CALLE_EXPECTED_SERVICE_ORIGIN ||
    endpoint.pathname !== CALLE_EXPECTED_MCP_PATH ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    endpoint.username !== '' ||
    endpoint.password !== ''
  ) {
    fail('The CALL-E service endpoint does not match the pinned HTTPS origin.', 'CALLE_TRANSPORT_ENDPOINT_REFUSED');
  }
  if (
    !Number.isSafeInteger(policy.timeoutMs) ||
    policy.timeoutMs < 1_000 ||
    policy.timeoutMs > CALLE_MAX_TRANSPORT_TIMEOUT_MS
  ) {
    fail('The CALL-E transport timeout is outside the local bound.', 'CALLE_TRANSPORT_TIMEOUT_INVALID');
  }
  if (
    !Number.isSafeInteger(policy.maximumRequestBytes) ||
    policy.maximumRequestBytes < 1 ||
    policy.maximumRequestBytes > CALLE_MAX_REQUEST_BYTES
  ) {
    fail('The CALL-E request-size bound is invalid.', 'CALLE_REQUEST_LIMIT_INVALID');
  }
  if (
    !Number.isSafeInteger(policy.maximumResponseBytes) ||
    policy.maximumResponseBytes < 1 ||
    policy.maximumResponseBytes > CALLE_MAX_RESPONSE_BYTES
  ) {
    fail('The CALL-E response-size bound is invalid.', 'CALLE_RESPONSE_LIMIT_INVALID');
  }
  if (policy.telemetry !== 'disabled' || policy.doNotTrack !== true) {
    fail('The CALL-E telemetry boundary must remain disabled.', 'CALLE_TELEMETRY_POLICY_INVALID');
  }
}
