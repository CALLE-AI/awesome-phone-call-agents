import type { CallTask } from './calle/types'

export interface SharedSnapshot {
  v: 1
  templateId: string
  title: string
  batch: boolean
  /** ISO 4217 currency the amounts were quoted in (older links omit it → USD). */
  currency?: string
  call: CallTask
}

function toBase64Url(json: string): string {
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  return decodeURIComponent(escape(atob(b64 + pad)))
}

/** Build a shareable URL that encodes a completed result in the hash. */
export function buildShareUrl(snapshot: SharedSnapshot): string {
  const data = toBase64Url(JSON.stringify(snapshot))
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#r=${data}`
}

/** Decode a shared snapshot from the current location hash, if present. */
export function decodeShareFromLocation(): SharedSnapshot | null {
  if (typeof window === 'undefined') return null
  const m = window.location.hash.match(/[#&]r=([^&]+)/)
  if (!m) return null
  try {
    const parsed = JSON.parse(fromBase64Url(m[1])) as SharedSnapshot
    if (parsed?.v === 1 && parsed.call?.object === 'call_task') return parsed
    return null
  } catch {
    return null
  }
}

export function clearShareHash() {
  if (typeof window === 'undefined') return
  history.replaceState(null, '', window.location.pathname + window.location.search)
}
