import { NextRequest, NextResponse } from "next/server";
import { getDashboardMetrics } from "@/lib/db";
import { validateApiAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  const metrics = getDashboardMetrics();
  return NextResponse.json(metrics);
}
