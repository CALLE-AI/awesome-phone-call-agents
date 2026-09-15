// ForgeGate — SOC Command Center
// 3-panel dashboard: Incident Queue | Call Status + Ticket | Activity Feed
// Talks to FastAPI backend: POST /incident, POST /incident/create,
// POST /incident/{id}/action, GET /incidents, GET /incidents/{id}/status,
// GET /health, GET /scenarios, GET /activity-feed, POST /reset

(() => {
  "use strict";

  const POLL_MS = 2500;
  const ACTIVITY_POLL_MS = 2000;

  const DISPOSITION_LABEL = {
    APPROVE: "Approve",
    HOLD: "Hold",
    ESCALATE: "Escalate",
    NO_ANSWER: "No Answer",
    UNCLEAR: "Unclear",
    DISPATCH_FAILED: "Dispatch Failed",
  };

  const ACTION_LABEL = {
    "AUTO-CLEARED": "Auto-Cleared",
    EXECUTED: "Executed",
    HELD: "Held",
    ESCALATED: "Escalated",
    DISCARDED: "Discarded",
  };

  const SEVERITY_RISK = { critical: 0.95, high: 0.85, medium: 0.5, low: 0.15 };

  // ── DOM refs ──
  const el = {
    modeLamp:       document.getElementById("modeLamp"),
    modeLabel:      document.getElementById("modeLabel"),
    thresholdValue: document.getElementById("thresholdValue"),
    resetBtn:       document.getElementById("resetBtn"),
    // Queue
    createBtn:      document.getElementById("createBtn"),
    createForm:     document.getElementById("createForm"),
    cfSource:       document.getElementById("cfSource"),
    cfSeverity:     document.getElementById("cfSeverity"),
    cfDescription:  document.getElementById("cfDescription"),
    cfAction:       document.getElementById("cfAction"),
    cfCancel:       document.getElementById("cfCancel"),
    scenarioStrip:  document.getElementById("scenarioStrip"),
    incidentList:   document.getElementById("incidentList"),
    queueEmpty:     document.getElementById("queueEmpty"),
    // Center
    callStatus:     document.getElementById("callStatus"),
    callPhaseLabel: document.getElementById("callPhaseLabel"),
    callTimer:      document.getElementById("callTimer"),
    ticketEmpty:    document.getElementById("ticketEmpty"),
    ticketBody:     document.getElementById("ticketBody"),
    postActions:    document.getElementById("postActions"),
    paReason:       document.getElementById("paReason"),
    btnDiscard:     document.getElementById("btnDiscard"),
    btnEscalate:    document.getElementById("btnEscalate"),
    resolutionBanner: document.getElementById("resolutionBanner"),
    // Feed
    activityFeed:   document.getElementById("activityFeed"),
    feedEmpty:      document.getElementById("feedEmpty"),
    feedCount:      document.getElementById("feedCount"),
    toast:          document.getElementById("toast"),
  };

  // ── State ──
  const state = {
    scenarios: [],
    entries: [],
    byIncident: new Map(),
    selectedId: null,
    connecting: new Set(),
    activities: [],
    riskThreshold: 0.7,
  };

  let toastTimer = null;
  let callTimerInterval = null;
  let callStartTime = null;

  // ════════════════════════════════════
  // Utilities
  // ════════════════════════════════════

  function showToast(message, isError) {
    el.toast.textContent = message;
    el.toast.classList.toggle("is-error", Boolean(isError));
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add("is-visible"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("is-visible");
      setTimeout(() => { el.toast.hidden = true; }, 240);
    }, 4200);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function maskText(text) {
    if (!text) return "";
    return String(text)
      .replace(/\+[1-9][0-9]{7,14}/g, m => {
        if (m.length <= 5) return m[0] + "*".repeat(m.length - 1);
        return m.slice(0, 2) + "*".repeat(m.length - 6) + m.slice(-4);
      })
      .replace(/Bearer\s+[A-Za-z0-9_\-\.]{8,}/gi, "Bearer [REDACTED_TOKEN]")
      .replace(/(?:calle|api|secret|token)[_-]?(?:key)?[\"'\s:=]+[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED_KEY]");
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour12: false });
  }

  function fmtPct(score) {
    if (score === null || score === undefined) return "—";
    return Math.round(score * 100) + "%";
  }

  function shortId(id) {
    return id.length > 18 ? id.slice(0, 18) + "…" : id;
  }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const detail = (data && data.detail) || res.statusText || "request failed";
      throw new Error(detail);
    }
    return data;
  }

  function severityFromScore(score) {
    if (score >= 0.9) return "critical";
    if (score >= 0.75) return "high";
    if (score >= 0.4) return "medium";
    return "low";
  }

  function lampForEntry(entry) {
    if (!entry.disposition) return "idle-clear";
    const key = entry.disposition.toUpperCase();
    if (key === "APPROVE") return "approve";
    if (key === "HOLD") return "hold";
    if (key === "ESCALATE") return "escalate";
    return "unclear";
  }

  function describeScenario(payload) {
    const bits = [];
    const s = payload.signals || {};
    if (s.rfid_zone) bits.push(s.rfid_zone.replace("_", " ").toUpperCase());
    if (s.gas_ppm !== undefined) bits.push(`${s.gas_ppm}ppm`);
    if (s.temp_c !== undefined) bits.push(`${s.temp_c}°C`);
    if (s.src_ip) bits.push(s.src_ip);
    if (s.attempts) bits.push(`${s.attempts} attempts`);
    if (s.coolant_psi !== undefined) bits.push(`${s.coolant_psi}psi`);
    if (s.zone) bits.push(s.zone.toUpperCase());
    if (s.door) bits.push(s.door.replace(/_/g, " "));
    if (s.body_count) bits.push(`${s.body_count} bodies`);
    if (s.task) bits.push(s.task);
    return bits.length ? bits.join(" · ") : payload.source || "incident";
  }

  // ════════════════════════════════════
  // Health / Status
  // ════════════════════════════════════

  async function loadHealth() {
    try {
      const health = await fetchJSON("/health");
      el.modeLamp.dataset.state = health.dry_run ? "dry-run" : "live";
      el.modeLabel.textContent = health.dry_run ? "DRY RUN — SIMULATED" : "LIVE — REAL CALLS";
      el.thresholdValue.textContent = fmtPct(health.risk_threshold);
      state.riskThreshold = health.risk_threshold || 0.7;
    } catch (err) {
      el.modeLamp.dataset.state = "offline";
      el.modeLabel.textContent = "OFFLINE";
      el.thresholdValue.textContent = "—";
      throw err;
    }
  }

  // ════════════════════════════════════
  // Scenarios
  // ════════════════════════════════════

  async function loadScenarios() {
    const data = await fetchJSON("/scenarios");
    state.scenarios = data.scenarios || [];
    renderScenarioStrip();
  }

  function renderScenarioStrip() {
    el.scenarioStrip.innerHTML = "";
    if (!state.scenarios.length) {
      el.scenarioStrip.innerHTML = '<p class="scenario-strip__loading">No scenarios found.</p>';
      return;
    }
    for (const scenario of state.scenarios) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-btn";
      btn.dataset.scenario = scenario.name;
      btn.textContent = scenario.payload.incident_id + " — " + describeScenario(scenario.payload);
      btn.addEventListener("click", () => fireScenario(scenario, btn));
      el.scenarioStrip.appendChild(btn);
    }
  }

  async function fireScenario(scenario, btn) {
    const incidentId = scenario.payload.incident_id;
    if (btn) { btn.classList.add("is-firing"); btn.disabled = true; }
    state.connecting.add(incidentId);
    selectIncident(incidentId);
    renderIncidentQueue();

    const startedAt = Date.now();
    const MIN_VISIBLE_MS = 850;

    try {
      const data = await fetchJSON("/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario.payload),
      });

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_VISIBLE_MS) {
        await new Promise(r => setTimeout(r, MIN_VISIBLE_MS - elapsed));
      }

      if (data.note) {
        showToast(`${shortId(incidentId)}: reusing existing call result.`);
      }
      await refresh();
      selectIncident(incidentId);
    } catch (err) {
      showToast(`Failed: ${err.message}`, true);
    } finally {
      state.connecting.delete(incidentId);
      if (btn) { btn.classList.remove("is-firing"); btn.disabled = false; }
      renderIncidentQueue();
      updateCallStatus();
    }
  }

  // ════════════════════════════════════
  // Create Incident
  // ════════════════════════════════════

  function initCreateForm() {
    let selectedSeverity = "medium";

    el.createBtn.addEventListener("click", () => {
      el.createForm.hidden = !el.createForm.hidden;
    });
    el.cfCancel.addEventListener("click", () => {
      el.createForm.hidden = true;
    });

    // Severity selector
    el.cfSeverity.addEventListener("click", (e) => {
      const opt = e.target.closest(".severity-opt");
      if (!opt) return;
      selectedSeverity = opt.dataset.severity;
      for (const o of el.cfSeverity.querySelectorAll(".severity-opt")) {
        o.dataset.active = o.dataset.severity === selectedSeverity ? "true" : "false";
      }
    });

    el.createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const desc = el.cfDescription.value.trim();
      const action = el.cfAction.value.trim();
      if (!desc || !action) { showToast("Fill in all fields.", true); return; }

      const tempId = `INC-${Math.floor(10000 + Math.random() * 90000)}`;
      const payload = {
        incident_id: tempId,
        source: el.cfSource.value,
        severity: selectedSeverity,
        description: desc,
        proposed_action: action,
        signals: {},
      };

      state.connecting.add(tempId);
      selectIncident(tempId);
      renderIncidentQueue();
      el.createForm.hidden = true;
      el.cfDescription.value = "";
      el.cfAction.value = "";

      try {
        const data = await fetchJSON("/incident/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        showToast(`Incident ${data.incident_id} processed.`);
        await refresh();
        selectIncident(data.incident_id);
      } catch (err) {
        showToast(`Create failed: ${err.message}`, true);
      } finally {
        state.connecting.delete(tempId);
        renderIncidentQueue();
        updateCallStatus();
      }
    });
  }

  // ════════════════════════════════════
  // Polling / Data
  // ════════════════════════════════════

  async function refresh() {
    const data = await fetchJSON("/incidents");
    state.entries = data.entries || [];
    state.byIncident = new Map();
    for (const entry of state.entries) {
      const prior = state.byIncident.get(entry.incident_id);
      if (!prior || new Date(entry.timestamp) >= new Date(prior.timestamp)) {
        state.byIncident.set(entry.incident_id, entry);
      }
    }
    renderIncidentQueue();
    renderTicketDetail();
    updateCallStatus();
  }

  async function refreshActivities() {
    try {
      const data = await fetchJSON("/activity-feed?limit=100");
      state.activities = data.activities || [];
      renderActivityFeed();
    } catch (_) { /* transient */ }
  }

  // ════════════════════════════════════
  // LEFT PANEL — Incident Queue
  // ════════════════════════════════════

  function renderIncidentQueue() {
    const allIds = new Set([...state.byIncident.keys(), ...state.connecting]);
    el.queueEmpty.hidden = allIds.size > 0;

    // Build ordered list: connecting first (they're newest), then by timestamp desc
    const items = [];
    for (const id of state.connecting) {
      if (!state.byIncident.has(id)) {
        items.push({ id, entry: null, connecting: true });
      }
    }
    const sorted = [...state.byIncident.entries()]
      .sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));
    for (const [id, entry] of sorted) {
      items.push({ id, entry, connecting: state.connecting.has(id) });
    }

    // Clear and rebuild (simple and fast enough for ≤20 items)
    const frag = document.createDocumentFragment();
    for (const item of items) {
      frag.appendChild(buildIncidentCard(item.id, item.entry, item.connecting));
    }
    // Keep queueEmpty but replace cards
    const existing = el.incidentList.querySelectorAll(".incident-card");
    existing.forEach(c => c.remove());
    el.incidentList.appendChild(frag);
  }

  function buildIncidentCard(id, entry, connecting) {
    const card = document.createElement("div");
    card.className = "incident-card";
    card.classList.toggle("is-selected", id === state.selectedId);
    card.addEventListener("click", () => selectIncident(id));

    const sev = entry ? severityFromScore(entry.risk_score) : "high";
    const actionState = connecting ? "RINGING" : (entry ? entry.action_state || "—" : "—");
    const riskPct = entry ? fmtPct(entry.risk_score) : "—";
    const desc = entry ? (entry.description || entry.proposed_action || entry.task_text || entry.source || "") : "Awaiting dispatch…";
    const time = entry ? fmtTime(entry.timestamp) : "";

    card.innerHTML = `
      <div class="incident-card__stripe" data-sev="${sev}"></div>
      <div class="incident-card__body">
        <div class="incident-card__top">
          <span class="incident-card__id">${escapeHtml(id)}</span>
          <span class="incident-card__badge" data-state="${escapeHtml(actionState)}">${escapeHtml(ACTION_LABEL[actionState] || actionState)}</span>
        </div>
        <div class="incident-card__desc">${escapeHtml(desc)}</div>
        <div class="incident-card__meta">
          <span class="incident-card__meta-item">Risk: ${riskPct}</span>
          ${time ? `<span class="incident-card__meta-item">${time}</span>` : ""}
        </div>
      </div>
    `;
    return card;
  }

  function selectIncident(id) {
    state.selectedId = id;
    renderIncidentQueue();
    renderTicketDetail();
    updateCallStatus();
  }

  // ════════════════════════════════════
  // CENTER — Call Status Widget
  // ════════════════════════════════════

  function updateCallStatus() {
    const entry = state.selectedId ? state.byIncident.get(state.selectedId) : null;
    const isConnecting = state.connecting.has(state.selectedId);

    if (isConnecting) {
      el.callStatus.dataset.phase = "ringing";
      el.callPhaseLabel.textContent = "Calling Security Lead…";
      startCallTimer();
    } else if (entry && entry.call_id) {
      el.callStatus.dataset.phase = "completed";
      const dispLabel = entry.disposition ? (DISPOSITION_LABEL[entry.disposition] || entry.disposition) : "Completed";
      el.callPhaseLabel.textContent = `Call Complete — ${dispLabel}`;
      stopCallTimer();
    } else {
      el.callStatus.dataset.phase = "idle";
      el.callPhaseLabel.textContent = "No Active Call";
      stopCallTimer();
    }
  }

  function startCallTimer() {
    if (callTimerInterval) return;
    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      el.callTimer.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }, 1000);
  }

  function stopCallTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    if (!state.connecting.has(state.selectedId)) {
      el.callTimer.textContent = "";
    }
  }

  // ════════════════════════════════════
  // CENTER — Ticket Detail
  // ════════════════════════════════════

  function renderTicketDetail() {
    const entry = state.selectedId ? state.byIncident.get(state.selectedId) : null;

    if (!entry) {
      el.ticketEmpty.hidden = false;
      el.ticketBody.hidden = true;
      el.postActions.hidden = true;
      el.resolutionBanner.hidden = true;
      return;
    }

    el.ticketEmpty.hidden = true;
    el.ticketBody.hidden = false;

    const lamp = lampForEntry(entry);
    const scorePct = entry.risk_score != null ? entry.risk_score : 0;
    const thresholdPct = entry.threshold != null ? entry.threshold : state.riskThreshold;
    const segCount = 20;
    let vuSegs = "";
    for (let i = 0; i < segCount; i++) {
      const segPos = (i + 1) / segCount;
      const lit = segPos <= scorePct;
      let cls = "vu__seg";
      if (lit) cls += segPos <= 0.6 ? " is-lit-low" : segPos <= 0.8 ? " is-lit-mid" : " is-lit-high";
      vuSegs += `<span class="${cls}"></span>`;
    }

    const actionLamp = entry.action_state === "EXECUTED" ? "approve"
      : entry.action_state === "AUTO-CLEARED" ? "idle-clear"
      : entry.action_state === "ESCALATED" ? "escalate"
      : entry.action_state === "DISCARDED" ? "alarm"
      : entry.action_state ? "hold" : "idle-clear";

    el.ticketBody.innerHTML = `
      <div class="ticket-fields">
        <div>
          <span class="ticket-field__label">Incident ID</span>
          <span class="ticket-field__value">${escapeHtml(entry.incident_id)}</span>
        </div>
        <div>
          <span class="ticket-field__label">Risk Score</span>
          <span class="ticket-field__value">${fmtPct(entry.risk_score)}</span>
          <div class="vu">${vuSegs}<span class="vu__threshold" style="left:${(thresholdPct * 100).toFixed(1)}%"></span></div>
        </div>
        <div>
          <span class="ticket-field__label">Disposition</span>
          <span class="ticket-field__value ticket-field__value--state">
            <span class="ticket-field__dot" data-lamp="${lamp}"></span>
            ${entry.disposition ? (DISPOSITION_LABEL[entry.disposition] || escapeHtml(entry.disposition)) : "—"}
          </span>
        </div>
        <div>
          <span class="ticket-field__label">Action State</span>
          <span class="ticket-field__value ticket-field__value--state">
            <span class="ticket-field__dot" data-lamp="${actionLamp}"></span>
            ${entry.action_state ? (ACTION_LABEL[entry.action_state] || escapeHtml(entry.action_state)) : "—"}
          </span>
        </div>
        <div>
          <span class="ticket-field__label">Call ID</span>
          <span class="ticket-field__value">${entry.call_id ? escapeHtml(entry.call_id) : "—"}</span>
        </div>
        <div>
          <span class="ticket-field__label">Mode</span>
          <span class="ticket-field__value">${entry.dry_run === undefined ? "—" : entry.dry_run ? "Dry-Run" : "Live"}</span>
        </div>
        <div>
          <span class="ticket-field__label">Logged</span>
          <span class="ticket-field__value">${fmtTime(entry.timestamp)}</span>
        </div>
        <div>
          <span class="ticket-field__label">Threshold</span>
          <span class="ticket-field__value">${fmtPct(entry.threshold)}</span>
        </div>
      </div>
      ${(entry.proposed_action || entry.description) ? `
        <div class="ticket-slip">
          <span class="ticket-slip__label">Proposed Action & Incident Details</span>
          <p class="ticket-slip__text">${entry.proposed_action ? `<strong>Action:</strong> ${escapeHtml(maskText(entry.proposed_action))}` : ""}${entry.description ? `<br><strong>Details:</strong> ${escapeHtml(maskText(entry.description))}` : ""}${entry.source ? `<br><strong>Source:</strong> ${escapeHtml(maskText(entry.source))}` : ""}</p>
        </div>` : ""}
      ${entry.task_text ? `
        <div class="ticket-slip">
          <span class="ticket-slip__label">CALL-E Task Prompt</span>
          <p class="ticket-slip__text">${escapeHtml(maskText(entry.task_text))}</p>
        </div>` : ""}
      ${entry.reason ? `
        <div class="ticket-slip">
          <span class="ticket-slip__label">Recipient's Reason</span>
          <p class="ticket-slip__text">${escapeHtml(maskText(entry.reason))}</p>
        </div>` : ""}
      ${entry.transcript_evidence ? `
        <div class="ticket-slip">
          <span class="ticket-slip__label">Transcript Evidence</span>
          <p class="ticket-slip__text ${entry.dry_run ? "ticket-slip__text--muted" : ""}">${escapeHtml(maskText(entry.transcript_evidence))}</p>
        </div>` : ""}
      ${entry.post_action_reason ? `
        <div class="ticket-slip">
          <span class="ticket-slip__label">Post-Action Reason</span>
          <p class="ticket-slip__text">${escapeHtml(maskText(entry.post_action_reason))}</p>
        </div>` : ""}
      ${!entry.call_id && entry.action_state === "AUTO-CLEARED" ? `
        <div class="ticket-slip">
          <span class="ticket-slip__label">Gate Decision</span>
          <p class="ticket-slip__text ticket-slip__text--muted">Risk score stayed under the ${fmtPct(entry.threshold)} threshold — no call was placed, incident auto-cleared.</p>
        </div>` : ""}
    `;

    // Post-actions or resolution banner
    renderPostActions(entry);
  }

  function renderPostActions(entry) {
    // Hide both by default
    el.postActions.hidden = true;
    el.resolutionBanner.hidden = true;

    if (entry.action_state === "HELD") {
      // Show Discard / Escalate buttons
      el.postActions.hidden = false;
      el.paReason.value = "";
    } else if (entry.action_state === "EXECUTED") {
      el.resolutionBanner.hidden = false;
      el.resolutionBanner.dataset.type = "approved";
      el.resolutionBanner.innerHTML = '<span>✓</span> Action APPROVED and EXECUTED — verified by voice call transcript';
    } else if (entry.action_state === "AUTO-CLEARED") {
      el.resolutionBanner.hidden = false;
      el.resolutionBanner.dataset.type = "cleared";
      el.resolutionBanner.innerHTML = '<span>○</span> Auto-Cleared — risk below threshold, no action required';
    } else if (entry.action_state === "ESCALATED") {
      el.resolutionBanner.hidden = false;
      el.resolutionBanner.dataset.type = "escalated";
      el.resolutionBanner.innerHTML = '<span>⬆</span> ESCALATED — forwarded for senior review';
    } else if (entry.action_state === "DISCARDED") {
      el.resolutionBanner.hidden = false;
      el.resolutionBanner.dataset.type = "discarded";
      el.resolutionBanner.innerHTML = '<span>✕</span> DISCARDED — determined to be non-actionable';
    }
  }

  async function handlePostAction(action) {
    if (!state.selectedId) return;
    const reason = el.paReason.value.trim();

    try {
      await fetchJSON(`/incident/${encodeURIComponent(state.selectedId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      showToast(`${state.selectedId}: ${action.toUpperCase()}`);
      await refresh();
      await refreshActivities();
    } catch (err) {
      showToast(`Action failed: ${err.message}`, true);
    }
  }

  // ════════════════════════════════════
  // RIGHT PANEL — Activity Feed
  // ════════════════════════════════════

  function renderActivityFeed() {
    const activities = state.activities;
    el.feedCount.textContent = String(activities.length);
    el.feedEmpty.hidden = activities.length > 0;

    // Remove old entries
    const existing = el.activityFeed.querySelectorAll(".feed-entry");
    existing.forEach(e => e.remove());

    const frag = document.createDocumentFragment();
    for (const act of activities) {
      const div = document.createElement("div");
      div.className = "feed-entry";
      div.dataset.event = act.event || "";
      const time = fmtTime(act.timestamp);
      div.innerHTML = `<span class="feed-entry__time">${time}</span> <span class="feed-entry__id">${escapeHtml(act.incident_id || "")}</span> <span class="feed-entry__event">${escapeHtml(act.event || "")}: ${escapeHtml(maskText(act.detail || ""))}</span>`;
      frag.appendChild(div);
    }
    el.activityFeed.appendChild(frag);

    // Auto-scroll to bottom
    el.activityFeed.scrollTop = el.activityFeed.scrollHeight;
  }

  // ════════════════════════════════════
  // Reset
  // ════════════════════════════════════

  async function resetExchange() {
    try {
      await fetchJSON("/reset", { method: "POST" });
      state.entries = [];
      state.byIncident.clear();
      state.selectedId = null;
      state.connecting.clear();
      state.activities = [];
      stopCallTimer();
      renderIncidentQueue();
      renderTicketDetail();
      updateCallStatus();
      renderActivityFeed();
      showToast("SOC Command Center reset: all incidents and logs cleared.");
    } catch (err) {
      showToast(`Could not reset: ${err.message}`, true);
    }
  }

  // ════════════════════════════════════
  // Boot
  // ════════════════════════════════════

  async function boot() {
    // Health check
    try {
      await loadHealth();
    } catch (_) {
      showToast("Cannot reach the ForgeGate backend. Is the server running?", true);
    }

    // Load scenarios
    try {
      await loadScenarios();
    } catch (err) {
      el.scenarioStrip.innerHTML = `<p class="scenario-strip__loading">Could not load scenarios: ${escapeHtml(err.message)}</p>`;
    }

    // Initial data load
    try {
      await refresh();
    } catch (_) { /* health check already surfaced toast */ }

    // Initial activity feed
    try {
      await refreshActivities();
    } catch (_) { /* non-critical */ }

    // Set up event handlers
    if (el.resetBtn) el.resetBtn.addEventListener("click", resetExchange);
    if (el.btnDiscard) el.btnDiscard.addEventListener("click", () => handlePostAction("discard"));
    if (el.btnEscalate) el.btnEscalate.addEventListener("click", () => handlePostAction("escalate"));
    initCreateForm();

    // Polling loops
    setInterval(async () => {
      try {
        await loadHealth();
        await refresh();
      } catch (_) { /* transient */ }
    }, POLL_MS);

    setInterval(async () => {
      try {
        await refreshActivities();
      } catch (_) { /* transient */ }
    }, ACTIVITY_POLL_MS);
  }

  boot();
})();
