import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireConsoleSession } from "@/lib/console/session-http";
import { readDataSource, resolveAllCalls } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  if (readDataSource() !== "mock") await db.refreshLiveCalls();
  const { calls, source } = resolveAllCalls(auth.session.accountId);
  return NextResponse.json({ success: true, calls, source });
}
