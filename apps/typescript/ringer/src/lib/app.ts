import type { RunMode } from './calle/client'
import type { OutcomeTone } from './tasks/types'

export interface AppSettings {
  mode: RunMode
  apiKey: string
  baseUrl: string
  /** Access secret for a deployment whose shared server key is gated. */
  appSecret: string
  callerName: string
  callbackNumber: string
  /** Whether the server reported a usable shared key (from /api/health). */
  serverKey?: boolean
  /** Whether the server can fire durable scheduled calls (server key + KV). */
  hasScheduler?: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'demo',
  apiKey: '',
  baseUrl: '',
  appSecret: '',
  callerName: '',
  callbackNumber: '',
}

export type ImpactKind = 'saved' | 'recovered' | 'booked' | 'cancelled' | 'answered' | 'other'

export interface HistoryEntry {
  id: string
  at: string
  mode: RunMode
  templateId: string
  templateLabel: string
  batch: boolean
  title: string
  status: string
  outcomeLabel: string
  outcomeTone: OutcomeTone
  headline: string | null
  summary: string | null
  /** Value captured (annualized bill savings / recovered refund / one-off savings). */
  savedUsd: number
  /** ISO 4217 currency `savedUsd` is denominated in (older entries → USD). */
  currency?: string
  kind: ImpactKind
}

export interface Impact {
  callsHandled: number
  totalSaved: number
  /** ISO 4217 currency `totalSaved` is denominated in. */
  currency: string
  booked: number
  cancelled: number
  minutesSaved: number
}

/** Assume each dreaded call Ringer handles saves the user ~15 minutes. */
const MINUTES_PER_CALL = 15

export function computeImpact(history: HistoryEntry[]): Impact {
  // You can't add €50 + $30 into one honest number. Pick the currency of the
  // most recent entry that captured value, and total only entries in it.
  const prevailing = [...history].reverse().find((h) => (h.savedUsd || 0) > 0)?.currency ?? 'USD'
  return {
    callsHandled: history.length,
    totalSaved: history
      .filter((h) => (h.currency ?? 'USD') === prevailing)
      .reduce((sum, h) => sum + (h.savedUsd || 0), 0),
    currency: prevailing,
    booked: history.filter((h) => h.kind === 'booked' && h.outcomeTone === 'success').length,
    cancelled: history.filter((h) => h.kind === 'cancelled' && h.outcomeTone === 'success').length,
    minutesSaved: history.length * MINUTES_PER_CALL,
  }
}
