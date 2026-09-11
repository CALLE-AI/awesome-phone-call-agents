import type { ClaimLineConfig } from "../config.js";
import type { PaymentGateway } from "./gateway.js";
import { SimulatedPaymentGateway } from "./simulated.js";
import { StripePaymentGateway } from "./stripe.js";

export type { PaymentGateway, PaymentRequest, PaymentResult } from "./gateway.js";
export { SimulatedPaymentGateway } from "./simulated.js";
export { StripePaymentGateway } from "./stripe.js";

/** Real Stripe when a secret key is configured, else the simulated gateway. */
export function createPaymentGateway(config: ClaimLineConfig): PaymentGateway {
  return config.stripeSecretKey
    ? new StripePaymentGateway(config.stripeSecretKey)
    : new SimulatedPaymentGateway();
}
