import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/**
 * Parse a timestamp from the API.
 *
 * The backend stamps UTC everywhere, but not every field carries a suffix: `_packet_out` appends
 * "Z" and `escalate._attempts` writes a bare `datetime.isoformat()`. A browser reads a bare string
 * as *local* time, which is how "last attempt 02:07" ended up under "prepared 19:07" for two calls
 * seven minutes apart. Anything with no zone is treated as UTC, because that is what it is.
 */
function parseIso(iso: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso)
  return new Date(hasZone ? iso : iso + 'Z')
}

/** ISO timestamp -> "19:04" (local, 24h). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = parseIso(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * A hazard's `starts_at` / `ends_at`, which are naive wall-clock strings ("2026-09-09T10:00") the
 * NWS issued in local time. They are shown exactly as written — converting them would move a heat
 * warning that runs from ten in the morning to three o'clock at night.
 */
export function fmtWallTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = iso.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : fmtTime(iso)
}

/** ISO timestamp -> "19:04:22" (local, 24h). For the event log, where ordering matters. */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = parseIso(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 58 -> "58s", 74 -> "1m 14s" */
export function fmtSeconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return m > 0 ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`
}

/**
 * Hours until this person is actually in trouble, in words.
 *
 * `null` is NOT "no risk" — `risk.py` is explicit that it means "no clock on this one". Rendering
 * that as "—" in a column of hours would read as low risk, so callers are expected to omit the
 * chip entirely rather than show an empty one.
 */
export function fmtTimeToHarm(h: number | null | undefined): string | null {
  if (h == null || !Number.isFinite(h)) return null
  if (h <= 0) return 'already at risk'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 2) return '1 hour'
  if (h < 24) return `${Math.round(h)} hours`
  return `${Math.round(h / 24)} days`
}

/** "pkt_5d6b1234…" -> "pkt_5d6b…" */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—'
  return id.length > 9 ? id.slice(0, 9) + '…' : id
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** API mask "******1001" -> display mask "••••••1001" */
export function fmtMask(mask: string | null | undefined): string {
  return (mask ?? '').replace(/\*/g, '•')
}

/** "outage_eta_h" -> "Outage eta h" is wrong; hazard facts get real names or fall back gracefully. */
const FACT_LABEL: Record<string, string> = {
  temp_f: 'Temperature',
  humidity_pct: 'Humidity',
  overnight_low_f: 'Overnight low',
  outage_eta_h: 'Power back in',
  customers_out: 'Homes without power',
  aqi: 'Air quality index',
  issued: 'Issued by',
  cause: 'Cause',
  note: 'Note',
}

export function factLabel(key: string): string {
  return FACT_LABEL[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function factValue(key: string, value: unknown): string {
  if (value == null) return '—'
  if (key.endsWith('_f')) return `${value}°F`
  if (key.endsWith('_pct')) return `${value}%`
  if (key.endsWith('_h')) return `${value} hours`
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}

export function normalizeQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”"‘’'.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sentence-case a snake_case identifier, for the rare place a raw key has to be shown. */
export function humanize(key: string): string {
  const s = key.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
