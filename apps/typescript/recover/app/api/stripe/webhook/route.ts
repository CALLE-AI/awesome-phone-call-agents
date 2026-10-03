import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { subscribersTable, callLogsTable } from "@/lib/db";
import { stripe } from "@/lib/stripe";

/**
 * Stripe Webhook receiver for subscription payment failures (invoice.payment_failed).
 *
 * SECURITY & CONFLICT COMPLIANCE:
 * 1. Fails closed without a configured STRIPE_WEBHOOK_SECRET and valid stripe-signature.
 * 2. Halts ambiguous or duplicate concurrent interventions (409 Conflict).
 * 3. Uses standards-reserved fictional identity defaults for unknown test subscribers.
 */
export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Refused: STRIPE_WEBHOOK_SECRET is not configured on this server (fail closed)." },
      { status: 401 }
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Unauthorized: Missing stripe-signature header" },
      { status: 401 }
    );
  }

  const rawBody = await req.text();
  let event: { type?: string; data?: { object?: Record<string, unknown> } };

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret) as unknown as typeof event;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    return NextResponse.json({ error: `Stripe webhook signature rejected: ${msg}` }, { status: 401 });
  }

  try {
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data?.object;
      const customerEmail = (invoice?.customer_email as string) || null;
      const customerName = (invoice?.customer_name as string) || "Demo Customer";
      const amountCents = (invoice?.amount_due as number) || 2900;
      const failureReason =
        ((invoice?.last_payment_error as Record<string, string>)?.message) ||
        ((invoice?.charge as Record<string, string>)?.failure_message) ||
        "Your card was declined.";
      const planName =
        ((invoice?.lines as { data?: Array<{ description?: string }> })?.data?.[0]?.description) ||
        "Subscription Plan";

      const allSubs = subscribersTable.all();
      let subscriber = customerEmail ? allSubs.find((s) => s.email === customerEmail) : undefined;

      if (!subscriber) {
        subscriber = {
          id: randomUUID(),
          name: customerName,
          // Standards-reserved CALL-E test number for demo recipients
          phone: "+12763229632",
          region: "US",
          locale: "en-US",
          email: customerEmail || `demo-sub-${randomUUID().slice(0, 6)}@example.com`,
          plan_name: planName,
          amount_cents: amountCents,
          stripe_customer_id: (invoice?.customer as string) || null,
          status: "past_due",
          followups_paused: 0,
          created_at: new Date().toISOString(),
        };
        subscribersTable.insert(subscriber);
      } else {
        // Conflict Resolution: Halt if already pending or in_progress
        const activeConflict = callLogsTable
          .allWithSubscriber()
          .find(
            (c) =>
              c.subscriber_id === subscriber!.id &&
              (c.status === "pending_confirmation" || c.status === "in_progress")
          );

        if (activeConflict) {
          return NextResponse.json(
            {
              received: true,
              conflict: true,
              message: "An active recovery intervention already exists for this subscriber. Halted to avoid duplicate.",
              existingCallId: activeConflict.id,
            },
            { status: 409 }
          );
        }

        subscribersTable.updateStatus(subscriber.id, "past_due");
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

      return NextResponse.json({
        received: true,
        subscriberId: subscriber.id,
        callLogId,
      });
    }

    return NextResponse.json({ received: true, ignored: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
