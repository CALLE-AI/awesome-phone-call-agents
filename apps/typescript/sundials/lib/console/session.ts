import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE } from "./session-cookie.ts";

export { SESSION_COOKIE };

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEV_SESSION_SECRET = "sundials-dev-session-secret";

export interface ConsoleSession {
  accountId: string;
  username: string;
  exp: number;
}

function sessionSecret(): string {
  return process.env.SUNDIALS_SESSION_SECRET?.trim() || DEV_SESSION_SECRET;
}

function encodePayload(session: ConsoleSession): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function encodeSessionCookie(session: ConsoleSession): string {
  const payload = encodePayload(session);
  return `${payload}.${sign(payload)}`;
}

export function decodeSessionCookie(value: string | undefined | null): ConsoleSession | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ConsoleSession;
    if (!parsed?.accountId || !parsed.username || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createSession(accountId: string, username: string): ConsoleSession {
  return { accountId, username, exp: Date.now() + SESSION_TTL_MS };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  };
}

type CookieReader = { cookies: { get(name: string): { value: string } | undefined } };

export function sessionFromRequest(req: CookieReader): ConsoleSession | null {
  return decodeSessionCookie(req.cookies.get(SESSION_COOKIE)?.value);
}
