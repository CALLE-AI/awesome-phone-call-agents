export const OFFICIAL_CALLE_BASE_URL = "https://api.heycall-e.com";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class CalleConfigError extends Error {
  constructor() {
    super(
      "CALLE_BASE_URL must be the exact official HTTPS origin or an exact HTTP loopback origin outside production. CALLE_API_KEY was not sent.",
    );
    this.name = "CalleConfigError";
  }
}

export function resolveCalleBaseUrl(
  value: string | undefined,
  environment: string,
): string {
  let url: URL;
  try {
    url = new URL(value?.trim() || OFFICIAL_CALLE_BASE_URL);
  } catch {
    throw new CalleConfigError();
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new CalleConfigError();
  }
  if (url.origin === OFFICIAL_CALLE_BASE_URL) return OFFICIAL_CALLE_BASE_URL;
  if (
    environment !== "production" &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname)
  ) {
    return url.origin;
  }
  throw new CalleConfigError();
}
