export class EngineOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineOriginError";
  }
}

function parseOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EngineOriginError(`${label} must be a valid URL origin`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new EngineOriginError(`${label} must not contain credentials, query, or fragment`);
  }
  if (url.pathname !== "/") {
    throw new EngineOriginError(`${label} must be an origin without a path`);
  }
  return url;
}

function isLoopback(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}

export function allowedEngineOrigins(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length > 10) {
    throw new EngineOriginError("ENGINE_ALLOWED_ORIGINS supports at most 10 origins");
  }
  return new Set(
    values.map((value) => {
      const url = parseOrigin(value, "ENGINE_ALLOWED_ORIGINS entry");
      if (url.protocol !== "https:") {
        throw new EngineOriginError("Approved remote engine origins must use HTTPS");
      }
      return url.origin;
    }),
  );
}

/** Resolve only loopback development engines or explicitly approved HTTPS origins. */
export function resolveEngineUrl(
  rawUrl = process.env.ENGINE_URL ?? "http://localhost:8008",
  rawAllowedOrigins = process.env.ENGINE_ALLOWED_ORIGINS,
): string {
  const url = parseOrigin(rawUrl, "ENGINE_URL");
  if (isLoopback(url)) return url.origin;

  if (url.protocol !== "https:") {
    throw new EngineOriginError("Remote ENGINE_URL must use HTTPS");
  }
  if (!allowedEngineOrigins(rawAllowedOrigins).has(url.origin)) {
    throw new EngineOriginError("ENGINE_URL is not listed in ENGINE_ALLOWED_ORIGINS");
  }
  return url.origin;
}
