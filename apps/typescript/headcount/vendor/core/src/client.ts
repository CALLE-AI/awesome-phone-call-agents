/**
 * Thin wrapper over @call-e/calle. Base URL is swappable so the same
 * runner can talk to the local simulator or the live API.
 *
 * CalleClient options (SDK 0.7.0): apiKey, baseUrl?, fetch?
 * Docs: https://github.com/CALLE-AI/server-sdk-typescript#configuration
 */

import { CalleClient } from "@call-e/calle";

export const LIVE_API_URL = "https://api.heycall-e.com";
export const DEFAULT_SIM_URL = "http://localhost:4000";

export type CalleMode = "sim" | "live";

export function resolveCalleMode(env: NodeJS.ProcessEnv = process.env): CalleMode {
  return env.CALLE_LIVE === "1" ? "live" : "sim";
}

export function resolveCalleBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return approvedBaseUrl(env.CALLE_BASE_URL ?? (resolveCalleMode(env) === "live" ? LIVE_API_URL : DEFAULT_SIM_URL), resolveCalleMode(env));
}

function approvedBaseUrl(value: string, mode: CalleMode): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (mode === "live" ? url.origin !== LIVE_API_URL : !local || !["http:", "https:"].includes(url.protocol))) {
    throw new Error("Refusing an unapproved CALL-E origin; use the official HTTPS API or a loopback simulator.");
  }
  return url.origin;
}

export function createCalleClient(
  options: { apiKey?: string; baseUrl?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): CalleClient {
  const mode = resolveCalleMode(env);
  const baseUrl = approvedBaseUrl(options.baseUrl ?? resolveCalleBaseUrl(env), mode);
  const apiKey = mode === "sim" ? "sim-local" : options.apiKey ?? env.CALLE_API_KEY;
  if (!apiKey) throw new Error("Live CALL-E requires an API key.");

  return new CalleClient({ apiKey, baseUrl, fetch: (input) => globalThis.fetch(input, { redirect: "error" }) });
}
