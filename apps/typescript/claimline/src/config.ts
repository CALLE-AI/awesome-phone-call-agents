import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ClaimLine runtime configuration.
 *
 * SAFE DEFAULT: `mode` is "fixture", meaning NO real phone calls are placed.
 * A live call requires CLAIMLINE_MODE=live *and* a CALLE_API_KEY.
 */
export type RunMode = "fixture" | "live";

export interface ClaimLineConfig {
  mode: RunMode;
  calleApiKey: string | null;
  calleBaseUrl: string | null;
  port: number;
  dbPath: string;
  webhookSecret: string | null;
  /** Minimum completion-confidence score to treat a call result as trusted. */
  confidenceThreshold: number;
  /** Display name used in call disclosures ("...calling on behalf of X"). */
  insurerName: string;
  /** Public base URL used when handing CALL-E a webhook target (live mode). */
  publicBaseUrl: string | null;
  /** Owner login username (uses the server's API key for calls). */
  ownerUser: string;
  /** Owner password. Null disables owner login (kept out of the repo). */
  ownerPass: string | null;
  /** Secret used to sign session cookies. */
  sessionSecret: string;
  /** Stripe secret key for demo payouts (test mode). Null → simulated payments. */
  stripeSecretKey: string | null;
  /** Slack incoming-webhook URL for autopilot reports. Null → not posted to Slack. */
  slackWebhookUrl: string | null;
  /** Microsoft Teams incoming-webhook URL for autopilot reports. */
  teamsWebhookUrl: string | null;
}

/** Minimal .env loader so the app has no dotenv dependency. */
function loadDotEnv(dir: string): void {
  const envPath = resolve(dir, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(cwd: string = process.cwd()): ClaimLineConfig {
  loadDotEnv(cwd);

  const calleApiKey = process.env.CALLE_API_KEY?.trim() || null;
  // Default: live when a server key is present (e.g. the hosted instance), else
  // fixture (a fresh clone stays no-call by default, satisfying repo safety).
  const rawMode = process.env.CLAIMLINE_MODE?.toLowerCase();
  const mode: RunMode =
    rawMode === "live" || rawMode === "fixture"
      ? (rawMode as RunMode)
      : calleApiKey
        ? "live"
        : "fixture";

  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  const dbPath = process.env.CLAIMLINE_DB ?? "./data/claimline.db";
  const confidenceThreshold = Number.parseFloat(
    process.env.CLAIMLINE_CONFIDENCE_THRESHOLD ?? "0.6",
  );

  return {
    mode,
    calleApiKey,
    calleBaseUrl: process.env.CALLE_BASE_URL?.trim() || null,
    port: Number.isFinite(port) ? port : 8787,
    dbPath,
    webhookSecret: process.env.CLAIMLINE_WEBHOOK_SECRET?.trim() || null,
    confidenceThreshold: Number.isFinite(confidenceThreshold)
      ? confidenceThreshold
      : 0.6,
    insurerName: process.env.CLAIMLINE_INSURER_NAME?.trim() || "ClaimLine Insurance",
    publicBaseUrl: process.env.CLAIMLINE_PUBLIC_BASE_URL?.trim() || null,
    ownerUser: process.env.CLAIMLINE_OWNER_USER?.trim() || "garglakshay",
    ownerPass: process.env.CLAIMLINE_OWNER_PASS || null,
    sessionSecret:
      process.env.CLAIMLINE_SESSION_SECRET?.trim() ||
      "claimline-dev-session-secret-change-in-production-0000000000",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() || null,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL?.trim() || null,
    teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL?.trim() || null,
  };
}
