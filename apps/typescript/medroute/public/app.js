let pharmacies = loadSavedPharmacies();
let history = [];
const root = document.querySelector("#pharmacies");
const esc = value => String(value ?? "").replace(/[&<>"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[char]);
function loadSavedPharmacies() {
  try {
    const saved = JSON.parse(localStorage.getItem("medroute-authorized-pharmacies") || "[]");
    return Array.isArray(saved) ? saved.slice(0, 5).map(pharmacy => ({ name: String(pharmacy.name || ""), phone: String(pharmacy.phone || ""), distanceKm: String(pharmacy.distanceKm || "") })) : [];
  } catch { return []; }
}
function savePharmacies() { localStorage.setItem("medroute-authorized-pharmacies", JSON.stringify(pharmacies)); }
const callOverlay = document.querySelector("#call-overlay");
function setLiveCallOverlay(active, pharmacyList = [], medicine = "") {
  if (!active) {
    document.body.classList.remove("call-in-progress");
    callOverlay.hidden = true;
    callOverlay.querySelector("video").pause();
    return;
  }
  const pharmacyNames = pharmacyList.map(pharmacy => pharmacy.name).filter(Boolean);
  const destination = pharmacyNames.length === 1 ? pharmacyNames[0] : `${pharmacyNames.length} authorized pharmacies`;
  callOverlay.querySelector("#call-overlay-title").textContent = `CALL-E is checking ${medicine || "medicine"}`;
  callOverlay.querySelector("#call-overlay-detail").textContent = `Speaking with ${destination}. This may take a few minutes.`;
  callOverlay.hidden = false;
  document.body.classList.add("call-in-progress");
  const animation = callOverlay.querySelector("video");
  animation.currentTime = 0;
  animation.play().catch(() => {});
  callOverlay.focus();
}
document.querySelectorAll(".example-value").forEach(input => input.addEventListener("focus", () => { if (input.classList.contains("example-value")) { input.value = ""; input.classList.remove("example-value"); } }, { once: true }));

function renderPharmacies() {
  root.innerHTML = pharmacies.length ? pharmacies.map((p, i) => `<div class="pharmacy"><input aria-label="Pharmacy name" placeholder="Pharmacy name" value="${esc(p.name)}"><input aria-label="E.164 phone" placeholder="+254 700 000 000" value="${esc(p.phone)}"><input aria-label="Distance km" type="number" min="0" step="0.1" placeholder="km" value="${esc(p.distanceKm)}"><button aria-label="Remove pharmacy" data-remove="${i}">×</button></div>`).join("") : `<p class="empty-state">No pharmacies added yet. Add only contacts you are authorized to call.</p>`;
}

function transcriptLink(record, resultIndex, result) {
  if (Array.isArray(result.transcript) && result.transcript.length) return `<a class="transcript-download" href="/api/transcripts/${encodeURIComponent(record.id)}/${resultIndex}.pdf" download>Download call transcript PDF <span aria-hidden="true">↓</span></a>`;
  return result.mode === "live" ? `<p class="transcript-status">No transcript was returned for this call.</p>` : "";
}

function resultCards(record) {
  return record.results.map((x, i) => { const r = x.result || {}; return `<article class="result ${esc(r.stock_status || "unknown")}"><div class="rank">${String(i + 1).padStart(2, "0")}</div><div><h3>${esc(x.pharmacy)}</h3><p>${esc(x.distanceKm)} km away · ${esc(x.phone)}</p></div><strong>${esc((r.stock_status || "unavailable").replaceAll("_", " "))}</strong><dl><div><dt>Price</dt><dd>${esc(r.price_range || "Unknown")}</dd></div><div><dt>Pickup</dt><dd>${esc((r.pickup_readiness || "unknown").replaceAll("_", " "))}</dd></div><div><dt>Hours</dt><dd>${esc(r.hours || "Unknown")}</dd></div></dl><p class="note">${esc(r.notes || x.error || "No details returned.")}</p>${transcriptLink(record, i, x)}</article>`; }).join("");
}

function show(record, scroll = true) {
  const output = document.querySelector("#output");
  output.hidden = false;
  document.querySelector("#badge").textContent = record.mode === "demo" ? "DEMO RESULTS" : "LIVE RESULTS";
  document.querySelector("#results").innerHTML = resultCards(record);
  if (scroll) output.scrollIntoView({ behavior: "smooth" });
}

async function loadHistory() {
  const response = await fetch("/api/history");
  const data = await response.json();
  history = data.history || [];
  document.querySelector("#history-count").textContent = `${history.length} saved`;
  document.querySelector("#history-list").innerHTML = history.length ? history.map(item => `<button class="history-item" data-history-id="${esc(item.id)}"><span><b>${esc(item.medicine)}</b><small>${new Date(item.createdAt).toLocaleString()} · ${esc(item.mode)}</small></span><strong>${item.results.length} call${item.results.length === 1 ? "" : "s"} →</strong></button>`).join("") : `<p class="history-empty">Your completed availability checks will appear here after the first run.</p>`;
}

function recentTranscriptAction(item) {
  const transcripts = (item.results || []).map((result, index) => ({ result, index })).filter(({ result }) => Array.isArray(result.transcript) && result.transcript.length);
  if (transcripts.length === 1) return `<a class="activity-pdf" href="/api/transcripts/${encodeURIComponent(item.id)}/${transcripts[0].index}.pdf" download>PDF <span aria-hidden="true">↓</span></a>`;
  if (transcripts.length > 1) return `<button class="activity-view-pdfs" type="button" data-history-id="${esc(item.id)}">View PDFs</button>`;
  return "";
}

const analyticsPreviewLimit = 7;
function medicineDemandRow(item, maximum) {
  return `<div class="bar-row"><span>${esc(item.medicine)}</span><div><i style="width:${Math.max(12, item.count / maximum * 100)}%"></i></div><b>${item.count}</b></div>`;
}
function recentActivityRow(item) {
  return `<div class="activity"><span class="activity-dot ${esc(item.mode)}"></span><div><b>${esc(item.medicine)}</b><small>${new Date(item.createdAt).toLocaleString()}</small></div><em>${item.results.length} call${item.results.length === 1 ? "" : "s"}</em>${recentTranscriptAction(item)}</div>`;
}
function analyticsOverflow(items, label, renderItem) {
  const more = items.slice(analyticsPreviewLimit);
  return more.length ? `<details class="analytics-overflow"><summary>See ${more.length} more ${label}<span aria-hidden="true">⌄</span></summary><div class="analytics-overflow-list">${more.map(renderItem).join("")}</div></details>` : "";
}

async function loadAnalytics() {
  const response = await fetch("/api/analytics");
  const data = await response.json();
  const maximum = Math.max(...data.topMedicines.map(item => item.count), 1);
  const medicineRows = data.topMedicines.slice(0, analyticsPreviewLimit).map(item => medicineDemandRow(item, maximum)).join("");
  const recentRows = data.recent.slice(0, analyticsPreviewLimit).map(recentActivityRow).join("");
  document.querySelector("#analytics-content").innerHTML = `<div class="metrics"><article><small>Saved checks</small><b>${data.totalRuns}</b><span>On this device</span></article><article><small>Pharmacies reached</small><b>${data.totalCalls}</b><span>Across all checks</span></article><article><small>In-stock rate</small><b>${data.inStockRate}%</b><span>Reported availability</span></article><article><small>Live runs</small><b>${data.liveRuns}</b><span>CALL-E completed</span></article></div><div class="analytics-grid"><section class="chart-card"><div><p class="eyebrow">MOST REQUESTED</p><h2>Medicine demand</h2></div>${data.topMedicines.length ? `${medicineRows}${analyticsOverflow(data.topMedicines, "medicines", item => medicineDemandRow(item, maximum))}` : `<p class="analytics-empty">No saved checks yet. Complete an availability check to start seeing trends.</p>`}</section><section class="chart-card"><div><p class="eyebrow">RECENT ACTIVITY</p><h2>Latest checks</h2></div>${data.recent.length ? `${recentRows}${analyticsOverflow(data.recent, "checks", recentActivityRow)}` : `<p class="analytics-empty">No activity to show yet.</p>`}</section></div>`;
}

root.addEventListener("input", e => { const row = e.target.closest(".pharmacy"); if (!row) return; const i = [...root.children].indexOf(row); const inputs = row.querySelectorAll("input"); pharmacies[i] = { name: inputs[0].value, phone: inputs[1].value, distanceKm: inputs[2].value }; savePharmacies(); });
root.addEventListener("click", e => { if (e.target.dataset.remove !== undefined) { pharmacies.splice(Number(e.target.dataset.remove), 1); savePharmacies(); renderPharmacies(); } });
document.querySelector("#add").onclick = () => { pharmacies.push({ name: "", phone: "", distanceKm: "" }); savePharmacies(); renderPharmacies(); };
document.querySelector("#live").onchange = event => { document.querySelector("#run").innerHTML = event.target.checked ? "<span>Place authorized live checks</span><b>→</b>" : "<span>Preview availability checks</span><b>→</b>"; };
document.querySelector("#run").onclick = async () => {
  const button = document.querySelector("#run"), consent = document.querySelector("#consent");
  if (!consent.checked) return alert("Please confirm authorization before preparing checks.");
  const confirmLive = document.querySelector("#live").checked;
  const medicine = document.querySelector("#medicine").value;
  button.disabled = true; button.textContent = confirmLive ? "Live checks in progress…" : "Preparing checks…";
  const strength = [document.querySelector("#strength-value").value, document.querySelector("#strength-unit").value, document.querySelector("#dosage-form").value].filter(Boolean).join(" ");
  if (confirmLive) setLiveCallOverlay(true, pharmacies, medicine);
  try { const response = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ medicine, strength, pharmacies, confirmLive }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); show(data); await loadHistory(); } catch (e) { alert(e.message); } finally { if (confirmLive) setLiveCallOverlay(false); button.disabled = false; button.innerHTML = confirmLive ? "<span>Place authorized live checks</span><b>→</b>" : "<span>Preview availability checks</span><b>→</b>"; }
};
document.querySelector("#history-list").onclick = event => { const id = event.target.closest("[data-history-id]")?.dataset.historyId; const record = history.find(item => item.id === id); if (record) show(record, true); };
document.querySelector("#analytics-content").onclick = async event => { const id = event.target.closest("[data-history-id]")?.dataset.historyId; if (!id) return; const record = history.find(item => item.id === id); if (!record) return; await changeView("workspace"); show(record, true); };
async function changeView(view) { document.querySelector("#workspace").hidden = view !== "workspace"; document.querySelector("#analytics").hidden = view !== "analytics"; document.querySelectorAll(".nav-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === view)); if (view === "analytics") await loadAnalytics(); window.scrollTo({ top: 0, behavior: "smooth" }); }
document.querySelectorAll(".nav-tab").forEach(button => button.onclick = () => changeView(button.dataset.view));
document.querySelector("#home").onclick = () => changeView("workspace");

renderPharmacies();
loadHistory();
