import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/accounts";
import { applySessionCookie, createSession } from "@/lib/console/session-http";
import { getSundialsDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const account = getSundialsDb().getAccountByUsername(username);
  if (!account || !verifyPassword(password, account.passwordHash)) {
    return NextResponse.json({ success: false, message: "Invalid username or password." }, { status: 401 });
  }
  const res = NextResponse.json({
    success: true,
    accountId: account.id,
    username: account.username,
    companyName: account.companyName
  });
  return applySessionCookie(res, createSession(account.id, account.username));
}
