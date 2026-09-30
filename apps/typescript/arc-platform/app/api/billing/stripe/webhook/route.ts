import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";

/**
 * Stripe is resolved per request, not at module load.
 *
 * This file used to throw at module scope when STRIPE_SECRET_KEY was unset.
 * Next collects every route at build time, so that threw during `npm run
 * build` - the command the README tells a reviewer to run - and the whole
 * build failed on a fresh clone with no Stripe account. A missing payment
 * credential is a reason for THIS ROUTE to refuse, not for the application
 * to fail to compile.
 *
 * Unconfigured now answers 503. Stripe retries a 5xx, so a webhook that
 * arrives while the keys are missing is redelivered once they are set,
 * rather than being swallowed by a 200 or permanently rejected by a 400.
 */
function stripeClient(): { stripe: Stripe; webhookSecret: string } | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return null;
  return { stripe: new Stripe(secretKey), webhookSecret };
}

// Safe mapping (NO direct env inside object keys)
function priceIdToPlan(priceId: string): "STARTER" | "GROWTH" | "ENTERPRISE" | null {
  const map: Record<string, "STARTER" | "GROWTH" | "ENTERPRISE"> = {
    [process.env.STRIPE_STARTER_MONTHLY_PRICE_ID || ""]: "STARTER",
    [process.env.STRIPE_STARTER_ANNUAL_PRICE_ID || ""]: "STARTER",
    [process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID || ""]: "GROWTH",
    [process.env.STRIPE_GROWTH_ANNUAL_PRICE_ID || ""]: "GROWTH",
    [process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID || ""]: "ENTERPRISE",
    [process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID || ""]: "ENTERPRISE",
  };

  return map[priceId] ?? null;
}

export async function POST(req: NextRequest) {
  const configured = stripeClient();
  if (!configured) {
    console.error("Stripe webhook received but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are not set.");
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }
  const { stripe, webhookSecret } = configured;

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    /* Was constructEvent(body, signature, "") - verified against an EMPTY
       secret, which no genuine Stripe signature can ever match, so every real
       webhook was rejected as invalid and this route did nothing at all. It
       failed closed, which is why nothing broke visibly. The real secret is
       required above, so there is no longer a way to reach this line
       without one. */
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        const priceId = sub.items.data[0]?.price.id;
        const plan = priceId ? priceIdToPlan(priceId) : null;

        if (!plan) break;

        const brand = await db.brand.findFirst({
          where: { stripeCustomerId: sub.customer as string },
        });

        if (!brand) break;

        /* current_period_end moved onto the subscription item in Stripe's
           2025 API versions and the SDK's type for this version has it in
           neither place. Narrowed to the two shapes actually read rather than
           cast to any, so a third field cannot be reached by accident. */
        const rawSub = sub as unknown as {
          current_period_end?: number;
          items?: { data?: { current_period_end?: number }[] };
        };
        const periodEnd =
          rawSub.current_period_end ??
          rawSub.items?.data?.[0]?.current_period_end;

        await db.brand.update({
          where: { id: brand.id },
          data: {
            plan,
            planExpiresAt: periodEnd ? new Date(periodEnd * 1000) : null,
          },
        });

        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        const brand = await db.brand.findFirst({
          where: { stripeCustomerId: sub.customer as string },
        });

        if (!brand) break;

        await db.brand.update({
          where: { id: brand.id },
          data: {
            plan: "STARTER",
            planExpiresAt: null,
          },
        });

        break;
      }
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}