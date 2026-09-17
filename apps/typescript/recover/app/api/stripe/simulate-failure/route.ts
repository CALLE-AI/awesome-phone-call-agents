import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { stripe, pickRandomDeclineScenario } from "@/lib/stripe";
import { subscribersTable, callLogsTable } from "@/lib/db";
import { buildRecoveryCallTask } from "@/lib/calle";
import { validateApiAuth } from "@/lib/auth";
import { maskPhone } from "@/lib/masking";

/**
 * Demo trigger: attempts a Stripe charge using a card token that declines.
 * 
 * SECURITY & CONFLICT RESOLUTION:
 * 1. Authenticated via `validateApiAuth`.
 * 2. Halts ambiguous duplicates: If an intervention is already pending confirmation
 *    or in progress for this subscriber, halts with 409 Conflict rather than
 *    generating duplicate competing side effects.
 * 3. Returns a safe preview with masked recipient phone.
 */
export async function POST(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  let body: { subscriberId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { subscriberId } = body;
  if (!subscriberId) {
    return NextResponse.json({ error: "subscriberId is required" }, { status: 400 });
  }

  const subscriber = subscribersTable.get(subscriberId);
  if (!subscriber) {
    return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
  }

  // Conflict Resolution: Halt if an active call or preview already exists for this subscriber
  const existingActive = callLogsTable
    .allWithSubscriber()
    .find(
      (c) =>
        c.subscriber_id === subscriber.id &&
        (c.status === "pending_confirmation" || c.status === "in_progress")
    );

  if (existingActive) {
    return NextResponse.json(
      {
        error:
          "Conflict: An active recovery intervention is already pending or in progress for this subscriber. Please reconcile or resolve it before initiating a new one.",
        existingCallId: existingActive.id,
        status: existingActive.status,
      },
      { status: 409 }
    );
  }

  const scenario = pickRandomDeclineScenario();
  let failureReason: string = scenario.reason;

  try {
    await stripe.charges.create({
      amount: subscriber.amount_cents,
      currency: "usd",
      source: scenario.token,
      description: `Renewal for ${subscriber.plan_name} (test-mode simulated decline)`,
    });
    return NextResponse.json(
      { error: "Stripe did not decline the test charge as expected" },
      { status: 500 }
    );
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      failureReason = err.message || failureReason;
    } else if (err && typeof err === "object" && "message" in err) {
      failureReason = String((err as { message: unknown }).message);
    }
  }

  const callLogId = randomUUID();
  callLogsTable.insert({
    id: callLogId,
    subscriber_id: subscriber.id,
    calle_call_id: null,
    trigger_reason: failureReason,
    status: "pending_confirmation",
    chain_id: callLogId,
    attempt_number: 1,
    retry_of: null,
    scheduled_for: null,
  });

  subscribersTable.updateStatus(subscriber.id, "past_due");

  const rawPreview = buildRecoveryCallTask(subscriber, failureReason);
  const preview = {
    ...rawPreview,
    recipient: {
      ...rawPreview.recipient,
      phone: maskPhone(rawPreview.recipient.phone),
    },
  };

  return NextResponse.json({
    callLogId,
    failureReason,
    preview,
  });
}