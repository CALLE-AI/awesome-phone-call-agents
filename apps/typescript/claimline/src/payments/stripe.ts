import type { PaymentGateway, PaymentRequest, PaymentResult } from "./gateway.js";

/**
 * Real Stripe gateway (test mode), used only when STRIPE_SECRET_KEY is set. It
 * creates and confirms a PaymentIntent with Stripe's test card so the demo shows
 * a genuine Stripe object id + status. Calls the REST API directly (no SDK dep).
 */
export class StripePaymentGateway implements PaymentGateway {
  readonly provider = "stripe";

  constructor(private readonly secretKey: string) {}

  async charge(req: PaymentRequest): Promise<PaymentResult> {
    // Stripe amounts are in the smallest currency unit (e.g. cents).
    const minor = Math.round(req.amount * 100);
    const form = new URLSearchParams({
      amount: String(minor),
      currency: req.currency.toLowerCase(),
      payment_method: "pm_card_visa",
      confirm: "true",
      "automatic_payment_methods[enabled]": "true",
      "automatic_payment_methods[allow_redirects]": "never",
    });
    if (req.description) form.set("description", req.description);
    for (const [k, v] of Object.entries(req.metadata ?? {})) {
      form.set(`metadata[${k}]`, v);
    }

    let res: Response;
    try {
      res = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch (err) {
      return {
        status: "failed",
        provider: this.provider,
        reference: "",
        message: `Stripe request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!res.ok || body.error) {
      return {
        status: "failed",
        provider: this.provider,
        reference: body.id ?? "",
        message: body.error?.message ?? `Stripe returned HTTP ${res.status}.`,
      };
    }
    const status = body.status === "succeeded" ? "succeeded" : "pending";
    return {
      status,
      provider: this.provider,
      reference: body.id ?? "",
      message: `Stripe PaymentIntent ${body.id} is ${body.status}.`,
    };
  }
}
