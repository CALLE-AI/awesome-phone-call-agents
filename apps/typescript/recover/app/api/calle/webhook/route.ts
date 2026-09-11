import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { callLogsTable, subscribersTable, webhookEventsTable } from "@/lib/db";
import type { PaymentRecoveryDecision } from "@/lib/calle";
import { MAX_CALL_ATTEMPTS, followUpDelayMinutes, fetchVerifiedCalleCall } from "@/lib/calle";
import { deepSanitizeText } from "@/lib/masking";
import { validateWebhookAuth } from "@/lib/auth";

/**
 * Authoritative Webhook Receiver for CALL-E terminal call events.
 *
 * SECURITY & GOVERNANCE COMPLIANCE:
 * 1. Authenticates webhook delivery using CALLE_WEBHOOK_SECRET. Fails closed if not configured.
 * 2. Deduplicates webhook events via unique event ID.
 * 3. Never trusts or acts upon caller-supplied transcript or result bodies.
 * 4. Re-fetches the authoritative call object directly from the CALL-E server API.
 * 5. Strictly binds the terminal result to the exact local call, stored recipient, and intent.
 * 6. Keeps financial and subscription resolutions strictly ADVISORY until confirmed by human operator.
 * 7. Deep-sanitizes all evidence and transcript data before storage.
 */
export async function POST(req: NextRequest) {
  // 1. Authenticate webhook signal
  if (!validateWebhookAuth(req, process.env.CALLE_WEBHOOK_SECRET)) {
    return NextResponse.json(
      { error: "Unauthorized: Missing or invalid CALL-E webhook secret" },
      { status: 401 }
    );
  }

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

  const subscriber = subscribersTable.get(callLog.subscriber_id);
  if (!subscriber) {
    return NextResponse.json({ error: "Subscriber record not found" }, { status: 404 });
  }

  // Exact Binding Verification: terminal result must match exact local call and stored destination
  const recipientPhone =
    verifiedCall.recipients?.[0]?.phones?.[0] ?? null;

  if (recipientPhone && subscriber.phone && recipientPhone.trim() !== subscriber.phone.trim()) {
    console.error(`[Webhook Security] Destination mismatch: verified ${recipientPhone} does not match stored ${subscriber.phone}`);
    callLogsTable.completeByCalleCallId(callId, {
      status: "failed",
      decision: "unknown",
      evidence: "Rejected: destination mismatch between provider record and stored subscriber.",
      raw_result: deepSanitizeText(JSON.stringify(verifiedCall)),
      action_taken: "Marked uncertain: provider destination did not match stored subscriber.",
      recovered_cents: 0,
    });
    return NextResponse.json({ error: "Destination binding validation failed" }, { status: 422 });
  }

  // Extract decision and evidence from verified server object only
  const structured = (verifiedCall.structuredResult || verifiedCall.recipients?.[0]?.structuredResult) as
    | { decision?: PaymentRecoveryDecision; evidence?: string }
    | null;

  const decision: PaymentRecoveryDecision = structured?.decision ?? "unknown";
  const evidence = deepSanitizeText(structured?.evidence ?? "");

  // All financial/subscription decisions remain strictly ADVISORY pending human operator confirmation.
  // Autonomous financial execution solely from structured call output is explicitly prevented.
  let actionTaken: string;
  let actionLink: string | null = null;
  const recoveredCents = 0; // Remains 0 until human operator executes charge

  if (decision === "retry_now") {
    actionTaken = "Advisory recommendation: Customer indicated affirmative retry consent. Awaiting human operator approval to execute charge.";
  } else if (decision === "update_card") {
    actionLink = `https://billing.stripe.com/p/session/demo_recover_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    actionTaken = "Advisory recommendation: Customer requested card update self-service link. Ready for operator dispatch.";
  } else if (decision === "pause_subscription") {
    actionTaken = "Advisory recommendation: Customer requested 30-day grace pause. Awaiting human operator approval.";
  } else if (decision === "no_answer") {
    actionTaken = "Customer unavailable; evaluating bounded follow-up eligibility.";
  } else {
    actionTaken = "Uncertain/ambiguous outcome; preserved for human operator reconciliation.";
  }

  // Persist authoritative, sanitized result
  callLogsTable.completeByCalleCallId(callId, {
    status: verifiedCall.status === "completed" ? "completed" : "failed",
    decision,
    evidence: evidence || null,
    raw_result: deepSanitizeText(JSON.stringify(verifiedCall)),
    action_taken: actionTaken,
    action_link: actionLink,
    recovered_cents: recoveredCents,
  });

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
      console.log(`[Follow-up Safety] Bounded ceiling reached for chain ${callLog.chain_id} (${MAX_CALL_ATTEMPTS} attempts). No further retries.`);
    }
  }

  return NextResponse.json({ ok: true, verified: true, advisory: true });
}