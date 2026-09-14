import { ENV } from "../_core/env";
import { isDemoMode } from "./demo-mode";

/** Server-only CALL-E configuration. Never import from Expo client code. */
export type CalleConfig = {
  apiKey: string;
  liveCallsEnabled: boolean;
  killSwitch: boolean;
  configured: boolean;
  demoMode: boolean;
  mode: "dry_run" | "live" | "disabled" | "demo";
};

export function loadCalleConfig(env: typeof ENV = ENV): CalleConfig {
  const apiKey = env.calleApiKey.trim();
  const liveCallsEnabled = env.calleLiveCalls;
  const killSwitch = env.calleKillSwitch;
  const demoMode = isDemoMode(env);
  const configured = apiKey.length > 0;

  let mode: CalleConfig["mode"] = "dry_run";
  if (killSwitch) mode = "disabled";
  else if (demoMode) mode = "demo";
  else if (configured && liveCallsEnabled) mode = "live";

  return {
    apiKey,
    liveCallsEnabled,
    killSwitch,
    configured,
    demoMode,
    mode,
  };
}

/** Safe metadata for diagnostics — no secrets. */
export function getCallePublicConfig(env: typeof ENV = ENV) {
  const config = loadCalleConfig(env);
  return {
    configured: config.configured,
    liveCallsEnabled: config.liveCallsEnabled,
    killSwitch: config.killSwitch,
    demoMode: config.demoMode,
    mode: config.mode,
    indicator: config.demoMode ? "DEMO" : config.mode === "live" ? "LIVE_ELIGIBLE" : "DRY_RUN",
  };
}

export function toPolicyEnv(config: CalleConfig) {
  return {
    liveCallsEnabled: config.liveCallsEnabled && !config.killSwitch,
    hasApiKey: config.configured,
    killSwitch: config.killSwitch,
    apiKey: config.apiKey,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Server-only CALL-E REST/SDK gateway config. Safe to import from server tests. */
export const calleConfig = {
  apiKey: (process.env.CALLE_API_KEY ?? ENV.calleApiKey).trim() || undefined,
  baseUrl: (process.env.CALLE_BASE_URL ?? ENV.calleBaseUrl ?? "https://api.heycall-e.com").replace(/\/+$/, ""),
  timeoutMs: parsePositiveInt(process.env.CALLE_TIMEOUT_MS, ENV.calleTimeoutMs || 30_000),
  pollIntervalMs: parsePositiveInt(process.env.CALLE_POLL_INTERVAL_MS, ENV.callePollIntervalMs || 2_000),
  pollTimeoutMs: parsePositiveInt(process.env.CALLE_POLL_TIMEOUT_MS, ENV.callePollTimeoutMs || 180_000),
  maxRetries: Math.min(8, Math.max(0, parsePositiveInt(process.env.CALLE_MAX_RETRIES, ENV.calleMaxRetries || 4))),
  retryBaseMs: parsePositiveInt(process.env.CALLE_RETRY_BASE_MS, ENV.calleRetryBaseMs || 500),
  mockMode: process.env.CALLE_MOCK_MODE === "true" || ENV.calleMockMode,
  fallbackMock: process.env.CALLE_FALLBACK_MOCK !== "false" && ENV.calleFallbackMock !== false,
  webhookSecret: (process.env.CALLE_WEBHOOK_SECRET ?? ENV.calleWebhookSecret).trim() || undefined,
  allowedRegions: new Set(
    (process.env.CALLE_ALLOWED_REGIONS ?? ENV.calleAllowedRegions)
      .split(",")
      .map((region) => region.trim().toUpperCase())
      .filter(Boolean),
  ),
  transport: (process.env.CALLE_TRANSPORT === "sdk" ? "sdk" : "rest") as "sdk" | "rest",
} as const;

export function requireCalleApiKey() {
  if (!calleConfig.apiKey) {
    throw new Error("CALLE_API_KEY is not configured on the server");
  }
  return calleConfig.apiKey;
}
