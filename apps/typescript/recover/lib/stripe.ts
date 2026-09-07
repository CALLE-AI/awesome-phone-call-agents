import Stripe from "stripe";

// Get a test-mode secret key from https://dashboard.stripe.com/test/apikeys
// TODO(you): set STRIPE_SECRET_KEY in your .env.local (starts with sk_test_...)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
});

// Stripe's well-known test card number that always fails with a generic decline.
// Safe to use in test mode -- no real card, no real money.
// https://docs.stripe.com/testing#declined-payments
export const ALWAYS_DECLINED_TEST_CARD_TOKEN = "tok_chargeDeclined";
