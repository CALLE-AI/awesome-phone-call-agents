import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireConsoleSession } from "@/lib/console/session-http";
import { parseRange } from "@/lib/console/format";
import { resolveAnalytics } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  await db.refreshLiveCalls();
  const range = parseRange(req.nextUrl.searchParams.get("range"));
  const { analytics, source } = resolveAnalytics(range, auth.session.accountId);
  return NextResponse.json({ success: true, analytics, source });
}
