export class CalleClient {
  constructor() {
    this.polls = 0;
    this.calls = { create: this.create.bind(this), get: this.get.bind(this) };
  }

  async create() {
    return { id: "call_late_result" };
  }

  async get() {
    this.polls += 1;
    if (this.polls === 1) {
      return {
        id: "call_late_result",
        status: "failed",
        failureMessage: "Provider status is not finalized yet.",
        recipients: [{ status: "failed", structuredResult: null, attempts: [] }],
      };
    }
    if (this.polls === 2) {
      return {
        id: "call_late_result",
        status: "in_progress",
        recipients: [{ status: "in_progress", structuredResult: null, attempts: [{ status: "dialing" }] }],
      };
    }
    return {
      id: "call_late_result",
      status: "completed",
      recipients: [{
        status: "completed",
        structuredResult: {
          stock_status: "in_stock",
          price_range: "KES 1,200",
          pickup_readiness: "ready_today",
          hours: "Open until 7 PM",
          substitution_available: "Not applicable",
          notes: "Completed after the provider finalized the call.",
          confidence: "high",
        },
        summary: "Medicine is available today.",
        attempts: [{
          status: "completed",
          completedAt: "2026-01-01T00:00:00.000Z",
          transcriptTurns: [{ speaker: "bot", text: "Hello, this is MedRoute." }, { speaker: "user", text: "Yes, we have it." }],
        }],
      }],
    };
  }
}
