(() => {
  "use strict";
  const form = document.getElementById("permit-form");
  const panel = document.getElementById("result-panel");
  const status = document.getElementById("status");
  const previewButton = document.getElementById("preview-button");
  let liveReady = false;
  let lastRequest = null;

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  const readRequest = () => {
    const values = new FormData(form);
    return {
      workflow_id: values.get("workflow_id"),
      phone: values.get("phone"),
      caller_has_authority: document.getElementById("authority").checked,
      recipient_is_public_department_number: document.getElementById("public-number").checked,
      organization_display_name: values.get("organization_display_name"),
      jurisdiction: values.get("jurisdiction"),
      department: values.get("department"),
      permit_reference: values.get("permit_reference"),
      project_type: values.get("project_type"),
      region: values.get("region"),
      locale: values.get("locale"),
      questions: values.getAll("questions"),
    };
  };
  const post = async (url, body) => {
    const response = await fetch(url, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  };
  const renderError = (error) => { panel.innerHTML = `<div class="result-content"><div class="error"><b>Could not build the brief.</b><br>${escapeHtml(error.message)}</div></div>`; };
  const renderPreview = (payload) => {
    const args = payload.call_arguments;
    const recipient = args.recipients[0];
    panel.innerHTML = `<div class="result-content">
      <span class="result-tag">Masked no-call preview</span>
      <h2>Ready for a deliberate decision.</h2>
      <div class="result-grid">
        <div><b>Recipient</b><span>${escapeHtml(recipient.phones[0])}</span></div>
        <div><b>Region / locale</b><span>${escapeHtml(recipient.region)} · ${escapeHtml(recipient.locale)}</span></div>
        <div><b>Creates a call</b><span>No</span></div>
        <div><b>Duplicate guard</b><span>${escapeHtml(args.idempotency_key)}</span></div>
      </div>
      <b class="result-tag">Exact CALL‑E task</b>
      <div class="task">${escapeHtml(args.task)}</div>
      <div class="live-box">
        <label><input id="live-confirm" type="checkbox"> I reviewed this exact masked plan and want to place one real call now.</label>
        <button id="live-button" type="button" ${liveReady ? "" : "disabled"}>${liveReady ? "Place one CALL‑E call" : "CALL‑E key not configured"}<span>☎</span></button>
      </div>
    </div>`;
    const liveButton = document.getElementById("live-button");
    liveButton?.addEventListener("click", runLiveCall);
  };
  const renderResult = (payload) => {
    const result = payload.structured_result || {};
    panel.innerHTML = `<div class="result-content"><span class="result-tag">Completed call</span><h2>${escapeHtml(result.current_status || payload.status || "Result received")}</h2>
      <div class="result-grid"><div><b>Blocker</b><span>${escapeHtml(result.blocker_summary || "Unknown")}</span></div><div><b>Next action</b><span>${escapeHtml(result.next_action || "Unknown")}</span></div><div><b>Deadline</b><span>${escapeHtml(result.response_deadline || "Unknown")}</span></div><div><b>Follow-up</b><span>${escapeHtml(result.followup_contact || "Unknown")}</span></div></div>
      <b class="result-tag">Evidence summary</b><div class="task">${escapeHtml(result.evidence_summary || "No summary returned")}</div></div>`;
  };
  async function runLiveCall() {
    const confirmation = document.getElementById("live-confirm");
    if (!confirmation?.checked) { renderError(new Error("Review the plan and confirm the one live call first.")); return; }
    const button = document.getElementById("live-button");
    button.disabled = true; button.firstChild.textContent = "Calling and waiting for the result…";
    try {
      const payload = await post("/api/call", {request:lastRequest,confirmations:{authority:true,public_number:true,live_call:true}});
      renderResult(payload);
    } catch (error) { renderError(error); }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); previewButton.disabled = true; previewButton.firstChild.textContent = "Building preview…";
    try { lastRequest = readRequest(); renderPreview(await post("/api/preview", lastRequest)); }
    catch (error) { renderError(error); }
    finally { previewButton.disabled = false; previewButton.firstChild.textContent = "Build masked preview "; }
  });
  fetch("/api/health").then((response) => response.json()).then((payload) => {
    liveReady = Boolean(payload.live_ready);
    status.classList.add(liveReady ? "ready" : "preview");
    status.querySelector("span").textContent = liveReady ? "CALL‑E live mode ready" : "Preview mode · no API key";
  }).catch(() => { status.querySelector("span").textContent = "Local preview"; });
})();
