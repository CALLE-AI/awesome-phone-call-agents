import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '@/lib/app'

const SETTINGS_KEY = 'ringer.settings'
const SECRETS_KEY = 'ringer.secrets'

/** The credential fields that must not live in durable, cross-tab storage. */
type Secrets = Pick<AppSettings, 'apiKey' | 'appSecret'>

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
  if (!storage) return fallback
  try {
    const raw = storage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback
  } catch {
    return fallback
  }
}

/**
 * App settings with a security boundary for credentials.
 *
 * The long-lived secrets — the CALL-E API key and the deployment access secret —
 * are kept in `sessionStorage` (per-tab, and cleared when the browser session
 * ends), isolated from the durable, non-secret preferences in `localStorage`.
 * `forgetCredentials()` wipes them on demand. This keeps bearer secrets out of
 * the persistent cross-tab store and gives the user an explicit clearing
 * boundary. A key left in an older build's `localStorage` blob is adopted into
 * the session store once and then stripped from `localStorage` by the effect.
 */
export function useAppSettings() {
  const win = typeof window === 'undefined' ? undefined : window

  const [settings, setSettings] = useState<AppSettings>(() => {
    const persisted = readJson<Partial<AppSettings>>(win?.localStorage, SETTINGS_KEY, {})
    const secrets = readJson<Secrets>(win?.sessionStorage, SECRETS_KEY, { apiKey: '', appSecret: '' })
    return {
      ...DEFAULT_SETTINGS,
      ...persisted,
      // Session store wins; fall back to a legacy key found in localStorage.
      apiKey: secrets.apiKey || persisted.apiKey || '',
      appSecret: secrets.appSecret || persisted.appSecret || '',
    }
  })

  useEffect(() => {
    if (!win) return
    try {
      const { apiKey, appSecret, ...rest } = settings
      // Non-secret settings only in the durable, cross-tab store.
      win.localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest))
      // Secrets only in the per-session store (removed entirely when empty).
      if (apiKey || appSecret) {
        win.sessionStorage.setItem(SECRETS_KEY, JSON.stringify({ apiKey, appSecret }))
      } else {
        win.sessionStorage.removeItem(SECRETS_KEY)
      }
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [win, settings])

  const forgetCredentials = useCallback(() => {
    setSettings((s) => ({ ...s, apiKey: '', appSecret: '' }))
  }, [])

  return [settings, setSettings, forgetCredentials] as const
}
