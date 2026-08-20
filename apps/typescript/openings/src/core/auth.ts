/**
 * Lightweight access control for the demo app.
 *
 * If neither `OPENINGS_AUTH_TOKEN` nor `OPENINGS_AUTH_USER`/`OPENINGS_AUTH_PASSWORD`
 * is set, the app is open (local dev / tests). When a token or Basic pair is set,
 * every page and every server action must present it. This keeps remotely
 * reachable mutating actions (create / run / stop / opt-out) and result pages
 * from being anonymously callable.
 *
 * The token form is intentionally simple for a demo app: a single shared secret.
 * It is checked in middleware for all routes, and again in server actions as
 * defense-in-depth via `requireAuth()`.
 */

export function isAuthRequired(): boolean {
  return Boolean(process.env.OPENINGS_AUTH_TOKEN || process.env.OPENINGS_BASIC_AUTH);
}

export function getAuthToken(): string | undefined {
  return process.env.OPENINGS_AUTH_TOKEN ?? process.env.OPENINGS_BASIC_AUTH?.split(":")[1] ?? process.env.OPENINGS_BASIC_AUTH;
}

/**
 * Check a raw Authorization header value against the configured token.
 * Accepts `Bearer <token>` and `Basic <base64(user:token)>` (password part).
 */
export function isValidAuthHeader(value: string | null, token: string): boolean {
  if (!value) return false;
  if (value === `Bearer ${token}`) return true;
  if (value.startsWith("Basic ")) {
    try {
      const decoded = atob(value.slice(6));
      // Accept either "user:token" or just "token" as the decoded value
      if (decoded === token) return true;
      const colon = decoded.indexOf(":");
      const pass = colon >= 0 ? decoded.slice(colon + 1) : "";
      if (pass === token) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function authCookieName(): string {
  return "openings_auth";
}
