import assert from "node:assert/strict";
import test from "node:test";
import { compareOffers, sanitizeOffers, summarizeOffers } from "../public/js/comparison.js";

const productRequest = { strengthValue: "500", strengthUnit: "milligrams", form: "Tablet", releaseType: "standard", brand: "" };
const offer = { medicine: "Example", brand: "Brand A", strength: "500 mg", form: "Tablet", releaseType: "standard", exactMatch: true, stock_status: "in_stock", pickup_readiness: "ready_today", price: 600, quantity: 30, unit: "tablet", currency: "KES", priceType: "exact", quote: "KES 600 for 30 tablets" };
const result = (overrides = {}, distanceKm = 2) => ({ pharmacy: "Pharmacy", distanceKm, result: { offers: [{ ...offer, ...overrides }] } });
const record = results => ({ medicine: "Example", productRequest, results });

test("unit price compares quantities, with stable source indexes and no mutation", () => {
  const source = record([result(), result({ price: 900, quantity: 60 }, 5)]);
  const original = JSON.stringify(source);
  const rows = compareOffers(source).groups[0].rows;
  assert.deepEqual(rows.map(r => r.unitPrice), [15, 20]);
  assert.deepEqual(rows.map(r => r.resultIndex), [1, 0]);
  assert.match(rows[0].reason, /Lowest confirmed/);
  assert.equal(JSON.stringify(source), original);
});

test("nearest sorts unknown distances last and excludes unavailable offers", () => {
  const comparison = compareOffers(record([result({}, null), result({}, 4), result({ stock_status: "out_of_stock" }, 0)]), { sort: "distance" });
  assert.deepEqual(comparison.groups[0].rows.map(r => r.resultIndex), [1, 0]);
  assert.equal(comparison.other.length, 1);
});

test("unconfirmed product, ingredient, strength, form and release are not ranked", () => {
  for (const change of [{ exactMatch: false }, { medicine: "Other" }, { strength: "250 mg" }, { form: "Capsule" }, { releaseType: "modified" }]) {
    const comparison = compareOffers(record([result(change)]));
    assert.equal(comparison.groups.length, 0);
    assert.match(comparison.other[0].reason, /match not confirmed/);
  }
});

test("invalid, approximate and ranged prices do not earn a cheapest recommendation", () => {
  for (const change of [{ price: null }, { price: 0 }, { price: -1 }, { price: Infinity }, { price: "5" }, { quantity: 0 }, { currency: "" }, { unit: "capsule" }, { priceType: "approximate" }, { priceType: "range" }]) {
    const group = compareOffers(record([result(change)])).groups[0];
    assert.equal(group.label, "Price not comparable");
    assert.equal(group.rows[0].unitPrice, null);
    assert.doesNotMatch(group.rows[0].reason, /Lowest/);
  }
});

test("currencies are compared in separate groups", () => {
  const groups = compareOffers(record([result(), result({ currency: "USD" })])).groups;
  assert.deepEqual(groups.map(g => g.label), ["KES / tablet", "USD / tablet"]);
});

test("best balance combines normalized price and distance with the selected preference", () => {
  const source = record([
    result({ price: 300, quantity: 30 }, 10),
    result({ price: 1000, quantity: 50 }, 2),
  ]);
  const priceHeavy = compareOffers(source, { sort: "balance", priceWeight: 75 }).groups[0].rows;
  assert.equal(priceHeavy[0].resultIndex, 0);
  assert.match(priceHeavy[0].reason, /75% price \/ 25% distance/);
  const distanceHeavy = compareOffers(source, { sort: "balance", priceWeight: 25 }).groups[0].rows;
  assert.equal(distanceHeavy[0].resultIndex, 1);
  assert.match(distanceHeavy[0].reason, /25% price \/ 75% distance/);
});

test("best balance does not rank an offer missing price or distance", () => {
  const source = record([result({ price: null }), result({}, null)]);
  const comparison = compareOffers(source, { sort: "balance" });
  assert.equal(comparison.groups.length, 2);
  assert.equal(comparison.groups.every(group => group.rows.every(row => row.balanceScore === null)), true);
  assert.match(comparison.groups[0].rows[0].reason, /not ranked/);
});

test("brand and pickup preferences separate ineligible offers without hiding evidence", () => {
  const comparison = compareOffers(record([result(), result({ brand: "B" }), result({ pickup_readiness: "unknown" })]), { brand: "Brand A", today: true });
  assert.equal(comparison.groups[0].rows.length, 1);
  assert.equal(comparison.other.length, 2);
});

test("multiple offers retain the parent index and legacy records are not inferred", () => {
  const source = record([{ ...result(), result: { offers: [offer, { ...offer, price: 300 }] } }, { result: { price_range: "KES 5" } }]);
  const comparison = compareOffers(source);
  assert.deepEqual(comparison.groups[0].rows.map(r => r.resultIndex), [0, 0]);
  assert.equal(comparison.other[0].resultIndex, 1);
  assert.equal(comparison.other[0].offer, null);
});

test("offer sanitization bounds input and preserves unknown values", () => {
  assert.deepEqual(sanitizeOffers(null), []);
  assert.equal(sanitizeOffers([null, ...Array(5).fill(offer)]).length, 2);
  assert.equal(sanitizeOffers([{ ...offer, price: "20", quantity: -1 }])[0].price, null);
  assert.equal(sanitizeOffers([{ ...offer, unit: "ml", currency: "kes" }])[0].unit, "mL");
  assert.equal(sanitizeOffers([{ ...offer, unit: "ml", currency: "kes" }])[0].currency, "KES");
});

test("decision summary respects weights and is independent of table sorting", () => {
  const source = record([result({ price: 300 }, 10), result({ price: 600 }, 2)]);
  const before = JSON.stringify(source);
  const summary = summarizeOffers(source, { sort: "distance", priceWeight: 75 });
  assert.equal(summary.balance[0].rows[0].resultIndex, 0);
  assert.equal(summary.price[0].rows[0].resultIndex, 0);
  assert.equal(summary.nearest[0].resultIndex, 1);
  assert.deepEqual(summary, summarizeOffers(source, { sort: "price", priceWeight: 75 }));
  assert.equal(summarizeOffers(source, { priceWeight: 25 }).balance[0].rows[0].resultIndex, 1);
  assert.equal(JSON.stringify(source), before);
});

test("decision summary preserves ties and never compares prices across currencies", () => {
  const summary = summarizeOffers(record([result(), result(), result({ currency: "USD", price: 1 }, 3)]));
  assert.deepEqual(summary.price.map(group => group.label), ["KES / tablet", "USD / tablet"]);
  assert.equal(summary.price[0].rows.length, 2);
  assert.equal(summary.balance[0].rows.length, 2);
  assert.equal(summary.nearest.length, 2);
});

test("summary applies brand, pickup and product eligibility to every highlight", () => {
  const source = record([result(), result({ brand: "B", price: 1 }, 0), result({ pickup_readiness: "unknown" }, 0), result({ exactMatch: false }, 0), result({ stock_status: "out_of_stock" }, 0)]);
  const summary = summarizeOffers(source, { brand: "Brand A", today: true });
  assert.equal(summary.brandName, "Brand A");
  for (const rows of [summary.brand, summary.nearest, summary.price[0].rows, summary.balance[0].rows]) {
    assert.deepEqual(rows.map(row => row.resultIndex), [0]);
  }
  const missing = summarizeOffers(source, { brand: "Unavailable brand" });
  assert.deepEqual(missing.brand, []);
  assert.deepEqual(missing.balance, []);
  assert.deepEqual(missing.nearest, []);
});

test("summary keeps unknown price eligible only for distance and handles legacy records", () => {
  const summary = summarizeOffers(record([result({ priceType: "approximate" }, 1), result({}, null)]));
  assert.deepEqual(summary.balance, []);
  assert.equal(summary.nearest[0].resultIndex, 0);
  assert.equal(summary.price[0].rows[0].resultIndex, 1);
  const legacy = summarizeOffers({ results: [{ result: { price_range: "KES 10" } }] });
  assert.deepEqual(legacy, { price: [], balance: [], total: [], nearest: [], brandName: "", brand: [] });
});

const purchaseRecord = (results, requestedQuantity = 45) => ({ ...record(results), productRequest: { ...productRequest, requestedQuantity } });
const packResult = (overrides = {}, distance = 2) => result({ purchaseMode: "whole_pack", availableQuantity: 180, ...overrides }, distance);

test("whole packs use purchase totals, not unit-price winners, for balance and total summaries", () => {
  const source = purchaseRecord([packResult(), packResult({ price: 900, quantity: 60 })], 20);
  const before = JSON.stringify(source);
  const rows = compareOffers(source, { sort: "total" }).groups[0].rows;
  assert.equal(rows[0].resultIndex, 0);
  assert.deepEqual(rows[0].purchase, { total: 600, packs: 1, purchaseQuantity: 30, extraQuantity: 10, stock: "sufficient" });
  const summary = summarizeOffers(source);
  assert.equal(summary.price[0].rows[0].resultIndex, 1);
  assert.equal(summary.total[0].rows[0].resultIndex, 0);
  assert.equal(summary.balance[0].rows[0].resultIndex, 0);
  assert.match(summary.balance[0].rows[0].reason, /estimated purchase total/);
  assert.equal(JSON.stringify(source), before);
});

test("pack rounding and explicitly permitted individual sales produce different totals", () => {
  const rows = compareOffers(purchaseRecord([packResult(), packResult({ purchaseMode: "per_unit" })]), { sort: "total" }).groups[0].rows;
  assert.deepEqual(rows.map(row => row.purchase.total), [900, 1200]);
  assert.deepEqual(rows.map(row => row.purchase.extraQuantity), [0, 15]);
  assert.deepEqual(rows.map(row => row.purchase.packs), [null, 2]);
  assert.equal(compareOffers(purchaseRecord([packResult()], 60)).groups[0].rows[0].purchase.packs, 2);
});

test("stock sufficiency covers the rounded purchase, not just the requested quantity", () => {
  for (const availableQuantity of [null, 0, 45, 59]) {
    const comparison = compareOffers(purchaseRecord([packResult({ availableQuantity })]));
    assert.equal(comparison.groups.length, 0);
    assert.equal(comparison.other[0].purchase.total, 1200);
    assert.equal(comparison.other[0].purchase.stock, availableQuantity === null ? "unknown" : "insufficient");
    assert.equal(summarizeOffers(purchaseRecord([packResult({ availableQuantity })])).nearest.length, 0);
  }
  assert.equal(compareOffers(purchaseRecord([packResult({ availableQuantity: 60 })])).groups.length, 1);
});

test("unconfirmed purchase terms and unusable quotes never invent totals or sufficient stock", () => {
  for (const change of [{ purchaseMode: undefined }, { purchaseMode: "unknown" }, { quantity: null }, { quantity: 2.5 }, { priceType: "range" }, { currency: "" }, { availableQuantity: 1.5 }, { unit: "g" }, { price: Number.MAX_VALUE }]) {
    const comparison = compareOffers(purchaseRecord([packResult(change)]));
    assert.equal(comparison.groups.length, 0, JSON.stringify(change));
    assert.equal(comparison.other[0].purchase.total, null);
  }
  const historical = sanitizeOffers([offer])[0];
  assert.equal(historical.purchaseMode, "unknown");
  assert.equal(historical.availableQuantity, null);
  assert.equal(compareOffers(record([result()])).groups.length, 1);
});

test("budget filters use full totals in one currency, include exact boundary and retain excluded evidence", () => {
  const source = purchaseRecord([packResult(), packResult({ price: 900, quantity: 60 }), packResult({ currency: "USD", price: 1 })]);
  const comparison = compareOffers(source, { budget: 900, budgetCurrency: "KES" });
  assert.deepEqual(comparison.groups[0].rows.map(row => row.resultIndex), [1]);
  assert.match(comparison.other[0].reason, /exceeds/);
  assert.match(comparison.other[1].reason, /currency/);
  assert.equal(summarizeOffers(source, { budget: 899, budgetCurrency: "KES" }).total.length, 0);
  for (const options of [{ budget: 0, budgetCurrency: "KES" }, { budget: -1, budgetCurrency: "KES" }, { budget: NaN, budgetCurrency: "KES" }, { budget: 10000, budgetCurrency: "" }]) {
    assert.equal(compareOffers(source, options).groups.length, 0);
  }
  assert.equal(compareOffers(source).groups.length, 2);
  const fractional = purchaseRecord([packResult({ price: 0.1, quantity: 10 })], 30);
  assert.equal(compareOffers(fractional, { budget: 0.3, budgetCurrency: "KES" }).groups[0].rows[0].purchase.total, 0.3);
});

test("liquid purchases retain decimals and exact pack boundaries", () => {
  const source = purchaseRecord([packResult({ form: "Syrup", unit: "mL", quantity: 0.1, price: 10, availableQuantity: 1 })], 0.3);
  source.productRequest.form = "Syrup";
  const purchase = compareOffers(source).groups[0].rows[0].purchase;
  assert.deepEqual(purchase, { total: 30, packs: 3, purchaseQuantity: 0.3, extraQuantity: 0, stock: "sufficient" });
});
