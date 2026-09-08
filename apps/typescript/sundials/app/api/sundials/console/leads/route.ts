import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDataSource, resolveLeadQueue } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET() {
  if (readDataSource() !== "mock") await db.refreshLiveCalls();
  const { leads, source } = resolveLeadQueue();
  return NextResponse.json({ success: true, leads, source });
}
