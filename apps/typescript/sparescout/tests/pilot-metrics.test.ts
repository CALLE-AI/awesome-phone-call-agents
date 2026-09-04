import assert from "node:assert/strict";
import test from "node:test";
import { calculatePilotMetrics } from "../lib/pilot-metrics.ts";

const completeQuote = (price: number) => JSON.stringify({
  part_found: true,
  compatibility: "confirmed",
  brand: "SKF",
  condition: "new",
  price_amount: price,
  currency: "KES",
  available_quantity: 1,
  delivery_available: "yes",
  delivery_eta: "today",
  reservation_possible: "yes",
  evidence: ["Supplier confirmed fitment."],
  notes: "",
});

test("publishes no performance values before a live pilot", () => {
  const metrics = calculatePilotMetrics([], [], [], 12, new Date("2026-08-17T12:00:00.000Z"));
  assert.equal(metrics.liveRequests, 0);
  assert.equal(metrics.contactRate, null);
  assert.equal(metrics.quoteCompleteness, null);
  assert.equal(metrics.medianSourcingMinutes, null);
  assert.equal(metrics.fixtureRunsExcluded, 12);
});

test("calculates pilot evidence from live records while retaining failures", () => {
  const metrics = calculatePilotMetrics(
    [
      { requestId: "request-1", status: "completed", requestCreatedAt: "2026-08-17T10:00:00.000Z", runCreatedAt: "2026-08-17T10:01:00.000Z", completedAt: "2026-08-17T10:10:00.000Z" },
      { requestId: "request-2", status: "failed", requestCreatedAt: "2026-08-17T11:00:00.000Z", runCreatedAt: "2026-08-17T11:01:00.000Z", completedAt: "2026-08-17T11:04:00.000Z" },
    ],
    [
      { requestId: "request-1", supplierId: "a" },
      { requestId: "request-1", supplierId: "b" },
      { requestId: "request-2", supplierId: "c" },
      { requestId: "request-2", supplierId: "d" },
    ],
    [
      { requestId: "request-1", supplierId: "a", status: "completed", resultJson: completeQuote(100) },
      { requestId: "request-1", supplierId: "b", status: "completed", resultJson: completeQuote(120) },
      { requestId: "request-2", supplierId: "c", status: "failed", resultJson: null },
    ],
    9,
    new Date("2026-08-17T12:00:00.000Z"),
  );

  assert.equal(metrics.liveRequests, 2);
  assert.equal(metrics.completedRequests, 1);
  assert.equal(metrics.contactRate, 50);
  assert.equal(metrics.quoteCompleteness, 100);
  assert.equal(metrics.medianSourcingMinutes, 10);
  assert.equal(metrics.compatibleOptions, 2);
  assert.equal(metrics.averagePriceSpread, 20);
  assert.equal(metrics.humanInterventionRate, 50);
  assert.equal(metrics.fixtureRunsExcluded, 9);
});
