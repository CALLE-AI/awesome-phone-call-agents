import { loadHardenedCalleConfig, validateHardenedCalleConfig } from "./config-hardening";

export type CalleReadinessCheck = { id: string; ok: boolean; message: string };
export type CalleReadiness = { ready: boolean; mode: string; checks: CalleReadinessCheck[] };

/** Produces non-sensitive, deterministic production-readiness checks for health endpoints and CI. */
export function getCalleReleaseReadiness(): CalleReadiness {
  const config = loadHardenedCalleConfig();
  const hardened = validateHardenedCalleConfig(config);
  const live = config.mode === "live";
  const checks: CalleReadinessCheck[] = [
    {
      id: "live-opt-in",
      ok: !live || config.liveCallsEnabled,
      message: live ? "Live calling is explicitly enabled." : "Live calling is disabled by default.",
    },
    {
      id: "explicit-live-intent",
      ok: config.liveIntentRequired,
      message: config.liveIntentRequired ? "Explicit live intent is required." : "Explicit live intent is disabled.",
    },
    {
      id: "kill-switch",
      ok: !live || !config.killSwitch,
      message: config.killSwitch ? "Kill switch is active." : "Kill switch is inactive.",
    },
    {
      id: "webhook-secret",
      ok: !live || Boolean(config.webhookSecret),
      message: config.webhookSecret ? "Webhook HMAC secret is configured." : "Live mode requires CALLE_WEBHOOK_SECRET.",
    },
    {
      id: "provider-origin",
      ok: !live || config.allowedProviderOrigins.size > 0,
      message: config.allowedProviderOrigins.size > 0 ? "Provider origin allowlist is configured." : "Live mode requires an approved provider origin.",
    },
    ...hardened.issues.map((message, index) => ({ id: `hardening-${index + 1}`, ok: false, message })),
  ];
  return { ready: checks.every((check) => check.ok), mode: config.mode, checks };
}
