'use client';

import { DialApiClient, ApiError } from '@dial/api-client';

/**
 * Browser-side client. It points at the same-origin BFF proxy, so no API host
 * and no credentials appear in the bundle, and the session travels as an
 * httpOnly cookie that page scripts cannot read.
 */
export const api = new DialApiClient({
  baseUrl: '',
  credentials: 'include',
});

export { ApiError };

/** Rewrites the client's paths onto the proxy prefix. */
const originalFetch = globalThis.fetch;
export function proxyPath(path: string): string {
  return path.startsWith('/api/') ? `/api/be/${path.slice('/api/'.length)}` : path;
}

export const proxied = new DialApiClient({
  baseUrl: '',
  credentials: 'include',
  fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? proxyPath(input) : input;
    return originalFetch(url as RequestInfo, init);
  }) as typeof fetch,
});
