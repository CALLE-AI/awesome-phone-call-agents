import { ENV } from "../_core/env";

export type CalleV4Config = {
  apiKey: string;
  baseUrl: string;
  webhookSecret?: string;
  timeoutMs: number;
  maxRetries: number;
  allowedRegions: string[];
  demoMode: boolean;
  liveTest: boolean;
};

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadCalleV4Config(
  env: Record<string, string | undefined> = process.env,
  appEnv: typeof ENV = ENV,
): CalleV4Config {
  const demoMode = (env.CALLE_DEMO_MODE ?? (appEnv.calleDemoMode ? "true" : "false")) !== "false";
  const regions = (env.CALLE_ALLOWED_REGIONS ?? appEnv.calleAllowedRegions ?? "CA,US,GB,AU,SG,IN")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  return {
    apiKey: (env.CALLE_API_KEY ?? appEnv.calleApiKey ?? "").trim(),
    baseUrl: (env.CALLE_BASE_URL ?? "https://api.heycall-e.com").replace(/\/$/, ""),
    webhookSecret: env.CALLE_WEBHOOK_SECRET?.trim() || undefined,
    timeoutMs: Math.max(1, parseIntEnv(env.CALLE_TIMEOUT_MS, 30_000)),
    maxRetries: Math.min(5, Math.max(0, parseIntEnv(env.CALLE_MAX_RETRIES, 3))),
    allowedRegions: regions,
    demoMode,
    liveTest: env.CALLE_LIVE_TEST === "true",
  };
}

export function getCalleV4PublicConfig(config: CalleV4Config = loadCalleV4Config()) {
  return {
    demoMode: config.demoMode,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    allowedRegions: config.allowedRegions,
    configured: config.apiKey.length > 0,
    webhookConfigured: Boolean(config.webhookSecret),
    mode: config.demoMode ? "demo" : config.apiKey ? "live" : "unconfigured",
  };
}
