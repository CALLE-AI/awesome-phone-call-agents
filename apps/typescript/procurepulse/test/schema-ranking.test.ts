import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeQuote, completeness, rankQuotes, type RankedQuote } from "../src/ranking.ts";
import { holdResultSchema, quoteResultSchema, validateHoldResult, validateQuoteResult, type QuoteResult } from "../src/schema.ts";

const exact: QuoteResult = {
  reached: "yes", item_match: "exact", available_quantity: "20", unit: "kg", unit_price: "14.50", currency: "USD",
  extra_fees: "0", fulfillment_method: "pickup", ready_at: "2026-09-11T18:15:00-07:00",
  quote_expires_at: "2026-09-11T20:00:00-07:00", contact_name: "Sam", conditions: "None stated", certainty: "high",
};
const ranked = (vendorId: string, vendorName: string, quote: QuoteResult): RankedQuote => ({
  vendorId, vendorName, quote, completeness: completeness(quote), ...analyzeQuote(quote, "20 kg"),
});

describe("result schemas", () => {
  it("are closed objects that require every declared field", () => {
    for (const schema of [quoteResultSchema, holdResultSchema]) {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    }
  });
  it("avoid CALL-E reserved recipient field names", () => {
    for (const field of ["summary", "status", "transcript", "call_id"]) {
      assert.ok(!(field in quoteResultSchema.properties));
      assert.ok(!(field in holdResultSchema.properties));
    }
  });
  it("describe every field so extraction has selection rules", () => {
    for (const p of Object.values(quoteResultSchema.properties)) assert.ok(p.description.length > 10);
  });
  it("rejects unexpected fields, non-strings and unknown enum values", () => {
    assert.throws(() => validateQuoteResult({ ...exact, invented: "x" }), /unexpected/);
    assert.throws(() => validateQuoteResult({ ...exact, unit_price: 14.5 }), /must be a string/);
    assert.throws(() => validateQuoteResult({ ...exact, certainty: "sure" }), /enum/);
    assert.throws(() => validateQuoteResult(null), /not an object/);
    assert.deepEqual(validateQuoteResult(exact), exact);
    assert.equal(validateHoldResult({ reached: "yes", hold_placed: "yes", hold_expires_at: "", contact_name: "Sam", notes: "" }).hold_placed, "yes");
  });
});

describe("unit-aware ranking", () => {
  it("computes a comparable total only for firm, unit-compatible quotes", () => {
    const a = analyzeQuote(exact, "20 kg");
    assert.equal(a.status, "eligible");
    assert.equal(a.comparableTotal, 290);
    assert.equal(analyzeQuote({ ...exact, unit_price: "13.75", extra_fees: "35" }, "20 kg").comparableTotal, 310);
  });
  it("sends ambiguity to needs review instead of guessing", () => {
    const vague = analyzeQuote({ ...exact, unit: "case", available_quantity: "5", unit_price: "", extra_fees: "", conditions: "Around $40 a case; depends on the market", certainty: "low" }, "20 kg");
    assert.equal(vague.status, "needs_review");
    assert.equal(vague.comparableTotal, null);
    assert.equal(vague.warnings.length, 5);
  });
  it("matches hedges as whole words only", () => {
    assert.equal(analyzeQuote({ ...exact, conditions: "Verified in the cooler; tax included." }, "20 kg").status, "eligible");
    assert.ok(analyzeQuote({ ...exact, conditions: "Price may change." }, "20 kg").warnings.includes("Price or fulfillment is conditional."));
  });
  it("excludes suppliers that were not reached or cannot supply", () => {
    assert.equal(analyzeQuote({ ...exact, reached: "no" }, "20 kg").status, "excluded");
    assert.equal(analyzeQuote({ ...exact, item_match: "unavailable" }, "20 kg").status, "excluded");
  });
  it("ranks cheapest and earliest separately, with a deterministic tie-break", () => {
    const later = ranked("rv", "Riverside", exact);
    const sooner = ranked("ns", "Northstar", { ...exact, unit_price: "13.75", extra_fees: "35", ready_at: "2026-09-11T17:00:00-07:00" });
    assert.deepEqual(rankQuotes([later, sooner]), { cheapest: "rv", earliest: "ns" });
    assert.equal(rankQuotes([ranked("z", "Zulu", exact), ranked("a", "Alpha", exact)]).cheapest, "a");
  });
  it("keeps completeness separate from certainty", () => {
    assert.equal(completeness(exact), 100);
    assert.equal(completeness({ ...exact, unit_price: "", fulfillment_method: "unknown" }), 85);
  });
});
