import { assertCalleSchema } from "./calle-schema-contract.js";

export class CalleClient {
  constructor() {
    this.calls = { create: this.create.bind(this), get: this.get.bind(this) };
    this.call = null;
    this.createAttempts = new Map();
    this.idempotencyKeys = new Map();
  }

  async create({ recipients, task, resultSchema, recipientResultSchema }, options = {}) {
    const recipient = recipients?.[0];
    if (!task.includes("Ask one question at a time") || !task.includes("do not repeat answered questions") || !task.includes("Here is a brief summary of what I heard:") || !task.includes("Is that summary correct?")) {
      throw new Error("Live-call task is missing the required answer-quality workflow");
    }
    if (resultSchema !== undefined) throw new Error("result_schema is not supported.");
    if (!recipient || !recipientResultSchema) {
      throw new Error("Live calls must include a recipient result schema");
    }
    assertCalleSchema(recipientResultSchema);
    if (!/^medroute_[a-f0-9]{64}$/.test(options.idempotencyKey || "")) {
      throw new Error("Live calls must pass a stable provider idempotency key");
    }
    const priorKey = this.idempotencyKeys.get(recipient.phone);
    if (priorKey && priorKey !== options.idempotencyKey) {
      throw new Error("A retry changed its provider idempotency key");
    }
    this.idempotencyKeys.set(recipient.phone, options.idempotencyKey);
    const createAttempt = (this.createAttempts.get(recipient.phone) || 0) + 1;
    this.createAttempts.set(recipient.phone, createAttempt);
    if (recipient.phone.endsWith("005") && createAttempt === 1) {
      throw Object.assign(new Error("The call plan could not be prepared."), { code: "internal_error" });
    }
    if (recipient.phone.endsWith("006")) {
      throw Object.assign(new Error("The call plan could not be prepared."), { code: "internal_error" });
    }
    if (recipient.phone.endsWith("002")) {
      this.call = { error: new Error("Simulated provider failure") };
      return { id: "call_0002" };
    }
    if (recipient.phone.endsWith("003")) {
      this.call = {
        id: `call_${recipient.phone.slice(-4)}`,
        status: "failed",
        failureMessage: "The provider did not finalize a structured result.",
        recipients: [{
          structuredResult: null,
          summary: "Conversation ended before the provider result was finalized.",
          attempts: [{ status: "failed", completedAt: "2026-01-01T00:00:00.000Z", transcriptTurns: [{ speaker: "bot", text: "Hello." }], failureMessage: "Call ended after pickup." }],
        }],
      };
      return { id: this.call.id };
    }
    this.call = {
      id: `call_${recipient.phone.slice(-4)}`,
      status: "completed",
      recipients: [{
        structuredResult: { stock_status: "in_stock", price_range: "KES 2,400", pickup_readiness: "ready_today", hours: "Open until 8 PM", substitution_available: "Not applicable", notes: "Exact medicine available; all core answers confirmed.", confidence: "high" },
        summary: "Available today.",
        attempts: [{ status: "completed", completedAt: "2026-01-01T00:00:00.000Z", transcriptTurns: [{ speaker: "bot", text: "Hello." }] }]
      }]
    };
    const productLine = task.match(/Requested product details: (\{[^\n]+\})\./);
    if (productLine) {
      const product = JSON.parse(productLine[1]);
      if (product.requestedQuantity && (!task.includes(`wants to purchase ${product.requestedQuantity}`) || !task.includes("whether whole packs are required") || !recipientResultSchema.properties.offers.items.properties.availableQuantity || !recipientResultSchema.properties.offers.items.required.includes("purchaseMode"))) {
        throw new Error("Quantity checks must request purchase terms and stock evidence");
      }
      this.call.recipients[0].structuredResult.offers = [{
        medicine: "Amoxicillin", brand: product.brand, strength: `${product.strengthValue} ${product.strengthUnit}`,
        form: product.form, releaseType: product.releaseType, exactMatch: true,
        stock_status: "in_stock", pickup_readiness: "ready_today", price: 600, quantity: 30,
        purchaseMode: "whole_pack", availableQuantity: 180,
        unit: "tablet", currency: "KES", priceType: "exact", quote: "KES 600 for 30 tablets",
      }];
    }
    return { id: this.call.id };
  }

  async get() {
    if (this.call.error) throw this.call.error;
    return this.call;
  }
}
