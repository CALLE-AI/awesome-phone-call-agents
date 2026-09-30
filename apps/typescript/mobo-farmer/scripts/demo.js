#!/usr/bin/env node
// MoboFarmer dry-run — 3 agents, deterministic fixture, no live CALL-E calls
const fixture = {
  inputSourcing: {
    route: "POST /api/agent/check-stock",
    supplier: "Afgri",
    item: "L33 maize",
    price_per_bag: 485,
    stock_quantity: 120,
    next_delivery_date: "2026-09-20"
  },
  marketLinker: {
    route: "POST /api/agent/status",
    market: "JHB Fresh Produce",
    produce_grade_accepted: "Grade 1",
    price_per_kg: 12.5,
    payment_terms: "EFT 48h"
  },
  waterCoordinator: {
    route: "GET /api/agent/call-history",
    wua: "Vaalharts WUA",
    irrigation_slot: "Mon/Thu 06:00-10:00",
    status: "confirmed"
  }
};
console.log("MoboFarmer dry-run demo — no phone calls");
console.log(JSON.stringify(fixture, null, 2));
console.log("\nLive mode needs {live:true} + human approval. Polling is abortable via /api/agent/status/[id] DELETE.");
