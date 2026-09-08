import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseRange } from "@/lib/console/format";
import { resolveAnalytics } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  await db.refreshLiveCalls();
  const range = parseRange(req.nextUrl.searchParams.get("range"));
  const { analytics, source } = resolveAnalytics(range);
  return NextResponse.json({ success: true, analytics, source });
}
