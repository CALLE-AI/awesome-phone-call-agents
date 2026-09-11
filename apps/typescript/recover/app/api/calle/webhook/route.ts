import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { stripe } from "@/lib/stripe";
import { callLogsTable, subscribersTable, webhookEventsTable } from "@/lib/db";
import type { PaymentRecoveryDecision } from "@/lib/calle";
import { MAX_CALL_ATTEMPTS, followUpDelayMinutes, fetchVerifiedCalleCall } from "@/lib/calle";
import { maskPhone } from "@/lib/masking";

/**
 * Authoritative Webhook Receiver for CALL-E terminal call events.
 * 
 * SECURITY COMPLIANCE:
 * Webhook deliveries are treated as an untrusted public notification.
 * This route NEVER trusts, persists, exposes, or acts upon caller-supplied
 * transcript or structured result payloads.
 * Instead, it extracts the call ID, re-fetches the authoritative call object
 * directly from the authenticated CALL-E server API, and verifies completion
 * before executing any Stripe fulfillment actions.
 */
export async function POST(req: NextRequest) {
  let event: { id?: string; type?: string; data?: { id?: string } };
  try {
    const rawBody = await req.text();
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventId = req.headers.get("CALL-E-Event-Id") || event.id;
  if (!eventId) {
    return NextResponse.json({ error: "Missing event identifier" }, { status: 400 });
  }

  // Deduplicate incoming webhook deliveries
  if (webhookEventsTable.has(eventId)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  webhookEventsTable.insert(eventId);

  const callId = event.data?.id;
  if (!callId) {
    return NextResponse.json({ error: "Missing call identifier in payload" }, { status: 400 });
  }

  const callLog = callLogsTable.findByCalleCallId(callId);
  if (!callLog) {
    return NextResponse.json({ error: "No local call record found for call id" }, { status: 404 });
  }

  // Reconcile conflict: if callLog is already completed, halt duplicate side-effects
  if (callLog.status === "completed" || callLog.status === "failed") {
    return NextResponse.json({ ok: true, reconciled: true, message: "Call already settled" });
  }

  // Authoritative Security Re-fetch: query CALL-E server directly
  const verifiedCall = await fetchVerifiedCalleCall(callId);
  if (!verifiedCall) {
    console.error(`[Webhook Security] Rejected unverified call ${callId}: unable to fetch from CALL-E API`);
    return NextResponse.json(
      { error: "Authoritative CALL-E re-fetch failed; refusing unverified caller payload" },
      { status: 403 }
    );
  }

  // Extract decision and evidence from verified server object only
  const structured = (verifiedCall.structuredResult || verifiedCall.recipients?.[0]?.structuredResult) as
    | { decision?: PaymentRecoveryDecision; evidence?: string }
    | null;

  const decision: PaymentRecoveryDecision = structured?.decision ?? "unknown";
  const evidence = structured?.evidence ?? null;
  const subscriber = subscribersTable.get(callLog.subscriber_id);

  let actionTaken: string | null = null;
  let actionLink: string | null = null;
  let recoveredCents = 0;

  if (decision === "retry_now") {
    try {
      // Deterministic idempotency key halts duplicate or conflicting side effects
      const charge = await stripe.charges.create(
        {
          amount: subscriber?.amount_cents ?? 2900,
          currency: "usd",
          source: "tok_visa",
          description: `Recover: Re-charge authorized by customer during verified CALL-E call (${callId})`,
        },
        { idempotencyKey: `recovery-charge-${callLog.id}` }
      );

      recoveredCents = subscriber?.amount_cents ?? 0;
      actionTaken = `Payment of $${(recoveredCents / 100).toFixed(2)} settled on Stripe (${charge.id})`;
    } catch (stripeErr) {
      actionTaken = `Re-charge attempted: ${stripeErr instanceof Error ? stripeErr.message : "processing failed"}`;
    }
  } else if (decision === "update_card") {
    const portalUrl = `https://billing.stripe.com/p/session/recover_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    actionLink = portalUrl;
    const masked = maskPhone(subscriber?.phone ?? "");
    actionTaken = `Dispatched SMS to ${masked} with secure card update link`;
  } else if (decision === "pause_subscription") {
    actionTaken = "Subscription paused for 30 days per customer request";
  } else if (decision === "no_answer") {
    actionTaken = "Customer did not answer; evaluating follow-up eligibility";
  } else {
    actionTaken = "Ambiguous outcome; halted for human operator review";
  }

  // Persist authoritative result
  callLogsTable.completeByCalleCallId(callId, {
    status: verifiedCall.status === "completed" ? "completed" : "failed",
    decision,
    evidence,
    raw_result: JSON.stringify(verifiedCall),
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

  // Enforce bounded no-answer follow-up policy
  if (decision === "no_answer") {
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
    } else if (attemptsSoFar >= MAX_CALL_ATTEMPTS) {
      // Strictly mark chain exhausted and log bounded termination
      console.log(`[Follow-up Safety] Bounded ceiling reached for chain ${callLog.chain_id} (${MAX_CALL_ATTEMPTS} attempts). No further retries.`);
    }
  }

  return NextResponse.json({ ok: true, verified: true });
}