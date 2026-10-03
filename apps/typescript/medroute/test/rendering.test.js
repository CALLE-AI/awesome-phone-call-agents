import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Mock DOM — single shared element cache, used by both document.querySelector
// and each mock element's own querySelector for child lookups.
// ---------------------------------------------------------------------------

const elementCache = new Map();

function createMockEl(id = "div") {
  const el = {
    id,
    hidden: false,
    disabled: false,
    checked: false,
    value: "",
    textContent: "",
    innerHTML: "",
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    _classSet: new Set(),
    classList: {
      add(c) { el._classSet.add(c); },
      remove(c) { el._classSet.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          el._classSet.has(c) ? el._classSet.delete(c) : el._classSet.add(c);
        } else {
          force ? el._classSet.add(c) : el._classSet.delete(c);
        }
      },
      has(c) { return el._classSet.has(c); },
    },
    focus() {},
    play() { return Promise.resolve(); },
    pause() {},
    scrollIntoView() {},
    addEventListener() {},
    onclick: null,
    onchange: null,
    querySelector(sel) {
      const childId = sel.replace("#", "");
      if (!elementCache.has(childId)) {
        elementCache.set(childId, createMockEl(childId));
      }
      return elementCache.get(childId);
    },
  };
  return el;
}

const navTabs = ["workspace", "results", "analytics"].map(view => {
  const tab = createMockEl(`nav-${view}`);
  tab.dataset.view = view;
  return tab;
});

globalThis.document = {
  querySelector(sel) {
    const id = sel.replace("#", "");
    if (!elementCache.has(id)) elementCache.set(id, createMockEl(id));
    return elementCache.get(id);
  },
  querySelectorAll: selector => selector === ".nav-tab" ? navTabs : [],
  createElement: (tag) => createMockEl(tag),
  body: {
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      has(c) { return this._set.has(c); },
    },
  },
};
globalThis.window = { scrollTo() {} };

// ---------------------------------------------------------------------------
// Import module (dom.js evaluates at import time, binding dom.* to elements)
// ---------------------------------------------------------------------------

const {
  setLiveCallOverlay,
  updateCallProgress,
  renderPharmacies,
  showResults,
  renderComparison,
  renderHistoryList,
  updateCtaMode,
  changeView,
} = await import("../public/js/rendering.js");

test("comparison sorting preserves pharmacy transcript references and escapes brands", () => {
  const offer = { medicine: "Example", brand: '<Brand "A">', strength: "500 mg", form: "Tablet", releaseType: "standard", exactMatch: true, stock_status: "in_stock", pickup_readiness: "ready_today", quantity: 30, unit: "tablet", currency: "KES", priceType: "exact", quote: "Confirmed quote" };
  const record = { id: "run_compare", mode: "live", createdAt: "2026-09-05T12:00:00Z", medicine: "Example", productRequest: { strengthValue: "500", strengthUnit: "mg", form: "Tablet", releaseType: "standard" }, results: [
    { pharmacy: "Near", distanceKm: 1, mode: "live", transcript: [{ text: "First" }], result: { offers: [{ ...offer, price: 600 }] } },
    { pharmacy: "Cheap", distanceKm: 5, mode: "live", transcript: [{ text: "Second" }], result: { offers: [{ ...offer, price: 300 }] } },
  ] };
  renderComparison(record, { sort: "price" });
  const priced = elementCache.get("results").innerHTML.split('class="comparison-scroll"')[1];
  assert.ok(priced.indexOf("Cheap") < priced.indexOf("Near"));
  assert.ok(priced.indexOf("/run_compare/1.pdf") < priced.indexOf("/run_compare/0.pdf"));
  assert.match(priced, /&lt;Brand &quot;A&quot;&gt;/);
  renderComparison(record, { sort: "distance" });
  const nearest = elementCache.get("results").innerHTML.split('class="comparison-scroll"')[1];
  assert.ok(nearest.indexOf("Near") < nearest.indexOf("Cheap"));
  assert.ok(nearest.indexOf("/run_compare/0.pdf") < nearest.indexOf("/run_compare/1.pdf"));
});

test("decision cards link to the exact offer, escape content and update with filters", () => {
  const product = { medicine: "Example", brand: '<Brand "A">', strength: "500 mg", form: "Tablet", releaseType: "standard", exactMatch: true, stock_status: "in_stock", pickup_readiness: "ready_today", quantity: 30, unit: "tablet", currency: "KES", priceType: "exact", price: 300 };
  const record = { id: "run_summary", mode: "demo", createdAt: "2026-09-05T12:00:00Z", medicine: "Example", productRequest: { strengthValue: "500", strengthUnit: "mg", form: "Tablet", releaseType: "standard" }, results: [
    { pharmacy: "Pharmacy <One>", distanceKm: 1, result: { offers: [{ ...product, price: 600 }, product] } },
    { pharmacy: "Pharmacy Two", distanceKm: 2, result: { offers: [{ ...product, price: 900 }] } },
  ] };
  renderComparison(record, { brand: product.brand });
  const html = elementCache.get("results").innerHTML;
  assert.match(html, /Your decision summary/);
  assert.match(html, /Brand preference match/);
  assert.match(html, /Pharmacy &lt;One&gt;/);
  assert.match(html, /&lt;Brand &quot;A&quot;&gt;/);
  assert.match(html, /href="#offer-0-1"/);
  assert.match(html, /id="offer-0-1"/);
  renderComparison(record, { brand: "Other brand" });
  const filtered = elementCache.get("results").innerHTML.split('class="comparison-scroll"')[0];
  assert.doesNotMatch(filtered, /href="#offer/);
  assert.match(filtered, /No confirmed offers match these preferences/);
  assert.doesNotMatch(filtered, /Your decision summary/);
});

/**
 * Get a cached mock element by ID.
 * @param {string} id - Element identifier.
 * @returns {Object} Mock DOM element.
 */
function el(id) { return elementCache.get(id); }

test("Results is an independent view and completed checks activate its navigation", async () => {
  await changeView("workspace", "");
  showResults({ id: "nav-result", mode: "demo", medicine: "M", results: [] }, false, false);
  assert.equal(el("workspace").hidden, false);
  assert.equal(el("output").hidden, true);
  await changeView("results", "");
  assert.equal(el("workspace").hidden, true);
  assert.equal(el("output").hidden, false);
  assert.equal(el("analytics").hidden, true);
  assert.equal(navTabs[1].attributes["aria-current"], "page");
  assert.equal(navTabs[0].attributes["aria-current"], undefined);
  await changeView("workspace", "");
  showResults({ id: "completed", mode: "live", medicine: "M", results: [] }, false);
  assert.equal(el("workspace").hidden, true);
  assert.equal(el("output").hidden, false);
  assert.equal(navTabs[1].classList.has("active"), true);
});

test("quantity results show whole-pack totals, budget changes and historical reset", () => {
  const offer = { medicine: "Example", brand: "A", strength: "500 mg", form: "Tablet", releaseType: "standard", exactMatch: true, stock_status: "in_stock", pickup_readiness: "ready_today", quantity: 30, unit: "tablet", currency: "KES", priceType: "exact", price: 600, purchaseMode: "whole_pack", availableQuantity: 180 };
  const record = { id: "purchase", mode: "demo", createdAt: "2026-09-05T12:00:00Z", medicine: "Example", productRequest: { strengthValue: "500", strengthUnit: "mg", form: "Tablet", releaseType: "standard", requestedQuantity: 45 }, results: [{ pharmacy: "Rx", distanceKm: 1, result: { offers: [offer] } }, { pharmacy: "Rx Two", distanceKm: 2, result: { offers: [offer] } }] };
  showResults(record, false);
  assert.equal(el("budget-controls").hidden, false);
  assert.equal(el("compare-currency").value, "KES");
  assert.match(el("results").innerHTML, /Estimated total: KES 1200.00/);
  assert.match(el("results").innerHTML, /2 whole packs · 60 tablet to buy · 15 extra/);
  assert.match(el("results").innerHTML, /Enough stock confirmed/);
  el("compare-budget").value = "1199";
  el("compare-budget").oninput();
  assert.doesNotMatch(el("results").innerHTML.split('class="comparison-scroll"')[0], /href="#offer/);
  assert.match(el("results").innerHTML, /exceeds your budget/);
  el("compare-budget").value = "1200";
  el("compare-budget").oninput();
  assert.match(el("results").innerHTML, /href="#offer-0-0"/);
  el("compare-currency").value = "";
  el("compare-currency").onchange();
  assert.match(el("budget-note").textContent, /select its currency/);
  showResults({ ...record, productRequest: { ...record.productRequest, requestedQuantity: undefined } }, false);
  assert.equal(el("budget-controls").hidden, true);
  assert.equal(el("compare-total-option").disabled, true);
  assert.equal(el("compare-budget").value, "");
  assert.doesNotMatch(el("results").innerHTML, /Estimated total:/);
});

test("one rejected call shows one status card, no empty comparison sections or availability claim", () => {
  showResults({ id: "rejected", mode: "live", createdAt: "2026-09-05T10:48:16Z", medicine: "Example", productRequest: { strengthValue: "500", strengthUnit: "mg", form: "Tablet", releaseType: "standard", requestedQuantity: 3 }, results: [{ pharmacy: "New Horizon Pharmacy", phone: "+254•••••7165", distanceKm: 2, mode: "live", error: "CALL-E could not complete this call: result_schema is not supported." }] }, false);
  const html = el("results").innerHTML;
  assert.equal(el("comparison-controls").hidden, true);
  assert.equal(el("badge").textContent, "CALL FAILED");
  assert.match(html, /Call setup rejected/);
  assert.equal((html.match(/<article/g) || []).length, 1);
  assert.doesNotMatch(html, /<table|Your decision summary|Nearest available|<dl>|unavailable|No transcript/);
});

test("an automated unreachable message is shown as a delivered call that did not reach staff", () => {
  showResults({ id: "unreachable", mode: "live", createdAt: "2026-09-05T11:25:08Z", medicine: "Panadol Extra", results: [{ pharmacy: "Harbor Health Pharmacy", phone: "+254•••••7154", distanceKm: 2.4, callId: "call_provider_reference", mode: "live", summary: "The first call did not connect with the pharmacy.", result: { stock_status: "unknown", price_range: "Unknown", pickup_readiness: "unknown", hours: "Unknown", notes: "Call reached an automated network message stating the mobile subscriber could not be reached.", confidence: "low" }, transcript: [{ speaker: "user", text: "Sorry, the mobile subscriber cannot be reached." }] }] }, false);
  const html = el("results").innerHTML;
  assert.equal(el("badge").textContent, "NUMBER UNREACHABLE");
  assert.equal(el("comparison-controls").hidden, true);
  assert.match(html, /Pharmacy number unreachable/);
  assert.match(html, /CALL-E placed the call/);
  assert.match(html, /call_provider_reference/);
  assert.match(html, /Download call transcript PDF/);
  assert.doesNotMatch(html, /Price<\/dt>|Pickup today<\/dt>|No comparable product quotes/);
});

test("one pharmacy quote is shown once without comparative winners", () => {
  const offer = { medicine: "Example", brand: "A", strength: "500 mg", form: "Tablet", releaseType: "standard", exactMatch: true, stock_status: "in_stock", pickup_readiness: "ready_today", quantity: 30, unit: "tablet", currency: "KES", priceType: "exact", price: 600 };
  showResults({ id: "one", mode: "live", createdAt: "2026-09-05T10:48:16Z", medicine: "Example", productRequest: { strengthValue: "500", strengthUnit: "mg", form: "Tablet", releaseType: "standard" }, results: [{ pharmacy: "One pharmacy", result: { offers: [offer] }, distanceKm: 2 }] }, false);
  assert.equal(el("comparison-controls").hidden, true);
  assert.equal((el("results").innerHTML.match(/One pharmacy/g) || []).length, 1);
  assert.doesNotMatch(el("results").innerHTML, /Your decision summary|decision-card/);
});

// ---------------------------------------------------------------------------
// renderPharmacies
// ---------------------------------------------------------------------------

test("renderPharmacies shows empty state when list is empty", () => {
  el("pharmacies").innerHTML = "old";
  renderPharmacies([]);
  assert.match(el("pharmacies").innerHTML, /No pharmacies added yet/);
});

test("renderPharmacies renders pharmacy rows with correct values", () => {
  renderPharmacies([
    { name: "HealthRx", phone: "+12025550111", distanceKm: "3.5" },
    { name: "CityPharm", phone: "+12025550222", distanceKm: "1.2" },
  ]);
  const html = el("pharmacies").innerHTML;
  assert.match(html, /HealthRx/);
  assert.match(html, /\+12025550111/);
  assert.match(html, /3\.5/);
  assert.match(html, /CityPharm/);
  assert.match(html, /data-remove="0"/);
  assert.match(html, /data-remove="1"/);
});

test("renderPharmacies escapes HTML in pharmacy names", () => {
  renderPharmacies([
    { name: '<script>alert(1)</script>', phone: "+12025550333", distanceKm: "1" },
  ]);
  assert.ok(!el("pharmacies").innerHTML.includes("<script>"));
  assert.match(el("pharmacies").innerHTML, /&lt;script&gt;/);
});

// ---------------------------------------------------------------------------
// showResults
// ---------------------------------------------------------------------------

test("showResults displays demo badge for demo mode", () => {
  showResults({
    id: "run_1", mode: "demo", medicine: "Aspirin", strength: "500mg",
    results: [{
      pharmacy: "TestRx", phone: "+12025550444", distanceKm: 2,
      result: { stock_status: "in_stock", price_range: "$10", pickup_readiness: "ready_today", hours: "9-5", substitution_available: "No", notes: "Available", confidence: "high" },
      mode: "demo",
    }],
  }, false);
  assert.equal(el("badge").textContent, "DEMO RESULTS");
});

test("showResults displays live badge for live mode", () => {
  showResults({
    id: "run_2", mode: "live", medicine: "Ibuprofen", strength: "",
    results: [{
      pharmacy: "LiveRx", phone: "+12025550555", distanceKm: 5,
      result: { stock_status: "limited", price_range: "$15", pickup_readiness: "not_confirmed_today", hours: "10-6", substitution_available: "Ask", notes: "Limited", confidence: "medium" },
      mode: "live",
    }],
  }, false);
  assert.equal(el("badge").textContent, "LIVE RESULTS");
});

test("showResults renders result cards with stock status", () => {
  showResults({
    id: "run_3", mode: "demo", medicine: "Test", strength: "",
    results: [
      { pharmacy: "A", phone: "+1", distanceKm: 1, result: { stock_status: "in_stock", price_range: "$5", pickup_readiness: "ready_today", hours: "9-5", notes: "", confidence: "high" }, mode: "demo" },
      { pharmacy: "B", phone: "+2", distanceKm: 2, result: { stock_status: "out_of_stock", price_range: "N/A", pickup_readiness: "unknown", hours: "Closed", notes: "Out", confidence: "low" }, mode: "demo" },
    ],
  }, false);
  const html = el("results").innerHTML;
  assert.match(html, /in.stock/);
  assert.match(html, /out.of.stock/);
  assert.match(html, /A/);
  assert.match(html, /B/);
});

test("showResults renders error result when call failed", () => {
  showResults({
    id: "run_err", mode: "live", medicine: "X", strength: "",
    results: [
      { pharmacy: "FailRx", phone: "+1", distanceKm: 1, error: "Call could not be completed.", mode: "live" },
    ],
  }, false);
  const html = el("results").innerHTML;
  assert.match(html, /FailRx/);
  assert.match(html, /Call could not be completed/);
});

test("showResults renders transcript download link when transcript exists", () => {
  showResults({
    id: "run_tx", mode: "live", medicine: "Y", strength: "",
    results: [{
      pharmacy: "TxRx", phone: "+1", distanceKm: 1,
      result: { stock_status: "in_stock", price_range: "$10", pickup_readiness: "ready_today", hours: "9-5", notes: "", confidence: "high" },
      mode: "live",
      transcript: [{ speaker: "bot", text: "Hello." }],
    }],
  }, false);
  const html = el("results").innerHTML;
  assert.match(html, /transcript-download/);
  assert.match(html, /data-transcript-url="\/api\/transcripts\/run_tx\/0\.pdf"/);
});

test("showResults shows 'no transcript' for live calls without transcript", () => {
  showResults({
    id: "run_notx", mode: "live", medicine: "Z", strength: "",
    results: [
      { pharmacy: "NoTxRx", phone: "+1", distanceKm: 1, result: { stock_status: "unknown", price_range: "?", pickup_readiness: "unknown", hours: "?", notes: "", confidence: "low" }, mode: "live" },
    ],
  }, false);
  assert.match(el("results").innerHTML, /No transcript was returned/);
});

test("showResults unhides the output element", () => {
  el("output").hidden = true;
  showResults({ id: "run_show", mode: "demo", medicine: "M", strength: "", results: [] }, false);
  assert.equal(el("output").hidden, false);
});

// ---------------------------------------------------------------------------
// renderHistoryList
// ---------------------------------------------------------------------------

test("renderHistoryList shows count and empty state", () => {
  renderHistoryList([]);
  assert.equal(el("history-count").textContent, "0 saved");
  assert.match(el("history-list").innerHTML, /completed availability checks will appear here/);
});

test("renderHistoryList renders history items with medicine names", () => {
  renderHistoryList([
    { id: "run_a", createdAt: "2026-07-25T10:00:00Z", mode: "demo", medicine: "Amoxicillin", strength: "500mg", results: [{}, {}] },
    { id: "run_b", createdAt: "2026-07-26T12:00:00Z", mode: "live", medicine: "Ibuprofen", strength: "", results: [{}] },
  ]);
  assert.equal(el("history-count").textContent, "2 saved");
  const html = el("history-list").innerHTML;
  assert.match(html, /Amoxicillin/);
  assert.match(html, /Ibuprofen/);
  assert.match(html, /2 calls/);
  assert.match(html, /1 call/);
  assert.match(html, /data-history-id="run_a"/);
  assert.match(html, /data-history-id="run_b"/);
});

// ---------------------------------------------------------------------------
// updateCtaMode
// ---------------------------------------------------------------------------

test("updateCtaMode shows demo text when live is unchecked", () => {
  el("live").checked = false;
  el("run").disabled = false;
  updateCtaMode();
  assert.match(el("run").innerHTML, /Preview pharmacy checks/);
  assert.match(el("hint").textContent, /simulated results only/);
});

test("updateCtaMode shows live text when live is checked", () => {
  el("live").checked = true;
  el("run").disabled = false;
  updateCtaMode();
  assert.match(el("run").innerHTML, /Start pharmacy calls/);
  assert.match(el("hint").textContent, /Live calling is enabled/);
});

test("updateCtaMode does not change button text when button is disabled", () => {
  el("run").innerHTML = "Custom text";
  el("run").disabled = true;
  el("live").checked = true;
  updateCtaMode();
  assert.equal(el("run").innerHTML, "Custom text");
  assert.match(el("hint").textContent, /Live calling is enabled/);
});

// ---------------------------------------------------------------------------
// setLiveCallOverlay
// ---------------------------------------------------------------------------

test("setLiveCallOverlay(true) shows overlay and adds body class", () => {
  el("call-overlay").hidden = true;
  setLiveCallOverlay(true, [{ name: "TestRx" }], "Aspirin");
  assert.equal(el("call-overlay").hidden, false);
  assert.ok(document.body.classList.has("call-in-progress"));
});

test("setLiveCallOverlay(true) writes title and detail text", () => {
  setLiveCallOverlay(true, [{ name: "A" }, { name: "B" }, { name: "C" }], "Ibuprofen");
  assert.match(el("call-overlay-title").textContent, /Ibuprofen/);
  assert.match(el("call-overlay-detail").textContent, /3 authorized pharmacies/);
});

test("setLiveCallOverlay labels a demo animation as simulated", () => {
  setLiveCallOverlay(true, [{ name: "DemoRx" }], "Ibuprofen", true);
  assert.match(el("call-overlay-status").textContent, /SIMULATED/);
  assert.match(el("call-overlay-title").textContent, /Simulating checks/);
  assert.match(el("call-overlay-detail").textContent, /No phone calls/);
  assert.match(el("call-overlay-note").textContent, /mock data/);
});

test("setLiveCallOverlay(false) hides overlay and removes body class", () => {
  document.body.classList.add("call-in-progress");
  el("call-overlay").hidden = false;
  setLiveCallOverlay(false);
  assert.equal(el("call-overlay").hidden, true);
  assert.ok(!document.body.classList.has("call-in-progress"));
});

test("the animation closes after every call ends, before results finish processing", () => {
  setLiveCallOverlay(true, [{ name: "A" }, { name: "B" }], "Example");
  updateCallProgress({ phases: ["finalizing", "calling"] });
  assert.equal(el("call-overlay").hidden, false);
  updateCallProgress({ phases: ["finalizing", "finished"] });
  assert.equal(el("call-overlay").hidden, true);
  assert.equal(document.body.classList.has("call-in-progress"), false);
  assert.match(el("calling-status").textContent, /Preparing/);
  updateCallProgress({ phases: ["calling"] });
  assert.equal(el("call-overlay").hidden, true, "A dismissed overlay must never be reopened by a stale progress update");
});

test("setLiveCallOverlay(true) defaults medicine to 'medicine' when empty", () => {
  setLiveCallOverlay(true, [{ name: "Rx" }], "");
  assert.match(el("call-overlay-title").textContent, /checking medicine/);
});
