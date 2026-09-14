import { randomUUID } from "node:crypto";
import type { PaymentGateway, PaymentRequest, PaymentResult } from "./gateway.js";

/**
 * Demo payment gateway: records a "successful" payout without moving any money.
 * This is the default so the app runs with no Stripe credentials.
 */
export class SimulatedPaymentGateway implements PaymentGateway {
  readonly provider = "simulated";

  async charge(req: PaymentRequest): Promise<PaymentResult> {
    return {
      status: "succeeded",
      provider: this.provider,
      reference: `sim_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      message: `Simulated payout of ${req.amount} ${req.currency} succeeded.`,
    };
  }
}
