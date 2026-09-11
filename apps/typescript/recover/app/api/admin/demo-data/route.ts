import { NextResponse } from "next/server";
import { seedDemoData, resetData } from "@/lib/db";

export async function POST() {
  seedDemoData();
  return NextResponse.json({ ok: true, message: "Demo data seeded successfully" });
}

export async function DELETE() {
  resetData();
  return NextResponse.json({ ok: true, message: "Database reset successfully" });
}
