// Pre-dial gate: consent, input validation, and quiet-hours enforcement.
//
// Design principle 2 (explicit consent) and principle 3 (never assume critical
// values) live here. No call is placed unless checkAccount returns { allowed: true }.

import type { OverdueAccount, GateDecision } from "./types.js";

/** Strict E.164: leading +, first digit 1-9, total 7-15 digits. */
const E164 = /^\+[1-9]\d{6,14}$/;

export interface GateConfig {
  /** Local hour (0-23) at/after which calls are NOT allowed. */
  quietHoursStart: number;
  /** Local hour (0-23) before which calls are NOT allowed. */
  quietHoursEnd: number;
  /** Override "now" for deterministic testing. */
  now?: Date;
}

/** Default quiet hours: no calls before 08:00 or at/after 21:00 local time. */
export const DEFAULT_GATE: GateConfig = {
  quietHoursStart: 21,
  quietHoursEnd: 8,
};

/** True if the string is a valid IANA timezone the runtime can resolve. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local hour (0-23) for a timezone at a given instant. */
export function localHour(timezone: string, when: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(when);
  const raw = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = Number(raw);
  // Intl can report hour "24" for midnight in some environments; normalize to 0.
  return hour === 24 ? 0 : hour;
}

/** True if `hour` falls inside the (possibly midnight-wrapping) quiet window. */
export function isQuietHour(hour: number, cfg: GateConfig): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = cfg;
  if (start > end) return hour >= start || hour < end; // wraps midnight
  return hour >= start && hour < end;
}

/** Run every gate check for one account. Order is deliberate: consent first. */
export function checkAccount(account: OverdueAccount, cfg: GateConfig): GateDecision {
  if (!account.consentToContact) return { allowed: false, reason: "no-consent" };
  if (!account.consentTimestamp) return { allowed: false, reason: "missing-consent-timestamp" };
  if (!E164.test(account.phone)) return { allowed: false, reason: "invalid-e164-phone" };
  if (!isValidTimeZone(account.timezone)) return { allowed: false, reason: "invalid-iana-timezone" };

  const when = cfg.now ?? new Date();
  const hour = localHour(account.timezone, when);
  if (isQuietHour(hour, cfg)) {
    return { allowed: false, reason: `quiet-hours-local-${hour}` };
  }
  return { allowed: true };
}
