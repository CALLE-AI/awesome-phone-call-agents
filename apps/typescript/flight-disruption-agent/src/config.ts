import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliGateway, DryRunGateway, SdkGateway, type CallGateway } from "./calle.ts";
import { isLoopbackBind } from "./access.ts";
import { DRY_RUN_CHANNEL_SECRET } from "./channel.ts";
import { DRY_RUN_WEBHOOK_SECRET } from "./events.ts";

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env loader so the app has no extra dependency. Real env vars win. */
export function loadEnvFile(path = join(APP_ROOT, ".env")): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] === undefined) continue;
    const key = match[1];
    const value = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function gatewayFromEnv(env = process.env): CallGateway {
  const mode = (env.CALLE_MODE ?? "dry-run").trim();
  if (mode === "dry-run" || mode === "") return new DryRunGateway();
  if (mode === "sdk") {
    const key = env.CALLE_API_KEY?.trim();
    if (!key) throw new Error("CALLE_MODE=sdk needs CALLE_API_KEY (dashboard.heycall-e.com/account/api-keys).");
    return new SdkGateway(key);
  }
  if (mode === "cli") return new CliGateway(env.CALLE_CLI?.trim() || undefined);
  throw new Error(`Unknown CALLE_MODE "${mode}". Use dry-run, sdk, or cli.`);
}

/**
 * Shared secret for the airline ops webhook. Dry run falls back to a published demo
 * secret so the feed works out of the box; live modes refuse to start the webhook without one.
 */
export function webhookSecretFromEnv(live: boolean, env = process.env): { secret: string | null; demo: boolean } {
  return sharedSecretFromEnv(env.AIRLINE_WEBHOOK_SECRET, DRY_RUN_WEBHOOK_SECRET, live);
}

/** Shared secret for the chat, web form, and phone line webhook, with the same dry-run fallback rules. */
export function channelSecretFromEnv(live: boolean, env = process.env): { secret: string | null; demo: boolean } {
  return sharedSecretFromEnv(env.CHANNEL_WEBHOOK_SECRET, DRY_RUN_CHANNEL_SECRET, live);
}

function sharedSecretFromEnv(value: string | undefined, demoSecret: string, live: boolean): { secret: string | null; demo: boolean } {
  const secret = value?.trim();
  if (secret) {
    if (secret === demoSecret && live) return { secret: null, demo: false };
    return { secret, demo: secret === demoSecret };
  }
  return live ? { secret: null, demo: false } : { secret: demoSecret, demo: true };
}

/** The demo schedule is fixed on 20 September 2026, so request cutoffs run on a demo clock. */
export const DEFAULT_DEMO_NOW = "2026-09-19T09:00:00+07:00";

/**
 * A clock that starts at DEMO_NOW when the server boots and then ticks in real time, so
 * passenger request eligibility keeps working after the fictional flights' real dates pass.
 * DEMO_NOW=real uses the wall clock. Only eligibility reads it; call polling uses real time.
 */
export function demoClockFromEnv(env = process.env, bootMs = Date.now()): { now: () => number; label: string | null } {
  const raw = env.DEMO_NOW?.trim() || DEFAULT_DEMO_NOW;
  if (raw === "real") return { now: () => Date.now(), label: null };
  const start = Date.parse(raw);
  if (Number.isNaN(start)) throw new Error(`DEMO_NOW must be an ISO timestamp or "real", got "${raw}".`);
  const offset = start - bootMs;
  return { now: () => Date.now() + offset, label: raw };
}

/**
 * Live modes need the operator's explicit statement that the owner of LIVE_DEMO_PHONE agreed
 * to receive these test calls. Returns an error message, or null when calls may start.
 */
export function liveAttestationError(live: boolean, env = process.env): string | null {
  if (!live) return null;
  if (env.LIVE_DEMO_PHONE_CONSENT?.trim().toLowerCase() === "yes") return null;
  return "Live mode needs LIVE_DEMO_PHONE_CONSENT=yes: confirm the owner of LIVE_DEMO_PHONE agreed to receive these test calls.";
}

/**
 * Where the desk pushes request updates for the passenger's channel. The body carries the
 * passenger's booking, so it must be HTTPS unless the channel runs on this machine.
 */
export function channelNotifyUrlFromEnv(env = process.env): string | null {
  const raw = env.CHANNEL_NOTIFY_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CHANNEL_NOTIFY_URL is not a valid URL: "${raw}".`);
  }
  const loopback = isLoopbackBind(url.hostname) || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("CHANNEL_NOTIFY_URL must use https (plain http only to this machine).");
  }
  return url.toString();
}
