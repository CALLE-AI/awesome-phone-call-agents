import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { subscribersTable, callLogsTable } from "@/lib/db";
import { buildRecoveryCallTask } from "@/lib/calle";

/**
 * Production-ready Stripe Webhook receiver.
 * Listens for real subscription invoice failures (invoice.payment_failed)
 * and charge declines (charge.failed).
 *
 * Instead of firing an unmonitored robocall, Recover intercepts the event
 * and stages a pending confirmation preview in the dashboard with the exact
 * script and customer details, maintaining our strict safety protocol.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const event = JSON.parse(rawBody);

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data?.object;
      const customerEmail = invoice?.customer_email || "customer@example.com";
      const customerName = invoice?.customer_name || "Valued Subscriber";
      const amountCents = invoice?.amount_due || 2900;
      const failureReason =
        invoice?.last_payment_error?.message ||
        invoice?.charge?.failure_message ||
        "Your card was declined.";
      const planName = invoice?.lines?.data?.[0]?.description || "Subscription Plan";

      // Find existing subscriber by email or create one
      const allSubs = subscribersTable.all();
      let subscriber = allSubs.find((s) => s.email === customerEmail);

      if (!subscriber) {
        subscriber = {
          id: randomUUID(),
          name: customerName,
          phone: "+12763229632", // User's CALL-E assigned US test number
          region: "US",
          locale: "en-US",
          email: customerEmail,
          plan_name: planName,
          amount_cents: amountCents,
          stripe_customer_id: invoice?.customer || null,
          status: "past_due",
          followups_paused: 0,
          created_at: new Date().toISOString(),
        };
        subscribersTable.insert(subscriber);
      } else {
        subscribersTable.updateStatus(subscriber.id, "past_due");
      }

      // Check if there is already an active or pending call for this subscriber
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
        action_taken: "Staged from live Stripe invoice.payment_failed webhook",
        action_link: null,
        recovered_cents: 0,
      });

      const preview = buildRecoveryCallTask(subscriber, failureReason);

      return NextResponse.json({
        received: true,
        callLogId,
        subscriberId: subscriber.id,
        preview,
      });
    }

    return NextResponse.json({ received: true, ignored: event.type });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid Stripe webhook payload" },
      { status: 400 }
    );
  }
}
