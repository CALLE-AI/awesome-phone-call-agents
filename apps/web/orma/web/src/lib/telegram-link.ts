/**
 * T6.5 Settings helpers for Telegram mint and unlink.
 *
 * Mirrors `mintLinkToken` / `unlinkTelegram` from the Edge link store.
 * Posts the hash only. Reach PostgREST through `ORMA_API_URL`.
 * apikey is the publishable anon key. Bearer is the signed-in user JWT.
 * Missing anonKey throws. It never falls back to the user JWT.
 * Service role never enters the bundle.
 *
 * T5.3 owns the real session client. Callers pass that JWT and the anon key.
 */
export const TELEGRAM_BOT_USERNAME = "orma_tele_bot"
export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000
export const LINK_TOKEN_BYTES = 32
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
// Settings passes this as apiUrl, so it reads getOrmaApiUrl() and a local session stays local.
// The node header check runs without Vite and cannot resolve $lib. Only there does the production URL stand.
export const ORMA_API_URL: string = (import.meta as { env?: unknown }).env
  ? (await import("$lib/supabase")).getOrmaApiUrl()
  : "https://orma-api.nryn.dev"

export type TelegramLinkClient = {
  apiUrl?: string
  accessToken: string
  userId: string
  anonKey: string
  fetch?: typeof fetch
}

export function telegramStartDeepLink(botUsername: string, token: string): string {
  const name = botUsername.replace(/^@/, "")
  return `https://t.me/${name}?start=${token}`
}

export async function hashLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function encodeLinkToken(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "")
  if (base.includes("supabase.co")) {
    throw new Error("must not use the project host")
  }
  return base
}

function requireAnonKey(anonKey: string | undefined): string {
  if (typeof anonKey !== "string" || anonKey.length === 0) {
    throw new Error("missing publishable anon key")
  }
  return anonKey
}

function headers(anonKey: string, accessToken: string, prefer?: string): Record<string, string> {
  const key = requireAnonKey(anonKey)
  const next: Record<string, string> = {
    apikey: key,
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  }
  if (prefer) next.prefer = prefer
  return next
}

export async function mintLinkToken(client: TelegramLinkClient): Promise<{
  token: string
  expiresAt: Date
  tokenHash: string
  deepLink: string
}> {
  const fetchImpl = client.fetch ?? fetch
  const base = apiBase(client.apiUrl ?? ORMA_API_URL)
  const entropy = crypto.getRandomValues(new Uint8Array(LINK_TOKEN_BYTES))
  const token = encodeLinkToken(entropy)
  if (!LINK_TOKEN_PATTERN.test(token)) {
    throw new Error("minted token is not a valid Telegram start payload")
  }
  const tokenHash = await hashLinkToken(token)
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS)

  const cleared = await fetchImpl(
    `${base}/rest/v1/telegram_link_tokens?user_id=eq.${encodeURIComponent(client.userId)}&consumed_at=is.null`,
    { method: "DELETE", headers: headers(client.anonKey, client.accessToken, "return=minimal") },
  )
  if (!cleared.ok) throw new Error("telegram_link_tokens open delete failed")

  const inserted = await fetchImpl(`${base}/rest/v1/telegram_link_tokens`, {
    method: "POST",
    headers: headers(client.anonKey, client.accessToken, "return=minimal"),
    body: JSON.stringify({
      token_hash: tokenHash,
      user_id: client.userId,
      expires_at: expiresAt.toISOString(),
    }),
  })
  if (!inserted.ok) throw new Error("telegram_link_tokens insert failed")

  return {
    token,
    expiresAt,
    tokenHash,
    deepLink: telegramStartDeepLink(TELEGRAM_BOT_USERNAME, token),
  }
}

export async function unlinkTelegram(client: TelegramLinkClient): Promise<void> {
  const fetchImpl = client.fetch ?? fetch
  const base = apiBase(client.apiUrl ?? ORMA_API_URL)

  const deleted = await fetchImpl(
    `${base}/rest/v1/telegram_link_tokens?user_id=eq.${encodeURIComponent(client.userId)}`,
    { method: "DELETE", headers: headers(client.anonKey, client.accessToken, "return=minimal") },
  )
  if (!deleted.ok) throw new Error("telegram_link_tokens delete failed")

  const cleared = await fetchImpl(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(client.userId)}`,
    {
      method: "PATCH",
      headers: headers(client.anonKey, client.accessToken, "return=minimal"),
      body: JSON.stringify({ telegram_chat_id: null }),
    },
  )
  if (!cleared.ok) throw new Error("profiles unlink failed")
}

export async function loadTelegramLinkState(client: TelegramLinkClient): Promise<{
  telegramChatId: number | null
}> {
  const fetchImpl = client.fetch ?? fetch
  const base = apiBase(client.apiUrl ?? ORMA_API_URL)
  const response = await fetchImpl(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(client.userId)}&select=telegram_chat_id`,
    { headers: headers(client.anonKey, client.accessToken) },
  )
  if (!response.ok) throw new Error("profiles telegram read failed")
  const rows = (await response.json()) as Array<{ telegram_chat_id: number | null }>
  if (rows.length === 0) return { telegramChatId: null }
  return { telegramChatId: rows[0].telegram_chat_id }
}
