/**
 * Browser and server Supabase clients for the web app.
 * Reach GoTrue through ORMA_API_URL. Never through a project host.
 * The publishable key is the only key that may enter this bundle.
 */
import { browser } from "$app/environment"
import { PUBLIC_ORMA_API_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public"
import { createBrowserClient, createServerClient, type SetAllCookies } from "@supabase/ssr"
import type { Session, User } from "@supabase/supabase-js"
import type { Database } from "./database.types"

export type { Session, User }

export const DEFAULT_ORMA_API_URL = "https://orma-api.nryn.dev"
export const LOGIN_CALLBACK_URL = "https://orma.nryn.dev/login/callback"

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined

export function getOrmaApiUrl(): string {
  const raw = PUBLIC_ORMA_API_URL || DEFAULT_ORMA_API_URL
  const url = raw.replace(/\/+$/, "")
  if (!url) throw new Error("missing ORMA_API_URL")
  if (url.includes("supabase.co")) throw new Error("must not use the project host")
  return url
}

export function getPublishableKey(): string {
  const key = PUBLIC_SUPABASE_ANON_KEY ?? ""
  if (!key) throw new Error("missing SUPABASE_ANON_KEY")
  if (key.startsWith("sb_") && key.includes("secret")) throw new Error("publishable key only")
  return key
}

export type ServerSupabase = ReturnType<typeof createSupabaseServerClient>
export type BrowserSupabase = ReturnType<typeof getSupabase>

export type AuthLocals = {
  supabase: ServerSupabase
  session: Session | null
  user: User | null
}

export function getAuthLocals(locals: App.Locals): AuthLocals {
  return locals as AuthLocals
}

export function createSupabaseServerClient(cookies: {
  getAll: () => { name: string; value: string }[]
  setAll: SetAllCookies
}) {
  return createServerClient<Database>(getOrmaApiUrl(), getPublishableKey(), {
    cookies: {
      getAll: cookies.getAll,
      setAll: cookies.setAll,
    },
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}

export function getSupabase() {
  if (!browser) {
    throw new Error("getSupabase() runs in the browser")
  }
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(getOrmaApiUrl(), getPublishableKey(), {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return browserClient
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession()
  if (error) throw error
  return data.session
}

export function sessionTokensFromUnknown(payload: unknown): {
  access_token: string
  refresh_token: string
} | null {
  if (!payload || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : null
  const nested = [record.session, data?.session, data, record]
  for (const candidate of nested) {
    if (!candidate || typeof candidate !== "object") continue
    const tokens = candidate as Record<string, unknown>
    const access = tokens.access_token
    const refresh = tokens.refresh_token
    if (typeof access === "string" && typeof refresh === "string" && access && refresh) {
      return { access_token: access, refresh_token: refresh }
    }
  }
  return null
}

export type TelegramWidgetUser = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export async function postAuthTelegram(
  widget: TelegramWidgetUser,
  options?: { accessToken?: string },
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (options?.accessToken) {
    headers.apikey = getPublishableKey()
    headers.authorization = `Bearer ${options.accessToken}`
  }
  const response = await fetch(`${getOrmaApiUrl()}/functions/v1/auth-telegram`, {
    method: "POST",
    headers,
    body: JSON.stringify(widget),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || `Telegram sign-in failed (${response.status})`)
  }
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new Error("Telegram sign-in returned invalid JSON")
  }
}
