/**
 * The one boundary every request carrying the CALL-E key crosses.
 *
 * `CALLE_API_BASE` is configuration, so a mistyped or hostile value would
 * otherwise send the bearer key to any host. Only an approved HTTPS origin is
 * accepted, and a redirect is refused, so the key never follows one elsewhere.
 * The fetch itself stays injectable, so tests keep their fake transports.
 */

export const CALLE_API_ORIGINS: readonly string[] = ["https://api.heycall-e.com"];

/** Returns the bare origin, or throws when the value is not an approved one. */
export function approvedCalleApiBase(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("CALLE_API_BASE is not a URL");
  }
  if (
    parsed.protocol !== "https:" || !CALLE_API_ORIGINS.includes(parsed.origin) ||
    parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" ||
    parsed.pathname.replace(/\/+$/, "") !== ""
  ) {
    throw new Error("CALLE_API_BASE is not an approved CALL-E origin");
  }
  return parsed.origin;
}

export type CalleTransport = {
  calleApiBase: string;
  calleApiKey: string;
  fetch: typeof fetch;
};

/** Sends one credentialed CALL-E request. The origin is checked on every call. */
export function calleFetch(transport: CalleTransport, path: string, init: RequestInit = {}): Promise<Response> {
  const base = approvedCalleApiBase(transport.calleApiBase);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${transport.calleApiKey}`);
  return transport.fetch(`${base}${path}`, { ...init, headers, redirect: "error" });
}
