import { NextRequest, NextResponse } from "next/server";
import { callLogsTable, subscribersTable } from "@/lib/db";
import { validateApiAuth } from "@/lib/auth";

/**
 * Discards a pending recovery call without placing it.
 * Authenticated via `validateApiAuth`.
 */
export async function POST(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  let body: { callLogId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { callLogId } = body;
  if (!callLogId) {
    return NextResponse.json({ error: "callLogId is required" }, { status: 400 });
  }

  const callLog = callLogsTable.get(callLogId);
  if (!callLog) {
    return NextResponse.json({ error: "Call log not found" }, { status: 404 });
  }

  if (callLog.status !== "pending_confirmation") {
    return NextResponse.json(
      { error: `Conflict: Call is not pending confirmation (current status: ${callLog.status})` },
      { status: 409 }
    );
  }

  callLogsTable.cancel(callLog.id);
  subscribersTable.updateStatus(callLog.subscriber_id, "active");

  return NextResponse.json({ ok: true });
}