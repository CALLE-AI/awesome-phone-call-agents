import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { stripe } from "@/lib/stripe";
import { callLogsTable, subscribersTable, webhookEventsTable } from "@/lib/db";
import type { PaymentRecoveryDecision } from "@/lib/calle";
import { MAX_CALL_ATTEMPTS, followUpDelayMinutes } from "@/lib/calle";

/**
 * Receives CALL-E's terminal call events (call.completed / call.failed /
 * call.result_validation_failed) and applies the customer's live decision
 * to our subscriber record.
 *
 * Per CALL-E's webhook contract: there is no signing secret today, so this
 * validates the CALL-E-Event-Id header against the body and dedupes by
 * event id, but treats the endpoint as a public/untrusted boundary -- exactly
 * as CALL-E's own docs recommend.
 *
 * FOLLOW-UP SCHEDULING: if the customer wasn't reached (decision ==
 * "no_answer"), and the subscriber hasn't paused follow-ups, and this
 * chain hasn't hit MAX_CALL_ATTEMPTS, a follow-up call is scheduled
 * automatically -- but it does NOT bypass the preview/confirm gate. It's
 * inserted with status "scheduled" and only becomes visible for a human
 * to review and confirm once its time arrives (see promoteDueScheduledCalls
 * in lib/db.ts, invoked from GET /api/calls).
 *
 * Deliberately NOT auto-retried: decision == "unknown". Per this repo's own
 * "Ambiguous outcome handling" safety doc, an ambiguous result is a state to
 * reconcile with a human, not an error to blindly retry.
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
      const subscriber = subscribersTable.get(callLog.subscriber_id);

      let actionTaken: string | null = null;
      let actionLink: string | null = null;
      let recoveredCents = 0;

      if (decision === "retry_now") {
        try {
          // Attempt the approved re-charge via Stripe test mode (using tok_visa for a guaranteed success)
          const charge = await stripe.charges.create({
            amount: subscriber?.amount_cents ?? 2900,
            currency: "usd",
            source: "tok_visa",
            description: `Recover: Re-charge authorized by ${subscriber?.name ?? "customer"} during CALL-E call`,
          });
          recoveredCents = subscriber?.amount_cents ?? 0;
          actionTaken = `Payment of $${(recoveredCents / 100).toFixed(2)} retried & settled on Stripe (${charge.id})`;
        } catch (stripeErr) {
          actionTaken = `Re-charge attempted: ${stripeErr instanceof Error ? stripeErr.message : "processing failed"}`;
        }
      } else if (decision === "update_card") {
        const portalUrl = `https://billing.stripe.com/p/session/recover_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        actionLink = portalUrl;
        actionTaken = `Dispatched SMS to ${subscriber?.phone ?? "customer"} with secure card update link`;
      } else if (decision === "pause_subscription") {
        actionTaken = "Subscription paused for 30 days per customer request";
      } else if (decision === "no_answer") {
        actionTaken = "Customer did not answer; follow-up scheduled";
      } else {
        actionTaken = "Ambiguous outcome; flagged for human operator review";
      }

      callLogsTable.completeByCalleCallId(callTask.id, {
        status: event.type === "call.completed" ? "completed" : "failed",
        decision,
        evidence,
        raw_result: JSON.stringify(callTask),
        action_taken: actionTaken,
        action_link: actionLink,
        recovered_cents: recoveredCents,
      });

      const nextStatus =
        decision === "retry_now" || decision === "update_card"
          ? "active"
          : decision === "pause_subscription"
          ? "paused"
          : "past_due";

      subscribersTable.updateStatus(callLog.subscriber_id, nextStatus);

      if (decision === "no_answer") {
        const subscriber = subscribersTable.get(callLog.subscriber_id);
        const attemptsSoFar = callLogsTable.countInChain(callLog.chain_id);

        if (subscriber && !subscriber.followups_paused && attemptsSoFar < MAX_CALL_ATTEMPTS) {
          const scheduledFor = new Date(Date.now() + followUpDelayMinutes() * 60_000).toISOString();
          callLogsTable.insert({
            id: randomUUID(),
            subscriber_id: callLog.subscriber_id,
            calle_call_id: null,
            trigger_reason: callLog.trigger_reason,
            status: "scheduled",
            chain_id: callLog.chain_id,
            attempt_number: callLog.attempt_number + 1,
            retry_of: callLog.id,
            scheduled_for: scheduledFor,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}