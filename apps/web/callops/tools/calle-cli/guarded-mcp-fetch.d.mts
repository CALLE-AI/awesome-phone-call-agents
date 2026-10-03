export const PINNED_CALLE_URL: string;
export const CALLE_PROTOCOL_VERSION: string;
export interface CalleHttpLimits {
  readonly timeoutMs: number;
  readonly perRequestTimeoutMs: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
}
export const CALLE_HTTP_LIMITS: CalleHttpLimits;
export interface CalleHttpObservation {
  readonly attemptedRequests: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly selectedOperationDispatched: boolean;
  readonly mutationAttempted: boolean;
}
export class CalleHttpBoundaryError extends Error {
  readonly code: string;
  constructor(code: string);
}
export function assertPinnedCalleUrl(value: unknown): void;
export function createBoundedCalleFetch(
  selected: 'tools/list' | 'plan_call' | 'run_call' | 'get_call_run',
  fetchImpl: typeof globalThis.fetch,
  options?: { readonly signal?: AbortSignal; readonly limits?: Partial<CalleHttpLimits> },
): { readonly fetch: typeof globalThis.fetch; readonly observation: () => CalleHttpObservation; readonly assertComplete: () => void; readonly close: () => void };
