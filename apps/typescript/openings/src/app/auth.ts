import { headers, cookies } from "next/headers";
import {
  authCookieName,
  isValidAuthHeader,
  isValidCookieValue,
  readAuthSecret,
} from "../core/auth";

/**
 * Defense-in-depth auth check for server actions. Middleware already gates
 * all routes, but server actions should also refuse unauthenticated callers
 * when a secret is configured.
 */
export async function requireAuth(): Promise<void> {
  const secret = readAuthSecret({
    OPENINGS_AUTH_TOKEN: process.env.OPENINGS_AUTH_TOKEN,
    OPENINGS_BASIC_AUTH: process.env.OPENINGS_BASIC_AUTH,
  });
  if (secret.kind === "none") return;

  const h = await headers();
  const auth = h.get("authorization");
  if (auth && isValidAuthHeader(auth, secret)) return;

  const c = await cookies();
  if (isValidCookieValue(c.get(authCookieName())?.value, secret)) return;

  throw new Error("unauthorized: authentication required");
}

export function isAuthRequired(): boolean {
  const secret = readAuthSecret({
    OPENINGS_AUTH_TOKEN: process.env.OPENINGS_AUTH_TOKEN,
    OPENINGS_BASIC_AUTH: process.env.OPENINGS_BASIC_AUTH,
  });
  return secret.kind !== "none";
}
