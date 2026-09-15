// Where credentials may travel. The CALL-E key is sent only to CALL-E's official HTTPS API, or to a
// loopback test server with an explicit dummy key, and credentialed requests never follow
// redirects, so a 30x can't forward the key or a request body to another host.

export const APPROVED_CALLE_ORIGINS: readonly string[] = ["https://api.heycall-e.com"];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * The base URL the CALL-E SDK may use; undefined keeps the SDK's official default. Throws for any other
 * origin, for loopback without CALLE_LOCAL_TEST_TRANSPORT=true and CALLE_API_KEY=local-test-only, and for URLs carrying credentials, a
 * query, or a fragment.
 */
export function calleBaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.CALLE_BASE_URL?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("CALLE_BASE_URL is not a valid URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("CALLE_BASE_URL must not contain credentials, a query, or a fragment.");
  }
  const base = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  if (url.protocol === "https:" && APPROVED_CALLE_ORIGINS.includes(url.origin)) return base;
  const web = url.protocol === "http:" || url.protocol === "https:";
  if (web && isLoopbackUrl(url) && env.CALLE_LOCAL_TEST_TRANSPORT === "true" && env.CALLE_API_KEY === "local-test-only") return base;
  throw new Error(`CALLE_BASE_URL must be ${APPROVED_CALLE_ORIGINS.join(" or ")}, or a loopback URL with CALLE_LOCAL_TEST_TRANSPORT=true and CALLE_API_KEY=local-test-only.`);
}

/** The SDK's fetch: a redirect fails the request instead of being followed. */
export function noRedirectFetch(input: Request): Promise<Response> {
  return fetch(input, { redirect: "error" });
}
