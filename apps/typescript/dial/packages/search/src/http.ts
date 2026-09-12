import { DiscoveryError } from './types.js';

/**
 * Outbound HTTP for the research layer.
 *
 * Section 25 (SSRF): every request Dial makes on a user's behalf goes to a host
 * on this allowlist. Nothing user-supplied or model-supplied is ever used to
 * build a hostname, so a business listing carrying an internal URL cannot make
 * the server fetch it. Redirects are followed manually and re-checked against
 * the same allowlist, because an allowed host redirecting to 169.254.169.254 is
 * the classic bypass.
 */

const ALLOWED_HOSTS = new Set([
  'nominatim.openstreetmap.org',
  'overpass-api.de',
  'overpass.kumi.systems',
  'places.googleapis.com',
  'maps.googleapis.com',
  'api.search.brave.com',
]);

/** Literal addresses that must never be reachable, even via redirect. */
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
  /\.internal$/i,
  /\.local$/i,
];

export function assertAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DiscoveryError('invalid_request', 'Malformed URL.');
  }
  if (url.protocol !== 'https:') {
    throw new DiscoveryError('invalid_request', 'Only HTTPS requests are permitted.');
  }
  if (BLOCKED_HOST_PATTERNS.some((p) => p.test(url.hostname))) {
    throw new DiscoveryError('invalid_request', 'Refusing to fetch a private address.');
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new DiscoveryError('invalid_request', `Host ${url.hostname} is not an allowed provider.`);
  }
  return url;
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Cap on response size, so a hostile endpoint cannot exhaust memory. */
  maxBytes?: number;
}

export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<string> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15_000,
    maxBytes = 4 * 1024 * 1024,
  } = options;

  let current = assertAllowedUrl(rawUrl).toString();

  for (let hop = 0; hop < 4; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      clearTimeout(timer);
      if ((error as Error).name === 'AbortError') {
        throw new DiscoveryError('network_error', 'The provider timed out.', true);
      }
      throw new DiscoveryError('network_error', `Network error: ${(error as Error).message}`, true);
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new DiscoveryError('provider_unavailable', 'Redirect without a location.');
      // Re-validate on every hop rather than trusting the first check.
      current = assertAllowedUrl(new URL(location, current).toString()).toString();
      continue;
    }

    if (response.status === 429) {
      throw new DiscoveryError('rate_limited', 'The search provider rate-limited Dial.', true);
    }
    if (response.status >= 500) {
      throw new DiscoveryError('provider_unavailable', `Provider returned ${response.status}.`, true);
    }
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new DiscoveryError('invalid_request', `Provider returned ${response.status}: ${text}`);
    }

    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > maxBytes) {
      throw new DiscoveryError('provider_unavailable', 'Provider response was too large.');
    }
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new DiscoveryError('provider_unavailable', 'Provider response was too large.');
    }
    return text;
  }
  throw new DiscoveryError('provider_unavailable', 'Too many redirects.');
}

export async function safeFetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const text = await safeFetch(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DiscoveryError('provider_unavailable', 'Provider returned malformed JSON.');
  }
}

/**
 * Minimal per-host rate limiter. Nominatim's usage policy allows at most one
 * request per second, and honouring it is a condition of using the service.
 */
const lastRequestAt = new Map<string, number>();

export async function throttleHost(host: string, minIntervalMs: number): Promise<void> {
  const previous = lastRequestAt.get(host) ?? 0;
  const wait = previous + minIntervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt.set(host, Date.now());
}
