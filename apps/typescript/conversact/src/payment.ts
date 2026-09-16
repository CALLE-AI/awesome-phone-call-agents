import type { CommerceQuote, PaymentHandoff, PaymentPort } from "./types.js";

export class DemoPayment implements PaymentPort {
  private readonly handoffs = new Map<string, PaymentHandoff>();

  async createHandoff(quote: CommerceQuote, sessionId: string): Promise<PaymentHandoff> {
    const existing = this.handoffs.get(sessionId);
    if (existing !== undefined) return existing;
    const handoff = {
      reference: `demo_payment_${sessionId}`,
      status: "demo_ready" as const,
      url: `https://checkout.example.test/conversact/${encodeURIComponent(quote.quoteId)}`,
    };
    this.handoffs.set(sessionId, handoff);
    return handoff;
  }
}
