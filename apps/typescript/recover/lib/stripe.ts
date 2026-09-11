import Stripe from "stripe";

// Get a test-mode secret key from https://dashboard.stripe.com/test/apikeys
// TODO(you): set STRIPE_SECRET_KEY in your .env.local (starts with sk_test_...)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
});


// Stripe's well-known test tokens for different decline reasons. Safe to use
// in test mode -- no real card, no real money involved.
// https://docs.stripe.com/testing#declined-payments
export const DECLINE_SCENARIOS = [
  { token: "tok_chargeDeclined", reason: "your card was declined" },
  { token: "tok_visa_chargeDeclinedInsufficientFunds", reason: "your card has insufficient funds" },
  { token: "tok_chargeDeclinedExpiredCard", reason: "your card has expired" },
] as const;

export function pickRandomDeclineScenario() {
  return DECLINE_SCENARIOS[Math.floor(Math.random() * DECLINE_SCENARIOS.length)];
}