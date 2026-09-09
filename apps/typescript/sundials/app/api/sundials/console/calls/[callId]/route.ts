import { NextRequest, NextResponse } from "next/server";
import { needsGeminiProfile, scheduleBrainAfterCall } from "@/lib/brain/pipeline";
import { requireConsoleSession } from "@/lib/console/session-http";
import { db, getSundialsDb } from "@/lib/db";
import { readDataSource, resolveCallDetail } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  const { callId } = await params;
  if (readDataSource() !== "mock") await db.refreshLiveCalls(callId);
  const { call, lead, source } = resolveCallDetail(callId, auth.session.accountId);
  if (!call) {
    return NextResponse.json({ success: false, message: "Call not found" }, { status: 404 });
  }
  if (needsGeminiProfile(call)) scheduleBrainAfterCall(getSundialsDb(), call.id);
  return NextResponse.json({ success: true, call, lead, source, profiling: needsGeminiProfile(call) });
}
