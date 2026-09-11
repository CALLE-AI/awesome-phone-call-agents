/** Presentation helpers shared across the UI. */

export function formatMoney(value: unknown, currency = 'USD', locale?: string): string | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n)) return null
  try {
    return n.toLocaleString(locale, {
      style: 'currency',
      currency,
      // narrowSymbol → "₦", "$", "€" rather than the ISO code ("NGN 25,000").
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    })
  } catch {
    return n.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 })
  }
}

/** Just the currency symbol for a code, e.g. "USD" → "$", "EUR" → "€", "NGN" → "₦". */
export function currencySymbol(currency = 'USD', locale?: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? '$'
  } catch {
    return '$'
  }
}

export function formatOffset(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) return `${s}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

/** Turn a snake_case or camelCase key into a Title Case label. */
export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase())
}
