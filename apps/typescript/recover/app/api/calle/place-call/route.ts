import { NextRequest, NextResponse } from "next/server";
import { callLogsTable, subscribersTable } from "@/lib/db";
import { placeRecoveryCall, isCalleOfflineMock } from "@/lib/calle";
import { validateApiAuth, validateStrictE164 } from "@/lib/auth";

/**
 * Server-Bound Call Placement Endpoint.
 * 
 * SECURITY COMPLIANCE:
 * 1. Authenticated via `validateApiAuth`.
 * 2. Enforces Server-Bound Destination Authorization: The client CANNOT supply
 *    an arbitrary phone number. It supplies only a `callLogId`. The server looks up
 *    the pre-registered subscriber in SQLite and dials ONLY their authorized number.
 * 3. Validates strict ASCII E.164 format.
 * 4. Halts and reconciles conflicting/concurrent active calls for the same subscriber.
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
    return NextResponse.json({ error: "Call log record not found" }, { status: 404 });
  }

  if (callLog.status !== "pending_confirmation") {
    return NextResponse.json(
      { error: `Conflict: Call is not pending confirmation (current status: ${callLog.status})` },
      { status: 409 }
    );
  }

  const subscriber = subscribersTable.get(callLog.subscriber_id);
  if (!subscriber) {
    return NextResponse.json({ error: "Subscriber record not found" }, { status: 404 });
  }

  // Enforce server-bound strict ASCII E.164 destination validation
  const phoneValidation = validateStrictE164(subscriber.phone);
  if (!phoneValidation.valid) {
    return NextResponse.json(
      { error: `Registered subscriber phone is not valid strict ASCII E.164: ${phoneValidation.error}` },
      { status: 422 }
    );
  }

  // Conflict Prevention: Check for any overlapping in_progress call for this subscriber
  const activeCalls = callLogsTable
    .allWithSubscriber()
    .filter((c) => c.subscriber_id === subscriber.id && c.status === "in_progress");

  if (activeCalls.length > 0) {
    return NextResponse.json(
      { error: "Conflict: A live call is already in progress for this subscriber." },
      { status: 409 }
    );
  }

  let webhookUrl =
    process.env.CALLE_WEBHOOK_URL ||
    (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/api/calle/webhook` : undefined);

  if (!webhookUrl) {
    if (isCalleOfflineMock) {
      // In offline mock mode, default to local endpoint so demo succeeds without ngrok
      webhookUrl = "http://localhost:3000/api/calle/webhook";
    } else {
      return NextResponse.json(
        {
          error:
            "Neither APP_BASE_URL nor CALLE_WEBHOOK_URL is set. CALL-E needs a publicly reachable webhook URL to report " +
            "the call result -- set APP_BASE_URL in .env.local to your ngrok tunnel URL (e.g. https://xxxx.ngrok-free.app).",
        },
        { status: 500 }
      );
    }
  }

  const idempotencyKey = `payment-recovery:${callLog.id}:${callLog.attempt_number}`;

  try {
    const call = await placeRecoveryCall({
      subscriber,
      failureReason: callLog.trigger_reason,
      idempotencyKey,
      webhookUrl,
      attemptNumber: callLog.attempt_number,
    });

    callLogsTable.attachCalleCall(callLog.id, call.id);
    return NextResponse.json({ calleCallId: call.id, isMock: isCalleOfflineMock });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "CALL-E rejected the call request";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}