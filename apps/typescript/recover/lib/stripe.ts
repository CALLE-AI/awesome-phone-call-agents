import Stripe from "stripe";
import { randomUUID } from "crypto";

const rawKey = process.env.STRIPE_SECRET_KEY?.trim();
const hasLiveStripeKey = Boolean(rawKey && (rawKey.startsWith("sk_test_") || rawKey.startsWith("sk_live_")));

export const isStripeOfflineMock = !hasLiveStripeKey;

/**
 * Real Stripe client if a valid test/live key is configured,
 * or an honest offline mock provider for zero-credential demo & testing.
 */
class MockStripeClient {
  charges = {
    create: async (
      params: {
        amount: number;
        currency: string;
        source?: string;
        description?: string;
      },
      options?: { idempotencyKey?: string }
    ) => {
      // Simulate network latency (50ms)
      await new Promise((r) => setTimeout(r, 50));
      return {
        id: `ch_mock_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        amount: params.amount,
        currency: params.currency,
        status: "succeeded",
        paid: true,
        description: params.description,
        idempotency_key: options?.idempotencyKey,
        mock_offline: true,
      };
    },
  };
}

export const stripe = hasLiveStripeKey
  ? new Stripe(rawKey!, {
      apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
    })
  : (new MockStripeClient() as unknown as Stripe);

// Stripe's well-known test tokens for different decline reasons.
export const DECLINE_SCENARIOS = [
  { token: "tok_chargeDeclined", reason: "your card was declined" },
  { token: "tok_visa_chargeDeclinedInsufficientFunds", reason: "your card has insufficient funds" },
  { token: "tok_chargeDeclinedExpiredCard", reason: "your card has expired" },
] as const;

export function pickRandomDeclineScenario() {
  return DECLINE_SCENARIOS[Math.floor(Math.random() * DECLINE_SCENARIOS.length)];
}