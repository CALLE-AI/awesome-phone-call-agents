import { NextRequest, NextResponse } from "next/server";
import { seedDemoData, resetData } from "@/lib/db";
import { validateApiAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  seedDemoData();
  return NextResponse.json({ ok: true, message: "Demo data seeded successfully" });
}

export async function DELETE(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  resetData();
  return NextResponse.json({ ok: true, message: "Database reset successfully" });
}
