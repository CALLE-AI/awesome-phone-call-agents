export class CalleClient {
  constructor() { this.calls = { createAndWait: this.createAndWait.bind(this) }; }
  async createAndWait({ recipient }) {
    if (recipient.phone.endsWith("002")) throw new Error("Simulated provider failure");
    return {
      id: `call_${recipient.phone.slice(-4)}`,
      recipients: [{
        structuredResult: { stock_status: "in_stock", price_range: "KES 850", pickup_readiness: "unknown", hours: "Open until 8 PM", confidence: "high" },
        summary: "Available today.",
        attempts: [{ transcriptTurns: [{ speaker: "bot", text: "Hello." }] }]
      }]
    };
  }
}
