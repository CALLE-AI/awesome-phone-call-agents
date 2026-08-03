import { NextResponse } from "next/server";
import { clearCalleSessionCookie } from "@/lib/auth";

/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */
export async function POST() {
  await clearCalleSessionCookie();
  return NextResponse.json({ ok: true });
}
