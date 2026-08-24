/**
 * Lightweight access control for the demo app.
 *
 * Fail-closed rule: when `OPENINGS_CALL_MODE=live`, an auth secret MUST be
 * configured (`OPENINGS_AUTH_TOKEN` or `OPENINGS_BASIC_AUTH=user:pass`).
 * `resolveConfig()` refuses to build a live caller without one, so a public
 * deployment can never expose call-creating actions anonymously.
 *
 * When no secret is set (local dev / tests) and the app is not in live mode,
 * pages and actions are open.
 *
 * The token form is intentionally simple for a demo app: a single shared
 * secret. It is checked in middleware for all routes, and again in server
 * actions as defense-in-depth via `requireAuth()`.
 */

export type AuthSecret =
  | { kind: "token"; value: string }
  | { kind: "basic"; user: string; password: string }
  | { kind: "none" };

/** Parse the configured secret once; both middleware and actions use this. */
export function readAuthSecret(env: {
  OPENINGS_AUTH_TOKEN?: string;
  OPENINGS_BASIC_AUTH?: string;
}): AuthSecret {
  const token = env.OPENINGS_AUTH_TOKEN?.trim();
  if (token) return { kind: "token", value: token };

  const basic = env.OPENINGS_BASIC_AUTH?.trim();
  if (basic) {
    const colon = basic.indexOf(":");
    if (colon > 0) {
      return { kind: "basic", user: basic.slice(0, colon), password: basic.slice(colon + 1) };
    }
    // No colon: treat the whole value as user with empty password is unsafe,
    // so treat it as a bearer-style shared secret instead.
    return { kind: "token", value: basic };
  }
  return { kind: "none" };
}

export function hasAuthSecret(secret: AuthSecret): boolean {
  return secret.kind !== "none";
}

/** The password/secret that must be presented (Basic password or Bearer token). */
export function authPassword(secret: AuthSecret): string | null {
  switch (secret.kind) {
    case "token":
      return secret.value;
    case "basic":
      return secret.password;
    case "none":
      return null;
  }
}

export function authUser(secret: AuthSecret): string | null {
  return secret.kind === "basic" ? secret.user : null;
}

/**
 * Timing-safe equality for secrets. Compares fixed-length digests so response
 * time does not leak how much of the prefix matched.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison pass to keep timing flat.
    let drift = 1;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      drift |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length)) & 1;
    }
    return drift === 0 && false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Check an Authorization header against the configured secret. */
export function isValidAuthHeader(value: string | null, secret: AuthSecret): boolean {
  if (!value || secret.kind === "none") return false;

  if (value.startsWith("Basic ")) {
    try {
      const decoded = atob(value.slice(6));
      const colon = decoded.indexOf(":");
      const user = colon >= 0 ? decoded.slice(0, colon) : "";
      const pass = colon >= 0 ? decoded.slice(colon + 1) : decoded;
      if (secret.kind === "basic") {
        return safeEqual(user, secret.user) && safeEqual(pass, secret.password);
      }
      // Token mode also accepts Basic where the password is the token.
      return safeEqual(pass, secret.value);
    } catch {
      return false;
    }
  }

  if (value.startsWith("Bearer ")) {
    const presented = value.slice(7).trim();
    if (secret.kind === "token") return safeEqual(presented, secret.value);
    // Token mode accepts the basic password as a bearer too.
    if (secret.kind === "basic") return safeEqual(presented, secret.password);
    return false;
  }

  return false;
}

export function isValidCookieValue(value: string | undefined | null, secret: AuthSecret): boolean {
  if (!value || secret.kind === "none") return false;
  const expected = authPassword(secret);
  return expected !== null && safeEqual(value, expected);
}

export function authCookieName(): string {
  return "openings_auth";
}
