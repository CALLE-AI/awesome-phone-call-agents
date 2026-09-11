import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSession,
  decodeSessionCookie,
  encodeSessionCookie,
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionFromRequest,
  type ConsoleSession
} from "./session.ts";

export function applySessionCookie(res: NextResponse, session: ConsoleSession): NextResponse {
  res.cookies.set(SESSION_COOKIE, encodeSessionCookie(session), sessionCookieOptions());
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}

export async function getConsoleSessionFromCookies(): Promise<ConsoleSession | null> {
  const store = await cookies();
  return decodeSessionCookie(store.get(SESSION_COOKIE)?.value);
}

export function requireConsoleSession(
  req: { cookies: { get(name: string): { value: string } | undefined } }
): { ok: true; session: ConsoleSession } | { ok: false; response: NextResponse } {
  const session = sessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, message: "Sign in required." }, { status: 401 })
    };
  }
  return { ok: true, session };
}

export { createSession };
