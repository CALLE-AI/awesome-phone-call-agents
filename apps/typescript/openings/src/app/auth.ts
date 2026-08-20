import { headers, cookies } from "next/headers";

/**
 * Defense-in-depth auth check for server actions. Middleware already gates
 * all routes, but server actions should also refuse unauthenticated callers
 * if the token is configured.
 */
export async function requireAuth(): Promise<void> {
  const token =
    process.env.OPENINGS_AUTH_TOKEN ??
    (process.env.OPENINGS_BASIC_AUTH?.includes(":")
      ? process.env.OPENINGS_BASIC_AUTH.split(":").slice(1).join(":")
      : process.env.OPENINGS_BASIC_AUTH);
  if (!token) return;

  const h = await headers();
  const auth = h.get("authorization");
  if (auth) {
    if (auth === `Bearer ${token}`) return;
    if (auth.startsWith("Basic ")) {
      try {
        const decoded = atob(auth.slice(6));
        if (decoded === token) return;
        const colon = decoded.indexOf(":");
        const pass = colon >= 0 ? decoded.slice(colon + 1) : "";
        if (pass === token) return;
        if (decoded.endsWith(`:${token}`)) return;
      } catch {
        // fall through
      }
    }
  }
  const c = await cookies();
  const cookie = c.get("openings_auth")?.value;
  if (cookie === token) return;

  throw new Error("unauthorized: authentication required");
}

export function isAuthRequired(): boolean {
  return Boolean(process.env.OPENINGS_AUTH_TOKEN || process.env.OPENINGS_BASIC_AUTH);
}
