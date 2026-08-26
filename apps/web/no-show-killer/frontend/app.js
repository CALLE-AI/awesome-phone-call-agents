const API_BASE = "http://localhost:5200";
const TOKEN_KEY = "noShowKillerApiToken";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const appointmentsEl = document.getElementById("appointments");
const cardTemplate = document.getElementById("card-template");
const apiStatusEl = document.getElementById("api-status");
const runBatchBtn = document.getElementById("run-batch");
const authGateEl = document.getElementById("auth-gate");
const authFormEl = document.getElementById("auth-form");
const authTokenInputEl = document.getElementById("auth-token-input");
const authErrorEl = document.getElementById("auth-error");

// Statuses that mean a call is actively being dispatched or is already in
// flight - mirrors IN_FLIGHT_STATUSES on the backend.
const IN_FLIGHT_STATUSES = ["DISPATCHING", "STARTED", "CALLING"];

function showAuthGate(message) {
  document.body.classList.add("auth-locked");
  authGateEl.classList.remove("hidden");
  if (message) {
    authErrorEl.textContent = message;
    authErrorEl.classList.remove("hidden");
  } else {
    authErrorEl.classList.add("hidden");
  }
  authTokenInputEl.focus();
}

function hideAuthGate() {
  document.body.classList.remove("auth-locked");
  authGateEl.classList.add("hidden");
}

// A 401 anywhere means the stored token is missing or wrong - drop it and
// make the operator re-enter it instead of silently retrying forever.
function handleUnauthorized() {
  clearToken();
  if (ws) {
    ws.onclose = null; // don't let this expected close trigger a reconnect loop
    ws.close();
    ws = null;
  }
  showAuthGate("That token was rejected. Enter the current API token.");
}

authFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = authTokenInputEl.value.trim();
  if (!token) return;
  setToken(token);
  authTokenInputEl.value = "";
  await start();
});

// Health check and status display
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    const usable = data.calle?.usable;
    apiStatusEl.textContent = usable
      ? "✅ backend connected, CALL-E authenticated"
      : "⚠️ backend connected, CALL-E NOT authenticated (run `calle auth login`)";
    apiStatusEl.style.color = usable ? "var(--accent)" : "#b33a33";
  } catch {
    apiStatusEl.textContent = "⚠️ backend unreachable";
    apiStatusEl.style.color = "#b33a33";
  }
}

// Fetch appointments from the backend
async function fetchAppointments() {
  const res = await fetch(`${API_BASE}/api/appointments`, { headers: authHeaders() });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    throw new Error(`Backend returned ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Format ISO date string to a more readable format
function formatTime(iso) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Render appointments in the UI — updates existing cards in place instead of
// wiping and rebuilding the whole list, so active calls don't cause flicker.
function render(appointments) {
  if (!appointments || appointments.length === 0) {
    appointmentsEl.innerHTML = `
      <div class="empty-state">
        <p>No appointments scheduled</p>
        <p class="empty-subtitle">Add your first appointment above</p>
      </div>
    `;
    return;
  }

  // If we're coming from the empty state (or initial loading message),
  // clear it out before adding real cards.
  if (!appointmentsEl.querySelector(".card") && appointmentsEl.children.length) {
    appointmentsEl.innerHTML = "";
  }

  const seenIds = new Set();

  for (const appt of appointments) {
    seenIds.add(String(appt.id));
    let card = appointmentsEl.querySelector(`[data-id="${CSS.escape(String(appt.id))}"]`);

    if (!card) {
      const node = cardTemplate.content.cloneNode(true);
      appointmentsEl.appendChild(node);
      card = appointmentsEl.lastElementChild;
      card.dataset.id = String(appt.id);
    }

    updateCard(card, appt);
  }

  // Remove cards for appointments that no longer exist
  for (const card of appointmentsEl.querySelectorAll(".card")) {
    if (!seenIds.has(card.dataset.id)) card.remove();
  }
}

// Update a single card's contents to match the given appointment data.
function updateCard(card, appt) {
  const nameEl = card.querySelector(".patient-name");
  if (nameEl.textContent !== appt.patientName) nameEl.textContent = appt.patientName;

  const serviceEl = card.querySelector(".service");
  if (serviceEl.textContent !== appt.service) serviceEl.textContent = appt.service;

  const timeText = formatTime(appt.scheduledAt);
  const timeEl = card.querySelector(".time");
  if (timeEl.textContent !== timeText) timeEl.textContent = timeText;

  const badge = card.querySelector(".badge");
  const newBadgeClass = `status-${appt.status}`;
  if (!badge.classList.contains(newBadgeClass)) {
    badge.className = "badge";
    badge.classList.add(newBadgeClass);
  }
  if (badge.textContent !== appt.status) badge.textContent = appt.status;

  // Mark the card as "live" while a call is actively being dispatched or is
  // in progress, so the pulsing indicator shows the user something is
  // happening in the background.
  card.classList.toggle("is-live", IN_FLIGHT_STATUSES.includes(appt.status));

  // Activity log — only append new lines instead of rebuilding the whole thing
  const activityEl = card.querySelector(".activity");
  const activityCount = appt.activity?.length || 0;

  if (activityCount === 0) {
    if (!activityEl.querySelector(".waiting-message")) {
      activityEl.innerHTML = `<span class="waiting-message">⏳ Waiting for call...</span>`;
    }
  } else {
    if (activityEl.querySelector(".waiting-message")) activityEl.innerHTML = "";
    const renderedCount = activityEl.children.length;
    for (let i = renderedCount; i < activityCount; i++) {
      const item = appt.activity[i];
      const line = document.createElement("div");
      line.classList.add("activity-line-new");
      const ts = item.ts ? `${formatTime(item.ts)} — ` : "";
      line.textContent = `${ts}${item.message ?? ""}`;
      activityEl.appendChild(line);
      // Trigger the fade-in on next frame, then drop the class once done
      requestAnimationFrame(() => {
        line.classList.add("activity-line-enter");
        setTimeout(() => line.classList.remove("activity-line-new", "activity-line-enter"), 400);
      });
    }
  }

  // Result summary / transcript
  if (appt.summary || appt.transcript) {
    const resultEl = card.querySelector(".result");
    resultEl.classList.remove("hidden");

    const summaryText = appt.summary || "Not available.";
    const summaryEl = resultEl.querySelector(".summary");
    if (summaryEl.textContent !== summaryText) summaryEl.textContent = summaryText;

    const transcriptText = appt.transcript || "No transcript available.";
    const transcriptEl = resultEl.querySelector(".transcript");
    if (transcriptEl.textContent !== transcriptText) transcriptEl.textContent = transcriptText;
  }

  // Confirm button state
  const btn = card.querySelector(".confirm-btn");
  let btnText;
  let btnDisabled;

  if (!appt.status) {
    btnDisabled = true;
    btnText = "⏳ No call yet";
  } else if (IN_FLIGHT_STATUSES.includes(appt.status)) {
    // A call is genuinely being dispatched or is already running - keep the
    // button disabled with distinct copy so it doesn't look like a fresh,
    // clickable "send confirmation call" button and invite a second call to
    // the same patient.
    btnDisabled = true;
    btnText = appt.status === "DISPATCHING" ? "📞 Starting call…" : "📞 Call in progress…";
  } else if (appt.status === "PENDING") {
    btnDisabled = false;
    btnText = "📞 Send confirmation call";
  } else if (appt.status === "DISPATCH_FAILED") {
    btnDisabled = false;
    btnText = "⚠️ Retry call";
  } else if (appt.status === "DISPATCH_UNCERTAIN") {
    // CALL-E never confirmed the call didn't start - staying disabled here is
    // deliberate, not a bug. Retrying automatically risks a duplicate real
    // call; this needs a human to check CALL-E's own records first.
    btnDisabled = true;
    btnText = "⚠️ Needs manual review";
  } else {
    btnDisabled = false;
    btnText = "📞 Call again";
  }

  if (btn.textContent !== btnText) btn.textContent = btnText;
  if (btn.disabled !== btnDisabled) btn.disabled = btnDisabled;

  // Attach the click listener only once per card
  if (!btn.dataset.bound) {
    btn.addEventListener("click", () => confirmAppointment(appt.id, btn));
    btn.dataset.bound = "true";
  }
}

// Confirm an appointment by triggering a call via the backend
async function confirmAppointment(id, btn) {
  btn.disabled = true;
  btn.textContent = "⏳ Calling…";
  try {
    const res = await fetch(`${API_BASE}/api/appointments/${id}/confirm`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.status === 401) {
      handleUnauthorized();
    } else if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.code === "call_in_progress") {
        alert("A call for this appointment is already in progress.");
      } else if (body.code === "dispatch_uncertain") {
        alert(
          "This appointment's last call outcome is uncertain. Check CALL-E's own records, " +
            "then clear it by hand before retrying - it won't retry automatically."
        );
      } else if (body.code === "unauthorized_destination") {
        alert("This appointment's phone number is not an authorized calling destination.");
      } else {
        alert(`Failed to start call: ${body.error || res.statusText}`);
      }
    }
  } catch (err) {
    alert(`Failed to start call: ${err.message}`);
  }
  await refresh();
}

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Connect to the backend WebSocket for real-time updates
function connectWebSocket() {
  const token = getToken();
  if (!token) return;

  try {
    // Auth is sent as the first message after connecting, not in the URL - a
    // query string can end up in proxy/access logs and browser history.
    const wsUrl = `${API_BASE.replace(/^http/, "ws")}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token }));
      reconnectAttempts = 0;
      checkHealth(); // re-run so the "live" indicator reflects current state cleanly
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "appointment_update") {
          refresh();
        }
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    };

    ws.onclose = (event) => {
      if (event.code === 4401) {
        handleUnauthorized();
        return;
      }
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 30000);
        console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        setTimeout(connectWebSocket, delay);
      } else if (!window.pollingInterval) {
        // Fallback to polling if WebSocket fails permanently
        window.pollingInterval = setInterval(refresh, 10000);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  } catch (err) {
    console.error("Failed to create WebSocket:", err);
  }
}

async function refresh() {
  try {
    const appointments = await fetchAppointments();
    render(appointments);
  } catch (err) {
    console.error("Failed to load appointments:", err);
    appointmentsEl.innerHTML = `
      <div class="error">
        <strong>⚠️ Couldn't load appointments</strong>
        <p>${err.message}</p>
        <p style="margin-top: 0.5rem; font-size: 0.85rem; opacity: 0.8;">
          Check that the backend is running at ${API_BASE}
          and that this page was opened via http:// (not by double-clicking the file).
        </p>
      </div>
    `;
  }
}

runBatchBtn.addEventListener("click", async () => {
  runBatchBtn.disabled = true;
  runBatchBtn.textContent = "⏳ Starting calls…";
  try {
    const response = await fetch(`${API_BASE}/api/confirm-tomorrow`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (response.status === 401) {
      handleUnauthorized();
    } else if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    } else {
      const result = await response.json();
      console.log("Batch call result:", result);
    }
  } catch (err) {
    alert(`Failed to start batch calls: ${err.message}`);
  } finally {
    runBatchBtn.disabled = false;
    runBatchBtn.textContent = "📞 Run tomorrow's confirmation calls";
  }
  await refresh();
});

const addForm = document.getElementById("add-form");

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const patientName = document.getElementById("patientName").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const service = document.getElementById("service").value.trim();
  const scheduledAtLocal = document.getElementById("scheduledAt").value;

  if (!patientName || !phone || !service || !scheduledAtLocal) {
    alert("Please fill in all fields");
    return;
  }

  const scheduledAt = new Date(scheduledAtLocal).toISOString();
  const submitBtn = addForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "⏳ Adding...";

  try {
    const res = await fetch(`${API_BASE}/api/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ patientName, phone, service, scheduledAt }),
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Backend returned ${res.status}`);
    }
    addForm.reset();
    await refresh();
    document.getElementById("appointments").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    alert(`Failed to add appointment: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add appointment";
  }
});

// Initial loading state, then real data
let initialLoad = true;

async function initialRefresh() {
  if (initialLoad) {
    appointmentsEl.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--muted);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">⏳</div>
        <p>Loading appointments...</p>
      </div>
    `;
    initialLoad = false;
  }
  await refresh();
}

function startIntervals() {
  if (window.__intervalsStarted) return;
  window.__intervalsStarted = true;

  // Safety net only — WebSocket is the primary update path
  setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) refresh();
  }, 30000);

  // Health check every minute
  setInterval(checkHealth, 60000);
}

// Entry point: require a token before touching any patient data. If one's
// already stored, try it silently; a 401 during that first fetch re-shows
// the gate via handleUnauthorized().
async function start() {
  const token = getToken();
  if (!token) {
    showAuthGate();
    return;
  }

  hideAuthGate();
  checkHealth();
  await initialRefresh();

  if (getToken()) {
    connectWebSocket();
    startIntervals();
  }
}

start();
