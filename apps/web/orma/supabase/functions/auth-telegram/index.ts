/**
 * T5.2 Telegram login bridge.
 *
 * Runtime env, same names as `scripts/bootstrap-env.sh` (no defaults):
 * `TELEGRAM_BOT_TOKEN`, `ORMA_API_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
 * `SUPABASE_ANON_KEY`.
 * Always `ORMA_API_URL`, never `*.supabase.co`.
 * Gateway JWT is off in `config.toml` `[functions.auth-telegram]`.
 * The handler still verifies the widget HMAC and refuses a stale payload.
 *
 * Pin with:
 * `deno test --allow-net --allow-env --allow-read supabase/functions/auth-telegram/index.ts`
 */

export const AUTH_DATE_MAX_AGE_SECONDS = 300
export const ALLOWED_ORIGIN = "https://orma.nryn.dev"

// GoTrue does not filter admin users by app_metadata. Email-first attach
// stores telegram_user_id there, so a later widget POST has to find that row.
// Bound the scan so a stuck page cannot loop. Telegram-first users also match
// the synthetic email on the same pass.
export const USER_LOOKUP_PAGE_SIZE = 50
export const USER_LOOKUP_MAX_PAGES = 4

export type AuthTelegramDeps = {
  botToken: string
  apiUrl: string
  serviceRoleKey: string
  anonKey: string
  fetch: typeof fetch
}

type WidgetPayload = Record<string, unknown>

type AuthUser = {
  id: string
  email: string
  appMetadata: Record<string, unknown>
}

export function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const value = getEnv(name)
  if (!value) throw new Error(`missing ${name}`)
  return value
}

export function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "")
  if (base.includes("supabase.co")) {
    throw new Error("must not use the project host")
  }
  return base
}

export function depsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): AuthTelegramDeps {
  const botToken = requireNamedEnv("TELEGRAM_BOT_TOKEN", getEnv)
  const apiUrl = requireNamedEnv("ORMA_API_URL", getEnv)
  if (apiUrl.includes("supabase.co")) {
    throw new Error("ORMA_API_URL must not be a project host")
  }
  return {
    botToken,
    apiUrl,
    serviceRoleKey: requireNamedEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv),
    anonKey: requireNamedEnv("SUPABASE_ANON_KEY", getEnv),
    fetch: fetchImpl,
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization")
  if (!header) return null
  const match = /^Bearer\s+(\S+)/i.exec(header.trim())
  if (!match) return null
  return match[1]
}

export function telegramSyntheticEmail(telegramUserId: string): string {
  return `tg-${telegramUserId}@telegram.invalid`
}

export function buildDataCheckString(payload: WidgetPayload): string {
  return Object.keys(payload)
    .filter((key) => key !== "hash")
    .filter((key) => {
      const value = payload[key]
      return value !== undefined && value !== null && value !== ""
    })
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("\n")
}

export function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ""
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0")
  return hex
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

export async function sha256Raw(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes))
  return new Uint8Array(digest)
}

export async function hmacSha256Hex(
  keyBytes: Uint8Array,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function computeWidgetHash(
  botToken: string,
  payload: WidgetPayload,
): Promise<string> {
  const secret = await sha256Raw(new TextEncoder().encode(botToken))
  return hmacSha256Hex(secret, buildDataCheckString(payload))
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json",
    },
  })
}

function unauthorized(): Response {
  return jsonResponse(401, { error: "unauthorized" })
}

function upstreamFailed(stage: string, status?: number): Response {
  if (typeof status === "number") {
    console.error(`auth-telegram ${stage} ${status}`)
  } else {
    console.error(`auth-telegram ${stage}`)
  }
  return jsonResponse(502, { error: "auth upstream failed", stage })
}

function telegramUserIdFrom(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value
  return null
}

function parseAuthDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readUser(value: unknown): AuthUser | null {
  const record = asRecord(value)
  const nested = asRecord(record.user)
  const id = typeof record.id === "string"
    ? record.id
    : typeof nested.id === "string"
    ? nested.id
    : null
  const email = typeof record.email === "string"
    ? record.email
    : typeof nested.email === "string"
    ? nested.email
    : null
  if (!id || !email) return null
  const appMetadata = asRecord(record.app_metadata ?? nested.app_metadata)
  return { id, email, appMetadata }
}

function hashedTokenFrom(value: unknown): string | null {
  const record = asRecord(value)
  const properties = asRecord(record.properties)
  if (typeof properties.hashed_token === "string" && properties.hashed_token) {
    return properties.hashed_token
  }
  if (typeof record.hashed_token === "string" && record.hashed_token) {
    return record.hashed_token
  }
  return null
}

function telegramIdMatches(user: AuthUser, telegramUserId: string): boolean {
  return String(user.appMetadata.telegram_user_id ?? "") === telegramUserId
}

function adminHeaders(deps: AuthTelegramDeps): Record<string, string> {
  return {
    apikey: deps.serviceRoleKey,
    authorization: `Bearer ${deps.serviceRoleKey}`,
    accept: "application/json",
    "content-type": "application/json",
  }
}

function anonHeaders(deps: AuthTelegramDeps): Record<string, string> {
  return {
    apikey: deps.anonKey,
    authorization: `Bearer ${deps.anonKey}`,
    accept: "application/json",
    "content-type": "application/json",
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function getBearerUser(
  deps: AuthTelegramDeps,
  token: string,
): Promise<AuthUser | null> {
  const response = await deps.fetch(`${apiBase(deps.apiUrl)}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: deps.anonKey,
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  })
  if (!response.ok) return null
  return readUser(await readJson(response))
}

async function listUserPage(
  deps: AuthTelegramDeps,
  page: number,
): Promise<AuthUser[]> {
  const url =
    `${apiBase(deps.apiUrl)}/auth/v1/admin/users` +
    `?page=${page}&per_page=${USER_LOOKUP_PAGE_SIZE}`
  const response = await deps.fetch(url, {
    method: "GET",
    headers: adminHeaders(deps),
  })
  if (!response.ok) throw new Error("user lookup failed")
  const body = await readJson(response)
  const record = asRecord(body)
  const raw = Array.isArray(body)
    ? body
    : Array.isArray(record.users)
    ? record.users
    : []
  const users: AuthUser[] = []
  for (const entry of raw) {
    const user = readUser(entry)
    if (user) users.push(user)
  }
  return users
}

async function findUserByTelegramId(
  deps: AuthTelegramDeps,
  telegramUserId: string,
): Promise<AuthUser | null> {
  const synthetic = telegramSyntheticEmail(telegramUserId)
  let emailMatch: AuthUser | null = null
  for (let page = 1; page <= USER_LOOKUP_MAX_PAGES; page++) {
    const users = await listUserPage(deps, page)
    for (const user of users) {
      if (telegramIdMatches(user, telegramUserId)) return user
      if (user.email === synthetic && emailMatch === null) emailMatch = user
    }
    if (users.length < USER_LOOKUP_PAGE_SIZE) break
  }
  return emailMatch
}

// GoTrue merges app_metadata on admin update, so provider keys stay put.
async function storeTelegramUserId(
  deps: AuthTelegramDeps,
  userId: string,
  telegramUserId: string,
): Promise<boolean> {
  const response = await deps.fetch(
    `${apiBase(deps.apiUrl)}/auth/v1/admin/users/${userId}`,
    {
      method: "PUT",
      headers: adminHeaders(deps),
      body: JSON.stringify({
        app_metadata: { telegram_user_id: telegramUserId },
      }),
    },
  )
  return response.ok
}

async function generateLink(
  deps: AuthTelegramDeps,
  email: string,
): Promise<{ hashedToken: string; user: AuthUser } | null> {
  const response = await deps.fetch(
    `${apiBase(deps.apiUrl)}/auth/v1/admin/generate_link`,
    {
      method: "POST",
      headers: adminHeaders(deps),
      body: JSON.stringify({ type: "magiclink", email }),
    },
  )
  if (!response.ok) return null
  const body = await readJson(response)
  const hashedToken = hashedTokenFrom(body)
  const user = readUser(body)
  if (!hashedToken || !user) return null
  return { hashedToken, user }
}

async function verifyOtp(
  deps: AuthTelegramDeps,
  hashedToken: string,
): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  user: { id: string; email: string }
} | null> {
  const response = await deps.fetch(`${apiBase(deps.apiUrl)}/auth/v1/verify`, {
    method: "POST",
    headers: anonHeaders(deps),
    body: JSON.stringify({ token_hash: hashedToken, type: "email" }),
  })
  if (!response.ok) return null
  const body = asRecord(await readJson(response))
  const user = readUser(body.user ?? body)
  const accessToken = typeof body.access_token === "string" ? body.access_token : null
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null
  const tokenType = typeof body.token_type === "string" ? body.token_type : "bearer"
  if (!accessToken || !refreshToken || expiresIn === null || !user) return null
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    token_type: tokenType,
    user: { id: user.id, email: user.email },
  }
}

function requiredWidgetFieldsPresent(payload: WidgetPayload): boolean {
  if (telegramUserIdFrom(payload.id) === null) return false
  if (typeof payload.first_name !== "string") return false
  if (parseAuthDate(payload.auth_date) === null) return false
  if (typeof payload.hash !== "string" || payload.hash.length === 0) return false
  return true
}

export function createAuthTelegramHandler(
  deps: AuthTelegramDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (req.method !== "POST") {
      return jsonResponse(405, { error: "method not allowed" })
    }

    let payload: WidgetPayload
    try {
      const parsed = await req.json()
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return jsonResponse(400, { error: "invalid payload" })
      }
      payload = parsed as WidgetPayload
    } catch {
      return jsonResponse(400, { error: "invalid payload" })
    }

    if (!requiredWidgetFieldsPresent(payload)) return unauthorized()

    const expectedHash = await computeWidgetHash(deps.botToken, payload)
    if (!timingSafeEqual(expectedHash, String(payload.hash))) return unauthorized()

    const authDate = parseAuthDate(payload.auth_date)
    if (authDate === null) return unauthorized()
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (nowSeconds - authDate > AUTH_DATE_MAX_AGE_SECONDS) return unauthorized()

    const telegramUserId = telegramUserIdFrom(payload.id)
    if (telegramUserId === null) return unauthorized()
    const syntheticEmail = telegramSyntheticEmail(telegramUserId)

    let email: string
    let knownUser: AuthUser | null = null
    const bearer = extractBearerToken(req)
    try {
      // Anon key, garbage, or expired JWT is a missing bearer, not a 401.
      if (bearer && bearer !== deps.anonKey) {
        knownUser = await getBearerUser(deps, bearer)
      }
      if (knownUser) {
        email = knownUser.email
      } else {
        knownUser = await findUserByTelegramId(deps, telegramUserId)
        email = knownUser?.email ?? syntheticEmail
      }

      const minted = await generateLink(deps, email)
      if (!minted) return upstreamFailed("generate_link")

      const userId = minted.user.id
      const stored = await storeTelegramUserId(deps, userId, telegramUserId)
      if (!stored) return upstreamFailed("store_metadata")

      const session = await verifyOtp(deps, minted.hashedToken)
      if (!session) return upstreamFailed("verify")
      return jsonResponse(200, session)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message === "user lookup failed") return upstreamFailed("lookup")
      return upstreamFailed("upstream")
    }
  }
}

if (import.meta.main) {
  Deno.serve(createAuthTelegramHandler(depsFromEnv()))
}

const testFn =
  (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test

if (typeof testFn === "function" && !import.meta.main) {
  const apiUrl = "https://orma-api.nryn.dev"
  const botToken = "123456:TEST-bot-token"
  const serviceRoleKey = "service-role-secret-value-do-not-leak"
  const anonKey = "anon-key-test-value"
  const telegramId = 424242
  const syntheticEmail = telegramSyntheticEmail(String(telegramId))
  const emailUser = {
    id: "00000000-0000-4000-8000-00000000000e",
    email: "ada@example.com",
  }
  const telegramUser = {
    id: "00000000-0000-4000-8000-00000000000t",
    email: syntheticEmail,
  }

  async function independentHash(
    token: string,
    fields: Record<string, string | number>,
  ): Promise<string> {
    const dataCheck = Object.keys(fields)
      .sort()
      .map((key) => `${key}=${fields[key]}`)
      .join("\n")
    const encoder = new TextEncoder()
    const secret = new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(token)),
    )
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(dataCheck))
    return [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }

  async function signedWidget(
    overrides: Record<string, string | number> = {},
  ): Promise<Record<string, string | number>> {
    const fields: Record<string, string | number> = {
      id: telegramId,
      first_name: "Ada",
      auth_date: Math.floor(Date.now() / 1000),
      ...overrides,
    }
    const hash = await independentHash(botToken, fields)
    return { ...fields, hash }
  }

  type FetchCall = {
    method: string
    path: string
    authorization: string | null
    apikey: string | null
    body: string
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }

  function mintFetch(opts: {
    users?: Array<{ id: string; email: string; app_metadata?: Record<string, unknown> }>
    bearerUser?: { id: string; email: string } | null
    hashedToken?: string
  } = {}) {
    const calls: FetchCall[] = []
    const hashedToken = opts.hashedToken ?? "hashed-token-test"
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      const method = (init?.method ?? "GET").toUpperCase()
      const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "")
      calls.push({
        method,
        path: url.pathname,
        authorization: headers.get("authorization"),
        apikey: headers.get("apikey"),
        body,
      })
      if (url.pathname === "/auth/v1/user") {
        if (!opts.bearerUser) return json({ message: "invalid JWT" }, 401)
        return json({
          id: opts.bearerUser.id,
          email: opts.bearerUser.email,
          app_metadata: {},
        })
      }
      if (url.pathname === "/auth/v1/admin/users" && method === "GET") {
        return json({ users: opts.users ?? [] })
      }
      if (url.pathname.startsWith("/auth/v1/admin/users/") && method === "PUT") {
        return json({ id: url.pathname.split("/").pop() })
      }
      if (url.pathname === "/auth/v1/admin/generate_link") {
        const parsed = JSON.parse(body) as { email?: string }
        const email = parsed.email ?? ""
        const listed = (opts.users ?? []).find((user) => user.email === email)
        const user = listed ?? opts.bearerUser ?? {
          id: telegramUser.id,
          email,
        }
        if (!user) return json({ message: "missing user" }, 500)
        return json({
          id: user.id,
          email: user.email,
          hashed_token: hashedToken,
          properties: { hashed_token: hashedToken },
        })
      }
      if (url.pathname === "/auth/v1/verify") {
        const parsed = JSON.parse(body) as { token_hash?: string; type?: string }
        if (parsed.token_hash !== hashedToken || parsed.type !== "email") {
          return json({ message: "invalid token" }, 401)
        }
        const linkCall = [...calls].reverse().find((call) =>
          call.path === "/auth/v1/admin/generate_link"
        )
        const email = linkCall
          ? (JSON.parse(linkCall.body) as { email?: string }).email ?? syntheticEmail
          : syntheticEmail
        const listed = (opts.users ?? []).find((user) => user.email === email)
        const user = listed ?? opts.bearerUser ?? telegramUser
        if (!user) return json({ message: "missing user" }, 500)
        return json({
          access_token: "access-test",
          refresh_token: "refresh-test",
          expires_in: 3600,
          token_type: "bearer",
          user: { id: user.id, email: user.email },
        })
      }
      throw new Error(`unexpected fetch ${method} ${url.pathname}`)
    }
    return { calls, fetch: fetchImpl }
  }

  function baseDeps(
    fetchImpl: typeof fetch,
    overrides: Partial<AuthTelegramDeps> = {},
  ): AuthTelegramDeps {
    return {
      botToken,
      apiUrl,
      serviceRoleKey,
      anonKey,
      fetch: fetchImpl,
      ...overrides,
    }
  }

  async function postWidget(
    deps: AuthTelegramDeps,
    payload: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return await createAuthTelegramHandler(deps)(
      new Request(`${apiUrl}/functions/v1/auth-telegram`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      }),
    )
  }

  testFn("valid payload returns 200 and a session-shaped body", async () => {
    const double = mintFetch()
    const payload = await signedWidget()
    const response = await postWidget(baseDeps(double.fetch), payload)
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`)
    const body = await response.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      user?: { id?: string; email?: string }
    }
    if (body.access_token !== "access-test") throw new Error("missing access_token")
    if (body.refresh_token !== "refresh-test") throw new Error("missing refresh_token")
    if (body.expires_in !== 3600) throw new Error("missing expires_in")
    if (body.token_type !== "bearer") throw new Error("missing token_type")
    if (body.user?.id !== telegramUser.id) throw new Error("user id mismatch")
    if (body.user?.email !== syntheticEmail) throw new Error("telegram-first email mismatch")
    if (response.headers.get("Access-Control-Allow-Origin") !== "https://orma.nryn.dev") {
      throw new Error("POST must send the app CORS origin")
    }
    const link = double.calls.find((call) => call.path === "/auth/v1/admin/generate_link")
    if (!link) throw new Error("generateLink was not called")
    const emailed = (JSON.parse(link.body) as { email?: string }).email
    if (emailed !== syntheticEmail) throw new Error("generateLink must use the synthetic email")
  })

  testFn("one-byte hash change returns 401 and does not call generateLink", async () => {
    const double = mintFetch()
    const payload = await signedWidget()
    const hash = String(payload.hash)
    const last = hash[hash.length - 1] === "a" ? "b" : "a"
    payload.hash = hash.slice(0, -1) + last
    const response = await postWidget(baseDeps(double.fetch), payload)
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`)
    const linked = double.calls.some((call) => call.path === "/auth/v1/admin/generate_link")
    if (linked) throw new Error("generateLink must not run for a bad hash")
  })

  testFn("stale auth_date returns 401 and does not call generateLink", async () => {
    if (AUTH_DATE_MAX_AGE_SECONDS !== 300) {
      throw new Error("window must start at 300s")
    }
    const double = mintFetch()
    const stale = Math.floor(Date.now() / 1000) - AUTH_DATE_MAX_AGE_SECONDS - 1
    const payload = await signedWidget({ auth_date: stale })
    const response = await postWidget(baseDeps(double.fetch), payload)
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`)
    const linked = double.calls.some((call) => call.path === "/auth/v1/admin/generate_link")
    if (linked) throw new Error("generateLink must not run for a stale payload")
  })

  testFn("depsFromEnv throws missing NAME and rejects supabase.co", () => {
    const names = [
      "TELEGRAM_BOT_TOKEN",
      "ORMA_API_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
    ]
    const values: Record<string, string> = {}
    for (const name of names) {
      try {
        depsFromEnv((key) => values[key])
        throw new Error(`expected missing ${name}`)
      } catch (error) {
        if (!(error instanceof Error) || error.message !== `missing ${name}`) {
          throw new Error(`expected missing ${name}, got ${error}`)
        }
        values[name] = name === "ORMA_API_URL" ? apiUrl : `${name}-value`
      }
    }
    const deps = depsFromEnv((key) => values[key])
    if (deps.botToken !== "TELEGRAM_BOT_TOKEN-value") {
      throw new Error("bot token must load from TELEGRAM_BOT_TOKEN")
    }
    if (deps.serviceRoleKey !== "SUPABASE_SERVICE_ROLE_KEY-value") {
      throw new Error("service role must load from SUPABASE_SERVICE_ROLE_KEY")
    }
    if (deps.anonKey !== "SUPABASE_ANON_KEY-value") {
      throw new Error("anon key must load from SUPABASE_ANON_KEY")
    }
    let threw = false
    try {
      depsFromEnv((key) =>
        key === "TELEGRAM_BOT_TOKEN"
          ? "token"
          : key === "ORMA_API_URL"
          ? "https://pyuubklpkhjngiqqwypf.supabase.co"
          : key === "SUPABASE_SERVICE_ROLE_KEY"
          ? "role"
          : key === "SUPABASE_ANON_KEY"
          ? "anon"
          : undefined)
    } catch (error) {
      threw = true
      if (!(error instanceof Error) || !error.message.includes("project host")) {
        throw new Error("depsFromEnv must reject *.supabase.co")
      }
    }
    if (!threw) throw new Error("depsFromEnv must throw for supabase.co URL")
  })

  testFn("bearer of an email user attaches and generateLink uses that email", async () => {
    const double = mintFetch({ bearerUser: emailUser })
    const payload = await signedWidget()
    const response = await postWidget(baseDeps(double.fetch), payload, {
      authorization: "Bearer email-session-jwt",
    })
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`)
    const body = await response.json() as { user?: { id?: string; email?: string } }
    if (body.user?.id !== emailUser.id) throw new Error("must mint for the bearer user")
    if (body.user?.email !== emailUser.email) throw new Error("must keep the email user")
    const link = double.calls.find((call) => call.path === "/auth/v1/admin/generate_link")
    if (!link) throw new Error("generateLink was not called")
    const emailed = (JSON.parse(link.body) as { email?: string }).email
    if (emailed !== emailUser.email) {
      throw new Error("generateLink must use the bearer email, not a synthetic one")
    }
    if (emailed === syntheticEmail) throw new Error("must not create a second synthetic user")
    const update = double.calls.find((call) =>
      call.method === "PUT" && call.path === `/auth/v1/admin/users/${emailUser.id}`
    )
    if (!update) throw new Error("attach must store telegram_user_id on the bearer user")
    const updated = JSON.parse(update.body) as {
      app_metadata?: { telegram_user_id?: string }
    }
    if (updated.app_metadata?.telegram_user_id !== String(telegramId)) {
      throw new Error("stored telegram_user_id must match the widget id")
    }
  })

  testFn("OPTIONS returns CORS origin for the app host", async () => {
    const double = mintFetch()
    const response = await createAuthTelegramHandler(baseDeps(double.fetch))(
      new Request(`${apiUrl}/functions/v1/auth-telegram`, { method: "OPTIONS" }),
    )
    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`expected 204 or 200, got ${response.status}`)
    }
    const origin = response.headers.get("Access-Control-Allow-Origin")
    if (origin !== "https://orma.nryn.dev") {
      throw new Error(`expected https://orma.nryn.dev, got ${origin}`)
    }
    if (ALLOWED_ORIGIN !== "https://orma.nryn.dev") {
      throw new Error("ALLOWED_ORIGIN must be the app host")
    }
    const methods = response.headers.get("Access-Control-Allow-Methods") ?? ""
    if (!methods.toLowerCase().includes("post") || !methods.toLowerCase().includes("options")) {
      throw new Error("CORS must allow POST and OPTIONS")
    }
    const allowHeaders = (response.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase()
    if (!allowHeaders.includes("content-type") || !allowHeaders.includes("authorization")) {
      throw new Error("CORS must allow content-type and authorization")
    }
    if (!allowHeaders.includes("apikey")) {
      throw new Error("CORS must allow apikey")
    }
  })

  testFn("handler uses service role on generateLink and never in the body", async () => {
    const double = mintFetch()
    const payload = await signedWidget()
    const response = await postWidget(baseDeps(double.fetch), payload)
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`)
    const text = await response.text()
    if (text.includes(serviceRoleKey)) throw new Error("service role leaked in the body")
    const parsed = JSON.parse(text) as Record<string, unknown>
    if ("service_role" in parsed || "serviceRoleKey" in parsed) {
      throw new Error("body must not name the service role")
    }
    const link = double.calls.find((call) => call.path === "/auth/v1/admin/generate_link")
    if (!link) throw new Error("generateLink was not called")
    if (link.authorization !== `Bearer ${serviceRoleKey}`) {
      throw new Error("generateLink must use the service role")
    }
    if (link.apikey !== serviceRoleKey) {
      throw new Error("generateLink apikey must be the service role")
    }
    const verify = double.calls.find((call) => call.path === "/auth/v1/verify")
    if (!verify) throw new Error("verifyOtp was not called")
    if (verify.authorization === `Bearer ${serviceRoleKey}`) {
      throw new Error("verifyOtp must not use the service role")
    }
    if (verify.apikey === serviceRoleKey) {
      throw new Error("verifyOtp apikey must not be the service role")
    }
    if (verify.apikey !== anonKey) throw new Error("verifyOtp must use the anon key")
  })

  testFn("GET is 405", async () => {
    const double = mintFetch()
    const response = await createAuthTelegramHandler(baseDeps(double.fetch))(
      new Request(`${apiUrl}/functions/v1/auth-telegram`),
    )
    if (response.status !== 405) throw new Error(`expected 405, got ${response.status}`)
    const linked = double.calls.some((call) => call.path === "/auth/v1/admin/generate_link")
    if (linked) throw new Error("GET must not mint")
  })

  testFn("missing widget fields are refused", async () => {
    const double = mintFetch()
    const response = await postWidget(baseDeps(double.fetch), { id: telegramId })
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`)
    const linked = double.calls.some((call) => call.path === "/auth/v1/admin/generate_link")
    if (linked) throw new Error("missing fields must not mint")
  })

  testFn("valid HMAC with anon key Bearer still mints telegram-first", async () => {
    const double = mintFetch({ bearerUser: null })
    const payload = await signedWidget()
    const response = await postWidget(baseDeps(double.fetch), payload, {
      authorization: `Bearer ${anonKey}`,
    })
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`)
    const body = await response.json() as {
      access_token?: string
      user?: { id?: string; email?: string }
    }
    if (!body.access_token) throw new Error("anon Bearer must still mint a session")
    if (body.user?.id !== telegramUser.id) throw new Error("anon Bearer must not invent a user")
    if (body.user?.email !== syntheticEmail) {
      throw new Error("anon Bearer must take the telegram-first path")
    }
    const link = double.calls.find((call) => call.path === "/auth/v1/admin/generate_link")
    if (!link) throw new Error("generateLink was not called")
    const emailed = (JSON.parse(link.body) as { email?: string }).email
    if (emailed !== syntheticEmail) {
      throw new Error("anon Bearer must not attach to a fake user")
    }
  })

  testFn("garbage bearer is missing and still mints telegram-first", async () => {
    const double = mintFetch({ bearerUser: null })
    const payload = await signedWidget()
    const response = await postWidget(baseDeps(double.fetch), payload, {
      authorization: "Bearer not-a-real-session",
    })
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`)
    const body = await response.json() as { user?: { id?: string; email?: string } }
    if (body.user?.id !== telegramUser.id) throw new Error("garbage Bearer must fall through")
    if (body.user?.email !== syntheticEmail) {
      throw new Error("garbage Bearer must take the telegram-first path")
    }
  })

  testFn("invalid HMAC with anon key Bearer still returns 401", async () => {
    const double = mintFetch({ bearerUser: null })
    const payload = await signedWidget()
    const hash = String(payload.hash)
    const last = hash[hash.length - 1] === "a" ? "b" : "a"
    payload.hash = hash.slice(0, -1) + last
    const response = await postWidget(baseDeps(double.fetch), payload, {
      authorization: `Bearer ${anonKey}`,
    })
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`)
    const linked = double.calls.some((call) => call.path === "/auth/v1/admin/generate_link")
    if (linked) throw new Error("bad hash must not mint even with anon Bearer")
  })

  testFn("later telegram login without bearer mints the attached email user", async () => {
    const double = mintFetch({
      users: [{
        id: emailUser.id,
        email: emailUser.email,
        app_metadata: { telegram_user_id: String(telegramId) },
      }],
    })
    const payload = await signedWidget()
    const response = await postWidget(baseDeps(double.fetch), payload)
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`)
    const body = await response.json() as { user?: { id?: string; email?: string } }
    if (body.user?.id !== emailUser.id) throw new Error("must reuse the attached user")
    const link = double.calls.find((call) => call.path === "/auth/v1/admin/generate_link")
    if (!link) throw new Error("generateLink was not called")
    const emailed = (JSON.parse(link.body) as { email?: string }).email
    if (emailed !== emailUser.email) {
      throw new Error("no-bearer login must mint the attached email, not a synthetic one")
    }
  })
}
