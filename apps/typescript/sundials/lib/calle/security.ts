/**
 * Security, sanitization and rate-limiting guardrails for Sundials
 */

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;
const ipRequestHistory = new Map<string, number[]>();

export function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 7) return "***-****";
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+1") && cleaned.length === 12) {
    return `+1 (${cleaned.slice(2, 5)}) ${cleaned.slice(5, 8)}-****`;
  }
  if (cleaned.startsWith("+65") && cleaned.length === 11) {
    return `+65 ${cleaned.slice(3, 7)} ****`;
  }
  const visiblePrefix = cleaned.slice(0, Math.max(3, cleaned.length - 4));
  return `${visiblePrefix}****`;
}

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== "string") {
    return { valid: false, error: "Email is required." };
  }
  const trimmed = email.trim();
  if (trimmed.length > 254) {
    return { valid: false, error: "Email is too long." };
  }
  if (!EMAIL_RE.test(trimmed)) {
    return { valid: false, error: "Enter a valid email address." };
  }
  return { valid: true };
}

export function maskEmail(email: string): string {
  const trimmed = (email || "").trim();
  const at = trimmed.indexOf("@");
  if (at < 1 || at === trimmed.length - 1) return "***@***";
  const user = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${user.slice(0, 1)}***@${domain}`;
}

export interface SupportedDestination {
  prefix: string;
  region: string;
  locale: string;
}

/** Longest prefix first so +65 is not treated as +6, and +1 is last. Unknown codes must not fall through to US. */
export const SUPPORTED_DESTINATIONS: readonly SupportedDestination[] = [
  { prefix: "+65", region: "SG", locale: "en-SG" },
  { prefix: "+61", region: "AU", locale: "en-AU" },
  { prefix: "+81", region: "JP", locale: "ja-JP" },
  { prefix: "+49", region: "DE", locale: "de-DE" },
  { prefix: "+44", region: "GB", locale: "en-GB" },
  { prefix: "+1", region: "US", locale: "en-US" }
];

const E164_RE = /^\+[1-9]\d{7,14}$/;
const UNSUPPORTED_DESTINATION_ERROR =
  "Phone number country is not in the supported list (+1, +44, +49, +61, +65, +81).";

export function compactE164(phone: string): string {
  return phone.trim().replace(/[\s()-]/g, "");
}

export function matchSupportedDestination(phone: string): SupportedDestination | null {
  const compact = compactE164(phone);
  if (!E164_RE.test(compact)) return null;
  return SUPPORTED_DESTINATIONS.find((dest) => compact.startsWith(dest.prefix)) || null;
}

export function validatePhoneNumber(phone: string): { valid: boolean; error?: string } {
  if (!phone || typeof phone !== "string") {
    return { valid: false, error: "Phone number is required." };
  }
  const compact = compactE164(phone);
  if (!compact.startsWith("+")) {
    return { valid: false, error: "Phone number must be E.164 and start with +." };
  }
  if (!E164_RE.test(compact)) {
    return { valid: false, error: "Phone number must be E.164 (8–15 digits after +)." };
  }
  const destination = matchSupportedDestination(compact);
  if (!destination) {
    return { valid: false, error: UNSUPPORTED_DESTINATION_ERROR };
  }
  const digits = compact.slice(1);
  const emergencyNumbers = ["911", "999", "112", "000", "110", "119", "993"];
  if (emergencyNumbers.includes(digits) || emergencyNumbers.some((em) => digits.endsWith(em) && digits.length <= 5)) {
    return { valid: false, error: "Emergency and reserved numbers are disallowed." };
  }
  const blockedPrefixes = ["882", "883", "870", "878", "900", "976"];
  for (const prefix of blockedPrefixes) {
    if (digits.startsWith(prefix) || digits.startsWith("1" + prefix) || digits.startsWith("44" + prefix)) {
      return { valid: false, error: "Disallowed premium rate or satellite destination." };
    }
  }
  return { valid: true };
}

export function sameE164(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  return compactE164(left) === compactE164(right);
}

export const CALL_CONSENT_MAX_AGE_MS = 15 * 60 * 1000;

export function validateCallConsent(
  phoneNumber: string,
  consent: { e164?: unknown; acceptedAt?: unknown; allowOneRetry?: unknown } | null | undefined
): { ok: true; e164: string; acceptedAt: string; allowOneRetry: boolean } | { ok: false; error: string } {
  if (!consent || typeof consent !== "object") {
    return { ok: false, error: "Confirm the automated call to this number before sending." };
  }
  if (consent.allowOneRetry !== true) {
    return { ok: false, error: "Confirm the automated call and the one follow-up if nobody answers." };
  }
  const e164 = typeof consent.e164 === "string" ? compactE164(consent.e164) : "";
  if (!sameE164(e164, phoneNumber)) {
    return { ok: false, error: "Call consent must match the phone number you entered." };
  }
  const acceptedAt = typeof consent.acceptedAt === "string" ? consent.acceptedAt : "";
  const acceptedMs = Date.parse(acceptedAt);
  if (!Number.isFinite(acceptedMs) || Date.now() - acceptedMs > CALL_CONSENT_MAX_AGE_MS || acceptedMs > Date.now() + 60_000) {
    return { ok: false, error: "Call consent expired. Confirm again and resend." };
  }
  return { ok: true, e164, acceptedAt, allowOneRetry: true };
}

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = ipRequestHistory.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    ipRequestHistory.set(ip, recent);
    return { allowed: false, remaining: 0 };
  }
  recent.push(now);
  ipRequestHistory.set(ip, recent);
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - recent.length };
}

const EVENT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_EVENT_BATCHES_PER_WINDOW = 60;
const eventIpHistory = new Map<string, number[]>();

export function checkEventRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = eventIpHistory.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < EVENT_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= MAX_EVENT_BATCHES_PER_WINDOW) {
    eventIpHistory.set(ip, recent);
    return { allowed: false, remaining: 0 };
  }
  recent.push(now);
  eventIpHistory.set(ip, recent);
  return { allowed: true, remaining: MAX_EVENT_BATCHES_PER_WINDOW - recent.length };
}
