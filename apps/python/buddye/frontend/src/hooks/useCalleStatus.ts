import { useEffect, useState } from 'react'
import { api } from '../api'
import type { CalleStatus } from '../types'

const POLL_MS = 30_000

// Module-level cache: the status endpoint runs the calle CLI, so route changes and
// StrictMode double-mounts must not refetch inside the 30 s window.
let cached: { value: CalleStatus | null; error: string | null; at: number } | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

function fetchStatus(): Promise<void> {
  if (inflight) return inflight
  inflight = api
    .calleStatus()
    .then((v) => {
      cached = { value: v, error: null, at: Date.now() }
    })
    .catch((err: unknown) => {
      cached = { value: cached?.value ?? null, error: err instanceof Error ? err.message : String(err), at: Date.now() }
    })
    .finally(() => {
      inflight = null
      notify()
    })
  return inflight
}

export function useCalleStatus(): { status: CalleStatus | null; error: string | null } {
  const [, bump] = useState(0)

  useEffect(() => {
    const l = () => bump((n) => n + 1)
    listeners.add(l)
    const stale = !cached || Date.now() - cached.at >= POLL_MS
    if (stale) void fetchStatus()
    const t = setInterval(() => void fetchStatus(), POLL_MS)
    return () => {
      listeners.delete(l)
      clearInterval(t)
    }
  }, [])

  return { status: cached?.value ?? null, error: cached?.error ?? null }
}
