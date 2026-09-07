import { NextRequest, NextResponse } from "next/server";
import { callLogsTable, subscribersTable, webhookEventsTable } from "@/lib/db";
import type { PaymentRecoveryDecision } from "@/lib/calle";

/**
 * Receives CALL-E's terminal call events (call.completed / call.failed /
 * call.result_validation_failed) and applies the customer's live decision
 * to our subscriber record.
 *
 * Per CALL-E's webhook contract: there is no signing secret today, so this
 * validates the CALL-E-Event-Id header against the body and dedupes by
 * event id, but treats the endpoint as a public/untrusted boundary -- exactly
 * as CALL-E's own docs recommend.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const event = JSON.parse(rawBody);
  const eventId = req.headers.get("CALL-E-Event-Id");

  if (!eventId || eventId !== event.id) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }

  if (webhookEventsTable.has(event.id)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  webhookEventsTable.insert(event.id);

  if (event.type === "call.completed" || event.type === "call.failed" || event.type === "call.result_validation_failed") {
    const callTask = event.data;
    const callLog = callLogsTable.findByCalleCallId(callTask.id);

    if (callLog) {
      // Whole-task structured result (see resultSchema in lib/calle.ts)
      const structured = callTask.structured_result as
        | { decision: PaymentRecoveryDecision; evidence: string }
        | null;

      const decision = structured?.decision ?? "unknown";
      const evidence = structured?.evidence ?? null;

      callLogsTable.completeByCalleCallId(callTask.id, {
        status: event.type === "call.completed" ? "completed" : "failed",
        decision,
        evidence,
        raw_result: JSON.stringify(callTask),
      });

      const nextStatus =
        decision === "retry_now" || decision === "update_card"
          ? "active" // optimistic; a real app would only flip this after the retry/update actually succeeds
          : decision === "pause_subscription"
          ? "paused"
          : "past_due";

      subscribersTable.updateStatus(callLog.subscriber_id, nextStatus);
    }
  }

  return NextResponse.json({ ok: true });
}
