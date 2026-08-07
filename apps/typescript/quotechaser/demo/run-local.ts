import { loadQuoteRequest } from "../src/config.js";
import { renderReport } from "../src/format.js";
import { runQuotes } from "../src/runner.js";
import type { CalleCallResult } from "../src/types.js";

const request = loadQuoteRequest("examples/request.example.json");
let index = 0;

const fakeCalls: CalleCallResult[] = [
  {
    status: "completed",
    taskCompleted: true,
    structuredResult: {
      outcome: "quote_received",
      unit_price: 0.84,
      total_price: 420,
      currency: "USD",
      availability: "500 boxes in stock",
      lead_time: "pickup tomorrow after 2 PM",
      minimum_order: "250 boxes",
      callback_required: false
    },
    evidence: ["The vendor quoted 84 cents each and said 500 are in stock."]
  },
  {
    status: "completed",
    taskCompleted: false,
    structuredResult: {
      outcome: "callback_needed",
      unit_price: null,
      total_price: null,
      currency: null,
      availability: "sales desk must check warehouse stock",
      lead_time: "unknown",
      minimum_order: "unknown",
      callback_required: true
    },
    evidence: ["The person who answered said sales would need to call back."]
  }
];

const report = await runQuotes(request, {
  async createAndWait() {
    return fakeCalls[index++] ?? fakeCalls[fakeCalls.length - 1]!;
  }
});

process.stdout.write(`${renderReport(report, request)}\n`);
