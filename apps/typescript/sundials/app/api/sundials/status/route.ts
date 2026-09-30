import { NextRequest, NextResponse } from "next/server";
import { db, toPublicCall } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ success: false, message: "taskId parameter is required" }, { status: 400 });
  }

  await db.refreshLiveCalls(taskId);
  const call = db.getCall(taskId);
  if (!call) {
    return NextResponse.json({ success: false, message: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, call: toPublicCall(call) });
}
