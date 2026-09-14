// ============================================================================
// MedRoute — Rendering Module
// All DOM rendering: pharmacy form, results, history, analytics, call overlay.
// ============================================================================

import { dom, esc } from "./dom.js";
import { apiFetchAnalytics } from "./api.js";
import { compareOffers, summarizeOffers, quantityUnit } from "./comparison.js";

/**
 * @typedef {Object} Pharmacy
 * @property {string} name
 * @property {string} phone
 * @property {string} distanceKm
 */

/**
 * @typedef {Object} SanitizedResult
 * @property {"in_stock"|"limited"|"out_of_stock"|"unknown"} stock_status
 * @property {string} price_range
 * @property {"ready_today"|"not_confirmed_today"|"unknown"} pickup_readiness
 * @property {string} hours
 * @property {string} substitution_available
 * @property {string} notes
 * @property {"high"|"medium"|"low"} confidence
 */

/**
 * @typedef {Object} CallResult
 * @property {string} pharmacy
 * @property {string} phone
 * @property {number} distanceKm
 * @property {SanitizedResult} result
 * @property {"live"|"demo"} mode
 * @property {string} [error]
 * @property {Array<{speaker: string, text: string, offsetSeconds: number|null}>} [transcript]
 */

/**
 * @typedef {Object} CheckRecord
 * @property {string} id
 * @property {string} createdAt
 * @property {"live"|"demo"} mode
 * @property {string} medicine
 * @property {string} strength
 * @property {CallResult[]} results
 */

// ---------------------------------------------------------------------------
// Call overlay
// ---------------------------------------------------------------------------

/**
 * Show or hide the full-screen live-call or clearly labelled demo-simulation overlay.
 * @param {boolean} active - Whether to show (true) or hide (false) the overlay.
 * @param {Pharmacy[]} [pharmacyList=[]] - Pharmacies being called (for display).
 * @param {string} [medicine=""] - Medicine name being checked (for display).
 * @param {boolean} [simulated=false] - Whether this is a safe visual simulation with no phone call.
 * @returns {void}
 */
export function setLiveCallOverlay(active, pharmacyList = [], medicine = "", simulated = false) {
  if (!active) {
    document.body.classList.remove("call-in-progress");
    dom.callOverlay.hidden = true;
    dom.callOverlay.querySelector("video").pause();
    return;
  }

  const names = pharmacyList.map((p) => p.name).filter(Boolean);
  const destination = names.length === 1 ? names[0] : `${names.length} authorized pharmacies`;
  dom.callOverlay.querySelector("#call-overlay-status").textContent = simulated
    ? "SIMULATED CHECK IN PROGRESS"
    : "CONNECTING TO PHARMACIES";
  dom.callOverlay.querySelector("#call-overlay-title").textContent = simulated
    ? `Simulating checks for ${medicine || "medicine"}`
    : `CALL-E is checking ${medicine || "medicine"}`;
  dom.callOverlay.querySelector("#call-overlay-detail").textContent = simulated
    ? `Preparing illustrative results for ${destination}. No phone calls will be placed.`
    : `Waiting for CALL-E to connect to ${destination}.`;
  dom.callOverlay.querySelector("#call-overlay-note").textContent = simulated
    ? "This animation demonstrates the workflow only. The results are mock data."
    : "Keep this window open. Your ranked pickup results will appear automatically when the call is complete.";
  dom.callOverlay.hidden = false;
  document.body.classList.add("call-in-progress");

  const animation = dom.callOverlay.querySelector("video");
  animation.currentTime = 0;
  animation.play().catch(() => {});
  dom.callOverlay.focus();
}

/** Update the overlay from provider evidence; never reopen a dismissed overlay.
 * @param {{phases: string[]}} progress - Current phase for each requested pharmacy.
 * @returns {void}
 */
export function updateCallProgress(progress) {
  const phases = progress?.phases;
  if (!Array.isArray(phases) || !phases.length) return;
  if (phases.every(phase => ["finalizing", "finished"].includes(phase))) {
    setLiveCallOverlay(false);
    document.querySelector("#calling-status").textContent = "Call activity has ended. Preparing the available results…";
    dom.run.textContent = "Preparing call results…";
  } else {
    const calling = phases.filter(phase => phase === "calling").length;
    dom.callOverlay.querySelector("#call-overlay-status").textContent = calling ? "CALL ACTIVITY IN PROGRESS" : "CONNECTING TO PHARMACIES";
    dom.callOverlay.querySelector("#call-overlay-detail").textContent = calling
      ? `CALL-E is handling ${calling} pharmacy call${calling === 1 ? "" : "s"}.`
      : "Waiting for CALL-E to connect. You can continue in the background.";
  }
}

// ---------------------------------------------------------------------------
// Pharmacy form
// ---------------------------------------------------------------------------

/**
 * Render the pharmacy form rows from the current pharmacy list.
 * Shows an empty state message when no pharmacies are configured.
 * @param {Pharmacy[]} pharmacies - Current pharmacy list.
 * @returns {void}
 */
export function renderPharmacies(pharmacies) {
  if (!pharmacies.length) {
    dom.pharmacies.innerHTML = `<p class="empty-state">No pharmacies added yet.</p>`;
    return;
  }

  dom.pharmacies.innerHTML = pharmacies
    .map(
      (p, i) => `
    <div class="pharmacy">
      <input aria-label="Pharmacy name" placeholder="Pharmacy name" value="${esc(p.name)}">
      <input aria-label="E.164 phone" placeholder="+12025550123" value="${esc(p.phone)}">
      <input aria-label="Distance km" type="number" min="0" step="0.1" placeholder="km" value="${esc(p.distanceKm)}">
      <button aria-label="Remove pharmacy" data-remove="${i}">×</button>
    </div>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Check results
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} Human-readable labels for pickup_readiness values. */
const pickupLabels = {
  can_hold: "ready for pickup today",
  cannot_hold: "not confirmed today",
  ready_today: "ready for pickup today",
  not_confirmed_today: "not confirmed today",
  unknown: "unknown",
};

/**
 * Generate the transcript download button or status message for a result.
 * @param {CheckRecord} record - The parent check record.
 * @param {number} resultIndex - Index of this result in the record's results array.
 * @param {CallResult} result - The call result to check for transcript data.
 * @returns {string} HTML string for the download button or status message.
 */
function transcriptLink(record, resultIndex, result) {
  if (Array.isArray(result.transcript) && result.transcript.length) {
    return `<button type="button" class="transcript-download" data-transcript-url="/api/transcripts/${encodeURIComponent(record.id)}/${resultIndex}.pdf">Download call transcript PDF <span aria-hidden="true">↓</span></button>`;
  }
  return result.mode === "live" ? `<p class="transcript-status">No transcript was returned for this call.</p>` : "";
}

/** Identify a telephone-network response that never reached pharmacy staff.
 * This uses the persisted provider summary, notes and transcript so saved
 * calls from before this display improvement are also labelled correctly.
 * @param {CallResult} result - Provider outcome for one pharmacy.
 * @returns {boolean} Whether the recipient number was unreachable.
 */
function recipientUnreachable(result) {
  const evidence = [result.summary, result.result?.notes, ...(result.transcript || []).map(turn => turn.text)]
    .filter(value => typeof value === "string").join(" ").toLowerCase();
  return /subscriber (?:cannot|could not) be reached|subscriber is unavailable|number (?:cannot|could not) be reached|number is not in service|phone is switched off|automated network message/.test(evidence);
}

/**
 * Render a single pharmacy result card as HTML.
 * @param {CallResult} result - Call result data.
 * @param {number} index - Zero-based rank index.
 * @param {CheckRecord} record - Parent check record (for transcript links).
 * @returns {string} HTML string for the result card.
 */
function resultCard(result, index, record) {
  const r = result.result || {};
  const pickup = pickupLabels[r.pickup_readiness] || String(r.pickup_readiness || "unknown").replaceAll("_", " ");

  if (result.error) {
    const status = /(?:result_schema|recipient_result_schema).*not supported/i.test(result.error) && !result.callId ? "Call setup rejected" : result.callId ? "Call incomplete" : "Call not confirmed";
    return `<article class="call-failure"><h3>${esc(result.pharmacy)}</h3><p>${esc(result.phone)} · ${result.distanceKm == null ? "Distance unknown" : `${esc(result.distanceKm)} km away`}</p><strong>${status}</strong><p>${esc(result.error)}</p><p>No verified availability or price was returned.</p>${result.callId ? `<small>CALL-E reference: ${esc(result.callId)}</small>` : ""}${Array.isArray(result.transcript) && result.transcript.length ? transcriptLink(record, index, result) : ""}</article>`;
  }

  if (recipientUnreachable(result)) {
    return `<article class="call-failure recipient-unreachable"><h3>${esc(result.pharmacy)}</h3><p>${esc(result.phone)} · ${result.distanceKm == null ? "Distance unknown" : `${esc(result.distanceKm)} km away`}</p><strong>Pharmacy number unreachable</strong><p>CALL-E placed the call, but an automated network message answered. No pharmacy staff member confirmed the medicine details.</p><p>Verify the number with the pharmacy and use a different authorized number, or wait for the live-call cooldown before trying the same number again.</p>${result.callId ? `<small>CALL-E reference: ${esc(result.callId)}</small>` : ""}${transcriptLink(record, index, result)}</article>`;
  }

  return `
    <article class="result ${esc(r.stock_status || "unknown")}">
      <div class="rank">${String(index + 1).padStart(2, "0")}</div>
      <div>
        <h3>${esc(result.pharmacy)}</h3>
        <p>${result.distanceKm == null ? "Distance unknown" : `${esc(result.distanceKm)} km away`} · ${esc(result.phone)}</p>
      </div>
      <strong>${esc((r.stock_status || "unavailable").replaceAll("_", " "))}</strong>
      <dl>
        <div><dt>Price</dt><dd>${esc(r.price_range || "Unknown")}</dd></div>
        <div><dt>Pickup today</dt><dd>${esc(pickup)}</dd></div>
        <div><dt>Hours</dt><dd>${esc(r.hours || "Unknown")}</dd></div>
      </dl>
      <p class="note">${esc(r.notes || result.error || "No details returned.")}</p>
      ${transcriptLink(record, index, result)}
    </article>`;
}

/**
 * Show a check record's results in the output section.
 * @param {CheckRecord} record - Check record to display.
 * @param {boolean} [scroll=true] - Whether to smooth-scroll to the results.
 * @param {boolean} [activate=true] - Whether to open the Results view.
 * @returns {void}
 */
export function showResults(record, scroll = true, activate = true) {
  if (activate) selectView("results");
  dom.badge.hidden = false;
  const failures = record.results.filter(r => r.error).length;
  const unreachable = record.results.filter(recipientUnreachable).length;
  dom.badge.textContent = record.mode === "demo" ? "DEMO RESULTS"
    : unreachable === record.results.length && unreachable > 0 ? "NUMBER UNREACHABLE"
    : failures === record.results.length && failures > 0 ? "CALL FAILED"
    : failures || unreachable ? "PARTIAL RESULTS" : "LIVE RESULTS";
  document.querySelector("#results-title").textContent = record.results.length > 1 ? "Care coordinator pickup shortlist" : "Pharmacy call result";
  const controls = document.querySelector("#comparison-controls");
  const structured = record.results.filter(r => !r.error && !recipientUnreachable(r) && Array.isArray(r.result?.offers) && r.result.offers.length);
  controls.hidden = !record.productRequest || structured.length < 2;
  if (record.productRequest && structured.length) {
    const sort = document.querySelector("#compare-sort");
    const brand = document.querySelector("#compare-brand");
    const today = document.querySelector("#compare-today");
    const weight = document.querySelector("#compare-weight");
    const balanceControls = document.querySelector("#balance-controls");
    const budget = document.querySelector("#compare-budget");
    const currency = document.querySelector("#compare-currency");
    const hasQuantity = Boolean(record.productRequest.requestedQuantity);
    document.querySelector("#budget-controls").hidden = !hasQuantity;
    document.querySelector("#compare-total-option").disabled = !hasQuantity;
    const currencies = [...new Set(record.results.flatMap(r => (r.result?.offers || []).map(o => o.currency)).filter(c => /^[A-Z]{3}$/.test(c || "")))];
    currency.innerHTML = '<option value="">Select currency</option>' + currencies.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    currency.value = currencies.length === 1 ? currencies[0] : "";
    budget.value = "";
    const brands = [...new Set(record.results.flatMap(r => (r.result?.offers || []).map(o => o.brand)).filter(Boolean))];
    if (record.productRequest.brand && !brands.includes(record.productRequest.brand)) brands.push(record.productRequest.brand);
    brand.innerHTML = '<option value="">All confirmed brands</option>' + brands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
    brand.value = record.productRequest.brand || "";
    sort.value = "balance";
    weight.value = "50";
    today.checked = false;
    const redraw = () => {
      balanceControls.hidden = sort.value !== "balance";
      const budgetActive = hasQuantity && (budget.value !== "" || budget.validity?.badInput);
      const budgetValue = budget.validity?.badInput ? NaN : Number(budget.value);
      const validBudget = Number.isFinite(budgetValue) && budgetValue >= 0 && Boolean(currency.value);
      document.querySelector("#budget-note").textContent = budgetActive && !validBudget
        ? "Enter a non-negative budget and select its currency to see matching offers."
        : "Only estimated medicine costs in the selected currency are compared. Travel costs and unquoted fees are excluded.";
      renderComparison(record, { sort: sort.value, brand: brand.value, today: today.checked, priceWeight: Number(weight.value), ...(budgetActive ? { budget: budgetValue, budgetCurrency: currency.value } : {}) });
    };
    sort.onchange = brand.onchange = today.onchange = weight.onchange = currency.onchange = redraw;
    budget.oninput = redraw;
    redraw();
  } else {
    dom.results.innerHTML = `<p class="comparison-note">${record.results.length} pharmacy request${record.results.length === 1 ? "" : "s"} · ${esc(new Date(record.createdAt).toLocaleString())}</p>`
      + (failures === record.results.length || unreachable === record.results.length ? "" : '<p class="comparison-note">No comparable product quotes were returned. Review the reported details below.</p>')
      + record.results.map((r, i) => resultCard(r, i, record)).join("");
  }
  if (scroll) dom.output.scrollIntoView({ behavior: "smooth" });
}

/** Render saved offers; changing preferences does not submit another call.
 * @param {Object} record
 * @param {Object} options
 */
export function renderComparison(record, options) {
  const comparison = compareOffers(record, options);
  const table = rows => `<div class="comparison-scroll"><table class="offer-table"><thead><tr><th>Pharmacy / product</th><th>Pack quote</th><th>Unit price</th><th>Distance</th><th>Pickup</th><th>Why shown / evidence</th></tr></thead><tbody>${rows.map(row => {
    const o = row.offer;
    return `<tr id="offer-${row.resultIndex}-${row.offerIndex}" tabindex="-1"><td><b>${esc(row.result.pharmacy)}</b><br>${esc(o.brand || "Brand not confirmed")}<br><small>${esc(o.medicine)} · ${esc(o.strength)} · ${esc(o.form)} · ${esc(o.releaseType)}<br>${esc(o.stock_status.replaceAll("_", " "))}</small></td>
      <td>${o.price == null ? "Price unconfirmed" : `${esc(o.currency || "Currency unknown")} ${esc(o.price)} (${esc(o.priceType)})`}<br>${o.quantity == null ? "Quantity unknown" : `${esc(o.quantity)} ${esc(o.unit)}`}<br><small>${esc(o.quote)}</small></td>
      <td>${row.unitPrice == null ? "Not comparable" : `${esc(o.currency)} ${esc(row.unitPrice.toFixed(2))} / ${esc(o.unit)}`}${record.productRequest?.requestedQuantity ? purchaseEstimate(row) : ""}</td>
      <td>${row.distance == null ? "Unknown" : `${esc(row.distance)} km`}</td>
      <td>${esc(pickupLabels[o.pickup_readiness] || "unknown")}</td>
      <td>${esc(row.reason)}${transcriptLink(record, row.resultIndex, row.result)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
  dom.results.innerHTML = `<p class="comparison-note">${record.mode === "demo" ? "Simulated quotes" : "Check recorded"}: ${esc(new Date(record.createdAt).toLocaleString())}. Availability and prices may change. Compare identical product specifications; brand choice is a preference, not a quality rating.</p>`
    + (record.productRequest?.requestedQuantity ? `<p class="comparison-note">Requested purchase quantity: <b>${esc(record.productRequest.requestedQuantity)} ${esc(quantityUnit(record.productRequest.form) || "units")}</b>. Recommendations require confirmed stock for the full purchase, including any extra units from whole packs. Estimated totals exclude travel costs and unquoted fees.</p>` : "")
    + (new Set(comparison.groups.flatMap(group => group.rows.map(row => row.resultIndex))).size > 1 ? decisionSummary(record, options) : "")
    + (comparison.groups.length ? comparison.groups.map(group => `<section class="comparison-group"><h3>${esc(group.label)}</h3>${table(group.rows)}</section>`).join("") : '<p class="comparison-note">No confirmed offers match these preferences.</p>')
    + (comparison.other.length ? `<section class="comparison-group"><h3>Other results — review before choosing</h3>${comparison.other.some(row => row.offer) ? table(comparison.other.filter(row => row.offer)) : ""}${comparison.other.filter(row => !row.offer).map(row => resultCard(row.result, row.resultIndex, record)).join("")}</section>` : "");
}

/** Show estimated purchase cost separately from confirmed stock evidence.
 * @param {Object} row - Compared offer.
 * @returns {string} Escaped purchase details.
 */
function purchaseEstimate(row) {
  const p = row.purchase, o = row.offer;
  const stock = o.availableQuantity === null ? "Available quantity unconfirmed" : `${esc(o.availableQuantity)} ${esc(o.unit)} confirmed available`;
  if (p.total === null) return `<div class="purchase-estimate"><b>Total unconfirmed</b><small>Confirm exact price, pack size and purchase terms.</small><small>${stock}</small></div>`;
  return `<div class="purchase-estimate"><b>Estimated total: ${esc(o.currency)} ${esc(p.total.toFixed(2))}</b><small>${p.packs === null ? "Individual units permitted" : `${esc(p.packs)} whole pack${p.packs === 1 ? "" : "s"}`} · ${esc(p.purchaseQuantity)} ${esc(o.unit)} to buy · ${esc(p.extraQuantity)} extra</small><small>${stock} · ${p.stock === "sufficient" ? "Enough stock confirmed" : p.stock === "insufficient" ? "Insufficient stock" : "Confirm enough stock"}</small></div>`;
}

/** Render the decision summary using the same eligibility rules as the table.
 * @param {Object} record - Saved check record.
 * @param {Object} options - Current caregiver preferences.
 * @returns {string} Escaped summary markup with links to offer evidence.
 */
function decisionSummary(record, options) {
  const summary = summarizeOffers(record, options);
  const entry = row => `<li><a href="#offer-${row.resultIndex}-${row.offerIndex}">${esc(row.result.pharmacy)} · ${esc(row.offer.brand || "Brand unconfirmed")}</a><span>${row.unitPrice === null ? "Unit price unconfirmed" : `${esc(row.offer.currency)} ${row.unitPrice.toFixed(2)} / ${esc(row.offer.unit)}`} · ${row.distance === null ? "Distance unknown" : `${esc(row.distance)} km`}</span>${record.productRequest?.requestedQuantity ? purchaseEstimate(row) : ""}<small>${esc(row.offer.strength)} · ${esc(row.offer.form)} · ${esc(row.offer.releaseType)} · ${esc(pickupLabels[row.offer.pickup_readiness] || "unknown")}</small></li>`;
  const matches = rows => `<ul>${rows.slice(0, 2).map(entry).join("")}</ul>${rows.length > 2 ? `<details><summary>${rows.length - 2} more matching offers</summary><ul>${rows.slice(2).map(entry).join("")}</ul></details>` : ""}`;
  const groups = (items, kind, empty) => items.length ? items.map(group => `<div class="decision-scope"><p class="decision-label">${esc(group.label)}${group.rows.length > 1 ? ` · ${group.rows.length} tied offers` : ""}</p>${matches(group.rows)}<p class="decision-explanation">${kind === "balance" ? esc(group.rows[0].reason) : kind === "total" ? "Lowest estimated total for the full purchase, with enough stock confirmed." : "Lowest exact unit price among matching available offers in this group."}</p></div>`).join("") : `<p class="decision-empty">${empty}</p>`;
  return `<section class="decision-summary" aria-labelledby="decision-title"><h3 id="decision-title">Your decision summary</h3><p class="decision-intro">Based on your current brand, pickup${record.productRequest?.requestedQuantity ? ", quantity and budget" : ""} preferences. Select a pharmacy below to review its quote. Confirm medicine suitability with your pharmacist.</p><div class="decision-grid">
    <article class="decision-card"><h4>Best balance</h4>${groups(summary.balance, "balance", "No eligible offer has both a comparable price and distance.")}</article>
    ${record.productRequest?.requestedQuantity ? `<article class="decision-card"><h4>Lowest estimated total</h4>${groups(summary.total, "total", "No confirmed purchase meets the current quantity and filters.")}</article>` : `<article class="decision-card"><h4>Lowest confirmed unit price</h4>${groups(summary.price, "price", "No comparable exact prices are available.")}</article>`}
    <article class="decision-card"><h4>Nearest available</h4>${summary.nearest.length ? `<p class="decision-label">${summary.nearest.length > 1 ? `${summary.nearest.length} equally near offers` : "Shortest known distance"}</p>${matches(summary.nearest)}<p class="decision-explanation">Among all matching available offers with a known distance. Check the quote and pickup status.</p>` : '<p class="decision-empty">No matching available offer has a known distance.</p>'}</article>
    ${summary.brandName ? `<article class="decision-card"><h4>Brand preference match</h4><p class="decision-label">${esc(summary.brandName)}</p>${summary.brand.length ? `${matches(summary.brand)}<p class="decision-explanation">Confirmed offers for your selected brand that meet the current product and pickup requirements.</p>` : '<p class="decision-empty">No confirmed available offers meet this brand preference and the current filters.</p>'}</article>` : ""}
    </div></section>`;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Render the saved checks history list.
 * @param {CheckRecord[]} history - History records to render.
 * @returns {void}
 */
export function renderHistoryList(history) {
  dom.historyCount.textContent = `${history.length} saved`;

  if (!history.length) {
    dom.historyList.innerHTML = `<p class="history-empty">Your completed availability checks will appear here after the first run.</p>`;
    return;
  }

  dom.historyList.innerHTML = history
    .map(
      (item) => `
    <button class="history-item" data-history-id="${esc(item.id)}">
      <span>
        <b>${esc(item.medicine)}</b>
        <small>${new Date(item.createdAt).toLocaleString()} · ${esc(item.mode)}</small>
      </span>
      <strong>${item.results.length} call${item.results.length === 1 ? "" : "s"} →</strong>
    </button>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** @type {number} Maximum items to show before collapsing into "See N more". */
const analyticsPreviewLimit = 7;

/**
 * Render a single medicine demand bar row for the analytics chart.
 * @param {{medicine: string, count: number}} item - Medicine and its check count.
 * @param {number} maximum - Maximum count across all medicines (for bar width scaling).
 * @returns {string} HTML string for the bar row.
 */
function medicineDemandRow(item, maximum) {
  const width = Math.max(12, (item.count / maximum) * 100);
  return `<div class="bar-row"><span>${esc(item.medicine)}</span><div><i style="width:${width}%"></i></div><b>${item.count}</b></div>`;
}

/**
 * Generate the transcript download button for a recent activity row.
 * @param {CheckRecord} item - Check record to check for transcripts.
 * @returns {string} HTML string for the PDF button, "View PDFs" button, or empty string.
 */
function recentTranscriptAction(item) {
  const transcripts = (item.results || [])
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => Array.isArray(result.transcript) && result.transcript.length);

  if (transcripts.length === 1) {
    return `<button type="button" class="activity-pdf" data-transcript-url="/api/transcripts/${encodeURIComponent(item.id)}/${transcripts[0].index}.pdf">PDF <span aria-hidden="true">↓</span></button>`;
  }
  if (transcripts.length > 1) {
    return `<button class="activity-view-pdfs" type="button" data-history-id="${esc(item.id)}">View PDFs</button>`;
  }
  return "";
}

/**
 * Render a single recent activity row for the analytics panel.
 * @param {CheckRecord} item - Check record to render.
 * @returns {string} HTML string for the activity row.
 */
function recentActivityRow(item) {
  return `
    <div class="activity">
      <span class="activity-dot ${esc(item.mode)}"></span>
      <div>
        <b>${esc(item.medicine)}</b>
        <small>${new Date(item.createdAt).toLocaleString()}</small>
      </div>
      <em>${item.results.length} call${item.results.length === 1 ? "" : "s"}</em>
      ${recentTranscriptAction(item)}
    </div>`;
}

/**
 * Render a "See N more" collapsible overflow section when items exceed the preview limit.
 * @param {Array<*>} items - Full list of items.
 * @param {string} label - Plural label for the items (e.g. "medicines", "checks").
 * @param {(item: *) => string} renderItem - Function to render a single item as HTML.
 * @returns {string} HTML string for the overflow details element, or empty string if none needed.
 */
function analyticsOverflow(items, label, renderItem) {
  const more = items.slice(analyticsPreviewLimit);
  if (!more.length) return "";
  return `
    <details class="analytics-overflow">
      <summary>See ${more.length} more ${label}<span aria-hidden="true">⌄</span></summary>
      <div class="analytics-overflow-list">${more.map(renderItem).join("")}</div>
    </details>`;
}

/**
 * Fetch and render the full analytics dashboard.
 * @param {string} token - Current access token.
 * @returns {Promise<void>}
 */
export async function renderAnalytics(token) {
  const data = await apiFetchAnalytics(token);
  if (!data) return;

  const maximum = Math.max(...data.topMedicines.map((m) => m.count), 1);
  const medicineRows = data.topMedicines
    .slice(0, analyticsPreviewLimit)
    .map((item) => medicineDemandRow(item, maximum))
    .join("");
  const recentRows = data.recent
    .slice(0, analyticsPreviewLimit)
    .map(recentActivityRow)
    .join("");

  dom.analyticsContent.innerHTML = `
    <div class="metrics">
      <article><small>Saved checks</small><b>${data.totalRuns}</b><span>In this workspace</span></article>
      <article><small>Pharmacies reached</small><b>${data.totalCalls}</b><span>Across all checks</span></article>
      <article><small>In-stock rate</small><b>${data.inStockRate}%</b><span>Reported availability</span></article>
      <article><small>Live runs</small><b>${data.liveRuns}</b><span>CALL-E completed</span></article>
    </div>
    <div class="analytics-grid">
      <section class="chart-card">
        <div><p class="eyebrow">MOST REQUESTED</p><h2>Medicine demand</h2></div>
        ${
          data.topMedicines.length
            ? `${medicineRows}${analyticsOverflow(data.topMedicines, "medicines", (item) => medicineDemandRow(item, maximum))}`
            : `<p class="analytics-empty">No saved checks yet. Complete an availability check to start seeing trends.</p>`
        }
      </section>
      <section class="chart-card">
        <div><p class="eyebrow">RECENT ACTIVITY</p><h2>Latest checks</h2></div>
        ${
          data.recent.length
            ? `${recentRows}${analyticsOverflow(data.recent, "checks", recentActivityRow)}`
            : `<p class="analytics-empty">No activity to show yet.</p>`
        }
      </section>
    </div>`;
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

/**
 * Select a view and update navigation without fetching data.
 * @param {"workspace"|"results"|"analytics"} view - Target view to activate.
 * @returns {void}
 */
function selectView(view) {
  dom.workspace.hidden = view !== "workspace";
  dom.output.hidden = view !== "results";
  dom.analytics.hidden = view !== "analytics";
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
  });
}

/**
 * Switch between workspace, results and analytics views.
 * @param {"workspace"|"results"|"analytics"} view - Target view to activate.
 * @param {string} token - Current access token (for analytics fetch).
 * @returns {Promise<void>}
 */
export async function changeView(view, token) {
  selectView(view);
  if (view === "analytics") await renderAnalytics(token);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// CTA mode (demo vs live)
// ---------------------------------------------------------------------------

/**
 * Update the submit button text and hint text based on the live/demo toggle state.
 * @returns {void}
 */
export function updateCtaMode() {
  const isLive = dom.live.checked;
  document.querySelector("#calling-status").textContent = isLive
    ? "Live calling selected. Starting a check will call your authorized pharmacies."
    : dom.live.disabled
      ? "Demo server: results are simulated. Live calling is unavailable here."
      : "Demo preview selected. Enable live pharmacy calls below to place real calls.";
  if (!dom.run.disabled) {
    dom.run.innerHTML = isLive
      ? "<span>Start pharmacy calls</span><b>→</b>"
      : "<span>Preview pharmacy checks</span><b>→</b>";
  }
  if (dom.hint) {
    dom.hint.textContent = isLive
      ? "Live calling is enabled. Structured inquiries will be placed to authorized numbers."
      : "Demo preview: simulated results only. No phone calls will be placed.";
  }
}
