/** Credentialed CALL-E traffic is pinned here. Anything else is fail-closed. */
export const CALLE_PRODUCTION_ORIGIN = "https://api.heycall-e.com";

export function assertCalleBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("CALLE_BASE_URL is not a URL");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  ) {
    throw new Error("CALLE_BASE_URL must not be a local origin");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("CALLE_BASE_URL must be the HTTPS production origin");
  }
  if (parsed.username || parsed.password) {
    throw new Error("CALLE_BASE_URL must not contain credentials");
  }
  if (parsed.origin !== CALLE_PRODUCTION_ORIGIN) {
    throw new Error("CALLE_BASE_URL is not the approved production origin");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("CALLE_BASE_URL must be the production origin only");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("CALLE_BASE_URL must be the production origin only");
  }
}

export function isApprovedCalleOrigin(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    assertCalleBaseUrl(url.trim());
    return true;
  } catch {
    return false;
  }
}
