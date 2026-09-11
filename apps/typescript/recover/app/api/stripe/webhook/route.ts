import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { subscribersTable, callLogsTable } from "@/lib/db";
import { buildRecoveryCallTask } from "@/lib/calle";
import { maskPhone } from "@/lib/masking";

/**
 * Production-ready Stripe Webhook receiver.
 * Listens for real subscription invoice failures (invoice.payment_failed).
 *
 * Conflict Handling: If an intervention is already active for this subscriber,
 * returns 409 and halts rather than creating a duplicate side effect.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    let event: { type?: string; data?: { object?: Record<string, unknown> } };

    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data?.object;
      const customerEmail = (invoice?.customer_email as string) || null;
      const customerName = (invoice?.customer_name as string) || "Valued Subscriber";
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
          // Default to CALL-E test number; real subscribers will already exist in DB with their registered number.
          phone: "+12763229632",
          region: "US",
          locale: "en-US",
          email: customerEmail || `unknown-${randomUUID().slice(0, 8)}@example.com`,
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

      const rawPreview = buildRecoveryCallTask(subscriber, failureReason);
      const preview = {
        ...rawPreview,
        recipient: {
          ...rawPreview.recipient,
          phone: maskPhone(rawPreview.recipient.phone),
        },
      };

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
