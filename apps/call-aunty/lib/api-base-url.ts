export const DEFAULT_API_PORT = 3000;

export type ApiBaseUrlPlatform = "ios" | "android" | "web" | "windows" | "macos";

export type ApiBaseUrlInput = {
  explicitUrl?: string | null;
  platformOS: ApiBaseUrlPlatform;
  expoHostUri?: string | null;
  webProtocol?: string;
  webHostname?: string;
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Parse Expo `hostUri` / debuggerHost values such as `192.168.1.12:8081`. */
export function hostnameFromExpoHostUri(hostUri: string | null | undefined): string | null {
  if (!hostUri) return null;
  try {
    const withProtocol = hostUri.includes("://") ? hostUri : `http://${hostUri}`;
    const hostname = new URL(withProtocol).hostname.trim();
    return hostname || null;
  } catch {
    const host = hostUri.split("/")[0]?.split(":")[0]?.trim();
    return host || null;
  }
}

function nativeLoopbackHost(platformOS: ApiBaseUrlPlatform, host: string): string {
  // Android emulator loopback is the host machine at 10.0.2.2, not 127.0.0.1.
  if (platformOS === "android" && (host === "localhost" || host === "127.0.0.1")) {
    return "10.0.2.2";
  }
  return host;
}

/**
 * Resolve the Express API origin for Expo web, iOS, and Android.
 * Metro serves the UI on 8081; the API listens on 3000.
 */
export function resolveApiBaseUrl(input: ApiBaseUrlInput): string {
  const explicit = input.explicitUrl?.trim();
  if (explicit) return trimSlash(explicit);

  if (input.platformOS === "web") {
    const hostname = input.webHostname ?? "";
    const protocol = input.webProtocol || "http:";
    if (hostname) {
      const apiHostname = hostname.replace(/^8081-/, "3000-");
      if (apiHostname !== hostname) {
        return trimSlash(`${protocol}//${apiHostname}`);
      }
      if (hostname === "localhost" || hostname === "127.0.0.1" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
        return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
      }
    }
    return "";
  }

  const host = hostnameFromExpoHostUri(input.expoHostUri);
  if (host) {
    return `http://${nativeLoopbackHost(input.platformOS, host)}:${DEFAULT_API_PORT}`;
  }

  const fallback = input.platformOS === "android" ? "10.0.2.2" : "127.0.0.1";
  return `http://${fallback}:${DEFAULT_API_PORT}`;
}
