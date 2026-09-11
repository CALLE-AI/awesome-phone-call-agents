import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { stripe, pickRandomDeclineScenario } from "@/lib/stripe";
import { subscribersTable, callLogsTable } from "@/lib/db";
import { buildRecoveryCallTask } from "@/lib/calle";

/**
 * Demo trigger: attempts a real Stripe test-mode charge using a card token
 * that Stripe guarantees will decline. This produces a genuine Stripe
 * `StripeCardError`, not a fabricated event -- the same shape of failure
 * you'd see from a real subscription renewal.
 *
 * IMPORTANT: this route does NOT place a CALL-E call. It only records the
 * failure and returns a preview of exactly what call would be placed (the
 * task text and recipient). The actual call only happens after an explicit
 * human confirmation via POST /api/calle/place-call -- see that route, and
 * app/api/calle/cancel-call/route.ts for the corresponding cancel path.
 *
 * This "no-call preview, confirm to proceed" pattern follows the safety
 * conventions used throughout this repo's other apps/skills for any workflow
 * that can ring a real person's phone.
 */
export async function POST(req: NextRequest) {
  const { subscriberId } = await req.json();
  const subscriber = subscribersTable.get(subscriberId);

  if (!subscriber) {
    return NextResponse.json({ error: "subscriber not found" }, { status: 404 });
  }

    const scenario = pickRandomDeclineScenario();
  let failureReason: string = scenario.reason;

  try {
    await stripe.charges.create({
      amount: subscriber.amount_cents,
      currency: "usd",
      source: scenario.token,
      description: `Renewal for ${subscriber.plan_name} -- ${subscriber.name} (test-mode simulated failure)`,
    });
    // If we ever get here, Stripe didn't decline -- shouldn't happen with
    // the always-declined test token, but don't silently proceed as if
    // a failure occurred.
    return NextResponse.json(
      { error: "Stripe did not decline the test charge as expected" },
      { status: 500 }
    );
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      failureReason = err.message || failureReason;
    } else {
      throw err;
    }
  }

  const callLogId = randomUUID();
  callLogsTable.insert({
    id: callLogId,
    subscriber_id: subscriber.id,
    calle_call_id: null,
    trigger_reason: failureReason,
    status: "pending_confirmation",
    chain_id: callLogId, // first call in the chain is its own chain root
    attempt_number: 1,
    retry_of: null,
    scheduled_for: null,
  });

  subscribersTable.updateStatus(subscriber.id, "past_due");

  const preview = buildRecoveryCallTask(subscriber, failureReason);

  return NextResponse.json({
    callLogId,
    failureReason,
    preview,
  });
}