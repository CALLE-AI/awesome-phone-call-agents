// File: src/lib/env.ts
// server-only; never import from a "use client" module.
import "server-only";

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

// The API key is only ever transmitted to an approved HTTPS CALL-E origin. Any other
// base URL (http://, or a non-CALL-E host) is rejected before a client is constructed,
// so a misconfigured CALLE_BASE_URL can never leak the key to an untrusted endpoint.
export const APPROVED_CALLE_ORIGINS = ["https://api.heycall-e.com"] as const;

function isApprovedCalleOrigin(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return u.host === "heycall-e.com" || u.host.endsWith(".heycall-e.com");
}

export const env = {
  calleApiKey: () => read("CALLE_API_KEY"),
  calleGoalId: () => read("CALLE_GOAL_ID"),
  calleWebhookUrl: () => read("CALLE_WEBHOOK_URL"),
  placesApiKey: () => read("PLACES_API_KEY"),
  live: () => read("GOODFAITH_LIVE") === "1",
  persist: () => read("GOODFAITH_PERSIST") === "1",
  webhookSecret: () => read("GOODFAITH_WEBHOOK_SECRET"),
  // Bearer token a caller must present to drive live-privileged endpoints (live quote
  // creation, private quote/event reads). Empty = live access refused (fail-closed).
  apiToken: () => read("GOODFAITH_API_TOKEN"),
  // Comma-separated E.164 numbers authorized to receive live calls. Empty = none.
  allowedRecipients: (): string[] =>
    (read("GOODFAITH_ALLOWED_RECIPIENTS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  // The base URL after enforcing the approved-origin allowlist. THROWS if the configured
  // CALLE_BASE_URL is not an approved HTTPS CALL-E origin, guaranteeing the key never
  // travels to an http:// or non-CALL-E host.
  calleBaseUrlChecked: (): string => {
    const raw = read("CALLE_BASE_URL") ?? "https://api.heycall-e.com";
    if (!isApprovedCalleOrigin(raw)) {
      throw new Error(`CALLE_BASE_URL is not an approved HTTPS CALL-E origin: ${raw}`);
    }
    return raw;
  },
};

// isLive is the single source of truth for mode selection.
export function isLive(): boolean {
  return env.live() && !!env.calleApiKey();
}
