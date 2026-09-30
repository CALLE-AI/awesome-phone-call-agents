export const TRACKING_CONSENT_STORAGE_KEY = "sundials_intent_consent";
export const TRACKING_CONSENT_TTL_MS = 5 * 60 * 1000;

export type TrackingConsentStatus = "granted" | "denied";

export function parseTrackingConsent(raw: string | null, now = Date.now()): "unknown" | TrackingConsentStatus {
  if (!raw) return "unknown";
  if (raw === "granted" || raw === "denied") return "unknown";
  try {
    const parsed = JSON.parse(raw) as { status?: unknown; at?: unknown };
    if (parsed.status !== "granted" && parsed.status !== "denied") return "unknown";
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return "unknown";
    if (now - parsed.at > TRACKING_CONSENT_TTL_MS || parsed.at > now + 60_000) return "unknown";
    return parsed.status;
  } catch {
    return "unknown";
  }
}

export function serializeTrackingConsent(status: TrackingConsentStatus, at = Date.now()): string {
  return JSON.stringify({ status, at });
}
