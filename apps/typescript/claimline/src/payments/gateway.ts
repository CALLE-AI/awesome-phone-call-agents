/** A payout request for an approved claim. Amount is in major units (e.g. USD). */
export interface PaymentRequest {
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PaymentResult {
  status: "succeeded" | "failed" | "pending";
  /** "stripe" | "simulated" */
  provider: string;
  /** Provider reference (Stripe PaymentIntent id, or a simulated id). */
  reference: string;
  message?: string;
}

/**
 * Payment gateway abstraction, mirroring the CalleGateway pattern: a real Stripe
 * implementation (used only when a Stripe key is configured) and a simulated one
 * that always "succeeds" for demos, so the app never needs real credentials.
 */
export interface PaymentGateway {
  readonly provider: string;
  charge(req: PaymentRequest): Promise<PaymentResult>;
}
