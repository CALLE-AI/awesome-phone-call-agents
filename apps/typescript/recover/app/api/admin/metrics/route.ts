import { NextResponse } from "next/server";
import { getDashboardMetrics } from "@/lib/db";

export async function GET() {
  const metrics = getDashboardMetrics();
  return NextResponse.json(metrics);
}
