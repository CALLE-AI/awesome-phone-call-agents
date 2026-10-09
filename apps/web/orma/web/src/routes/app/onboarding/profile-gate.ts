/**
 * Profile existence under RLS. apikey is the publishable key.
 * Bearer is the signed-in user JWT. Cached once per request scope.
 */

const lookups = new WeakMap<object, Promise<boolean>>()

export type ProfileLookup = {
  apiUrl: string
  anonKey: string
  accessToken: string
  userId: string
  fetch?: typeof fetch
}

/** A finished profile lands on Today. An account with no profile goes to onboarding first. */
export function postAuthPath(hasProfile: boolean): "/app/onboarding" | "/app" {
  return hasProfile ? "/app" : "/app/onboarding"
}

export function isOnboardingPath(path: string): boolean {
  return path === "/app/onboarding" || path.startsWith("/app/onboarding/")
}

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "")
  if (!base) throw new Error("missing ORMA_API_URL")
  if (base.includes("supabase.co")) throw new Error("must not use the project host")
  return base
}

export async function lookupProfileExists(opts: ProfileLookup): Promise<boolean> {
  if (!opts.anonKey) throw new Error("missing publishable anon key")
  const base = apiBase(opts.apiUrl)
  const fetchImpl = opts.fetch ?? fetch
  const url = `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(opts.userId)}&select=id`
  const response = await fetchImpl(url, {
    headers: {
      apikey: opts.anonKey,
      authorization: `Bearer ${opts.accessToken}`,
    },
  })
  if (!response.ok) return false
  let rows: unknown
  try {
    rows = await response.json()
  } catch {
    return false
  }
  return Array.isArray(rows) && rows.length > 0
}

export function hasProfileCached(scope: object, lookup: () => Promise<boolean>): Promise<boolean> {
  const existing = lookups.get(scope)
  if (existing) return existing
  const pending = lookup()
  lookups.set(scope, pending)
  return pending
}
