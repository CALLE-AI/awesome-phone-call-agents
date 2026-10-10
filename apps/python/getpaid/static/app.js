const STATUS_LABELS = {
  not_called: "not called yet",
  in_progress: "calling…",
  paid: "paid",
  promised: "promised a date",
  disputed: "disputed",
  voicemail: "left voicemail",
  no_answer: "no answer",
  wrong_number: "wrong number",
  declined: "declined to discuss",
  failed: "call failed",
};

let currentMode = "fixture";
let liveCallsPlaced = 0;
let liveCallsMax = 0;
let liveCallsExhausted = false;

async function loadMode() {
  const res = await fetch("/api/mode");
  const data = await res.json();
  currentMode = data.mode;
  liveCallsPlaced = data.live_calls_placed ?? 0;
  liveCallsMax = data.live_calls_max ?? 0;
  liveCallsExhausted = data.live_calls_exhausted ?? false;

  const pill = document.getElementById("modePill");
  pill.textContent =
    data.mode === "live"
      ? "live mode — real calls will be placed"
      : "fixture mode — no real calls placed, sample results only";
  pill.classList.add(data.mode);

  const runFollowUpsBtn = document.getElementById("runFollowUps");
  if (data.mode === "live") {
    runFollowUpsBtn.disabled = true;
    runFollowUpsBtn.title =
      "Disabled in live mode — automatic follow-ups have no per-call consent, so only the individual call button can place a live call.";
  }

  updateLiveBudgetDisplay();
}

function updateLiveBudgetDisplay() {
  const budget = document.getElementById("liveCallBudget");
  const exhausted = document.getElementById("creditsExhaustedBanner");
  if (!budget || !exhausted) return;

  if (currentMode !== "live") {
    budget.hidden = true;
    exhausted.hidden = true;
    return;
  }

  budget.hidden = false;
  budget.textContent = `live demo calls used: ${liveCallsPlaced}/${liveCallsMax} — kept extremely low to preserve real CALL-E credits`;
  exhausted.hidden = !liveCallsExhausted;
}

async function loadInvoices() {
  const res = await fetch("/api/invoices");
  const invoices = await res.json();
  const list = document.getElementById("invoiceList");

  if (invoices.length === 0) {
    list.innerHTML = '<p class="empty">No invoices yet — add one above to try it out.</p>';
    return;
  }

  list.innerHTML = invoices.map(renderCard).join("");

  invoices.forEach((inv) => {
    const btn = document.getElementById(`call-${inv.id}`);
    if (btn) btn.addEventListener("click", () => placeCall(inv.id));
    const del = document.getElementById(`del-${inv.id}`);
    if (del) del.addEventListener("click", () => deleteInvoice(inv.id));
    const consentBox = document.getElementById(`consent-${inv.id}`);
    if (consentBox && btn) {
      consentBox.addEventListener("change", () => {
        btn.disabled = !consentBox.checked;
      });
    }
  });
}

function renderCard(inv) {
  const label = STATUS_LABELS[inv.status] || inv.status;
  const lastAttempt = (inv.attempts || []).slice(-1)[0];
  const promiseLine =
    inv.status === "promised" && inv.promised_date
      ? `<div class="card-sub">promised by ${inv.promised_date}</div>`
      : "";

  const history = (inv.attempts || [])
    .map(
      (a, i) =>
        `<div class="history-item">call ${i + 1} (${a.mode}) — ${STATUS_LABELS[a.status] || a.status}</div>`
    )
    .join("");

  const reviewBanner = inv.needs_human_review
    ? `<div class="review-banner">⚠ Needs human review — automatic follow-up limit reached, no more calls will be placed automatically.</div>`
    : "";

  const isLive = currentMode === "live";
  const consentCheckbox =
    isLive && !liveCallsExhausted
      ? `<label class="consent-check">
           <input type="checkbox" id="consent-${inv.id}">
           I confirm I have permission to call this number
         </label>`
      : "";
  const callDisabled = isLive; // re-enabled per-card only once consent is checked (see loadInvoices)

  return `
    <div class="invoice-card">
      <div class="card-top">
        <div>
          <div class="card-title">${escapeHtml(inv.client_name)} — #${escapeHtml(inv.invoice_number)}</div>
          <div class="card-sub">${escapeHtml(inv.amount)} ${escapeHtml(inv.currency)} · due ${inv.due_date}</div>
          ${promiseLine}
        </div>
        <span class="stamp ${inv.status}">${label}</span>
      </div>

      ${reviewBanner}

      ${lastAttempt ? `<div class="note"><strong>Last call:</strong> ${escapeHtml(lastAttempt.note || "")}</div>` : ""}
      ${history ? `<div class="history">${history}</div>` : ""}

      ${consentCheckbox}

      <div class="card-actions">
        <button id="call-${inv.id}" class="btn-primary" ${callDisabled ? "disabled" : ""}>
          ${isLive && liveCallsExhausted
            ? "Demo credits exhausted"
            : inv.status === "not_called"
              ? "Place first call"
              : "Call again"}
        </button>
        <button id="del-${inv.id}" class="btn-ghost">Remove</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function placeCall(invoiceId) {
  const btn = document.getElementById(`call-${invoiceId}`);
  const consentBox = document.getElementById(`consent-${invoiceId}`);
  const consent = currentMode === "live" && consentBox && consentBox.checked;

  btn.disabled = true;
  btn.textContent = "Calling…";
  try {
    const url = `/api/invoices/${invoiceId}/call${consent ? "?consent=true" : ""}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.detail || "Could not place the call.");
      return;
    }
  } finally {
    // Live mode's global call budget can change on every attempt (success
    // or not), so re-fetch it before re-rendering cards.
    if (currentMode === "live") await loadMode();
    await loadInvoices();
  }
}

async function deleteInvoice(invoiceId) {
  await fetch(`/api/invoices/${invoiceId}`, { method: "DELETE" });
  await loadInvoices();
}

document.getElementById("invoiceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  await fetch("/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  form.reset();
  await loadInvoices();
});

document.getElementById("runFollowUps").addEventListener("click", async (e) => {
  const btn = e.target;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Checking…";
  try {
    const res = await fetch("/api/follow-ups/run", { method: "POST" });
    const data = await res.json();
    btn.textContent = `${original} (${data.follow_ups_placed} placed)`;
    setTimeout(() => (btn.textContent = original), 2500);
  } finally {
    btn.disabled = false;
    await loadInvoices();
  }
});

(async () => {
  await loadMode(); // must resolve first: renderCard() reads currentMode
  await loadInvoices();
})();
