const listEl = document.getElementById("list");
const detailEl = document.getElementById("detail");
const healthEl = document.getElementById("health");
const scenariosEl = document.getElementById("scenarios");

let selectedId = null;
let incidents = [];

async function loadHealth() {
  try {
    const health = await (await fetch("/api/health")).json();
    
    const calleStatus = health.calleConfigured ? "ok" : "bad";
    const oncallStatus = health.oncallConfigured ? "ok" : "bad";
    
    healthEl.innerHTML = `
      <div class="health-badge ${calleStatus}"><i class="ph-fill ph-${health.calleConfigured ? 'check' : 'x'}-circle"></i> CALL-E Ready</div>
      <div class="health-badge ${oncallStatus}"><i class="ph-fill ph-${health.oncallConfigured ? 'check' : 'x'}-circle"></i> On-call Set</div>
      <div class="health-badge ok"><i class="ph-fill ph-check-circle"></i> Catalog Ready</div>
    `;
    healthEl.className = "health";
  } catch (error) {
    healthEl.innerHTML = `<div class="health-badge bad"><i class="ph-fill ph-x-circle"></i> ${String(error)}</div>`;
    healthEl.className = "health";
  }
}

async function loadScenarios() {
  const scenarios = await (await fetch("/api/scenarios")).json();
  scenariosEl.innerHTML = scenarios
    .map(
      (item) => `<button class="scenario" type="button" data-id="${item.id}" title="Say: ${escapeHtml(item.sayOnPhone.replace("{code}", "CODE"))}">
        <i class="ph ph-lightning"></i>
        <span>${escapeHtml(item.title)}</span>
      </button>`
    )
    .join("");
  for (const button of scenariosEl.querySelectorAll("button")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const created = await (
          await fetch("/api/incidents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "console", scenarioId: button.dataset.id })
          })
        ).json();
        if (created.error) throw new Error(created.error);
        selectedId = created.id;
        await loadIncidents();
      } catch (error) {
        alert(error.message ?? error);
      } finally {
        button.disabled = false;
      }
    });
  }
}

async function loadIncidents() {
  incidents = await (await fetch("/api/incidents")).json();
  renderList();
  if (selectedId) {
    const match = incidents.find((item) => item.id === selectedId);
    if (match) renderDetail(match);
  } else if (incidents[0]) {
    selectedId = incidents[0].id;
    renderDetail(incidents[0]);
    renderList();
  }
}

function getStatusIcon(status) {
  if (status === "resolved" || status === "completed") return '<i class="ph-fill ph-check-circle" style="color: #3dd68c;"></i>';
  if (status === "failed" || status === "error" || status === "no_answer" || status === "timeout") return '<i class="ph-fill ph-x-circle" style="color: #ff6b6b;"></i>';
  if (status === "calling" || status === "in_call" || status === "in-progress" || status === "executing" || status === "gathering") return '<i class="ph-fill ph-spinner-gap ph-spin" style="color: #f0b429;"></i>';
  return '<i class="ph-fill ph-circle" style="color: #888;"></i>';
}

function renderList() {
  listEl.innerHTML = incidents
    .map(
      (item) => `<li data-id="${item.id}" class="${item.id === selectedId ? "active" : ""}">
        <div class="status">${getStatusIcon(item.status)} ${item.status}</div>
        <div class="title">${escapeHtml(item.triggerReason).slice(0, 90)}</div>
        <small>${new Date(item.createdAt).toLocaleString()}</small>
      </li>`
    )
    .join("");
  for (const li of listEl.querySelectorAll("li")) {
    li.addEventListener("click", () => {
      selectedId = li.dataset.id;
      const item = incidents.find((row) => row.id === selectedId);
      renderList();
      if (item) renderDetail(item);
    });
  }
}

function renderDetail(item) {
  const snap = item.snapshot;
  const post = item.postActionSnapshot;
  const line = item.sayOnPhone
    ? item.sayOnPhone.replace("{code}", item.confirmationCode)
    : `Say the action, then confirm ${item.confirmationCode}.`;
  detailEl.innerHTML = `
    <h2><i class="ph-fill ph-warning" style="color: #f0b429;"></i> ${escapeHtml(item.scenarioId || item.source)}</h2>
    <p class="status">${getStatusIcon(item.status)} ${item.status} &nbsp;&middot;&nbsp; CALL-E: <code>${escapeHtml(item.calleCallId ?? "not placed yet")}</code></p>
    <p class="trigger">${escapeHtml(item.triggerReason)}</p>
    <div class="say">
      <h3><i class="ph ph-phone-call"></i> When the phone rings, say exactly</h3>
      <p><code>${escapeHtml(line)}</code></p>
      <p class="conf">Confirmation phrase: <code>${escapeHtml(item.confirmationCode)}</code></p>
      <pre>${escapeHtml(item.fixCommand || "")}</pre>
      ${
        item.calleCallId && !item.execution
          ? `<button type="button" id="sync"><i class="ph ph-arrows-clockwise"></i> Pull CALL-E result</button>`
          : ""
      }
    </div>
    
    <div class="grid">
      <div class="card">
        <h3><i class="ph ph-chart-line-up"></i> Failure telemetry</h3>
        ${snap ? snapshotHtml(snap) : "<p class='empty'>Loading case…</p>"}
      </div>
      <div class="card">
        <h3><i class="ph ph-terminal-window"></i> Spoken decision & execution</h3>
        <pre>${escapeHtml(JSON.stringify({ spoken: item.spoken, execution: item.execution }, null, 2))}</pre>
        ${item.error ? `<p class="health bad"><i class="ph-fill ph-warning-circle"></i> ${escapeHtml(item.error)}</p>` : ""}
      </div>
      <div class="card">
        <h3><i class="ph ph-chats-circle"></i> Transcript</h3>
        <div class="transcript">${
          item.transcript?.length
            ? item.transcript
                .map(
                  (turn) =>
                    `<p class="${turn.speaker === "bot" ? "bot" : ""}"><strong>${escapeHtml(
                      turn.speaker === "bot" ? "CALL-E" : "You"
                    )}:</strong> ${escapeHtml(turn.text)}</p>`
                )
                .join("")
            : "<div class='empty'>Waiting for CALL-E.</div>"
        }</div>
      </div>
      <div class="card">
        <h3><i class="ph ph-shield-check"></i> Post-Action Telemetry</h3>
        ${post ? snapshotHtml(post) : "<p class='empty'>No post-action snapshot yet.</p>"}
      </div>
    </div>
    <div class="audit">
      <h3><i class="ph ph-clock-counter-clockwise"></i> Audit Log</h3>
      <pre>${escapeHtml((item.audit ?? []).map((row) => `${row.at}  ${row.kind.padEnd(10)}  ${row.detail}`).join("\n"))}</pre>
    </div>
  `;
  const syncBtn = document.getElementById("sync");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      try {
        const updated = await (
          await fetch(`/api/incidents/${item.id}/sync`, { method: "POST" })
        ).json();
        if (updated.error) throw new Error(updated.error);
        selectedId = updated.id;
        await loadIncidents();
      } catch (error) {
        alert(error.message ?? error);
      } finally {
        syncBtn.disabled = false;
      }
    });
  }
}

function snapshotHtml(snap) {
  return `<pre>${escapeHtml(
    [
      `${snap.region} ${snap.cluster}/${snap.service}`,
      `running ${snap.runningCount} desired ${snap.desiredCount} pending ${snap.pendingCount}`,
      `task ${snap.currentRevision} → previous ${snap.previousRevision ?? "none"}`,
      `alarm ${snap.alarm.name ?? "N/A"} ${snap.alarm.state ?? ""} ${snap.alarm.reason ?? ""}`,
      `cpu ${snap.cpuPercent ?? "N/A"}%  5xx ${snap.target5xx ?? "N/A"}  unhealthy ${snap.unhealthyTargets ?? "N/A"}`,
      snap.securityGroup ? `sg ${snap.securityGroup.id}: ${snap.securityGroup.ingress.join("; ")}` : "",
      ...(snap.events ?? []).slice(0, 4),
      ...(snap.recentLogs ?? []).slice(-4)
    ]
      .filter(Boolean)
      .join("\n")
  )}</pre>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const stream = new EventSource("/api/stream");
stream.addEventListener("incident", () => {
  loadIncidents();
});

loadHealth();
loadScenarios();
loadIncidents();
setInterval(loadHealth, 15000);
