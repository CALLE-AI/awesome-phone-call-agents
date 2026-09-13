const form = document.querySelector("#request-form");
const plan = document.querySelector("#plan");
const result = document.querySelector("#result");
const button = document.querySelector("#start-call");
const confirmation = document.querySelector("#confirmation");
let request;
let runId;

function showError(message) { window.alert(message); }
function fields(data) { return Object.fromEntries(data.entries()); }
function detailNodes(items) {
  return items.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    return [term, description];
  });
}
async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}
function setStatus(data) {
  document.querySelector("#status").textContent = data.status || "PREPARING";
  document.querySelector("#status-message").textContent = data.message || "CALL-E is processing the request.";
  const activity = document.querySelector("#activity");
  activity.replaceChildren(...(data.activity || []).map((item) => {
    const li = document.createElement("li");
    li.textContent = item.message || "Status updated.";
    return li;
  }));
  if (data.summary || data.transcript || Object.keys(data.extracted || {}).length) {
    document.querySelector("#outcome").classList.remove("hidden");
    document.querySelector("#summary").textContent = data.summary || "No summary was returned.";
    document.querySelector("#transcript").textContent = data.transcript || "Not available.";
    document.querySelector("#extracted").textContent = JSON.stringify(data.extracted || {}, null, 2);
  }
}
async function poll() {
  if (!runId) return;
  try {
    const data = await api(`/api/status/${encodeURIComponent(runId)}`);
    setStatus(data);
    const terminal = ["COMPLETED", "FAILED", "NO_ANSWER", "DECLINED", "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED"];
    if (!terminal.includes(data.status)) window.setTimeout(poll, 10_000);
  } catch (error) { showError(error.message); }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  request = { ...fields(new FormData(form)), idempotencyKey: `service-rescue:${crypto.randomUUID()}` };
  try {
    const data = await api("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    document.querySelector("#plan-summary").textContent = data.summary;
    document.querySelector("#call-details").replaceChildren(...detailNodes([
      ["Provider", request.providerPhone],
      ["Request", request.serviceType],
      ["Time", request.timeWindow]
    ]));
    plan.classList.remove("hidden");
    plan.scrollIntoView({ behavior: "smooth" });
  } catch (error) { showError(error.message); }
});
function updateAuthorization() {
  button.disabled = confirmation.value.trim() !== "CALL" || !document.querySelector("#authority").checked || !document.querySelector("#not-emergency").checked;
}
confirmation.addEventListener("input", updateAuthorization);
document.querySelector("#authority").addEventListener("input", updateAuthorization);
document.querySelector("#not-emergency").addEventListener("input", updateAuthorization);
button.addEventListener("click", async () => {
  try {
    button.disabled = true;
    const data = await api("/api/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, confirmation: confirmation.value.trim(), authority: document.querySelector("#authority").checked, notEmergency: document.querySelector("#not-emergency").checked }) });
    runId = data.runId;
    result.classList.remove("hidden");
    setStatus(data);
    result.scrollIntoView({ behavior: "smooth" });
    if (runId) poll();
  } catch (error) { showError(error.message); updateAuthorization(); }
});
document.querySelector("#test-login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const login = await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    const message = `Signed in as ${login.username}`;
    document.querySelector("#login-status").textContent = message;
    window.alert(message);
  } catch (error) { document.querySelector("#login-status").textContent = error.message; window.alert(error.message); }
});
