import assert from "node:assert/strict";
import test from "node:test";
import { assertQuoteRequest, QuoteRequestError } from "../src/config.js";
import { toVendorQuote } from "../src/runner.js";
import { previewReceipt } from "../src/script.js";
import type { QuoteRequest, Vendor } from "../src/types.js";

const request: QuoteRequest = {
  request_id: "test-run",
  buyer: { business_name: "Test Bakery", contact_name: "Maya Chen" },
  item: { name: "cake boxes", quantity: 500, must_haves: ["food-safe"] },
  vendors: [{ name: "Vendor A", phone: "+14155550100", source: "business website" }],
  max_disclosure: ["business name", "item", "quantity"],
  policy: { locale: "en-US", allow_voicemail: false }
};

const vendor: Vendor = request.vendors[0]!;

test("validates a safe quote request", () => {
  assert.equal(assertQuoteRequest(request).request_id, "test-run");
});

test("refuses non E.164 phone numbers", () => {
  assert.throws(
    () => assertQuoteRequest({ ...request, vendors: [{ ...vendor, phone: "555-0100" }] }),
    QuoteRequestError
  );
});

test("refuses secrets and payment-like details", () => {
  assert.throws(
    () => assertQuoteRequest({ ...request, item: { ...request.item, must_haves: ["use card 4111 1111 1111 1111"] } }),
    QuoteRequestError
  );
});

test("receipt changes when the request changes", () => {
  const first = previewReceipt(request);
  const second = previewReceipt({ ...request, item: { ...request.item, quantity: 600 } });
  assert.notEqual(first, second);
});

test("turns CALL-E structured output into a comparable vendor quote", () => {
  const quote = toVendorQuote(vendor, {
    status: "completed",
    taskCompleted: true,
    structuredResult: {
      outcome: "quote_received",
      unit_price: 1.25,
      total_price: 625,
      currency: "USD",
      availability: "in stock",
      lead_time: "two days",
      minimum_order: "100",
      callback_required: false
    },
    evidence: ["They quoted one dollar and twenty-five cents each."]
  });
  assert.equal(quote.total_price, 625);
  assert.equal(quote.outcome, "quote_received");
  assert.equal(quote.evidence.length, 1);
});
