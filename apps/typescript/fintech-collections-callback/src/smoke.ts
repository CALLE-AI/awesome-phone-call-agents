// Builds a single overdue account from SMOKE_* environment variables for a
// one-number live smoke test. This exists so a real --live call can target a
// number you control and consent to, WITHOUT touching the fictional fixtures
// (whose reserved-for-fiction numbers must never be dialed).
//
// The only required variable is SMOKE_PHONE. Consent is OFF unless you set
// SMOKE_CONSENT=true explicitly, so the pre-dial gate blocks by default rather
// than assuming consent on your behalf.

import type { OverdueAccount } from "./types.js";

type Env = Record<string, string | undefined>;

/** YYYY-MM-DD for `days` before `from` (UTC). */
export function isoDateDaysAgo(days: number, from: Date = new Date()): string {
  const safe = Number.isFinite(days) ? days : 30;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - safe);
  return d.toISOString().slice(0, 10);
}

/**
 * Assemble one account from SMOKE_* vars. Throws if SMOKE_PHONE is absent.
 * Format/consent/quiet-hours are NOT checked here — that is the gate's job, so
 * a smoke run exercises the exact same pre-dial checks a real batch would.
 */
export function buildSmokeAccount(env: Env = process.env): OverdueAccount {
  const phone = env.SMOKE_PHONE;
  if (!phone) {
    throw new Error(
      "SMOKE_PHONE is required for --smoke runs (E.164, a number you control and consent to call).",
    );
  }

  const consent = env.SMOKE_CONSENT === "true";
  const daysPastDue = Number(env.SMOKE_DAYS_PAST_DUE ?? 30);

  return {
    accountId: env.SMOKE_ACCOUNT_ID ?? "SMOKE-1",
    customerName: env.SMOKE_NAME ?? "Test Customer",
    phone,
    region: env.SMOKE_REGION ?? "US",
    // Default to this machine's timezone so "call me now" respects local quiet hours.
    timezone: env.SMOKE_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    amountDueCents: Number(env.SMOKE_AMOUNT_CENTS ?? 10000),
    currency: env.SMOKE_CURRENCY ?? "USD",
    dueDate: env.SMOKE_DUE_DATE ?? isoDateDaysAgo(Number.isFinite(daysPastDue) ? daysPastDue : 30),
    daysPastDue: Number.isFinite(daysPastDue) ? daysPastDue : 30,
    consentToContact: consent,
    // Only attach a timestamp when consent is asserted; defaults to "now".
    consentTimestamp: consent ? (env.SMOKE_CONSENT_TIMESTAMP ?? new Date().toISOString()) : undefined,
    language: env.SMOKE_LANGUAGE ?? "en-US",
  };
}
