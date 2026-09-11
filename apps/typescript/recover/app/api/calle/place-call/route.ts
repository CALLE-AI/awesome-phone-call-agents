import { NextRequest, NextResponse } from "next/server";
import { callLogsTable, subscribersTable } from "@/lib/db";
import { placeRecoveryCall } from "@/lib/calle";

/**
 * The ONLY route in this app that actually places a CALL-E outbound call.
 *
 * This is only reachable after a human has seen the exact call preview
 * (task text + recipient) from /api/stripe/simulate-failure and explicitly
 * clicked "Confirm & place call" in the dashboard -- see app/page.tsx.
 * There is no code path that skips this confirmation step.
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

  const subscriber = subscribersTable.get(callLog.subscriber_id);
  if (!subscriber) {
    return NextResponse.json({ error: "subscriber not found" }, { status: 404 });
  }

  const webhookUrl =
    process.env.CALLE_WEBHOOK_URL ||
    (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/api/calle/webhook` : undefined);

  if (!webhookUrl) {
    return NextResponse.json(
      {
        error:
          "Neither APP_BASE_URL nor CALLE_WEBHOOK_URL is set. CALL-E needs a publicly reachable webhook URL to report " +
          "the call result -- set APP_BASE_URL in .env.local to your ngrok/tunnel URL (e.g. https://xxxx.ngrok-free.app).",
      },
      { status: 500 }
    );
  }

    // Include a timestamp so a genuinely new attempt (e.g. retrying after a
  // rejected/failed prior attempt, or an updated task) gets a fresh key,
  // rather than colliding with a previous attempt's now-stale request body.
  const idempotencyKey = `payment-recovery:${callLog.id}:${Date.now()}`;

  try {
    const call = await placeRecoveryCall({
      subscriber,
      failureReason: callLog.trigger_reason,
      idempotencyKey,
      webhookUrl,
      attemptNumber: callLog.attempt_number,
    });
    callLogsTable.attachCalleCall(callLog.id, call.id);
    return NextResponse.json({ calleCallId: call.id });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "CALL-E rejected the call request";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}