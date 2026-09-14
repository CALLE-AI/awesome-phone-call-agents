export class CalleClient {
  constructor() {
    this.polls = 0;
    this.calls = { create: async () => ({ id: "call_finalizing" }), get: this.get.bind(this) };
  }
  async get() {
    this.polls++;
    const ready = process.env.MEDROUTE_TEST_NEVER_FINALIZES !== "true" && this.polls > 4;
    return {
      id: "call_finalizing", status: "in_progress",
      recipients: [{
        structuredResult: ready ? { stock_status: "in_stock", price_range: "KES 100", pickup_readiness: "ready_today", notes: "Finalized after hangup" } : null,
        attempts: [{ status: "completed", completedAt: "2026-09-05T10:00:00Z", transcriptTurns: [{ speaker: "user", text: "Goodbye." }] }],
      }],
    };
  }
}
