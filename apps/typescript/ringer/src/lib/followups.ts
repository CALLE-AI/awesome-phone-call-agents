import type { CreatePayload } from './calle/client'
import type { LaunchMeta } from '@/components/compose/Composer'

/* ------------------------------------------------------------------ */
/*  Scheduled retries / follow-up calls                                */
/* ------------------------------------------------------------------ */

export interface ScheduledCall {
  id: string
  createdAt: string
  dueAt: string
  title: string
  escalated: boolean
  payload: CreatePayload
  meta: LaunchMeta
}

export function newScheduledCall(
  payload: CreatePayload,
  meta: LaunchMeta,
  dueAt: Date,
  escalated: boolean,
): ScheduledCall {
  return {
    id: `sched_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    dueAt: dueAt.toISOString(),
    title: meta.title,
    escalated,
    payload,
    meta,
  }
}

export function isDue(s: { dueAt: string }): boolean {
  return new Date(s.dueAt).getTime() <= Date.now()
}

export function formatDue(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'due now'
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 60) return `in ${days}d`
  const months = Math.round(days / 30)
  return `in ~${months}mo`
}

/** Tomorrow at 9:00 local time. */
export function tomorrowMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

export function inHours(h: number): Date {
  return new Date(Date.now() + h * 3_600_000)
}

/* ------------------------------------------------------------------ */
/*  Rate watches (recurring renegotiation)                             */
/* ------------------------------------------------------------------ */

export interface RateWatch {
  id: string
  createdAt: string
  /** When the promo ends and a renegotiation should be queued. */
  endsAt: string
  company: string
  newAmount: number | null
  previousAmount: number | null
  promoLength: string | null
  /** ISO 4217 currency the amounts are in (older watches → USD). */
  currency?: string
}

/** Parse "12 months", "6-month promo", "1 year" → months (default 12). */
export function parsePromoMonths(promo: string | null | undefined): number {
  if (!promo) return 12
  const m = promo.match(/(\d+)\s*[- ]?\s*(month|mo\b)/i)
  if (m) return Math.max(1, Number(m[1]))
  const y = promo.match(/(\d+)\s*[- ]?\s*(year|yr)/i)
  if (y) return Math.max(1, Number(y[1])) * 12
  return 12
}

export function newRateWatch(input: {
  company: string
  newAmount: number | null
  previousAmount: number | null
  promoLength: string | null
  currency?: string
}): RateWatch {
  const months = parsePromoMonths(input.promoLength)
  const ends = new Date()
  ends.setMonth(ends.getMonth() + months)
  // Nudge a week early so the user renegotiates before the price jumps.
  ends.setDate(ends.getDate() - 7)
  return {
    id: `watch_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    endsAt: ends.toISOString(),
    company: input.company,
    newAmount: input.newAmount,
    previousAmount: input.previousAmount,
    promoLength: input.promoLength,
    currency: input.currency,
  }
}
