"use strict";

const state = {
  data: null,
  view: "evidence",
  selected: 0,
  reviewed: new Set(),
  escalated: new Set(),
  notes: new Map(),
  activity: [
    { time: "Local", message: "Evidence console opened. No external action was taken." },
  ],
};

const byId = (id) => document.getElementById(id);

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const displayValue = (value, fallback = "Unresolved") => (
  value === null || value === undefined || value === "" ? fallback : escapeHtml(value)
);

const formatDate = (value, fallback = "Unresolved") => {
  if (!value) return fallback;
  const normalized = /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(0, 10)}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

const formatMoney = (amount, currency) => {
  if (amount === null || amount === undefined) return "Unresolved";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  } catch (_error) {
    return `${amount} ${currency || ""}`.trim();
  }
};

const matchMeta = (matchStatus) => {
  if (matchStatus === "exact") return { label: "Exact", className: "exact" };
  if (matchStatus === "compatible") return { label: "Compatible", className: "compatible" };
  return { label: "Unresolved", className: "unresolved" };
};

const showToast = (message) => {
  const toast = byId("toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
};

const addActivity = (message) => {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  state.activity.unshift({ time, message });
  renderActivity();
};

const openDialog = (id) => {
  const dialog = byId(id);
  if (typeof dialog.showModal === "function") dialog.showModal();
};

const renderHeaderAndRequest = () => {
  const request = state.data.request;
  const specs = request.required_specs || [];
  byId("header-request-id").textContent = request.request_id;
  byId("header-status").textContent = "No call placed";
  byId("part-number").textContent = request.part_number;
  byId("manufacturer").textContent = request.manufacturer;
  byId("quantity").textContent = `${request.quantity} units`;
  byId("need-by").textContent = formatDate(request.need_by);
  byId("facility").textContent = request.facility;
  byId("requester").textContent = request.requester;
  byId("alternates").textContent = request.acceptable_alternatives ? "Human review" : "Not allowed";
  byId("spec-count").textContent = String(specs.length);
  byId("spec-list").innerHTML = specs.map((spec) => `<li>${escapeHtml(spec)}</li>`).join("");

  byId("mobile-part-number").textContent = request.part_number;
  byId("mobile-quantity").textContent = String(request.quantity);
  byId("mobile-need-by").textContent = formatDate(request.need_by).replace(", 2026", "");
  byId("mobile-spec-count").textContent = String(specs.length);

  byId("request-dialog-content").innerHTML = `
    <dl class="dialog-grid">
      <div><dt>Request</dt><dd>${escapeHtml(request.request_id)}</dd></div>
      <div><dt>Requester</dt><dd>${escapeHtml(request.requester)}</dd></div>
      <div class="span-two"><dt>Facility</dt><dd>${escapeHtml(request.facility)}</dd></div>
      <div><dt>Part</dt><dd>${escapeHtml(request.part_number)}</dd></div>
      <div><dt>Manufacturer</dt><dd>${escapeHtml(request.manufacturer)}</dd></div>
      <div><dt>Quantity</dt><dd>${escapeHtml(request.quantity)}</dd></div>
      <div><dt>Need by</dt><dd>${formatDate(request.need_by)}</dd></div>
      <div class="span-two"><dt>Description</dt><dd>${escapeHtml(request.description)}</dd></div>
      <div class="span-two"><dt>Non-negotiable specifications</dt><dd>${specs.map(escapeHtml).join(" · ")}</dd></div>
    </dl>`;
};

const renderWorkflow = () => {
  const evidence = state.data.evidence.candidates || [];
  const reviewedCount = state.reviewed.size;
  const steps = [
    ["Approved request", "Exact scope locked", "complete"],
    ["Masked call plan", "Awaiting explicit gate", "complete"],
    ["Supplier evidence", `${evidence.length} responses loaded`, state.view === "evidence" ? "active" : "complete"],
    ["Buyer review", reviewedCount ? `${reviewedCount} decision recorded` : "Human decision pending", reviewedCount ? "active" : ""],
  ];
  byId("workflow-list").innerHTML = steps.map((step, index) => `
    <li class="workflow-step ${step[2]}" data-step="${index + 1}">
      <div><strong>${escapeHtml(step[0])}</strong><small>${escapeHtml(step[1])}</small></div>
    </li>`).join("");
};

const renderPlan = () => {
  const plan = state.data.plan;
  const recipients = plan.recipients || [];
  byId("recipient-list").innerHTML = recipients.map((recipient, index) => `
    <li>
      <span class="recipient-number">${index + 1}</span>
      <div>
        <strong>${escapeHtml(recipient.name)}</strong>
        <span>${escapeHtml(recipient.phone)}</span>
        <span>${escapeHtml(recipient.authorization_reference)}</span>
      </div>
    </li>`).join("");
  byId("plan-task-text").textContent = plan.task;
  byId("approval-token").textContent = plan.approval_token;
  byId("authority-recipients").textContent = String(recipients.length);
  byId("authority-window").textContent = `${plan.call_window.start}–${plan.call_window.end}`;
};

const renderEvidenceRows = () => {
  const candidates = state.data.evidence.candidates || [];
  const rows = byId("evidence-rows");
  if (!candidates.length) {
    rows.innerHTML = `<tr><td colspan="7"><div class="empty-state"><h2>No supplier evidence</h2><p>Load a completed CALL-E result to compare supplier claims.</p></div></td></tr>`;
    byId("evidence-detail").hidden = true;
    return;
  }
  byId("evidence-detail").hidden = false;
  rows.innerHTML = candidates.map((item, index) => {
    const match = matchMeta(item.match_status);
    return `
      <tr class="${index === state.selected ? "selected" : ""}" data-index="${index}">
        <td data-label="Supplier"><button class="supplier-name" type="button" data-index="${index}">${escapeHtml(item.supplier)}</button></td>
        <td data-label="Match"><span class="match-label ${match.className}"><i class="status-icon ${match.className}" aria-hidden="true"></i>${match.label}</span></td>
        <td data-label="Available">${displayValue(item.quantity_available)}</td>
        <td data-label="Price">${formatMoney(item.unit_price, item.currency)}</td>
        <td data-label="Ship">${item.earliest_ship_date ? formatDate(item.earliest_ship_date).replace(", 2026", "") : "Unresolved"}</td>
        <td data-label="Lead">${item.lead_time_days === null || item.lead_time_days === undefined ? "Unresolved" : `${escapeHtml(item.lead_time_days)} day${item.lead_time_days === 1 ? "" : "s"}`}</td>
        <td><button class="open-row" type="button" data-index="${index}" aria-label="Open evidence for ${escapeHtml(item.supplier)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button></td>
      </tr>`;
  }).join("");
};

const renderEvidenceDetail = () => {
  const candidates = state.data.evidence.candidates || [];
  if (!candidates.length) return;
  const item = candidates[state.selected];
  const match = matchMeta(item.match_status);
  let decision = "Awaiting buyer review";
  let decisionClass = "";
  if (state.reviewed.has(state.selected)) {
    decision = "Reviewed by buyer";
    decisionClass = "reviewed";
  }
  if (state.escalated.has(state.selected)) {
    decision = "Escalated for follow-up";
    decisionClass = "escalated";
  }
  const caveat = item.alternative_caveats
    ? `<p class="caveat"><strong>Engineering caveat:</strong> ${escapeHtml(item.alternative_caveats)}</p>`
    : "";
  const detail = byId("evidence-detail");
  detail.innerHTML = `
    <div class="detail-main">
      <span class="detail-kicker">Selected supplier · <span class="match-label ${match.className}">${match.label}</span></span>
      <h2>${escapeHtml(item.supplier)}</h2>
      <blockquote class="evidence-quote">“${escapeHtml(item.evidence_quote || "No spoken evidence was returned.")}”</blockquote>
      ${caveat}
      <dl class="detail-facts">
        <div><dt>Manufacturer stated</dt><dd>${displayValue(item.manufacturer_confirmed)}</dd></div>
        <div><dt>Part stated</dt><dd>${displayValue(item.part_number_confirmed)}</dd></div>
        <div><dt>Shipping cutoff</dt><dd>${displayValue(item.shipping_cutoff)}</dd></div>
        <div><dt>Alternate</dt><dd>${displayValue(item.alternative_part_number, "None stated")}</dd></div>
      </dl>
    </div>
    <div class="detail-actions">
      <h3>Human decision</h3>
      <span class="decision-chip ${decisionClass}">${decision}</span>
      <label for="buyer-note">Buyer note</label>
      <textarea id="buyer-note" placeholder="Record a decision note. Nothing is sent to a supplier.">${escapeHtml(state.notes.get(state.selected) || "")}</textarea>
      <div class="decision-buttons">
        <button class="primary-button" id="mark-reviewed-button" type="button">Mark buyer reviewed</button>
        <button class="secondary-button danger" id="escalate-button" type="button">Escalate evidence gap</button>
      </div>
    </div>`;

  byId("buyer-note").addEventListener("input", (event) => {
    state.notes.set(state.selected, event.target.value);
  });
  byId("mark-reviewed-button").addEventListener("click", () => {
    state.reviewed.add(state.selected);
    state.escalated.delete(state.selected);
    addActivity(`${item.supplier} marked reviewed. No supplier action was taken.`);
    renderEvidenceDetail();
    renderWorkflow();
    showToast("Buyer review recorded locally. No order or reservation was created.");
  });
  byId("escalate-button").addEventListener("click", () => {
    state.escalated.add(state.selected);
    state.reviewed.delete(state.selected);
    addActivity(`${item.supplier} evidence gap escalated for human follow-up.`);
    renderEvidenceDetail();
    renderWorkflow();
    showToast("Evidence gap flagged for human follow-up.");
  });
};

const selectEvidence = (index) => {
  if (!Number.isInteger(index)) return;
  state.selected = index;
  renderEvidenceRows();
  renderEvidenceDetail();
  const item = state.data.evidence.candidates[index];
  addActivity(`${item.supplier} evidence inspected.`);
};

const switchView = (view, announce = true) => {
  if (!state.data || !["plan", "evidence"].includes(view)) return;
  state.view = view;
  const evidenceActive = view === "evidence";
  byId("evidence-view").hidden = !evidenceActive;
  byId("call-plan-view").hidden = evidenceActive;
  byId("evidence-tab").classList.toggle("active", evidenceActive);
  byId("call-plan-tab").classList.toggle("active", !evidenceActive);
  byId("evidence-tab").setAttribute("aria-selected", String(evidenceActive));
  byId("call-plan-tab").setAttribute("aria-selected", String(!evidenceActive));
  byId("view-status").textContent = evidenceActive
    ? "You are viewing supplier evidence. Human review is required."
    : "You are reviewing a masked no-call plan. No call has been placed.";
  renderWorkflow();
  if (announce) addActivity(`${evidenceActive ? "Evidence" : "Call plan"} view opened.`);
};

const renderActivity = () => {
  byId("activity-list").innerHTML = state.activity.map((item) => `
    <li><time>${escapeHtml(item.time)}</time><span>${escapeHtml(item.message)}</span></li>`).join("");
};

const bindEvents = () => {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  byId("review-plan-button").addEventListener("click", () => switchView("plan"));
  byId("authority-plan-button").addEventListener("click", () => switchView("plan"));
  byId("request-details-button").addEventListener("click", () => openDialog("request-dialog"));
  byId("menu-button").addEventListener("click", () => openDialog("request-dialog"));
  byId("activity-button").addEventListener("click", () => openDialog("activity-dialog"));
  byId("mobile-authority-button").addEventListener("click", () => openDialog("authority-dialog"));

  byId("evidence-rows").addEventListener("click", (event) => {
    const control = event.target.closest("[data-index]");
    if (!control) return;
    selectEvidence(Number(control.dataset.index));
  });

  byId("copy-command-button").addEventListener("click", async () => {
    const command = `partline run fixtures/example-request.json --live --confirm ${state.data.plan.approval_token}`;
    try {
      await navigator.clipboard.writeText(command);
      showToast("Live command copied. Running it still requires an API key and an open call window.");
    } catch (_error) {
      showToast(`Copy this command: ${command}`);
    }
    addActivity("Live CLI command prepared. No call was placed.");
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (event.key === "1") switchView("plan");
    if (event.key === "2") switchView("evidence");
  });
};

const renderAll = () => {
  renderHeaderAndRequest();
  renderPlan();
  renderEvidenceRows();
  renderEvidenceDetail();
  renderActivity();
  switchView("evidence", false);
};

const showLoadError = (message) => {
  byId("loading-screen").innerHTML = `
    <div class="error-state">
      <h1>Evidence could not be loaded</h1>
      <p>${escapeHtml(message)}</p>
      <button class="primary-button" id="retry-button" type="button">Retry</button>
    </div>`;
  byId("retry-button").addEventListener("click", () => window.location.reload());
};

const start = async () => {
  try {
    const response = await fetch("/api/bootstrap", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Local server returned ${response.status}.`);
    state.data = await response.json();
    renderAll();
    bindEvents();
    byId("app").hidden = false;
    byId("loading-screen").hidden = true;
  } catch (error) {
    showLoadError(error instanceof Error ? error.message : "Unknown loading error.");
  }
};

start();
