import { NextRequest, NextResponse } from "next/server";
import { callLogsTable, subscribersTable } from "@/lib/db";

/**
 * Discards a pending recovery call without ever placing it. Reverts the
 * subscriber back to "active" since, from the customer's perspective,
 * nothing happened -- no call was placed, no charge decision was made.
 */
export async function POST(req: NextRequest) {
  const { callLogId } = await req.json();
  const callLog = callLogsTable.get(callLogId);

  if (!callLog) {
    return NextResponse.json({ error: "call log not found" }, { status: 404 });
  }
  if (callLog.status !== "pending_confirmation") {
    return NextResponse.json(
      { error: `call is not pending confirmation (status: ${callLog.status})` },
      { status: 409 }
    );
  }

  callLogsTable.cancel(callLog.id);
  subscribersTable.updateStatus(callLog.subscriber_id, "active");

  return NextResponse.json({ ok: true });
}