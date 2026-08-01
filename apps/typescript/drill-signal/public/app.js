const state = {
  drillId: null,
  drill: null,
  pollTimer: null,
  authRequired: false,
  authHealthKnown: false,
  fakeServerReady: true,
};

const panels = ["create", "preview", "control", "report"];
const stepButtons = document.querySelectorAll(".step");

const SCORE_LABELS = {
  contactability: "Contactability",
  acknowledgement: "Acknowledgement",
  roleCoverage: "Role coverage",
  escalationCorrectness: "Escalation correctness",
  followUpNeeds: "Follow-up needs",
};

const TOKEN_KEY = "drill-signal-operator-token";

function showStep(step) {
  panels.forEach((name) => {
    document.getElementById(`panel-${name}`).classList.toggle("active", name === step);
  });
  stepButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.step === step));
  if (step === "preview" && state.drill) {
    syncLiveAckUI(state.drill.mode);
  }
}

stepButtons.forEach((btn) => btn.addEventListener("click", () => showStep(btn.dataset.step)));

function authHeaders() {
  const headers = { "content-type": "application/json" };
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: authHeaders(),
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload;
}

function syncLiveAckUI(mode) {
  const liveWrap = document.getElementById("live-ack-wrap");
  const liveInput = liveWrap.querySelector('input[name="liveSideEffectAcknowledged"]');
  const isLive = mode === "live";
  liveWrap.hidden = !isLive;
  liveInput.required = isLive;
  if (!isLive) {
    liveInput.checked = false;
  }
}

function renderPreview(plan, drill) {
  document.getElementById("preview-plan").innerHTML = `<ul>${plan.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
  syncLiveAckUI(drill.mode);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderStatus(drill) {
  document.getElementById("mode-pill").textContent = `Mode: ${drill.mode}`;
  syncLiveAckUI(drill.mode);
  document.getElementById("status-board").innerHTML = `
    <div class="metric"><span>Status</span><strong>${escapeHtml(drill.status)}</strong></div>
    <div class="metric"><span>Calls placed</span><strong>${drill.callsPlaced} / ${drill.maxCalls}</strong></div>
    <div class="metric"><span>Primary</span><strong>${escapeHtml(drill.primary.phoneMasked)}</strong></div>
    <div class="metric"><span>Backup</span><strong>${drill.backup ? escapeHtml(drill.backup.phoneMasked) : "—"}</strong></div>
  `;
  document.getElementById("event-log").innerHTML = drill.events
    .slice()
    .reverse()
    .map((evt) => `<div class="evt ${evt.level}">[${evt.at}] ${escapeHtml(evt.message)}${evt.detail ? ` — ${escapeHtml(evt.detail)}` : ""}</div>`)
    .join("");
  document.getElementById("cancel-boundary").textContent = drill.cancelBoundary ?? "";
  const terminal = ["completed", "failed", "cancelled", "ambiguous"].includes(drill.status);
  document.getElementById("launch-btn").disabled = terminal || drill.status !== "armed";
  document.getElementById("cancel-btn").disabled = terminal;
  const fakeErr = document.getElementById("fake-server-error");
  if (drill.mode === "fake-server" && !state.fakeServerReady) {
    fakeErr.textContent =
      "Fake-server mode requires CALLE_BASE_URL on the server or an embedded fake provider. Configure the server before launch.";
  } else {
    fakeErr.textContent = "";
  }
  if (drill.report) renderReport(drill.report);
  if (terminal) {
    stopPoll();
    showStep("report");
  }
}

function renderReport(report) {
  const scores = report.scores;
  const scoreHtml = Object.entries(scores)
    .map(([key, value]) => {
      const label = SCORE_LABELS[key] ?? key;
      return `<div class="score-card"><h3>${escapeHtml(label)}</h3><strong>${value}</strong><div class="bar"><i style="width:${value}%"></i></div></div>`;
    })
    .join("");
  document.getElementById("report-content").innerHTML = `
    <p>${escapeHtml(report.summary)}</p>
    <div class="report-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;">${scoreHtml}</div>
    <h3>Recommendations</h3>
    <ul>${report.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    <h3>Evidence excerpts</h3>
    <ul>${report.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("") || "<li>No excerpts recorded.</li>"}</ul>
    <h3>Attempts</h3>
    <ul>${report.attempts.map((a) => `<li>${escapeHtml(a.role)}: ${escapeHtml(a.outcome)} (${escapeHtml(a.phoneMasked)})</li>`).join("") || "<li>No attempts.</li>"}</ul>
  `;
}

async function loadPresets() {
  const { presets } = await api("/api/presets");
  const select = document.getElementById("simulation-preset");
  select.innerHTML = presets.map((p) => `<option value="${p}">${p}</option>`).join("");
}

function renderOperatorAuthUI() {
  const wrap = document.getElementById("operator-token-wrap");
  const status = document.getElementById("auth-health-status");
  const authWrap = document.getElementById("operator-auth-wrap");
  const showToken = state.authRequired || !state.authHealthKnown;
  wrap.hidden = !showToken;
  authWrap.hidden = !showToken;
  if (!state.authHealthKnown) {
    status.textContent = "Could not verify auth requirements; token may be needed.";
    status.hidden = false;
  } else {
    status.textContent = "";
    status.hidden = true;
  }
  const input = document.getElementById("operator-token");
  if (showToken) {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      input.value = saved;
    }
  } else {
    input.value = "";
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Health check failed");
    }
    state.authRequired = payload.authRequired === true;
    state.authHealthKnown = true;
  } catch {
    state.authRequired = false;
    state.authHealthKnown = false;
  }
  renderOperatorAuthUI();
}

async function loadConfig() {
  const config = await api("/api/config");
  state.fakeServerReady = config.fakeServerReady !== false;
}

document.getElementById("operator-token").addEventListener("change", (event) => {
  const value = event.target.value.trim();
  if (value) {
    sessionStorage.setItem(TOKEN_KEY, value);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
});

document.getElementById("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {
    primaryLabel: form.primaryLabel.value,
    primaryPhone: form.primaryPhone.value,
    primaryConsented: form.primaryConsented.checked,
    backupLabel: form.backupLabel.value || undefined,
    backupPhone: form.backupPhone.value || undefined,
    backupConsented: form.backupConsented.checked,
    mode: form.mode.value,
    simulationPreset: form.simulationPreset.value,
  };
  const drill = await api("/api/drills", { method: "POST", body: JSON.stringify(body) });
  state.drillId = drill.id;
  state.drill = drill;
  const preview = await api(`/api/drills/${drill.id}/preview`);
  renderPreview(preview.plan, drill);
  renderStatus(drill);
  showStep("preview");
});

document.getElementById("preview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    operatorConfirmedDrillPurpose: form.operatorConfirmedDrillPurpose.checked,
    maxCallsDisclosed: form.maxCallsDisclosed.checked,
  };
  if (state.drill?.mode === "live") {
    payload.liveSideEffectAcknowledged = form.liveSideEffectAcknowledged.checked;
  }
  const drill = await api(`/api/drills/${state.drillId}/preview`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.drill = drill;
  renderStatus(drill);
  showStep("control");
});

document.getElementById("launch-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (state.drill?.mode === "fake-server" && !state.fakeServerReady) {
    alert("Fake-server mode is not configured on the server. Set CALLE_BASE_URL or enable the embedded fake provider.");
    return;
  }
  document.getElementById("launch-btn").disabled = true;
  try {
    const drill = await api(`/api/drills/${state.drillId}/launch`, {
      method: "POST",
      body: JSON.stringify({ launchConfirmed: form.launchConfirmed.checked }),
    });
    state.drill = drill;
    renderStatus(drill);
    startPoll();
  } catch (error) {
    alert(error.message);
    document.getElementById("launch-btn").disabled = false;
  }
});

document.getElementById("cancel-btn").addEventListener("click", async () => {
  const drill = await api(`/api/drills/${state.drillId}/cancel`, { method: "POST", body: "{}" });
  state.drill = drill;
  renderStatus(drill);
});

function startPoll() {
  stopPoll();
  state.pollTimer = setInterval(async () => {
    if (!state.drillId) return;
    const drill = await api(`/api/drills/${state.drillId}`);
    state.drill = drill;
    renderStatus(drill);
  }, 800);
}

function stopPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

Promise.all([loadPresets(), loadHealth(), loadConfig()]).catch(console.error);
