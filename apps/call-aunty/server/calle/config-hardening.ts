import { calleConfig, loadCalleConfig, type CalleConfig } from "./config";

export type HardenedCalleConfig = CalleConfig &
  Omit<typeof calleConfig, "apiKey"> & {
    liveIntentRequired: boolean;
    liveLoopbackOnly: boolean;
    allowLoopbackOperator: boolean;
    operatorToken?: string;
    approvedOrigins: Set<string>;
    rejectRedirects: boolean;
    allowLocalDevOrigins: boolean;
    requireHttpsOrigin: boolean;
    allowedProviderOrigins: Set<string>;
  };

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function originOf(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function parseOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const candidate of (raw ?? "").split(",")) {
    const origin = originOf(candidate.trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * Parses configuration for the direct CALL-E gateway. API-key presence is deliberately
 * kept separate from live execution authorization.
 */
export function loadHardenedCalleConfig(): HardenedCalleConfig {
  const base = loadCalleConfig();
  const approvedOrigins = parseOrigins(process.env.CALLE_APPROVED_ORIGINS);
  const providerOrigin = originOf(process.env.CALLE_BASE_URL ?? calleConfig.baseUrl);
  const allowedProviderOrigins = parseOrigins(process.env.CALLE_APPROVED_PROVIDER_ORIGINS);

  // A configured provider URL is the allowlist default; deployments may narrow it with
  // CALLE_APPROVED_PROVIDER_ORIGINS when they need a separate explicit allowlist.
  if (allowedProviderOrigins.size === 0 && providerOrigin) {
    allowedProviderOrigins.add(providerOrigin);
  }

  return {
    ...base,
    ...calleConfig,
    apiKey: base.apiKey,
    liveIntentRequired: asBool(process.env.CALLE_LIVE_INTENT_REQUIRED, true),
    liveLoopbackOnly: asBool(process.env.CALLE_LIVE_LOOPBACK_ONLY, true),
    allowLoopbackOperator: asBool(process.env.CALLE_ALLOW_LOOPBACK_OPERATOR, true),
    operatorToken: (process.env.CALLE_OPERATOR_TOKEN ?? "").trim() || undefined,
    approvedOrigins,
    rejectRedirects: asBool(process.env.CALLE_REJECT_REDIRECTS, true),
    allowLocalDevOrigins: asBool(process.env.CALLE_ALLOW_LOCAL_DEV_ORIGINS, true),
    requireHttpsOrigin: asBool(process.env.CALLE_REQUIRE_HTTPS_ORIGIN, true),
    allowedProviderOrigins,
  };
}

export function validateHardenedCalleConfig(config = loadHardenedCalleConfig()) {
  const issues: string[] = [];

  if (config.mode === "live" && config.killSwitch) {
    issues.push("live mode cannot be active while the kill switch is set");
  }
  if (config.mode === "live" && config.liveLoopbackOnly === false && !config.operatorToken) {
    issues.push("non-loopback live mode requires CALLE_OPERATOR_TOKEN");
  }
  if (config.liveIntentRequired !== true) {
    issues.push("CALLE_LIVE_INTENT_REQUIRED should remain true for direct gateway hardening");
  }
  if (config.rejectRedirects !== true) {
    issues.push("CALLE_REJECT_REDIRECTS should remain true for direct gateway hardening");
  }
  if (config.requireHttpsOrigin !== true) {
    issues.push("credentialed origins must require HTTPS in the hardened configuration");
  }
  if (config.mode === "live" && config.allowedProviderOrigins.size === 0) {
    issues.push("live mode requires an absolute HTTPS CALL-E provider origin");
  }
  for (const origin of config.approvedOrigins) {
    if (!origin.startsWith("https://")) {
      issues.push(`credentialed origin must be HTTPS: ${origin}`);
    }
  }

  return { ok: issues.length === 0, issues };
}
