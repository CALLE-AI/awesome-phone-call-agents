import type { CalleAuthenticatedMcpSession } from '../../src/integrations/calle-live-auth-boundary';
import type { CalleHttpLimits, CalleHttpObservation } from './guarded-mcp-fetch.mjs';
export const CALLE_MAX_STATUS_READS: 3;
export interface GuardedCalleCoreOptions {
  readonly enabled?: boolean;
  readonly cacheRoot?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly limits?: Partial<CalleHttpLimits>;
}
export function createCalleDiscovery(options?: GuardedCalleCoreOptions): {
  readonly listTools: (signal?: AbortSignal) => Promise<unknown>;
  readonly observation: () => CalleHttpObservation;
};
export function createCalleCoreSession(options?: GuardedCalleCoreOptions): CalleAuthenticatedMcpSession & {
  readonly observations: () => Readonly<Record<'plan' | 'run' | 'status', CalleHttpObservation> & { readonly statusReadCount: number }>;
};
