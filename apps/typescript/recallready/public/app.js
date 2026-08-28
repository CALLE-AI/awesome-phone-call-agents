const $ = (id) => document.getElementById(id);
const state = { recalls: [], selected: null, preview: null };

const panels = ["search", "match", "approve", "result"];
function showPanel(name) {
  panels.forEach((panel, index) => {
    $(`${panel}-panel`).classList.toggle("hidden", panel !== name);
    document.querySelector(`[data-step="${index + 1}"]`).classList.toggle("active", panel === name);
  });
}

function setStatus(id, message = "", error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle("error", error);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function short(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderResults() {
  $("results").innerHTML = state.recalls.map((recall, index) => `
    <button class="result-option" type="button" data-index="${index}">
      <div><h3>${escapeHtml(recall.title)}</h3><p>${escapeHtml(short(recall.hazards[0] || recall.description))}</p></div>
      <span class="date">${escapeHtml(String(recall.date || "").slice(0, 10))}</span>
    </button>
  `).join("");
  document.querySelectorAll(".result-option").forEach((button) => {
    button.addEventListener("click", () => selectRecall(Number(button.dataset.index)));
  });
}

function selectRecall(index) {
  state.selected = state.recalls[index];
  const recall = state.selected;
  $("selected-recall").innerHTML = `
    <h3>${escapeHtml(recall.title)}</h3>
    <p><strong>Hazard:</strong> ${escapeHtml(short(recall.hazards[0] || "Not summarized", 320))}</p>
    <p><strong>Published remedy:</strong> ${escapeHtml(short(recall.remedies[0] || "Contact the recalling firm", 320))}</p>
    <p><strong>Record:</strong> ${escapeHtml(recall.number || recall.id)}</p>
  `;
  $("model-number").value = "";
  $("date-code").value = "";
  showPanel("match");
}

$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("search-status", "Searching the official public record…");
  $("results").innerHTML = "";
  try {
    const payload = await api("/api/recalls/search", {
      method: "POST",
      body: JSON.stringify({ query: $("query").value }),
    });
    state.recalls = payload.recalls;
    setStatus("search-status", `${state.recalls.length} matching recall record${state.recalls.length === 1 ? "" : "s"}. Select one to continue.`);
    renderResults();
  } catch (error) {
    setStatus("search-status", error.message, true);
  }
});

$("change-recall").addEventListener("click", () => showPanel("search"));

$("preview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("preview-status", "Refetching the official record and building a constrained script…");
  try {
    const payload = await api("/api/previews", {
      method: "POST",
      body: JSON.stringify({
        recallId: state.selected.id,
        modelNumber: $("model-number").value,
        dateCode: $("date-code").value,
        demoPhone: $("demo-phone").value,
        demoConsent: $("demo-consent").checked,
      }),
    });
    state.preview = payload.preview;
    const preview = state.preview;
    $("preview-card").innerHTML = `
      <div><div class="meta">Destination</div><div class="value">${escapeHtml(preview.maskedPhone)} · ${escapeHtml(preview.phoneSource.replaceAll("_", " "))}</div></div>
      <div><div class="meta">Item</div><div class="value">${escapeHtml(preview.product)} · ${escapeHtml(preview.modelNumber)}</div></div>
      <div><div class="meta">Goal</div><div class="value">${escapeHtml(preview.callGoal)}</div></div>
      <div><div class="meta">Expires</div><div class="value">${escapeHtml(new Date(preview.expiresAt).toLocaleTimeString())}</div></div>
      <div class="wide"><div class="meta">Hard boundaries</div><ul class="boundary-list">${preview.boundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    `;
    $("run-live").disabled = !preview.liveCallsEnabled;
    $("run-live").title = preview.liveCallsEnabled ? "" : "Live calls are disabled on this deployment";
    $("approval-phrase").value = "";
    setStatus("preview-status");
    showPanel("approve");
  } catch (error) {
    setStatus("preview-status", error.message, true);
  }
});

async function run(mode) {
  setStatus("call-status", mode === "live" ? "CALL‑E is placing the approved call…" : "Running the deterministic no-call path…");
  $("run-mock").disabled = true;
  $("run-live").disabled = true;
  try {
    const payload = await api("/api/calls", {
      method: "POST",
      body: JSON.stringify({
        previewId: state.preview.previewId,
        approvalPhrase: $("approval-phrase").value,
        mode,
      }),
    });
    renderResult(payload.result);
    showPanel("result");
  } catch (error) {
    setStatus("call-status", error.message, true);
    $("run-mock").disabled = false;
    $("run-live").disabled = !state.preview.liveCallsEnabled;
  }
}

$("run-mock").addEventListener("click", () => run("mock"));
$("run-live").addEventListener("click", () => run("live"));

function renderResult(result) {
  $("result-provider").textContent = result.provider === "call-e" ? "LIVE CALL‑E RESULT" : "SAFE MOCK RESULT";
  $("result-card").innerHTML = `
    <div class="hero-result"><div class="meta">Eligibility</div><div class="value">${escapeHtml(result.eligibility.replaceAll("_", " "))}</div></div>
    <div><div class="meta">Remedy</div><div class="value">${escapeHtml(result.remedy.replaceAll("_", " "))}</div></div>
    <div><div class="meta">Confidence</div><div class="value">${Math.round(result.confidence * 100)}%</div></div>
    <div><div class="meta">Required proof</div><div class="value">${escapeHtml(result.requiredProof)}</div></div>
    <div><div class="meta">Deadline</div><div class="value">${escapeHtml(result.deadline || "None stated")}</div></div>
    <div><div class="meta">Human handoff</div><div class="value">${result.needsHuman ? "Required" : "Not required"}</div></div>
    <div class="wide"><div class="meta">Next safe step</div><div class="value">${escapeHtml(result.nextStep)}</div></div>
    <div class="wide"><div class="meta">Grounded evidence</div><ul class="boundary-list">${result.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No evidence returned.</li>"}</ul></div>
  `;
}

$("start-over").addEventListener("click", () => {
  state.selected = null;
  state.preview = null;
  state.recalls = [];
  $("results").innerHTML = "";
  setStatus("search-status");
  showPanel("search");
});

api("/api/health").then((health) => {
  $("mode-label").textContent = health.mode === "live-enabled" ? "CALL‑E live calls enabled" : "Safe mock mode · live calls locked";
}).catch(() => {
  $("mode-label").textContent = "Runtime unavailable";
});
