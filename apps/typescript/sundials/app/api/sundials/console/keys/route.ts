import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/accounts";
import { requireConsoleSession } from "@/lib/console/session-http";
import { getSundialsDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  const account = getSundialsDb().getAccount(auth.session.accountId);
  if (!account) {
    return NextResponse.json({ success: false, message: "Account not found." }, { status: 401 });
  }
  return NextResponse.json({ success: true, account: toPublicAccount(account) });
}

export async function POST(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  try {
    const sdkKey = getSundialsDb().generateSdkKey(auth.session.accountId);
    const account = getSundialsDb().getAccount(auth.session.accountId);
    return NextResponse.json({
      success: true,
      sdkKey,
      account: account ? toPublicAccount(account) : undefined
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not generate an SDK key.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
