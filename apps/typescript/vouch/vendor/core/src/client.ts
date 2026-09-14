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
  if (env.CALLE_BASE_URL) return env.CALLE_BASE_URL;
  return resolveCalleMode(env) === "live" ? LIVE_API_URL : DEFAULT_SIM_URL;
}

export function createCalleClient(
  options: { apiKey?: string; baseUrl?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): CalleClient {
  const baseUrl = options.baseUrl ?? resolveCalleBaseUrl(env);
  const apiKey = options.apiKey ?? env.CALLE_API_KEY ?? "sim-local";

  return new CalleClient({ apiKey, baseUrl });
}
