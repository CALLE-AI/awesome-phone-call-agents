import { NextRequest, NextResponse } from "next/server";
import { applySessionCookie, createSession } from "@/lib/console/session-http";
import { getSundialsDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    username?: string;
    password?: string;
    companyName?: string;
  } | null;
  const created = getSundialsDb().createAccount({
    username: typeof body?.username === "string" ? body.username : "",
    password: typeof body?.password === "string" ? body.password : "",
    companyName: typeof body?.companyName === "string" ? body.companyName : ""
  });
  if (!created.ok) {
    return NextResponse.json({ success: false, message: created.message }, { status: 400 });
  }
  const res = NextResponse.json({
    success: true,
    accountId: created.account.id,
    username: created.account.username,
    companyName: created.account.companyName
  });
  return applySessionCookie(res, createSession(created.account.id, created.account.username));
}
