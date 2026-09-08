import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDataSource, resolveMetrics } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET() {
  if (readDataSource() !== "mock") await db.refreshLiveCalls();
  const { metrics, source } = resolveMetrics();
  return NextResponse.json({ success: true, metrics, source });
}
