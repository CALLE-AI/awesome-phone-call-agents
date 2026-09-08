import { NextResponse } from "next/server";
import { scheduleMissingBriefings } from "@/lib/brain/pipeline";
import { db, getSundialsDb } from "@/lib/db";
import { readDataSource, resolveLeadDetail } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  if (readDataSource() !== "mock") await db.refreshLiveCalls();
  const { lead, calls, source } = resolveLeadDetail(leadId);
  if (!lead) {
    return NextResponse.json({ success: false, message: "Lead not found" }, { status: 404 });
  }
  scheduleMissingBriefings(getSundialsDb(), calls);
  return NextResponse.json({ success: true, lead, calls, source });
}
