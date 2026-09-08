import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDataSource, resolveAllCalls } from "@/lib/console/source";

export const runtime = "nodejs";

export async function GET() {
  if (readDataSource() !== "mock") await db.refreshLiveCalls();
  const { calls, source } = resolveAllCalls();
  return NextResponse.json({ success: true, calls, source });
}
