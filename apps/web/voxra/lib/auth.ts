// ─── CALL-E broker OAuth helpers (server-side only) ──────────────────────────
// No NextAuth. Auth is handled via the CALL-E broker session API, the same
// mechanism used by the CALL-E CLI (@call-e/core/broker-client).

import { config } from "@/lib/config";
import { decryptString, encryptString } from "@/lib/crypto";
import { getRedisClient } from "@/lib/redis";
import { cookies } from "next/headers";

export const BROKER_BASE_URL  = config.brokerBaseUrl;
export const SERVER_URL       = config.mcpUrl;
export const AUTH_BASE_URL    = BROKER_BASE_URL;
export const CHANNEL          = "openagent_oauth";
export const SCOPE            = "openid email profile";
export const CLIENT_NAME      = "call-e-web";
export const SESSION_SECRET_HEADER = "X-OpenAgent-Session-Secret";
export const INTEGRATION_HEADER    = "X-Call-E-Integration";
export const INTEGRATION_VALUE     = "call-e-web/1.0.0";
export const TIMEOUT_MS            = config.timeoutMs;
const AUTH_STATE_TTL_SECONDS = 10 * 60;
const SESSION_KEY_PREFIX = "calle:session:";
const AUTH_STATE_KEY_PREFIX = "calle:auth:";
const INLINE_AUTH_STATE_PREFIX = "in:";
const REDIS_AUTH_STATE_PREFIX = "rs:";

// ─── Cookie name ─────────────────────────────────────────────────────────────

export const SESSION_COOKIE = "calle_session";
export const AUTH_STATE_COOKIE = "calle_auth_state";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrokerSession {
  session_id: string;
  session_secret: string;
  login_url: string;
  status: string;
  expires_at: string | null;
  poll_after_ms: number | null;
}

export interface CalleSession {
  access_token: string;
  refresh_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
  expires_at: string | null;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}

interface SessionCookiePayload {
  sid: string;
  v: 1;
}

interface AuthStatePayload {
  session_id: string;
  session_secret: string;
}

interface InlineAuthStatePayload extends AuthStatePayload {
  iat: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function integrationHeaders(): Record<string, string> {
  return { [INTEGRATION_HEADER]: INTEGRATION_VALUE };
}

function brokerHeaders(sessionSecret: string): Record<string, string> {
  return { ...integrationHeaders(), [SESSION_SECRET_HEADER]: sessionSecret };
}

async function setEncryptedRedisValue(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const redis = await getRedisClient();
  if (!redis) return false;

  const encrypted = encryptString(JSON.stringify(value));
  await redis.set(key, encrypted, "EX", ttlSeconds);
  return true;
}

async function getEncryptedRedisValue<T>(key: string): Promise<T | null> {
  const redis = await getRedisClient();
  if (!redis) return null;

  const encrypted = await redis.get(key);
  if (!encrypted) return null;

  const decrypted = decryptString(encrypted);
  if (!decrypted) return null;

  return JSON.parse(decrypted) as T;
}

async function deleteRedisKey(key: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  await redis.del(key);
}

function authStateRedisKey(authStateId: string): string {
  return `${AUTH_STATE_KEY_PREFIX}${authStateId}`;
}

function sessionRedisKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function toInlineAuthState(payload: AuthStatePayload): string {
  const inlinePayload: InlineAuthStatePayload = {
    ...payload,
    iat: Date.now(),
  };
  return `${INLINE_AUTH_STATE_PREFIX}${encryptString(JSON.stringify(inlinePayload))}`;
}

function fromInlineAuthState(value: string): AuthStatePayload | null {
  if (!value.startsWith(INLINE_AUTH_STATE_PREFIX)) return null;

  const encrypted = value.slice(INLINE_AUTH_STATE_PREFIX.length);
  const plain = decryptString(encrypted);
  if (!plain) return null;

  try {
    const payload = JSON.parse(plain) as InlineAuthStatePayload;
    if (!payload?.session_id || !payload?.session_secret || !payload?.iat) {
      return null;
    }

    if (Date.now() - payload.iat > AUTH_STATE_TTL_SECONDS * 1000) {
      return null;
    }

    return {
      session_id: payload.session_id,
      session_secret: payload.session_secret,
    };
  } catch {
    return null;
  }
}

function encryptCookiePayload(payload: SessionCookiePayload): string {
  return encryptString(JSON.stringify(payload));
}

function decryptCookiePayload(value: string): SessionCookiePayload | null {
  const plain = decryptString(value);
  if (!plain) return null;

  try {
    const parsed = JSON.parse(plain) as SessionCookiePayload;
    if (!parsed?.sid || parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function brokerPost(path: string, headers: Record<string, string>, body?: object) {
  const res = await fetch(`${BROKER_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Broker ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function brokerGet(path: string, headers: Record<string, string>) {
  const res = await fetch(`${BROKER_BASE_URL}${path}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Broker GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Create a new broker session. Returns pending session with a login_url. */
export async function createBrokerSession(): Promise<BrokerSession> {
  const payload = await brokerPost(
    "/api/v1/openagent-auth/sessions",
    integrationHeaders(),
    {
      server_url:    SERVER_URL,
      auth_base_url: AUTH_BASE_URL,
      channel:       CHANNEL,
      scope:         SCOPE,
      client_name:   CLIENT_NAME,
    }
  );
  return {
    session_id:    String(payload.session_id),
    session_secret: String(payload.session_secret),
    login_url:     String(payload.login_url),
    status:        String(payload.status ?? "PENDING").toUpperCase(),
    expires_at:    payload.expires_at ? String(payload.expires_at) : null,
    poll_after_ms: Number(payload.poll_after_ms || 2000) || 2000,
  };
}

/** Poll the status of an existing broker session. */
export async function getBrokerSessionStatus(session: BrokerSession): Promise<BrokerSession> {
  const payload = await brokerGet(
    `/api/v1/openagent-auth/sessions/${session.session_id}`,
    brokerHeaders(session.session_secret)
  );
  return {
    ...session,
    status:        String(payload.status ?? session.status).toUpperCase(),
    expires_at:    payload.expires_at ? String(payload.expires_at) : session.expires_at,
    poll_after_ms: Number(payload.poll_after_ms || 0) || session.poll_after_ms,
  };
}

/** Persist broker auth state in Redis so the browser never receives session_secret. */
export async function createAuthState(session: BrokerSession): Promise<string> {
  const authStateId = crypto.randomUUID();
  const payload: AuthStatePayload = {
    session_id: session.session_id,
    session_secret: session.session_secret,
  };

  const saved = await setEncryptedRedisValue(
    authStateRedisKey(authStateId),
    payload,
    AUTH_STATE_TTL_SECONDS
  );

  if (!saved) {
    return toInlineAuthState(payload);
  }

  return `${REDIS_AUTH_STATE_PREFIX}${authStateId}`;
}

export async function getAuthStateSession(authStateId: string): Promise<BrokerSession | null> {
  const inlinePayload = fromInlineAuthState(authStateId);
  const redisStateId = authStateId.startsWith(REDIS_AUTH_STATE_PREFIX)
    ? authStateId.slice(REDIS_AUTH_STATE_PREFIX.length)
    : authStateId;
  const payload = inlinePayload ?? await getEncryptedRedisValue<AuthStatePayload>(authStateRedisKey(redisStateId));
  if (!payload?.session_id || !payload?.session_secret) {
    return null;
  }

  return {
    session_id: payload.session_id,
    session_secret: payload.session_secret,
    login_url: "",
    status: "PENDING",
    expires_at: null,
    poll_after_ms: 2000,
  };
}

export async function clearAuthState(authStateId: string): Promise<void> {
  if (authStateId.startsWith(INLINE_AUTH_STATE_PREFIX)) {
    return;
  }

  const redisStateId = authStateId.startsWith(REDIS_AUTH_STATE_PREFIX)
    ? authStateId.slice(REDIS_AUTH_STATE_PREFIX.length)
    : authStateId;
  await deleteRedisKey(authStateRedisKey(redisStateId));
}

/** Exchange an AUTHORIZED session for an access token. */
export async function exchangeBrokerSession(session: BrokerSession): Promise<CalleSession> {
  const payload = await brokerPost(
    `/api/v1/openagent-auth/sessions/${session.session_id}/exchange`,
    brokerHeaders(session.session_secret)
  );

  // Payload shape: { token: { access_token, ... }, expires_at, user?: { email, name, picture } }
  const accessToken: string =
    payload?.token?.access_token ?? payload?.access_token ?? "";
  if (!accessToken) throw new Error("Exchange response missing access_token");

  return {
    access_token: accessToken,
    refresh_token: payload?.token?.refresh_token ?? payload?.refresh_token ?? null,
    token_type: payload?.token?.token_type ?? payload?.token_type ?? "Bearer",
    scope: payload?.token?.scope ?? payload?.scope ?? SCOPE,
    expires_at:   payload.expires_at ? String(payload.expires_at) : null,
    email:        payload?.user?.email   ?? payload?.email   ?? null,
    name:         payload?.user?.name    ?? payload?.name    ?? null,
    picture:      payload?.user?.picture ?? payload?.picture ?? null,
  };
}

// ─── Session cookie helpers ───────────────────────────────────────────────────

function computeSessionMaxAge(session: CalleSession): number {
  return session.expires_at
    ? Math.max(0, Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000))
    : 60 * 60 * 24 * 30;
}

export function isSessionExpired(session: CalleSession, skewSeconds = 30): boolean {
  if (!session.expires_at) return false;
  const exp = new Date(session.expires_at).getTime();
  if (isNaN(exp)) return false;
  return exp <= Date.now() + skewSeconds * 1000;
}

export async function setCalleSessionCookie(session: CalleSession): Promise<void> {
  const sessionId = crypto.randomUUID();
  const maxAge = computeSessionMaxAge(session);
  const stored = await setEncryptedRedisValue(sessionRedisKey(sessionId), session, maxAge);

  if (!stored) {
    throw new Error("Redis is unavailable for session storage");
  }

  const encoded = encryptCookiePayload({ sid: sessionId, v: 1 });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encoded, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearCalleSessionCookie(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const payload = raw ? decryptCookiePayload(raw) : null;
  if (payload?.sid) {
    await deleteRedisKey(sessionRedisKey(payload.sid));
  }

  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

async function discoverTokenEndpoint(): Promise<string> {
  const protectedResourceUrls = [
    `${AUTH_BASE_URL}/.well-known/oauth-protected-resource/mcp/${CHANNEL}`,
    `${AUTH_BASE_URL}/.well-known/oauth-protected-resource`,
  ];

  let authServer = AUTH_BASE_URL;
  for (const url of protectedResourceUrls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: integrationHeaders(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const payload = await res.json();
      const servers = Array.isArray(payload?.authorization_servers) ? payload.authorization_servers : [];
      if (typeof servers[0] === "string" && servers[0]) {
        authServer = String(servers[0]).replace(/\/+$/u, "");
        break;
      }
    } catch {
      // try next discovery URL
    }
  }

  const res = await fetch(`${authServer}/.well-known/oauth-authorization-server`, {
    method: "GET",
    headers: integrationHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OAuth discovery failed: ${res.status}`);
  }
  const payload = await res.json();
  const tokenEndpoint = payload?.token_endpoint;
  if (!tokenEndpoint || typeof tokenEndpoint !== "string") {
    throw new Error("OAuth discovery missing token_endpoint");
  }
  return tokenEndpoint;
}

export async function refreshCalleSession(session: CalleSession): Promise<CalleSession | null> {
  if (!session.refresh_token) return null;
  const tokenEndpoint = await discoverTokenEndpoint();

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
    client_id: CLIENT_NAME,
    scope: SCOPE,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      ...integrationHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    return null;
  }

  const payload = await res.json();
  const accessToken = payload?.access_token;
  if (!accessToken || typeof accessToken !== "string") {
    return null;
  }

  const expiresIn = Number(payload?.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : session.expires_at;

  return {
    ...session,
    access_token: accessToken,
    refresh_token: payload?.refresh_token ?? session.refresh_token ?? null,
    token_type: payload?.token_type ?? session.token_type ?? "Bearer",
    scope: payload?.scope ?? session.scope ?? SCOPE,
    expires_at: expiresAt,
  };
}

export async function getUsableCalleSession(): Promise<CalleSession | null> {
  const current = await getCalleSession();
  if (!current) return null;

  if (!isSessionExpired(current)) {
    return current;
  }

  const refreshed = await refreshCalleSession(current);
  if (!refreshed) {
    await clearCalleSessionCookie();
    return null;
  }

  await setCalleSessionCookie(refreshed);
  return refreshed;
}

/** Read and parse the CALL-E session cookie. Returns null if absent/invalid. */
export async function getCalleSession(): Promise<CalleSession | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(SESSION_COOKIE)?.value;
    if (!raw) return null;

    const payload = decryptCookiePayload(raw);
    if (!payload?.sid) return null;

    const session = await getEncryptedRedisValue<CalleSession>(sessionRedisKey(payload.sid));
    if (!session?.access_token) return null;
    return session;
  } catch {
    return null;
  }
}
